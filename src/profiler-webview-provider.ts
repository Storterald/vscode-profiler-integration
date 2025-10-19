import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import * as vscode from "vscode";
import * as crypto from "crypto";
import { ProfilerOutput } from "./iprofiler";

export class ProfilerWebviewProvider implements vscode.WebviewViewProvider {
        private _view?: vscode.WebviewView;
        private _ctx: vscode.ExtensionContext;
        private _pendingData?: ProfilerOutput;

        constructor(context: vscode.ExtensionContext) {
                this._ctx = context;
        }

        public async resolveWebviewView(webviewView: vscode.WebviewView) {
                this._view = webviewView;

                webviewView.webview.options = {
                        enableScripts: true,
                        localResourceRoots: [this._ctx.extensionUri]
                };

                webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

                webviewView.webview.onDidReceiveMessage(async (data) => {
                        switch (data.type) {
                        case "ready":
                                if (this._pendingData)
                                        await this.updateFlamegraph(this._pendingData);
                                break;
                        case "file-loaded":
                                if ((this._pendingData = await utils.unpack(Buffer.from(data.content))))
                                        await this.updateFlamegraph(this._pendingData);
                                break;
                        }
                });
        }

        public async updateFlamegraph(data: ProfilerOutput) {
                this._pendingData = data;
                
                if (this._view)
                        await this._view.webview.postMessage(this._pendingData);
        }

        private _getHtmlForWebview(webview: vscode.Webview) {
                const nonce: string = crypto.randomBytes(16).toString("base64");

                let html: string  = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.html"), "utf-8");
                const css: string = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.css"), "utf-8");
                const js: string  = fs.readFileSync(path.join(this._ctx.extensionPath, "webview", "profiler.js"), "utf-8");

                html = html.replace("<!-- meta -->", `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">`);
                html = html.replace("<!-- css -->", `<style>${css}</style>`);
                html = html.replace("<!-- js -->", `<script nonce="${nonce}">${js}</script>`);
                return html;
        }
}