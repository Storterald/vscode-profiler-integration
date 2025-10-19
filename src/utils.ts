import * as fs from "fs";
import * as zip from "zlib";
import * as path from "path";
import * as vscode from "vscode";
import { ProfilerOutput } from "./iprofiler";

export async function pack(context: vscode.ExtensionContext, data: ProfilerOutput): Promise<void> {
        function getFormattedTime(): string {
                return new Date().toISOString().replace("T", "_").replace(/:/g, '-').replace(/\..+/, "");
        }

        const dir: string = path.join(context.extensionPath, "cached")
        if (!fs.existsSync(dir))
                fs.mkdirSync(dir);

        const outputPath: string = path.join(dir, `${getFormattedTime()}.vscprof`);
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