import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import * as vscode from "vscode";
import * as crypto from "crypto";
import { ProfilerOutput } from "./iprofiler";

export class ProfilerWebviewProvider implements vscode.WebviewViewProvider {
        private _view:        vscode.WebviewView | undefined;
        private _ctx:         vscode.ExtensionContext;
        private _pendingData: ProfilerOutput | undefined;

        constructor(context: vscode.ExtensionContext) {
                this._ctx = context;
        }

        public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
                interface ReadyMessage {
                        type: "ready";
                }

                interface InvalidMessage {
                        type: "invalid";
                }

                interface FileLoadedMessage {
                        type:    "file-loaded";
                        name:    string;
                        content: number[];
                }

                type Message = ReadyMessage | InvalidMessage | FileLoadedMessage;

                this._view = webviewView;

                webviewView.webview.options = {
                        enableScripts:      true,
                        localResourceRoots: [this._ctx.extensionUri]
                };

                webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

                webviewView.webview.onDidReceiveMessage(async (data: Message): Promise<void> => {
                        switch (data.type) {
                        case "ready":
                                if (this._pendingData)
                                        await this.updateView(this._pendingData);
                                break;
                        case "file-loaded":
                                if ((this._pendingData = await utils.unpack(Buffer.from(data.content))))
                                        await this.updateView(this._pendingData);
                                break;
                        case "invalid":
                                await vscode.window.showErrorMessage("Error obtaining profiler output.");
                                break;
                        }
                });
        }

        public async updateView(data: ProfilerOutput): Promise<void> {
                this._pendingData = data;
                
                if (this._view)
                        await this._view.webview.postMessage(this._pendingData);
        }

        private _getHtmlForWebview(webview: vscode.Webview): string {
                const css: string   = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.css"), "utf-8");
                const js1: string   = fs.readFileSync(path.join(this._ctx.extensionPath, "build", "webview", "elements.js"), "utf-8");
                const js2: string   = fs.readFileSync(path.join(this._ctx.extensionPath, "build", "webview", "profiler.js"), "utf-8");
                const nonce: string = crypto.randomBytes(16).toString("base64");

                return fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.html"), "utf-8")
                        .replace("<!-- meta -->",     `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">`)
                        .replace("<!-- css -->",      `<style>${css}</style>`)
                        .replace("<!-- js-types -->", `<script nonce="${nonce}">${js1}</script>`)
                        .replace("<!-- js-code -->",  `<script nonce="${nonce}">${js2}</script>`);
        }
}
