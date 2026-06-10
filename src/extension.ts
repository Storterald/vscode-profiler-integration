import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as utils from "./utils";
import { Perf } from "./profilers/perf";
import { AMDuProf } from "./profilers/uProf";
import { IntelVtune } from "./profilers/VTune";
import { IProfiler, ProfilerOutput } from "./iprofiler";
import { ProfilerWebviewProvider } from "./profiler-webview-provider";

let profilerWebview: ProfilerWebviewProvider;

// noinspection JSUnusedGlobalSymbols
export async function activate(context: vscode.ExtensionContext): Promise<void> {
        profilerWebview = new ProfilerWebviewProvider(context);

        vscode.window.registerWebviewViewProvider("profiler.webview", profilerWebview);

        context.subscriptions.push(vscode.commands.registerCommand("profiler.profile-project", async (): Promise<void> => {
                // TODO support for single file applications
                const exe: string = await vscode.commands.executeCommand("cmake.getLaunchTargetPath");
                await vscode.commands.executeCommand("cmake.build");

                const profiler: IProfiler | undefined = ((): IProfiler | undefined => {
                        if (process.platform === "linux")
                                return new Perf();

                        if (process.platform === "win32") {
                                const model: string = os.cpus()[0].model;
                                if (/intel/i.test(model))
                                        return new IntelVtune();

                                if (/amd|ryzen|epyc/i.test(model))
                                        return new AMDuProf();
                        }

                        vscode.window.showErrorMessage("Unsupported platform.");
                        return undefined;
                })();
                if (!profiler)
                        return;

                const cli: string | undefined = await profiler.cli();
                if (!cli)
                        return;

                const cwd: string    = path.dirname(exe);
                const outDir: string = fs.mkdtempSync(path.join(os.tmpdir(), profiler.constructor.name));

                try {
                        console.info(`Profiling: '${exe}', cwd: '${cwd}'`)

                        const root: ProfilerOutput | undefined = await profiler.profile(context, cli, cwd, outDir, exe);
                        if (!root)
                                return;

                        await utils.pack(context, root);
                        await profilerWebview.updateView(root);
                        vscode.commands.executeCommand("profiler.webview.focus");
                } finally {
                        fs.rmSync(outDir, { recursive: true, force: true });
                }
        }));
}
