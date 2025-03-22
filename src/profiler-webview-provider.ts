import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as crypto from 'crypto';
import { StackFrame } from "./iprofiler";

export class ProfilerWebviewProvider implements vscode.WebviewViewProvider {
        private _view?: vscode.WebviewView;
        private _extensionUri: vscode.Uri;
        private _extensionPath: string;
        private _pendingData?: StackFrame;

        constructor(private readonly context: vscode.ExtensionContext) {
                this._extensionUri = context.extensionUri;
                this._extensionPath = context.extensionPath;
        }

        public resolveWebviewView(webviewView: vscode.WebviewView) {
                this._view = webviewView;

                webviewView.webview.options = {
                        enableScripts: true,
                        localResourceRoots: [this._extensionUri]
                };

                webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

                webviewView.webview.onDidReceiveMessage(data => {
                        if (data.type === 'ready') {
                                console.log('Webview ready');
                                if (this._pendingData) {
                                        this.updateFlamegraph(this._pendingData);
                                        this._pendingData = undefined;
                                }
                        }
                });
        }

        public updateFlamegraph(data: StackFrame) {
                this._pendingData = data;
                
                if (this._view)
                        this._view.webview.postMessage(data);
        }

        private validateStackFrame(frame: any): StackFrame | null {
                try {
                        const result: StackFrame = {
                                name: String(frame.name),
                                value: Number(frame.value),
                                children: []
                        };

                        if (!result.name || isNaN(result.value) || result.value <= 0) {
                                return null;
                        }

                        if (Array.isArray(frame.children)) {
                                result.children = frame.children
                                        .map((child: any) => this.validateStackFrame(child))
                                        .filter((child: StackFrame | null) => child !== null) as StackFrame[];
                        }

                        return result;
                } catch (error) {
                        console.error('Data validation failed:', error);
                        return null;
                }
        }

        private _getHtmlForWebview(webview: vscode.Webview) {
                const nonce = crypto.randomBytes(16).toString('base64');

                let html: string = fs.readFileSync(path.join(this._extensionPath, "resources", "profiler.html"), "utf-8");
                const css = fs.readFileSync(path.join(this._extensionPath, "resources", "profiler.css"), "utf-8");
                const js = fs.readFileSync(path.join(this._extensionPath, "resources", "profiler.js"), "utf-8");

                html = html.replace("<!-- meta -->", `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">`);
                html = html.replace("<!-- css -->", `<style>${css}</style>`);
                html = html.replace("<!-- js -->", `<script nonce="${nonce}">${js}</script>`);
                return html;
        }
}