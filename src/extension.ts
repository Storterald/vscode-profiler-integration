import * as vscode from "vscode";
import { Perf } from "./profilers/perf";
import { AMDuProf } from "./profilers/uProf";
import { IProfiler, ProfilerOutput } from "./iprofiler";
import { ProfilerWebviewProvider } from "./profiler-webview-provider";

let profilerWebview: ProfilerWebviewProvider;

export function activate(context: vscode.ExtensionContext) {
        profilerWebview = new ProfilerWebviewProvider(context);

        vscode.window.registerWebviewViewProvider("profiler.webview", profilerWebview);
        context.subscriptions.push(getProfileCommand(context));
}

function getProfileCommand(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.commands.registerCommand("profiler.profile-project", async () => {
                // TODO support for single file applications
                const exe: string = await vscode.commands.executeCommand("cmake.getLaunchTargetPath");
                await vscode.commands.executeCommand("cmake.build");

                let profiler: IProfiler = process.platform == "win32" ? new AMDuProf() : new Perf();

                const root: ProfilerOutput | undefined = await profiler.profile(context, exe);
                if (!root)
                        return;
                
                await profilerWebview.updateFlamegraph(root);
                vscode.commands.executeCommand("profiler.webview.focus");
        });
}