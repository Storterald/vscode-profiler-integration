interface ProfilerOutput {
        exeName:    string;
        type:       string;
        stackFrame: StackFrame;
}

interface StackFrame {
        name:     string;
        value:    number;
        children: StackFrame[];
}

type View = "flame-graph" | "calltree" | "methods";

// @ts-ignore
const vscode: any = acquireVsCodeApi();

const mainElement: HTMLDivElement      = document.querySelector("#main")!;
const tooltip: HTMLDivElement          = document.querySelector(".tooltip")!;
const time: HTMLDivElement             = tooltip.querySelector(".tooltip-time")!;
const funcName: HTMLParagraphElement   = tooltip.querySelector("#function-name")!;
const flame: SVGElement                = tooltip.querySelector("#fire-icon")!;
const value: HTMLParagraphElement      = tooltip.querySelector("#value-count-label")!;
const absolute: HTMLParagraphElement   = tooltip.querySelector("#absolute-percentage-label")!;
const relative: HTMLParagraphElement   = tooltip.querySelector("#relative-percentage-label")!;
const parentName: HTMLParagraphElement = tooltip.querySelector("#parent-name")!;

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
                        renderCurrentView();
        });
});

document.querySelector(".input-file")!.addEventListener("change", async (e: Event): Promise<void> => {
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

function renderCurrentView(): void {
        mainElement.innerHTML     = "";
        mainElement.style.cssText = "";

        mainElement.className = `${currentView}-container`;

        switch (currentView) {
                case "flame-graph":
                        renderFlamegraph(currentData!);
                        break;
                case "calltree":
                        renderCallTree(currentData!);
                        break;
                case "methods":
                        renderMethodList(currentData!);
                        break;
        }
}

function getColorHue(value: number, rootValue: number): number {
        const intensity = Math.min(0.8, (0.6 * value) / rootValue + 0.3);
        return 40 - (40 * intensity);
}

function renderFlamegraph(output: ProfilerOutput): void {
        interface FlameNode {
                name: string;
                value: number;
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

        function renderNodes(parent: { name: string, value: number }, node: FlameNode): void {
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
                        const absPercentage: number = (node.value / root.value) * 100;
                        const relPercentage: number = (node.value / parent.value) * 100;

                        if (absPercentage >= 20) {
                                time.classList.add("tooltip-fire");
                                flame.style.display = "block";
                        } else {
                                time.classList.remove("tooltip-fire");
                                flame.style.display = "none";
                        }

                        funcName.textContent   = node.name;
                        value.textContent      = `${node.value}${output.type}`;
                        absolute.textContent   = `${absPercentage.toFixed(2)}%`;
                        relative.textContent   = `${relPercentage.toFixed(2)}%`;
                        parentName.textContent = parent.name;

                        tooltip.style.display = "block";
                        tooltip.style.opacity = "1";
                });

                element.addEventListener("mousemove", (e: MouseEvent): void => {
                        const rect: DOMRect = mainElement.getBoundingClientRect();
                        if (rect.right - e.clientX < rect.width * 0.5) {
                                tooltip.style.right = `${rect.width - e.clientX + 15}px`;
                                tooltip.style.left  = "";
                        } else {
                                tooltip.style.left  = `${e.clientX + 15}px`;
                                tooltip.style.right = "";
                        }

                        if (rect.bottom - e.clientY < rect.height * 0.2) {
                                tooltip.style.bottom = `${rect.height - e.clientY + 10}px`
                                tooltip.style.top     = ""
                        } else {
                                tooltip.style.top    = `${e.clientY - 10}px`;
                                tooltip.style.bottom = ""
                        }
                });

                element.addEventListener("mouseleave", () => {
                        tooltip.style.opacity = "0";
                        tooltip.style.display = "none";
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

        const root: StackFrame = output.stackFrame;
        root.children.forEach((node: StackFrame): void => {
                const tree: HTMLUListElement = document.createElement("ul");
                tree.className               = "calltree";

                addNode(node, tree);
                mainElement.appendChild(tree);

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
                name: string;
                value: number;
        }

        const root: StackFrame = output.stackFrame;

        const titlebar: HTMLDivElement = document.createElement("div");
        titlebar.className             = "methods-titlebar";
        mainElement.appendChild(titlebar);

        const method: HTMLDivElement = document.createElement("div");
        method.style.width           = "50%";
        titlebar.appendChild(method);

        const methodText: HTMLDivElement = document.createElement("p");
        methodText.textContent           = "Method";
        method.appendChild(methodText);

        const samples: HTMLDivElement = document.createElement("div");
        samples.style.width           = "20%";
        titlebar.appendChild(samples);

        const samplesText: HTMLDivElement = document.createElement("p");
        samplesText.textContent           = "Samples";
        samples.appendChild(samplesText);

        const nodes: Method[] = [];
        function addNode(node: StackFrame): void {
                nodes.push({ name: node.name, value: node.value });
                if (node.children)
                        node.children.forEach(addNode);
        }

        root.children.forEach(addNode);
        nodes.sort((a: Method, b: Method): number => b.value - a.value);

        nodes.forEach((node: Method): void => {
                const div: HTMLDivElement = document.createElement("div");
                div.className             = "method";

                const name: HTMLParagraphElement = document.createElement("p");
                name.textContent                 = node.name;
                div.appendChild(name);

                const bar: HTMLDivElement = document.createElement("div");
                bar.className             = "method-bar";
                div.appendChild(bar);

                const bg: HTMLDivElement = document.createElement("div");
                bg.className             = "method-bar-bg";
                bg.style.width           = `${(node.value / nodes[0].value) * 100}%`;
                bg.style.background      = `hsl(${getColorHue(node.value, nodes[0].value)}, 100%, 50%)`;
                bar.appendChild(bg);

                mainElement.appendChild(div);
        });
}

function isValidProfilerOutput(data: ProfilerOutput): boolean {
        return !!data.exeName && !!data.type && !!data.stackFrame && !!data.stackFrame.value;
}

window.addEventListener("message", (event: MessageEvent<ProfilerOutput>): void => {
        if (event.data && isValidProfilerOutput(event.data)) {
                currentData = event.data;
                renderCurrentView();
        } else {
                console.error("[Webview] Invalid data format:", event.data);
                vscode.postMessage({ type: "invalid" });
        }
});

console.log("[Webview] Initialized");
vscode.postMessage({ type: "ready" });
