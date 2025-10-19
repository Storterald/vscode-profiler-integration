import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as which from "which";
import * as vscode from "vscode";
import * as utils from "../utils";
import { ExtensionContext } from "vscode";
import { IProfiler, ProfilerOutput, StackFrame } from "../iprofiler";

export class Perf implements IProfiler {
        public async profile(context: ExtensionContext, exePath: string): Promise<ProfilerOutput | undefined> {
                const cli: string | undefined = await this.cli();
                if (!cli)
                        return;

                const cwd: string    = path.dirname(exePath);
                const outDir: string = fs.mkdtempSync(path.join(os.tmpdir(), "perf-"));

                console.info(`Profiling: '${exePath}', cwd: '${cwd}'`)

                try {
                        return await this._run(context, cli, cwd, outDir, exePath);
                } finally {
                        fs.rmSync(outDir, { recursive: true, force: true });
                }
        }

        public async cli(): Promise<string | undefined> {
                try {
                        return await which("perf");
                } catch {
                        await vscode.window.showErrorMessage("Perf not found.");
                }
        }

        private async _run(context: ExtensionContext, cli: string, cwd: string, outDir: string, exePath: string): Promise<ProfilerOutput | undefined> {
                const perfData: string = path.join(outDir, "perf.data");
                const outFile: string  = path.join(outDir, "perf.txt");

                let output: ProfilerOutput | undefined     = undefined;
                let translateTask: vscode.Task | undefined = undefined;
                let done: boolean                          = false;

                const runTask = new vscode.Task(
                        { type: "shell" },
                        vscode.TaskScope.Workspace,
                        "Profile an application",
                        "VSCode Profiler Integration",
                        new vscode.ShellExecution(this._getProfileCommand(cli, perfData, exePath), { cwd: cwd })
                );

                const runDisposable = vscode.tasks.onDidEndTaskProcess(async (e) => {
                        if (e.execution.task !== runTask)
                                return;

                        runDisposable.dispose();
                        if (e.exitCode !== 0) {
                                vscode.window.showErrorMessage("Profiler error. Not generating output.");
                                done = true;
                                return;
                        }

                        translateTask = new vscode.Task(
                                { type: "shell" },
                                vscode.TaskScope.Workspace,
                                "Translate Profiler Output",
                                "VSCode Profiler Integration",
                                new vscode.ShellExecution(this._getTranslateCommand(cli, perfData, outFile), { cwd: outDir })
                        );

                        await vscode.tasks.executeTask(translateTask);
                });

                const translateDisposable = vscode.tasks.onDidEndTaskProcess(async (e) => {
                        if (!translateTask || e.execution.task !== translateTask)
                                return;

                        translateDisposable.dispose();
                        if (e.exitCode !== 0) {
                                vscode.window.showErrorMessage("Profiler error. Not generating output.");
                                done = true;
                                return;
                        }

                        output = await this._getRoot(outFile, path.basename(exePath));

                        await utils.pack(context, output);
                        done = true;
                });

                await vscode.tasks.executeTask(runTask);

                return new Promise<ProfilerOutput | undefined>((resolve) => {
                        const checkCompletion = () => {
                                if (done)
                                        resolve(output);
                        }

                        const interval = setInterval(() => {
                                checkCompletion();
                                if (done)
                                        clearInterval(interval);

                        }, 100);
                })
        }

        private _getProfileCommand(cli: string, outFile: string, exe: string): string {
                return `${cli} record ` +
                        "-F 1000 " +
                        "--call-graph fp " +
                        "-e cycles:u " +
                        `-o '${outFile}' ` +
                        `'${exe}'`;
        }

        private _getTranslateCommand(cli: string, inputFile: string, outFile: string): string {
                return `${cli} script -i ${inputFile} > ${outFile}`;
        }

        private async _getRoot(dataPath: string, exeName: string): Promise<ProfilerOutput> {
                const data: string      = fs.readFileSync(dataPath, "utf-8").toString()
                const samples: string[] = data.split("\n\n")

                let root: ProfilerOutput = {
                        exeName: exeName,
                        type: " cycles",
                        stackFrame: {
                                name: "all",
                                value: 0,
                                children: []
                        }
                };

                samples.forEach(sample => {
                        const lines: string[] = sample.split("\n");
                        const header: string  = lines[0].trim();

                        const headerParts: string[] = header.split(/\s+/);
                        let value: number           = -1;
                        for (let i = 1; i < headerParts.length; ++i) {
                                if (headerParts[i] === "cycles:u:") {
                                        value = parseInt(headerParts[i - 1]);
                                        break;
                                }
                        }

                        if (value === -1)
                                return

                        let current: StackFrame = root.stackFrame;
                        current.value          += value;
                        for (let i = lines.length - 1; i > 0; --i) {
                                const lineParts: string[] = lines[i].trim().split(/\s+/);
                                const name: string        = lineParts[1] === "[unknown]" ?
                                        `unknown!:0x${lineParts[0]}` :
                                        lineParts[1].split('+')[0];

                                let tmp: StackFrame | undefined
                                if ((tmp = current.children.find(v => v.name === name))) {
                                        current = tmp;
                                } else {
                                        let s = current.children.push({
                                                name: name,
                                                value: 0,
                                                children: []
                                        });
                                        current = current.children[s - 1];
                                }
                                
                                current.value += value;
                        }
                })

                return root;
        }

}