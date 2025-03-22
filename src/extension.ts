import * as fs from "fs";
import * as vscode from "vscode";
import { AMDuProf } from "./profilers/uProf";
import { IProfiler, StackFrame } from "./iprofiler";
import { ProfilerWebviewProvider } from "./profiler-webview-provider";

let profilerWebview: ProfilerWebviewProvider;

export function activate(context: vscode.ExtensionContext) {
        profilerWebview = new ProfilerWebviewProvider(context);

        vscode.window.registerWebviewViewProvider("profiler.webview", profilerWebview);
        context.subscriptions.push(getProfileCommand(context));
}

function getProfileCommand(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.commands.registerCommand("profiler.profile-project", async () => {
                const exe: string = await vscode.commands.executeCommand("cmake.getLaunchTargetPath");
                await vscode.commands.executeCommand("cmake.build");

                // TODO add more profilers / selection for them
                const profiler: IProfiler = new AMDuProf();

                const root: StackFrame | undefined = await profiler.profile(context, exe);
                if (!root)
                        return;
                
                fs.writeFileSync("D:/tree.json", JSON.stringify(root, null, 2));
                profilerWebview.updateFlamegraph(root);
                vscode.commands.executeCommand('profiler.webview.focus');
        });
}