import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as zip from "zip-lib";
import * as vscode from "vscode";

export async function pack(context: vscode.ExtensionContext, cpuDb: string): Promise<string | undefined> {
        function getFormattedTime(): string {
                return new Date().toISOString().replace("T", "_").replace(/:/g, '-').replace(/\..+/, "");
        }

        const archive    = path.join(context.extensionPath, "cached", `${path.basename(cpuDb)}.zip`);
        const outputPath = path.join(context.extensionPath, "cached", `${getFormattedTime()}.vscprof`);

        try {
                await zip.archiveFile(cpuDb, archive);
                await fs.promises.rename(archive, outputPath);
                return outputPath;
        } catch (err) {
                vscode.window.showErrorMessage("Error saving the profiled session.");
                console.error(err);
                return;
        }
}

export async function unpack(vscprof: string, filename: string): Promise<string | undefined> {
        const name    = path.parse(vscprof).name;
        const archive = path.join(os.tmpdir(), name + ".zip");
        const dir     = path.join(os.tmpdir(), name);

        try {
                await fs.promises.copyFile(vscprof, archive);
                await zip.extract(archive, dir);

                return path.join(dir, filename);
        } catch (err) {
                vscode.window.showErrorMessage("Error loading the profiled session.");
                console.error(err);
                return;
        } finally {
                if (fs.existsSync(archive))
                        await fs.promises.rm(archive);
        }
}