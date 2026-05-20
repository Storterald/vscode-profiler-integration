import { ExtensionContext } from "vscode";

export interface ProfilerOutput {
        exeName:    string;
        type:       string;
        stackFrame: StackFrame;
}

export interface StackFrame {
        name:     string;
        value:    number;
        children: StackFrame[];
}

export interface IProfiler {
        /**
         * Profile an application. The function should return undefined on error.
         * Error message handling is on the profile function.
         * 
         * @param context vscode context
         * @param cli profiler cli executable path
         * @param cwd working directory path
         * @param outDir output directory path
         * @param exePath path of the application to profile
         */
        profile(context: ExtensionContext, cli: string, cwd: string, outDir: string, exePath: string): Promise<ProfilerOutput | undefined>;

        /**
         * Returns the path to the CLI interface of the profiler.
         * Error message handling is on the cli function.
         */
        cli(): Promise<string | undefined>;
}
