import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as sqlite from "sqlite";
import * as utils from "../utils";
import * as sqlite3 from "sqlite3";
import { ExtensionContext } from "vscode";
import { IProfiler, ProfilerOutput, StackFrame } from "../iprofiler";

interface CallstackFrame {
        callstackId: string;
        functionId: number;
        depth: number;
}

export class AMDuProf implements IProfiler {
        public async profile(context: ExtensionContext, cli: string, cwd: string, outDir: string, exePath: string): Promise<ProfilerOutput | undefined> {
                let ok: boolean = await utils.runCommandTask(
                        "Profile and application", this._getProfileCommand(cli, cwd, outDir, exePath),
                        "Profiler error. Not generating output.");
                if (!ok)
                        return undefined;

                const dir: string | undefined = this._getFirstChildDirectory(outDir);
                if (!dir) {
                        vscode.window.showErrorMessage("Profiler did not generate any output.");
                        return;
                }

                ok = await utils.runCommandTask(
                        "Translate Profiler Output", this._getTranslateCommand(cli, cwd, dir),
                        "Profiler error. Not generating output.");
                if (!ok)
                        return undefined;

                return await this._getRoot(context, path.join(dir!, "cpu.db"), path.basename(exePath));
        }

        public async cli(): Promise<string | undefined> {
                const cli: string | undefined = vscode.workspace.getConfiguration("vscode.profiler.integration").get<string>("uProfCLIPath");
                if (!cli) {
                        await vscode.window.showErrorMessage("AMD uProf CLI executable path not set.");
                        return;
                }

                if (!fs.existsSync(cli) || path.basename(cli) != "AMDuProfCLI.exe") {
                        await vscode.window.showErrorMessage("Invalid AMD uProf CLI executable path.");
                        return;
                }

                return cli;
        }

        private _getProfileCommand(cli: string, cwd: string, outDir: string, exePath: string): string {
                return `& '${cli}' collect ` +
                        "--config tbp " +
                        "--interval 1 " +
                        "--call-graph-interval 1 " +
                        "--call-graph-mode fp " +
                        "--call-graph-depth 256 " +
                        "--call-graph-type user " +
                        `-w '${cwd}' ` +
                        `-o '${outDir}' ` +
                        `'${exePath}'`;
        }

        private _getTranslateCommand(cli: string, cwd: string, input: string): string {
                return `& '${cli}' translate ` +
                        "--agg-interval 1024 " +
                        `--symbol-path ${cwd} ` +
                        `-i ${input}`
        }

        private _getFirstChildDirectory(dirPath: string): string | undefined {
                try {
                        const files = fs.readdirSync(dirPath);
                        const directories = files.filter(file => fs.statSync(path.join(dirPath, file)).isDirectory());

                        return directories.length > 0 ? path.join(dirPath, directories[0]) : undefined;
                } catch {
                        return;
                }
        }

        private async _getRoot(context: vscode.ExtensionContext, cpuDbPath: string, exeName: string): Promise<ProfilerOutput> {
                const db = await sqlite.open({ filename: cpuDbPath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
                const functions = await this._getFunctions(context, db);
                const callstack = await this._getCallstack(context, db);
                const functionModules = await this._getFunctionModules(context, db);
                const callstackWeights = await this._getCallstackWeights(context, db);
                await db.close();

                const root: ProfilerOutput = {
                        exeName: exeName,
                        type: "s",
                        stackFrame: {
                                name: "all",
                                value: 0,
                                children: []
                        }
                };

                for (const frames of callstack.values()) {
                        frames.sort((a: CallstackFrame, b: CallstackFrame): number => b.depth - a.depth); // leaf first

                        let currentNode: StackFrame = root.stackFrame;
                        for (const frame of frames) {
                                let name: string | undefined = functions.get(frame.functionId);
                                if (!name) {
                                        const moduleName = functionModules.get(frame.functionId);
                                        const functionHex = frame.functionId.toString(16);
                                        name = moduleName ?
                                                `${moduleName}!:0x${functionHex}` :
                                                `unknown!:0x${functionHex}`;
                                }

                                let childNode: StackFrame | undefined;
                                if ((childNode = currentNode.children.find(n => n.name === name))) {
                                        currentNode = childNode;
                                } else {
                                        let s = currentNode.children.push({
                                                name: name,
                                                value: 0,
                                                children: []
                                        });
                                        currentNode = currentNode.children[s - 1];
                                }
                        }

                        // Retrieve the sample weight for this callstack (default to 1 if not found)
                        // and add it to the leaf node.
                        const sampleWeight = callstackWeights.get(frames[0].callstackId) || 1;
                        currentNode.value += sampleWeight;
                }

                utils.updateNodeValues(root.stackFrame);
                return root;
        }

        private async _getFunctions(context: vscode.ExtensionContext, db: sqlite.Database): Promise<Map<number, string>> {
                interface Function {
                        functionId: number;
                        functionName: string;
                }

                const query = await this._loadSQL(context, "functions.sql");
                const results = await db.all(query) as Function[];

                const functions = new Map<number, string>();
                results.forEach(({ functionId, functionName }) => {
                        functions.set(functionId, functionName);
                });

                return functions;
        }

        private async _getCallstack(context: vscode.ExtensionContext, db: sqlite.Database): Promise<Map<string, Array<CallstackFrame>>> {
                const query = await this._loadSQL(context, "callstack.sql");
                const results = await db.all(query) as CallstackFrame[];

                const callstack = new Map<string, Array<CallstackFrame>>();
                results.forEach(row => {
                        const id = row.callstackId;
                        if (!callstack.has(id))
                                callstack.set(id, []);

                        callstack.get(id)!.push(row);
                });

                return callstack;
        }

        private async _getCallstackWeights(context: vscode.ExtensionContext, db: sqlite.Database): Promise<Map<string, number>> {
                interface UnifiedSampleRow {
                        callstackId: string;
                        weight: number;
                }

                const query = await this._loadSQL(context, "weights.sql");
                const results = await db.all(query) as UnifiedSampleRow[];

                const weightMap = new Map<string, number>();
                results.forEach(row => {
                        weightMap.set(row.callstackId, row.weight);
                });

                return weightMap;
        }

        private async _getFunctionModules(context: vscode.ExtensionContext, db: sqlite.Database): Promise<Map<number, string | undefined>> {
                const query1 = await this._loadSQL(context, "modules.sql");
                const results1 = await db.all(query1) as { moduleId: number, modulePath: string }[];

                const moduleNames = new Map<number, string>();
                results1.forEach(({ moduleId, modulePath }) => {
                        moduleNames.set(moduleId, path.basename(modulePath));
                });

                const query2 = await this._loadSQL(context, "unifiedSampleSeries.sql");
                const results2 = await db.all(query2) as { moduleId: number, functionId: number }[];

                const functionModules = new Map<number, string | undefined>();
                results2.forEach(({ moduleId, functionId }) => {
                        functionModules.set(functionId, moduleNames.get(moduleId));
                });

                return functionModules;
        }

        private async _loadSQL(context: vscode.ExtensionContext, filePath: string): Promise<string> {
                return fs.promises.readFile(path.join(context.extensionPath, "queries", filePath), "utf8");
        }

}
