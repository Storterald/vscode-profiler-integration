import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as utils from "../utils";
import * as csv from "csv-parse/sync"
import { ExtensionContext } from "vscode";
import { IProfiler, ProfilerOutput, StackFrame } from "../iprofiler";

export class IntelVtune implements IProfiler {
        public async profile(_: ExtensionContext, cli: string, cwd: string, outDir: string, exePath: string): Promise<ProfilerOutput | undefined> {
                let ok = await utils.runCommandTask(
                        "Profile an application", this._getProfileCommand(cli, cwd, outDir, exePath),
                        "Profiler error. Not generating output.");
                if (!ok)
                        return undefined;

                ok = await utils.runCommandTask(
                        "Translate Profiler Output", this._getTranslateCommand(cli, outDir),
                        "Profiler error. Not generating output.");
                if (!ok)
                        return undefined;

                return await this._getRoot(outDir, path.basename(exePath));
        }

        public async cli(): Promise<string | undefined> {
                const cli: string | undefined = vscode.workspace.getConfiguration("vscode.profiler.integration").get<string>("VTuneCLIPath");
                if (!cli) {
                        await vscode.window.showErrorMessage("Intel VTune executable path not set.");
                        return;
                }

                if (!fs.existsSync(cli) || path.basename(cli) != "vtune.exe") {
                        await vscode.window.showErrorMessage("Invalid Intel VTune CLI executable path.");
                        return;
                }

                return cli;
        }

        private _getProfileCommand(cli: string, cwd: string, outDir: string, exePath: string): string {
                return `& '${cli}' -collect hotspots ` +
                        `-app-working-dir="${cwd}" ` +
                        `-result-dir="${outDir}" ` +
                        `'${exePath}'`;
        }

        private _getTranslateCommand(cli: string, outDir: string): string {
                return `& '${cli}' -report callstacks ` +
                        "-format=csv " +
                        "-csv-delimiter=comma " +
                        `-report-output="${path.join(outDir, "callstacks.csv")}" ` +
                        `-result-dir="${outDir}" `;
        }

        private async _getRoot(outDir: string, exeName: string): Promise<ProfilerOutput> {
                const callstacks: string = fs.readFileSync(path.join(outDir, "callstacks.csv"), "utf8");

                const root: ProfilerOutput = {
                        exeName:       exeName,
                        type:          " s",
                        stackFrame: {
                                name:     "all",
                                value:    0,
                                thread:   undefined,
                                cpu:      undefined,
                                children: []
                        },
                        supportsCpu:   false,
                        supportsHeap:  false,
                        supportsStack: false,
                        timepoints:    []
                };

                const callstacksData: string[][] = csv.parse(callstacks, { delimiter: ",", skip_empty_lines: true  });
                for (let i: number = 1; i < callstacksData.length; ++i) {
                        if (callstacksData[i][0] === "")
                                continue;

                        const name: string                           = callstacksData[i][0];
                        let stack: { name: string, value: number }[] = [ { name: name, value: Number.parseFloat(callstacksData[i][2]) } ];
                        while (i + 1 < callstacksData.length && callstacksData[i + 1][0] === "" && callstacksData[i + 1][1] !== "")
                                stack.push({ name: callstacksData[++i][1], value: Number.parseFloat(callstacksData[i][2]) });

                        let parent: StackFrame = root.stackFrame;
                        for (let j: number = stack.length - 1; j >= 0; --j) {
                                const value: number               = stack[j].value;
                                const tmp: StackFrame | undefined = parent.children.find(s => s.name === stack[j].name);
                                if (!tmp) {
                                        const s: number = parent.children.push({
                                                name:     stack[j].name,
                                                value:    value,
                                                thread:   "TODO-thread",
                                                cpu:      "TODO-cpu",
                                                children: []
                                        })

                                        parent = parent.children[s - 1]
                                        continue;
                                }

                                tmp.value += value;
                                parent     = tmp;
                        }
                }

                utils.updateNodeValues(root.stackFrame);
                return root;
        }
}