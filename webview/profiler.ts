// @ts-ignore
const vscode: any = acquireVsCodeApi();

interface ProfilerOutput {
        exeName:    string;
        type:       string;
        stackFrame: StackFrame;
}

interface StackFrameBase {
        name:     string;
        value:    number;
}

interface StackFrame extends StackFrameBase {
        children: StackFrame[];
}

type View = "flame-graph" | "calltree" | "methods";

class HTMLResizableGridElement extends HTMLElement {
        private observer: MutationObserver | undefined;

        constructor() {
                super();

                this.observer = new MutationObserver((mutations: MutationRecord[]): void => {
                        for (const mutation of mutations)
                                if (mutation.type === "childList")
                                        this.updateList();
                });

                this.observer.observe(this, {
                        childList: true
                });
        }

        connectedCallback(): void {
                this.setAttribute("is-resizing", "false");
                this.updateList();
        }

        updateList(): void {
                if (this.children.length === 0)
                        return;

                const elsPanes: NodeListOf<HTMLElement> = this.querySelectorAll(":scope > .pane");
                let fr: number[]                        = [...elsPanes].map((elPane: HTMLElement): number => {
                        return parseFloat(elPane.dataset.fr || (1 / elsPanes.length).toString());
                });

                let elPaneCurr: HTMLElement | null = null;
                let paneIndex: number              = -1;
                let frStart: number                = 0;
                let frNext: number                 = 0;

                const frToCSS = (): void => {
                        this.style.gridTemplateColumns = fr.join("fr ") + "fr";
                }

                const pointerDown = (e: MouseEvent): void => {
                        if (!e.target || !e.currentTarget)
                                return;

                        if (this.getAttribute("is-resizing") === "true"
                            || !(e.target as HTMLElement).closest(".gutter"))
                                return;

                        elPaneCurr = (e.currentTarget as HTMLElement).previousElementSibling! as HTMLElement;
                        fr         = [...elsPanes].map((elPane: HTMLElement): number => elPane.clientWidth / this.clientWidth);
                        paneIndex  = [...elsPanes].indexOf(elPaneCurr);
                        frStart    = fr[paneIndex];
                        frNext     = fr[paneIndex + 1];

                        this.setAttribute("is-resizing", "true");
                        this.addEventListener("pointermove", pointerMove);
                        this.addEventListener("pointerup", pointerUp);
                }

                const pointerMove = (e: MouseEvent): void => {
                        e.preventDefault();

                        const paneBCR: DOMRect   = elPaneCurr!.getBoundingClientRect();
                        const parentSize: number = this.clientWidth;
                        const pointer            = {
                                x: Math.max(0, Math.min(e.clientX - paneBCR.left, this.clientWidth)),
                                y: Math.max(0, Math.min(e.clientY - paneBCR.top, this.clientHeight))
                        };

                        const frRel: number  = pointer.x / parentSize;
                        const frDiff: number = frStart - frRel;
                        fr[paneIndex]        = Math.max(0.05, frRel);
                        fr[paneIndex + 1]    = Math.max(0.05, frNext + frDiff);

                        frToCSS();

                        elPaneCurr!.dispatchEvent(new Event("resize"));
                }

                const pointerUp = (_: MouseEvent): void => {
                        this.removeEventListener("pointermove", pointerMove);
                        this.removeEventListener("pointerup", pointerUp);
                        this.setAttribute("is-resizing", "false");
                }

                const elNew = (tag: string, prop = {}): HTMLElement => {
                        return Object.assign(document.createElement(tag), prop);
                }

                const first: HTMLElement = this.children[0] as HTMLElement;
                first.getElementsByClassName("gutter")[0]?.remove();
                first.onpointerdown = null;

                for (let i: number = 1; i < this.children.length; ++i) {
                        const child: HTMLElement = this.children[i] as HTMLElement;
                        if (child.getElementsByClassName("gutter").length === 0)
                                child.append(elNew("span", { className: "gutter" }));
                        child.onpointerdown = pointerDown;
                }

                frToCSS();
                window.dispatchEvent(new Event("resize"));
        }
}
customElements.define("resizable-grid", HTMLResizableGridElement);

class HTMLFunctionTooltipElement extends HTMLElement {
        private static tooltip: HTMLFunctionTooltipElement | undefined;

        constructor() {
                super();
        }

        connectedCallback(): void {
                this.innerHTML = `
<div class="tooltip-time tooltip-fire">
        <p id="function-name" class="tooltip-function"></p>
        <div style="flex-grow: 1"></div>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" id="fire-icon" viewBox="0 0 16 16">
                    <path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15"/>
                </svg>
                <p id="value-count-label"></p>
        </div>
        <div class="tooltip-data">
                <p id="absolute-percentage-label" class="tooltip-percentage"></p>
                <p>of all</p>
                <div></div>
                <div></div>
                <p id="relative-percentage-label" class="tooltip-percentage"></p>
                <p>of</p>
                <p id="parent-name" class="tooltip-function"></p>
        </div>
</div>`
        }

        static show(node: StackFrameBase, parent: StackFrameBase, output: ProfilerOutput): void {
                if (!HTMLFunctionTooltipElement.tooltip)
                        HTMLFunctionTooltipElement.tooltip = document.body.appendChild(document.createElement("function-tooltip")) as HTMLFunctionTooltipElement

                const self: HTMLFunctionTooltipElement = HTMLFunctionTooltipElement.tooltip;

                const absPercentage: number = (node.value / output.stackFrame.value) * 100;
                const relPercentage: number = (node.value / parent.value) * 100;

                const time: HTMLDivElement             = self.querySelector(".tooltip-time")!;
                const funcName: HTMLParagraphElement   = self.querySelector("#function-name")!;
                const flame: SVGElement                = self.querySelector("#fire-icon")!;
                const value: HTMLParagraphElement      = self.querySelector("#value-count-label")!;
                const absolute: HTMLParagraphElement   = self.querySelector("#absolute-percentage-label")!;
                const relative: HTMLParagraphElement   = self.querySelector("#relative-percentage-label")!;
                const parentName: HTMLParagraphElement = self.querySelector("#parent-name")!;

                if (absPercentage >= 20) {
                        time.classList.add("tooltip-fire");
                        flame.style.display = "block";
                } else {
                        time.classList.remove("tooltip-fire");
                        flame.style.display = "none";
                }

                funcName.textContent   = node.name;
                value.textContent      = `${node.value.toFixed(2)}${output.type}`;
                absolute.textContent   = `${absPercentage.toFixed(2)}%`;
                relative.textContent   = `${relPercentage.toFixed(2)}%`;
                parentName.textContent = parent.name;

                self.style.opacity = "1";
                self.style.display = "block";
        }


        static move(x: number, y: number): void {
                if (!HTMLFunctionTooltipElement.tooltip)
                        return;

                const self: HTMLFunctionTooltipElement = HTMLFunctionTooltipElement.tooltip;

                const rect: DOMRect = mainElement.getBoundingClientRect();
                if (rect.right - x < rect.width * 0.5) {
                        self.style.right = `${rect.width - x + 15}px`;
                        self.style.left  = "";
                } else {
                        self.style.left  = `${x + 15}px`;
                        self.style.right = "";
                }

                if (rect.bottom - y < rect.height * 0.2) {
                        self.style.bottom = `${rect.height - y + 10}px`
                        self.style.top     = ""
                } else {
                        self.style.top    = `${y - 10}px`;
                        self.style.bottom = ""
                }
        }

        static hide(): void {
                if (!HTMLFunctionTooltipElement.tooltip)
                        return;

                const self: HTMLFunctionTooltipElement = HTMLFunctionTooltipElement.tooltip;

                self.style.opacity = "0";
                self.style.display = "none";
        }
}
customElements.define("function-tooltip", HTMLFunctionTooltipElement);

const mainElement: HTMLDivElement = document.querySelector("#main")!;

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
        const intensity: number = Math.min(0.8, (0.6 * value) / rootValue + 0.3);
        return 40 - (40 * intensity);
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
                        HTMLFunctionTooltipElement.show(node, parent, output);
                });

                element.addEventListener("mousemove", (e: MouseEvent): void => {
                        HTMLFunctionTooltipElement.move(e.clientX, e.clientY);
                });

                element.addEventListener("mouseleave", () => {
                        HTMLFunctionTooltipElement.hide();
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
                name: string;
                value: number;
        }

        const root: StackFrame = output.stackFrame;

        const grid: HTMLResizableGridElement = document.createElement("resizable-grid") as HTMLResizableGridElement;
        grid.className                       = "panes methods";
        mainElement.appendChild(grid);

        const names: HTMLElement = document.createElement("div");
        names.className          = "pane";
        grid.appendChild(names);

        const samplesCount: HTMLElement = document.createElement("div");
        samplesCount.className          = "pane";
        grid.appendChild(samplesCount);

        const methodText: HTMLDivElement = document.createElement("p");
        methodText.textContent           = "Method";
        names.appendChild(methodText);

        const sampleText: HTMLDivElement = document.createElement("p");
        sampleText.textContent           = "Samples";
        samplesCount.appendChild(sampleText);

        const nodes: Method[] = [];
        function addNode(node: StackFrame): void {
                nodes.push({ name: node.name, value: node.value });
                if (node.children)
                        node.children.forEach(addNode);
        }

        root.children.forEach(addNode);
        nodes.sort((a: Method, b: Method): number => b.value - a.value);

        nodes.forEach((node: Method): void => {
                const name: HTMLParagraphElement = document.createElement("p");
                name.textContent                 = node.name;
                names.appendChild(name);

                const bar: HTMLDivElement = document.createElement("div");
                bar.className             = "method-bar";
                samplesCount.appendChild(bar);

                const bg: HTMLDivElement = document.createElement("div");
                bg.className             = "method-bar-bg";
                bg.style.width           = `${(node.value / nodes[0].value) * 100}%`;
                bg.style.background      = `hsl(${getColorHue(node.value, nodes[0].value)}, 100%, 50%)`;
                bar.appendChild(bg);

                const text: HTMLParagraphElement = document.createElement("p");
                text.className                   = "method-bar-text";
                text.textContent                 = node.value.toFixed(2).toString();
                bar.appendChild(text);
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
