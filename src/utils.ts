import * as fs from "fs";
import * as zip from "zlib";
import * as path from "path";
import * as vscode from "vscode";
import { ShellExecutionOptions } from "vscode";
import { ProfilerOutput, StackFrame } from "./iprofiler";

export function updateNodeValues(node: StackFrame): number {
        if (node.children.length === 0)
                return node.value;

        node.value = node.children.reduce((acc, child) => acc + updateNodeValues(child), node.value);
        return node.value;
}

export async function pack(context: vscode.ExtensionContext, data: ProfilerOutput): Promise<void> {
        function getFormattedTime(): string {
                return new Date().toISOString().replace("T", "_").replace(/:/g, '-').replace(/\..+/, "");
        }

        const dir: string = path.join(context.extensionPath, "cached")
        if (!fs.existsSync(dir))
                fs.mkdirSync(dir);

        const outputPath: string = path.join(dir, `${getFormattedTime()}.vscprof`);
        console.log(`Saving cached profiled session at ${outputPath}`);
        try {
                let buf: Buffer = zip.gzipSync(Buffer.from(JSON.stringify(data), "utf-8"));
                fs.writeFileSync(outputPath, buf, "binary");
        } catch (err) {
                await vscode.window.showErrorMessage("Error saving the profiled session.");
                console.error(err);

                if (fs.existsSync(outputPath))
                        fs.rmSync(outputPath);
        }
}

export async function unpack(vscprof: Buffer): Promise<ProfilerOutput | undefined> {
        try {
                return JSON.parse(zip.gunzipSync(vscprof).toString("utf-8"));
        } catch (err) {
                await vscode.window.showErrorMessage("Error loading the profiled session.");
                console.error(err);
        }
}

export async function runCommandTask(name: string, command: string, error: string, opts: ShellExecutionOptions | undefined = undefined): Promise<boolean> {
        console.debug(`Running console command: ${command}`);

        const task = new vscode.Task(
                { type: "shell" },
                vscode.TaskScope.Workspace,
                name,
                "VSCode Profiler Integration",
                new vscode.ShellExecution(command, opts)
        );

        let done: boolean = false;
        let ok: boolean   = true;
        const runDisposable = vscode.tasks.onDidEndTaskProcess(async (e) => {
                if (e.execution.task !== task)
                        return;

                done = true;

                runDisposable.dispose();
                if (e.exitCode !== 0) {
                        vscode.window.showErrorMessage(error);
                        ok = false;
                }
        });

        await vscode.tasks.executeTask(task);

        return new Promise((resolve) => {
                const checkCompletion = () => {
                        if (done)
                                resolve(ok);
                }

                const interval = setInterval(() => {
                        checkCompletion();
                        if (done)
                                clearInterval(interval);

                }, 100);
        })
}
