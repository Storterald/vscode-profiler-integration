import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as sqlite from "sqlite";
import * as utils from "../utils";
import * as sqlite3 from "sqlite3";
import { ExtensionContext } from "vscode";
import { IProfiler, ProfilerOutput, StackFrame, Timepoint } from "../iprofiler";

interface CallstackFrame {
        callstackId: string;
        functionId: number;
        depth: number;
}

interface FunctionInfo {
        moduleName: string;
        threadId:   number;
        cpuId:      number;
        second:     number;
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
                        "--db sqlite " + // TODO: if version > 5.3
                        `--symbol-path ${cwd} ` +
                        `-i ${input}`
        }

        private _getFirstChildDirectory(dirPath: string): string | undefined {
                try {
                        const files       = fs.readdirSync(dirPath);
                        const directories = files.filter(file => fs.statSync(path.join(dirPath, file)).isDirectory());

                        return directories.length > 0 ? path.join(dirPath, directories[0]) : undefined;
                } catch {
                        return;
                }
        }

        private async _getRoot(context: vscode.ExtensionContext, cpuDbPath: string, exeName: string): Promise<ProfilerOutput> {
                const db = await sqlite.open({
                        filename: cpuDbPath,
                        driver:   sqlite3.Database,
                        mode:     sqlite3.OPEN_READONLY
                });
                try {
                        const [functions, callstack, infos, weights] = await Promise.all([
                                await this._getFunctions(context, db),
                                await this._getCallstack(context, db),
                                await this._getFunctionInfos(context, db),
                                await this._getCallstackWeights(context, db)
                        ]);

                        const root: ProfilerOutput = {
                                exeName:          exeName,
                                type:             " s",
                                stackFrame: {
                                        name:     "all",
                                        value:    0,
                                        thread:   undefined,
                                        cpu:      undefined,
                                        children: []
                                },
                                supportsTimeline: true,
                                supportsCpu:      false,
                                supportsHeap:     false,
                                supportsStack:    false,
                                timepoints:       []
                        };

                        for (const frames of Object.values(callstack)) {
                                frames.sort((a: CallstackFrame, b: CallstackFrame): number => b.depth - a.depth); // leaf first

                                let currentNode: StackFrame = root.stackFrame;
                                for (const frame of frames) {
                                        let name: string | undefined         = functions[frame.functionId];
                                        const info: FunctionInfo | undefined = infos[frame.functionId];
                                        
                                        if (!name) {
                                                const functionHex: string = frame.functionId.toString(16);
                                                name                      = info ?
                                                        `${info.moduleName}!:0x${functionHex}` :
                                                        `unknown!:0x${functionHex}`;
                                        }

                                        if (info) {
                                                const existing: Timepoint      = root.timepoints[info.second] || {
                                                        milli:  info.second * 1000,
                                                        points: {}
                                                }
                                                existing.points[info.threadId] = {
                                                        cpu:   0,
                                                        heap:  0,
                                                        stack: 0
                                                };
                                                root.timepoints[info.second]   = existing;
                                        }
                                        
                                        let childNode: StackFrame | undefined;
                                        if ((childNode = currentNode.children.find(n => n.name === name))) {
                                                currentNode = childNode;
                                        } else {
                                                const size: number = currentNode.children.push({
                                                        name:     name,
                                                        value:    0,
                                                        thread:   info?.threadId,
                                                        cpu:      info?.cpuId,
                                                        children: []
                                                });
                                                currentNode = currentNode.children[size - 1];
                                        }
                                }

                                const weight: number = weights[frames[0].callstackId] || 1;
                                currentNode.value   += weight;
                        }

                        utils.updateNodeValues(root.stackFrame);

                        root.timepoints = root.timepoints.filter(e => e !== null)
                        return root;
                } finally {
                        await db.close();
                }
        }

        private async _getFunctions(context: vscode.ExtensionContext, db: sqlite.Database): Promise<{ [key: number]: string }> {
                interface Function {
                        id:   number;
                        name: string;
                }

                const functionsQuery = await this._loadSQL(context, "functions.sql");
                const functions      = await db.all(functionsQuery) as Function[];

                const functionNames: { [key: number]: string } = {};
                for (const func of functions)
                        functionNames[func.id] = func.name;

                return functionNames;
        }

        private async _getCallstack(context: vscode.ExtensionContext, db: sqlite.Database): Promise<{ [key: string]: CallstackFrame[] }> {
                const callstackQuery  = await this._loadSQL(context, "callstack.sql");
                const callstackFrames = await db.all(callstackQuery) as CallstackFrame[];

                const callstack: { [key: string]: CallstackFrame[] } = {};
                for (const frame of callstackFrames) {
                        const id: string = frame.callstackId;
                        if (!(id in callstack))
                                callstack[id] = [];

                        callstack[id].push(frame);
                }

                return callstack;
        }

        private async _getCallstackWeights(context: vscode.ExtensionContext, db: sqlite.Database): Promise<{ [key: string]: number }> {
                interface UnifiedSampleRow {
                        callstackId: string;
                        weight:      number;
                }

                const weightsQuery = await this._loadSQL(context, "weights.sql");
                const weights      = await db.all(weightsQuery) as UnifiedSampleRow[];

                const functionWeight: { [key: string]: number } = {};
                for (const weight of weights)
                        functionWeight[weight.callstackId] = weight.weight;

                return functionWeight;
        }

        private async _getFunctionInfos(context: vscode.ExtensionContext, db: sqlite.Database): Promise<{ [key: number]: FunctionInfo }> {
                interface Module {
                        id:   number;
                        path: string
                }

                interface Sample {
                        module: number;
                        id:     number;
                        thread: number;
                        cpu:    number;
                        second: number;
                }
                
                const [modulesQuery, samplesQuery] = await Promise.all([
                        await this._loadSQL(context, "modules.sql"),
                        await this._loadSQL(context, "unifiedSampleSeries.sql")
                ]);

                const [modules, samples] = await Promise.all([
                        await db.all(modulesQuery) as Module[],
                        await db.all(samplesQuery) as Sample[]
                ]);

                const moduleNames: { [key: number]: string; } = {};
                for (const module of modules)
                        moduleNames[module.id] = path.basename(module.path);

                const functionModules: { [key: number]: FunctionInfo } = {};
                for (const sample of samples)
                        functionModules[sample.id] = {
                                moduleName: moduleNames[sample.module],
                                threadId:   sample.thread,
                                cpuId:      sample.cpu,
                                second:     sample.second
                        };

                return functionModules;
        }

        private async _loadSQL(context: vscode.ExtensionContext, filePath: string): Promise<string> {
                return fs.promises.readFile(path.join(context.extensionPath, "queries", filePath), "utf8");
        }

}
