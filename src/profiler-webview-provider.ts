import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as crypto from "crypto";
import { IProfiler, StackFrame } from "./iprofiler";

export class ProfilerWebviewProvider implements vscode.WebviewViewProvider {
        private _view?: vscode.WebviewView;
        private _ctx: vscode.ExtensionContext;
        private _pendingData?: StackFrame;
        private _profiler: IProfiler;

        constructor(type: { new(): IProfiler; }, context: vscode.ExtensionContext) {
                this._ctx = context;
                this._profiler = new type();
        }

        public async resolveWebviewView(webviewView: vscode.WebviewView) {
                this._view = webviewView;

                webviewView.webview.options = {
                        enableScripts: true,
                        localResourceRoots: [this._ctx.extensionUri]
                };

                webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

                webviewView.webview.onDidReceiveMessage(async (data) => {
                        if (data.type === "ready") {
                                if (this._pendingData)
                                        this.updateFlamegraph(this._pendingData);
                        } else if (data.type === "file-loaded") {
                                const tmp = path.join(os.tmpdir(), path.basename(data.name));
                                
                                try {
                                        await fs.promises.writeFile(tmp, Buffer.from(data.content));
                                        this._pendingData = await this._profiler.parse(this._ctx, tmp);
                                        await fs.promises.rm(tmp);

                                        if (this._pendingData)
                                                this.updateFlamegraph(this._pendingData);
                                } catch (err) {
                                        vscode.window.showErrorMessage("Error loading the profiled session.");
                                        console.log(err);
                                }
                        }
                });
        }

        public updateFlamegraph(data: StackFrame) {
                this._pendingData = data;
                
                if (this._view)
                        this._view.webview.postMessage(data);
        }

        private _getHtmlForWebview(webview: vscode.Webview) {
                const nonce = crypto.randomBytes(16).toString("base64");

                let html: string = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.html"), "utf-8");
                const css = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.css"), "utf-8");
                const js = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.js"), "utf-8");

                html = html.replace("<!-- meta -->", `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">`);
                html = html.replace("<!-- css -->", `<style>${css}</style>`);
                html = html.replace("<!-- js -->", `<script nonce="${nonce}">${js}</script>`);
                return html;
        }
}