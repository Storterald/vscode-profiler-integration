import * as vscode from "vscode";

export interface StackFrame {
        name: string;
        value: number;
        children: StackFrame[];
}

export interface IProfiler {
        /**
         * Profile an application. The function should return undefined on error.
         * Error message handling is on the profile function.
         * 
         * @param context vscode context
         * @param exePath path of the application to profile
         */
        profile(context: vscode.ExtensionContext, exePath: string): Promise<StackFrame | undefined>;

        /**
         * Returns the path to the CLI interface of the profiler.
         * Error message handling is on the cli function.
         */
        cli(): string | undefined;
}