import * as fs from "fs";
import which from "which";
import * as path from "path";
import * as vscode from "vscode";
import * as utils from "../utils";
import { ExtensionContext } from "vscode";
import {IProfiler, ProfilerOutput, StackFrame, Timepoint} from "../iprofiler";

interface SampleHeader {
        name: string;
        thread: number;
        cpu: number;
        time: number;
}

interface HeaderParseInfo {
        header: SampleHeader;
        newI:   number;
        type:   string;
        value:  number;
}

interface CallstackParseInfo {
        callstack: string[];
        newI:      number;
}

export class Perf implements IProfiler {
        public async profile(_: ExtensionContext, cli: string, cwd: string, outDir: string, exePath: string): Promise<ProfilerOutput | undefined> {
                const perfData: string = path.join(outDir, "perf.data");
                const outFile: string  = path.join(outDir, "perf.txt");

                let ok: boolean = await utils.runCommandTask(
                        "Profile an application", this._getProfileCommand(cli, perfData, exePath),
                        "Profiler error. Not generating output.", { cwd: cwd });
                if (!ok)
                        return undefined;

                ok = await utils.runCommandTask(
                        "Translate Profiler Output", this._getTranslateCommand(cli, perfData, outFile),
                        "Profiler error. Not generating output.", { cwd: outDir });
                if (!ok)
                        return undefined;

                return await this._getRoot(outFile, path.basename(exePath));
        }

        public async cli(): Promise<string | undefined> {
                try {
                        return await which("perf");
                } catch {
                        await vscode.window.showErrorMessage("Perf not installed.");
                }
        }

        private _getProfileCommand(cli: string, outFile: string, exe: string): string {
                return `${cli} record ` +
                        "-F 20 " +
                        "--sample-cpu " +
                        "--stat " +
                        // TODO: maybe run a memory profiler along this
                        // "--sample-mem-info " +
                        "--call-graph fp " +
                        "--running-time " +
                        "-e '{cycles:u,ref-cycles}:S' " +
                        /* TODO: requires sudo or low /proc/sys/kernel/perf_event_paranoid (0 or -1)
                                "-e sched:sched_switch " +
                                "-e sched:sched_wakeup" +
                                "-e sched:sched_process_fork " +
                                "-e sched:sched_process_exit " +
                        */
                        `-o '${outFile}' ` +
                        `'${exe}'`;
        }

        private _getTranslateCommand(cli: string, inputFile: string, outFile: string): string {
                return `${cli} script --header -i ${inputFile} > ${outFile}`;
        }

        private async _getRoot(dataPath: string, exeName: string): Promise<ProfilerOutput> {
                interface SampleData {
                        header:     SampleHeader;
                        cycles?:    number;
                        refCycles?: number;
                        callstack?: string[];
                }

                const data: string = fs.readFileSync(dataPath, "utf-8");

                let root: ProfilerOutput = {
                        exeName:          exeName,
                        type:             " cycles",
                        stackFrame: {
                                name:     "all",
                                value:    0,
                                thread:   undefined,
                                cpu:      undefined,
                                children: []
                        },
                        supportsTimeline: true,
                        supportsCpu:      true,
                        supportsHeap:     false,
                        supportsStack:    false,
                        timepoints:       []
                };

                const headerEndString: string = "#\n";
                const headerEnd: number       = data.indexOf(headerEndString);

                const samples: { [key: string]: SampleData } = {};
                for (let i: number = headerEnd + headerEndString.length; i < data.length;) {
                        const header: HeaderParseInfo = this._parseHeader(data, i);
                        i                             = header.newI;

                        if ((header.type !== "cycles:u" && header.type !== "ref-cycles")
                            || header.header.name != exeName) {
                                i = data.indexOf("\n\n", i) + 2;
                                continue;
                        }

                        const key: string        = `${header.header.thread}:${header.header.time}`;
                        let existing: SampleData = samples[key] || { header: header.header };
                        if (header.type === "cycles:u")
                                existing.cycles = header.value;
                        else // ref-cycles
                                existing.refCycles = header.value;

                        if (header.type !== "cycles:u") {
                                i            = data.indexOf("\n\n", i) + 2;
                                samples[key] = existing;
                                continue;
                        }

                        const callstack: CallstackParseInfo = this._parseCallstack(data, i);
                        existing.callstack                  = callstack.callstack;
                        i                                   = callstack.newI;
                        samples[key]                        = existing;
                }

                const timepoints: Map<number, Timepoint> = new Map();
                const minTime: number                    = Math.min(...Object.values(samples).map((s: SampleData): number => s.header.time))
                for (const sample of Object.values(samples)) {
                        if (!sample.cycles || !sample.refCycles || !sample.callstack)
                                continue;

                        const timepoint: Timepoint = {
                                milli:  Math.floor((sample.header.time - minTime) * 1000),
                                points: {
                                        [sample.header.thread]: {
                                                cpu:   sample.cycles / sample.refCycles * 100,
                                                heap:  0,
                                                stack: 0
                                        }
                                }
                        }
                        const existing: Timepoint | undefined = timepoints.get(sample.header.time);
                        if (existing)
                                existing.points[sample.header.thread] = timepoint.points[sample.header.thread];

                        timepoints.set(sample.header.time, existing || timepoint);

                        let current: StackFrame = root.stackFrame;
                        current.value          += sample.cycles;
                        for (const call of sample.callstack) {
                                let tmp: StackFrame | undefined;
                                if ((tmp = current.children.find((v: StackFrame): boolean => v.name === call))) {
                                        current = tmp;
                                } else {
                                        const s: number = current.children.push({
                                                name:     call,
                                                value:    0,
                                                thread:   sample.header.thread,
                                                cpu:      sample.header.cpu,
                                                children: []
                                        });
                                        current = current.children[s - 1];
                                }
                                
                                current.value += sample.cycles;
                        }
                }

                root.timepoints = [...timepoints.entries()]
                        .sort(([a], [b]) => a - b)
                        .map(([, v]) => v);

                return root;
        }

        private _parseHeader(data: string, i: number): HeaderParseInfo {
                // TODO: maybe avoid reallocs, just linear parsing

                const header: string        = data.substring(i, data.indexOf('\n', i));
                const headerParts: string[] = header.trim().split(/\s+/);

                return {
                        header: {
                                name:   headerParts[0],
                                thread: Number(headerParts[1]),
                                cpu:    Number(headerParts[2].slice(1, -1)),
                                time:   Number(headerParts[3].slice(0, -1))
                        },
                        newI:   i + header.length + 1,
                        type:   headerParts[5].slice(0, -1),
                        value:  Number(headerParts[4])
                };
        }

        private _parseCallstack(data: string, i: number): CallstackParseInfo {
                // TODO: maybe avoid reallocs, just linear parsing

                const callstack: string = data.substring(i, data.indexOf("\n\n", i));
                const calls: string[]   = callstack.split('\n');

                let stack: string[] = [];
                for (const call of calls) {
                        const line: string         = call.trim();
                        const addressEnd: number   = line.indexOf(' ');
                        const address: string      = line.substring(0, addressEnd);
                        const pathBegin: number    = line.lastIndexOf('(');
                        const functionName: string = line.substring(addressEnd + 1, pathBegin - 1);

                        stack.push(functionName === "[unknown]" ?
                                `unknown!:0x${address}` :
                                functionName.split('+')[0]);
                }

                return {
                        callstack: stack.reverse(),
                        newI: i + callstack.length + 2
                }
        }

}
