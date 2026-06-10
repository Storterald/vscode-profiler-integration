// @ts-ignore
const vscode: any = acquireVsCodeApi();

interface TimepointThreadData {
        cpu:     number;
        heap:    number;
        stack:   number;
}

interface Timepoint {
        milli:  number;
        points: { [thread: string]: TimepointThreadData }
}

interface ProfilerOutput {
        exeName:          string;
        type:             string;
        stackFrame:       StackFrame;
        supportsTimeline: boolean;
        supportsCpu:      boolean;
        supportsHeap:     boolean;
        supportsStack:    boolean;
        timepoints:       Timepoint[];
}

interface StackFrameBase {
        name:     string;
        value:    number;
}

interface StackFrame extends StackFrameBase {
        thread:   number | string | undefined;
        cpu:      number | string | undefined;
        children: StackFrame[];
}

interface ChartPoint {
        milli: number;
        value: number;
}

type View = "flame-graph" | "calltree" | "methods" | "timeline";

const threadSelector: HTMLDivElement             = document.getElementById("thread-selector")! as HTMLDivElement;
const mainElement: HTMLDivElement                = document.getElementById("main")! as HTMLDivElement;
const tooltipElement: HTMLFunctionTooltipElement = document.getElementById("tooltip")! as HTMLFunctionTooltipElement;

// JetBrains chevrons. Apache 2.0 license.
const chevrons: string = `
<div class="calltree-item-chevron" aria-expanded="true">
        <svg class="chevron-down" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.5 6.25L8 9.75L4.5 6.25" stroke="#818594" stroke-linecap="round" />
        </svg>
        <svg class="chevron-right" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 11.5L9.5 8L6 4.5" stroke="#818594" stroke-linecap="round" />
        </svg>
</div>`;

let currentThread: string                   = "All threads";
let currentData: ProfilerOutput | undefined = undefined;
let currentView: View                       = "flame-graph";

document.querySelectorAll(".titlebar-tab").forEach((tab: Element): void => {
        tab.addEventListener("click", () => {
                if (tab.classList.contains("active"))
                        return;

                document.querySelectorAll(".titlebar-tab").forEach(tab => {
                        tab.classList.remove("active");
                });

                tab.classList.add("active");
                currentView = (tab as HTMLElement).dataset.view as View;
                if (currentData)
                        renderCurrentView(currentData!);
        });
});

document.getElementById("load-vscprof")!.addEventListener("change", async (e: Event): Promise<void> => {
        const file: File | undefined = (e.target as HTMLInputElement | null)?.files?.[0];
        if (!file)
                return;

        file.arrayBuffer().then((buffer: ArrayBuffer): void => {
                console.log(`Loading file '${file.name}'...`)
                vscode.postMessage({
                        type:    "file-loaded",
                        name:    file.name,
                        content: Array.from(new Uint8Array(buffer))
                });
        })
});

function getCssVariable(name: string): string {
        return window.getComputedStyle(document.body).getPropertyValue(name);
}

function renderCurrentView(output: ProfilerOutput): void {
        mainElement.innerHTML = "";
        mainElement.className = `${currentView}-container`;

        switch (currentView) {
                case "flame-graph":
                        renderFlamegraph(output);
                        break;
                case "calltree":
                        renderCallTree(output);
                        break;
                case "methods":
                        renderMethodList(output);
                        break;
                case "timeline":
                        renderTimeline(output);
                        break;
        }
}

function getColorHue(value: number, rootValue: number): number {
        const intensity: number = Math.min(0.8, (0.6 * value) / rootValue + 0.3);
        return 40 - (40 * intensity);
}

function renderThreadList(output: ProfilerOutput): void {
        threadSelector.innerHTML = "";

        const threads: { [thread: string]: any } = {};
        function addThreads(frame: StackFrame): void {
                if (frame.thread !== undefined)
                        threads[frame.thread] = {};
                for (const child of frame.children)
                        addThreads(child);
        }
        addThreads(output.stackFrame);

        const keys: string[] = ["All threads"];
        keys.push(...Object.keys(threads))
        for (const key of keys) {
                const button: HTMLDivElement = document.createElement("div");
                button.className             = "thread-button";
                button.textContent           = key;
                threadSelector.appendChild(button);
        }

        let current: HTMLElement = threadSelector.firstChild! as HTMLElement;
        function selectThread(event: PointerEvent): void {
                if (!event.target)
                        return;

                current.classList.remove("active");
                current = event.target as HTMLElement;
                current.classList.add("active");

                currentThread = current.textContent;
                renderCurrentView(currentData!);  // TODO: implement thread only views in flame graph and call tree
        }

        for (const child of threadSelector.children)
                (child as HTMLElement).onclick = selectThread;

        (threadSelector.firstChild as HTMLElement).classList.add("active");
}

function renderFlamegraph(output: ProfilerOutput): void {
        interface FlameNode extends StackFrameBase {
                x: number;
                y: number;
                width: number;
                color: string;
                children: FlameNode[];
        }

        const root: StackFrame = output.stackFrame;

        const bottom: HTMLDivElement = document.createElement("div");
        bottom.className             = "flame-graph-bottom";
        mainElement.appendChild(bottom);

        const graph: HTMLDivElement = document.createElement("div");
        graph.className             = "flame-graph";

        const rootColor: string     = getCssVariable("--vscode-profiler-integration.flamegraph.rootColor");
        const nodeColor: string     = getCssVariable("--vscode-profiler-integration.flamegraph.nodeColor");
        let foregroundColor: string = getCssVariable("--vscode-profiler-integration.flamegraph.foreground");

        if (foregroundColor !== "rgba(0, 0, 0, 0)")
                graph.style.color = foregroundColor;

        const nodeHeight: number = Number.parseInt(getCssVariable("--node-height"));

        function processNode(node: StackFrame, x: number, depth: number): FlameNode | undefined {
                interface Accumulator {
                        nodes: FlameNode[];
                        nextX: number;
                }

                const width: number = (node.value / root.value) * 100;
                if (width < 0.05)
                        return;

                const children: StackFrame[] = node.children.sort((a: StackFrame, b: StackFrame): number => b.value - a.value);
                const hue: number            = getColorHue(node.value, root.value);

                return {
                        name:     node.name,
                        value:    node.value,
                        x:        x,
                        y:        depth * nodeHeight,
                        width:    width,
                        color:    node === root ?
                                rootColor === "rgba(0, 0, 0, 0)" ? `hsl(${hue}, 100%, 50%)` : rootColor :
                                nodeColor === "rgba(0, 0, 0, 0)" ? `hsl(${hue}, 100%, 50%)` : nodeColor,
                        children: children.reduce((acc: Accumulator, child: StackFrame): Accumulator => {
                                const processed: FlameNode | undefined = processNode(child, acc.nextX, depth + 1);
                                if (processed) {
                                        acc.nextX += processed.width;
                                        acc.nodes.push(processed);
                                }

                                return acc;
                        }, { nodes: [], nextX: x }).nodes
                };
        }

        // Unlike 'text-overflow: ellipsis', this does not show anything if the
        // container is too small.
        function getTextToFit(nodeWidth: number, nodeName: string): string | undefined {
                const maxChars: number = Math.floor((nodeWidth / 100) * window.innerWidth / 7);
                if (maxChars <= 3)
                        return undefined;

                if (nodeName.length <= maxChars)
                        return nodeName;

                return nodeName.substring(0, maxChars - 3) + "...";
        }

        function renderNodes(parent: StackFrameBase, node: FlameNode): void {
                const element: HTMLDivElement = document.createElement("div");
                element.className             = "flame-node";
                element.style.left            = `${node.x}%`;
                element.style.bottom          = `${node.y}px`;
                element.style.width           = `${node.width}%`;
                element.style.background      = `${node.color}`;

                const textContent: string | undefined = getTextToFit(node.width, node.name);
                if (textContent) {
                        const text: HTMLParagraphElement = document.createElement("p");
                        text.className                   = "flame-node-text";
                        text.textContent                 = textContent;
                        element.appendChild(text);
                }

                element.addEventListener("mouseenter", (): void => {
                        tooltipElement.show(node, parent, output);
                });

                element.addEventListener("mousemove", (e: MouseEvent): void => {
                        tooltipElement.move(e.clientX, e.clientY);
                });

                element.addEventListener("mouseleave", () => {
                        tooltipElement.hide();
                });

                graph.appendChild(element);
                node.children.forEach((child: FlameNode): void => renderNodes(node, child));
        }

        const processedRoot: FlameNode = processNode(root, 0, 0)!;
        renderNodes(root, processedRoot);

        mainElement.appendChild(graph);
}

function renderCallTree(output: ProfilerOutput): void {
        function createListElement(node: StackFrame): HTMLLIElement {
                const li: HTMLLIElement = document.createElement("li");
                li.className            = "calltree-item";

                const data: HTMLDivElement = document.createElement("div");
                data.className             = "calltree-item-data";

                const perc: HTMLParagraphElement = document.createElement("p");
                perc.className   = "calltree-item-percentage"
                perc.textContent = `${((node.value / root.value) * 100).toFixed(1)}%`
                perc.style.color = `hsl(${getColorHue(node.value, root.value)}, 100%, 50%)`

                if (node.children && node.children.length > 0)
                        data.innerHTML = chevrons;
                else
                        perc.style.paddingLeft = "22px"; // 16 svg + 6 gap

                const name: HTMLParagraphElement = document.createElement("p");
                name.textContent                 = node.name;

                data.appendChild(perc);
                data.appendChild(name);

                li.appendChild(data);
                return li;
        }

        function addNode(node: StackFrame, parent: HTMLUListElement): void {
                const element: HTMLLIElement = createListElement(node);

                if (node.children && node.children.length > 0) {
                        const ul: HTMLUListElement = document.createElement("ul");
                        element.appendChild(ul);

                        node.children.forEach((e: StackFrame): void => addNode(e, ul));
                }

                parent.appendChild(element);
        }

        const treeRoot: HTMLElement = document.createElement("div");
        mainElement.appendChild(treeRoot);

        const root: StackFrame = output.stackFrame;
        root.children.forEach((node: StackFrame): void => {
                const tree: HTMLUListElement = document.createElement("ul");
                tree.className               = "calltree";

                addNode(node, tree);
                treeRoot.appendChild(tree);

                tree.addEventListener("click", (e: PointerEvent): void => {
                        const chevron: HTMLDivElement | undefined = (e.target! as HTMLElement | undefined)?.closest(".calltree-item-chevron")!;
                        if (!chevron)
                                return;

                        const li: HTMLLIElement    = chevron.parentElement!.parentElement! as HTMLLIElement;
                        const ul: HTMLUListElement = li.querySelector("ul")!;

                        if (ul.style.display === "none") {
                                chevron.setAttribute("aria-expanded", "true");
                                ul.style.display = "";
                        } else {
                                chevron.setAttribute("aria-expanded", "false");
                                ul.style.display = "none";
                        }
                });
        });
}

function renderMethodList(output: ProfilerOutput): void {
        interface Method {
                name:   string;
                value:  number;
                own:    number;
                thread: string | undefined;
        }

        const root: StackFrame = output.stackFrame;

        const grid: HTMLResizableGridElement = document.createElement("resizable-grid") as HTMLResizableGridElement;
        grid.className                       = "methods";
        mainElement.appendChild(grid);

        const names: HTMLElement = document.createElement("div");
        grid.appendChild(names);

        const samplesCount: HTMLElement = document.createElement("div");
        samplesCount.setAttribute("initial-size", "15");
        grid.appendChild(samplesCount);

        const ownSamplesCount: HTMLElement = document.createElement("div");
        ownSamplesCount.setAttribute("initial-size", "15");
        grid.appendChild(ownSamplesCount);

        const methodText: HTMLDivElement = document.createElement("p");
        methodText.textContent           = "Method";
        names.appendChild(methodText);

        const sampleText: HTMLDivElement = document.createElement("p");
        sampleText.textContent           = "Samples";
        samplesCount.appendChild(sampleText);

        const ownSampleText: HTMLDivElement = document.createElement("p");
        ownSampleText.textContent           = "Own Samples";
        ownSamplesCount.appendChild(ownSampleText);

        let nodes: Method[] = [];
        function addNode(node: StackFrame): void {
                nodes.push({
                        name:   node.name,
                        value:  node.value,
                        own:    node.value - node.children.reduce((sum: number, child: StackFrame): number => sum + child.value, 0),
                        thread: node.thread?.toString()
                });
                node.children.forEach(addNode);
        }

        root.children.forEach(addNode);
        if (currentThread !== "All threads")
                nodes = nodes.filter((node: Method): boolean => node.thread === currentThread);

        nodes.sort((a: Method, b: Method): number => b.value - a.value);

        const maxOwnValue: number = Math.max(...nodes.map((node: Method): number => node.own));
        nodes.forEach((node: Method): void => {
                const name: HTMLParagraphElement = document.createElement("p");
                name.textContent                 = node.name;
                names.appendChild(name);

                const bar1: HTMLDivElement = document.createElement("div");
                bar1.className             = "method-bar";
                samplesCount.appendChild(bar1);

                const bg1: HTMLDivElement = document.createElement("div");
                bg1.className             = "method-bar-bg";
                bg1.style.width           = `${(node.value / nodes[0].value) * 100}%`;
                bg1.style.background      = `hsl(${getColorHue(node.value, nodes[0].value)}, 100%, 50%)`;
                bar1.appendChild(bg1);

                const text1: HTMLParagraphElement = document.createElement("p");
                text1.className                   = "method-bar-text";
                text1.textContent                 = node.value.toFixed(2).toString();
                bar1.appendChild(text1);

                const bar2: HTMLDivElement = document.createElement("div");
                bar2.className             = "method-bar";
                ownSamplesCount.appendChild(bar2);

                const bg2: HTMLDivElement = document.createElement("div");
                bg2.className             = "method-bar-bg";
                bg2.style.width           = `${(node.own / maxOwnValue) * 100}%`;
                bg2.style.background      = `hsl(${getColorHue(node.own, maxOwnValue)}, 100%, 50%)`;
                bar2.appendChild(bg2);

                const text2: HTMLParagraphElement = document.createElement("p");
                text2.className                   = "method-bar-text";
                text2.textContent                 = node.own.toFixed(2).toString();
                bar2.appendChild(text2);
        });
}

function mean(values: number[]): number {
        return values.reduce((sum: number, v: number): number => sum + v, 0) / values.length;
}

function buildSvgChart(timepoints: ChartPoint[], id: string, kind: string, maxY: number, w: number, h: number, pad: { top: number, bottom: number, right: number, left: number }): string {
        const innerW: number = w - pad.left - pad.right;
        const innerH: number = h - pad.top - pad.bottom;
        const minT: number   = timepoints[0].milli;
        const maxT: number   = timepoints[timepoints.length - 1].milli;

        const startX: number = pad.left;
        const endX: number   = w - pad.right;
        const startY: number = h - pad.bottom;

        let line: string;
        if (maxT === minT) {
                const usage: number = mean(timepoints.map((v: ChartPoint): number => v.value)) / maxY;
                const y: number     = pad.top + innerH - usage * innerH;
                line                = `<polygon points="${startX},${startY} ${startX},${y} ${endX},${y} ${endX},${startY}" id="${id}" class="timeline-chart"></polygon>`;
        } else {
                function toX(milli: number): number {
                        return pad.left + ((milli - minT) / (maxT - minT)) * innerW;
                }

                function toY(pct: number): number {
                        return pad.top + innerH - (pct / maxY) * innerH;
                }

                const points: string = timepoints
                        .map((tp: ChartPoint): string => `${toX(tp.milli).toFixed(1)},${toY(tp.value).toFixed(1)}`)
                        .join(' ');
                line                 = `<polygon points="${startX},${startY} ${points} ${endX},${startY}" id="${id}" class="timeline-chart"></polygon>`;
        }

        const yLinesCount: number    = Math.min(maxY, 4);
        const yLinesValues: number[] = [];
        for (let i: number = 0; i <= yLinesCount; ++i)
                yLinesValues.push(i / yLinesCount);

        const yGridLines: string = yLinesValues.map((perc: number): string => {
                const y: number = pad.top + innerH - perc * innerH;
                return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + innerW}" y2="${y}" class="timeline-chart-line"></line>`;
        }).join('\n');

        const yTicks: string = yLinesValues.map((perc: number): string => {
                const y: number = pad.top + innerH - perc * innerH;
                const v: number = perc * maxY;
                return `<text x="${pad.left - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="timeline-chart-text">${v}${kind}</text>`;
        }).join('\n');

        const xGridLines: string = [ 0.25, 0.5, 0.75 ].map((perc: number): string => {
                const x: number = pad.left + innerW * perc;
                return `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + innerH}" class="timeline-chart-line"></line>`;
        }).join('\n');

        const xTicks: string = [ 0, 0.25, 0.5, 0.75, 1 ].map((perc: number): string => {
                const x: number     = pad.left + innerW * perc;
                const t: number     = Math.floor(maxT * perc);
                const label: string = `${Math.floor(t / 60000)}:${Math.floor((t % 60000) / 1000.0)}.${(t % 1000).toString().padStart(3, '0')}`;
                return `<text x="${x}" y="${pad.top + innerH + 20}" text-anchor="middle" class="timeline-chart-text">${label}</text>`;
        }).join('\n');

        return `
<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${w} ${h}"
    preserveAspectRatio="none"
    style="width:100%; height:100%;">
  ${yGridLines}
  ${xGridLines}
  ${line}
  <rect x="${pad.left}" y="${pad.top}" width="${innerW}" height="${innerH}" fill="none" stroke="#ccc" stroke-width="0.5"/>
  ${xTicks}
  ${yTicks}
</svg>`;
}

function renderTimeline(output: ProfilerOutput): void {
        if (!output.supportsTimeline)
                return;

        const w: number = 500;
        const h: number = 300;
        const pad       = { top: 20, bottom: 30, right: 20, left: 40 };

        // TODO: sometimes CPU usage for a thread is over 100%???

        interface FilteredTimepoint {
                milli: number;
                cpu:   number;
                heap:  number;
                stack: number;
        }

        const threadsMaxUsage: number = Math.max(...output.timepoints.map((t: Timepoint): number => Object.keys(t.points).length));

        let filtered: FilteredTimepoint[];
        if (currentThread === "All threads") {
                filtered = output.timepoints.map((t: Timepoint): FilteredTimepoint => {
                        return {
                                milli: t.milli,
                                cpu:   Object.values(t.points).reduce((s: number, v: TimepointThreadData): number => s + v.cpu, 0) / threadsMaxUsage,
                                heap:  Object.values(t.points).reduce((s: number, v: TimepointThreadData): number => s + v.heap, 0),
                                stack: Object.values(t.points).reduce((s: number, v: TimepointThreadData): number => s + v.stack, 0)
                        }
                });
        } else {
                filtered = output.timepoints
                        .filter((t: Timepoint): boolean => currentThread in t.points)
                        .map((t: Timepoint): FilteredTimepoint => {
                                return {
                                        milli: t.milli,
                                        cpu:   t.points[currentThread].cpu,
                                        heap:  t.points[currentThread].heap,
                                        stack: t.points[currentThread].stack
                                }
                        });
        }

        const cpuMeanUsage: number  = output.supportsCpu ? mean(filtered.map((t: FilteredTimepoint): number => t.cpu)) : 0;
        const heapMaxUsage: number  = output.supportsHeap ? Math.max(...filtered.map((t: FilteredTimepoint): number => t.heap)) : 0;
        const stackMaxUsage: number = output.supportsStack ? Math.max(...filtered.map((t: FilteredTimepoint): number => t.stack)) : 0;

        mainElement.innerHTML = `
<div id="cpu-container" class="timeline-grid-element">
  <div class="timeline-container-title">
    <p>CPU</p>
    <p>${cpuMeanUsage.toFixed(2)}%</p>
  </div>
  <div class="chart-container">
    ${ output.supportsCpu ? `
      ${buildSvgChart(filtered.map((t: FilteredTimepoint): ChartPoint => {
        return {
          milli: t.milli,
          value: t.cpu
        }
      }), "cpu-chart", '%', 100, w, h, pad)}` : `
      <p>Profiler does not support CPU Usage</p>`
    }
  </div>
</div>
<div id="heap-container" class="timeline-grid-element">
  <div class="timeline-container-title">
    <p>Heap</p>
    <p>${heapMaxUsage.toFixed(2)}MB</p>
  </div>
  <div class="chart-container">
    ${ output.supportsHeap ? `
      ${buildSvgChart(filtered.map((t: FilteredTimepoint): ChartPoint => {
        return {
          milli: t.milli,
          value: t.heap
        }
      }), "heap-chart", '', heapMaxUsage, w, h, pad)}` : `
      <p>Profiler does not support Heap Usage</p>`
    }
  </div>
</div>
<div id="threads-container" class="timeline-grid-element">
  <div class="timeline-container-title">
    <p>Threads</p>
    <p>${threadsMaxUsage}</p>
  </div>
  <div class="chart-container">
    ${ output.supportsTimeline ? `
      ${buildSvgChart(output.timepoints.map((t: Timepoint): ChartPoint => {
        return {
          milli: t.milli,
          value: Object.keys(t.points).length
        }
      }), "threads-chart", '', threadsMaxUsage, w, h, pad)}` : `
      <p>Profiler does not support Heap Usage</p>`
    }
  </div>
</div>
<div id="stack-container" class="timeline-grid-element">
  <div class="timeline-container-title">
    <p>Non-Heap Memory</p>
    <p>${stackMaxUsage}MB</p>
  </div>
  <div class="chart-container">
    ${ output.supportsStack ? `
      ${buildSvgChart(filtered.map((t: FilteredTimepoint): ChartPoint => {
        return {
          milli: t.milli,
          value: t.stack
        }
      }), "stack-chart", '', stackMaxUsage, w, h, pad)}` : `
      <p>Profiler does not support Stack Usage</p>`
    }
  </div>
</div>`;
}

window.addEventListener("message", (event: MessageEvent<ProfilerOutput>): void => {
        function isValidProfilerOutput(data: ProfilerOutput): boolean {
                return !!data.exeName && !!data.type && !!data.stackFrame && !!data.stackFrame.value;
        }

        if (event.data && isValidProfilerOutput(event.data)) {
                document.getElementById("input-container")!.classList.add("hidden");
                document.getElementById("editor")!.classList.remove("hidden");

                currentData = event.data;
                renderThreadList(currentData!);
                renderCurrentView(currentData!);
        } else {
                console.error("[Webview] Invalid data format:", event.data);
                vscode.postMessage({ type: "invalid" });
        }
});

console.log("[Webview] Initialized");
vscode.postMessage({ type: "ready" });
