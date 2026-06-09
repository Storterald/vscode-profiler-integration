import * as fs from "fs";
import which from "which";
import * as path from "path";
import * as vscode from "vscode";
import * as utils from "../utils";
import { ExtensionContext } from "vscode";
import { IProfiler, ProfilerOutput, StackFrame } from "../iprofiler";

export class Perf implements IProfiler {
        public async profile(_: ExtensionContext, cli: string, cwd: string, outDir: string, exePath: string): Promise<ProfilerOutput | undefined> {
                const perfData: string = path.join(outDir, "perf.data");
                const outFile: string  = path.join(outDir, "perf.txt");

                let ok: boolean = await utils.runCommandTask(
                        "Profile an application", this._getProfileCommand(cli, perfData, exePath),
                        "Profiler error. Not generating output.", { cwd: cwd });
                if (!ok)
                        return undefined;

                ok = await utils.runCommandTask(
                        "Translate Profiler Output", this._getTranslateCommand(cli, perfData, outFile),
                        "Profiler error. Not generating output.", { cwd: outDir });
                if (!ok)
                        return undefined;

                return await this._getRoot(outFile, path.basename(exePath));
        }

        public async cli(): Promise<string | undefined> {
                try {
                        return await which("perf");
                } catch {
                        await vscode.window.showErrorMessage("Perf not installed.");
                }
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
                const data: string      = fs.readFileSync(dataPath, "utf-8");
                const samples: string[] = data.split("\n\n");

                let root: ProfilerOutput = {
                        exeName:    exeName,
                        type:       " cycles",
                        stackFrame: {
                                name:     "all",
                                value:    0,
                                thread:   undefined,
                                cpu:      undefined,
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
                                        const s: number = current.children.push({
                                                name:     name,
                                                value:    0,
                                                thread:   "TODO-thread",
                                                cpu:      "TODO-cpu",
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
