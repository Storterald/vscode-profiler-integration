const vscode = acquireVsCodeApi();
const mainElement = document.querySelector(".main");
const tooltip = document.querySelector(".tooltip");

// Jetbrains chevrons. Apache 2.0 license.
const chevrons = `
<div class="calltree-item-chevron" aria-expanded="true">
        <svg class="chevron-down" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.5 6.25L8 9.75L4.5 6.25" stroke="#818594" stroke-linecap="round" />
        </svg>
        <svg class="chevron-right" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 11.5L9.5 8L6 4.5" stroke="#818594" stroke-linecap="round" />
        </svg>
</div>`;

let currentData = null;
let currentView= "flame";

document.querySelectorAll(".titlebar-button").forEach(button => {
        button.addEventListener("click", () => {
                if (button.classList.contains("active"))
                        return;

                document.querySelectorAll(".titlebar-button").forEach(b => {
                        b.classList.remove("active");
                        b.querySelector(".titlebar-button-border").classList.remove("active");
                });

                button.classList.add("active");
                button.querySelector(".titlebar-button-border").classList.add("active");

                currentView = button.dataset.view;
                if (currentData)
                        renderCurrentView();
        });
});

document.querySelector(".input-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file)
                return;

        const reader = new FileReader();
        reader.onload = () => {
                vscode.postMessage({
                        type: "file-loaded",
                        name: file.name,
                        content: Array.from(new Uint8Array(reader.result))
                });
        };

        reader.readAsArrayBuffer(file);
});

function getCssVariable(name) {
        return window.getComputedStyle(document.body).getPropertyValue(name);
}

function renderCurrentView() {
        mainElement.innerHTML     = "";
        mainElement.style.cssText = "";

        switch (currentView) {
                case "flame":
                        renderFlamegraph(currentData);
                        break;
                case "calltree":
                        renderCallTree(currentData);
                        break;
                case "methods":
                        renderMethodList(currentData);
                        break;
        }
}

function getColorHue(value, rootValue) {
        const intensity = Math.min(0.8, (0.6 * value) / rootValue + 0.3);
        return 40 - (40 * intensity);
}

function renderFlamegraph(output) {
        mainElement.style.cssText = `
                display: flex;
                flex-direction: column-reverse;
                overflow-y: scroll;
                overflow-x: hidden;
        `;

        const root = output.stackFrame;

        const bottom = document.createElement("div");
        bottom.className = "flame-graph-bottom";
        mainElement.appendChild(bottom);

        const graph = document.createElement("div");
        graph.className = "flame-graph";

        const rootColor = getCssVariable("--vscode-profiler-integration.flamegraph.rootColor");
        const nodeColor = getCssVariable("--vscode-profiler-integration.flamegraph.nodeColor");

        let foregroundColor = getCssVariable("--vscode-profiler-integration.flamegraph.foreground");
        if (foregroundColor !== "rgba(0, 0, 0, 0)")
                graph.style.color = foregroundColor;

        function processNode(node, x = 0, depth = 0, rootValue) {
                const width = (node.value / rootValue) * 100;
                if (width < 0.05)
                        return;

                const filteredChildren = node.children.sort((a, b) => b.value - a.value);
                const hue              = getColorHue(node.value, rootValue);

                return {
                        name: node.name,
                        value: node.value,
                        x: x,
                        y: depth * 20,
                        width: width,
                        color: node === root ?
                                rootColor === "rgba(0, 0, 0, 0)" ? `hsl(${hue}, 100%, 50%)` : rootColor :
                                nodeColor === "rgba(0, 0, 0, 0)" ? `hsl(${hue}, 100%, 50%)` : nodeColor,
                        children: filteredChildren.reduce((acc, child) => {
                                const processed = processNode(child, acc.nextX, depth + 1, rootValue);
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
        function getTextToFit(nodeWidth, nodeName) {
                const maxChars = Math.floor((nodeWidth / 100) * window.innerWidth / 7);
                if (maxChars <= 3)
                        return "";

                if (nodeName.length <= maxChars)
                        return nodeName;

                return nodeName.substring(0, maxChars - 3) + "...";
        }

        function renderNodes(parent, node) {
                const element = document.createElement("div");
                element.className = "flame-node";
                element.style.cssText = `
                        left: ${node.x}%;
                        bottom: ${node.y}px;
                        width: ${node.width}%;
                        background: ${node.color};
                `;

                const textContent = getTextToFit(node.width, node.name);
                if (textContent)
                        element.textContent = textContent;

                element.addEventListener("mouseenter", () => {
                        tooltip.querySelector("#executable-label").textContent    = output.exeName;
                        tooltip.querySelector("#function-name-label").textContent = node.name;

                        const absPercentage = (node.value / root.value) * 100;
                        tooltip.querySelector("#absolute-percentage-label").textContent = `${absPercentage.toFixed(2)}%`;
                        tooltip.querySelector("#absolute-percentage-bg").style.width    = `${Math.round(absPercentage)}%`;

                        const relPercentage = (node.value / parent.value) * 100;
                        tooltip.querySelector("#relative-percentage-label").textContent = `${relPercentage.toFixed(2)}%`;

                        tooltip.querySelector("#value-label").textContent      = `${node.value}`;
                        tooltip.querySelector("#value-type-label").textContent = `${output.type}`;

                        tooltip.style.display = "block";
                        tooltip.style.opacity = "1";
                });

                element.addEventListener("mousemove", (e) => {
                        const rect = mainElement.getBoundingClientRect();
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
                node.children.forEach(child => renderNodes(node, child));
        }

        const processedRoot = processNode(root, 0, 0, root.value);
        renderNodes(root, processedRoot);

        mainElement.appendChild(graph);
}

function renderCallTree(output) {
        function createListElement(node, rootValue) {
                const li = document.createElement("li");
                li.className = "calltree-item";

                const data = document.createElement("div");
                data.className = "calltree-item-data";

                const hue = getColorHue(node.value, rootValue);

                const perc = document.createElement("p");
                perc.className = "calltree-item-percentage"
                perc.textContent = `${((node.value / rootValue) * 100).toFixed(1)}%`
                perc.style.color = `hsl(${hue}, 100%, 50%)`

                if (node.children && node.children.length > 0)
                        data.innerHTML = chevrons;
                else
                        perc.style.paddingLeft = "22px"; // 16 svg + 6 gap

                const name = document.createElement("p");
                name.textContent = node.name;

                data.appendChild(perc);
                data.appendChild(name);

                li.appendChild(data);
                return li;
        }

        function addNode(node, parent, rootValue) {
                const element = createListElement(node, rootValue);

                if (node.children && node.children.length > 0) {
                        const ul = document.createElement("ul");
                        element.appendChild(ul);

                        node.children.forEach(e => addNode(e, ul, rootValue));
                }

                parent.appendChild(element);
        }

        mainElement.style.cssText = `
                overflow-y: scroll;
                overflow-x: hidden;
        `;

        const root = output.stackFrame;
        root.children.forEach(node => {
                const tree = document.createElement("ul");
                tree.className = "calltree";

                addNode(node, tree, root.value);
                mainElement.appendChild(tree);

                tree.addEventListener("click", e => {
                        const chevron = e.target.closest(".calltree-item-chevron");
                        if (!chevron)
                                return;

                        const li = chevron.parentElement.parentElement;
                        const ul = li.querySelector("ul");

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

function renderMethodList(output) {
        mainElement.style.cssText = `
                display: flex;
                flex-direction: column;
                overflow-y: scroll;
                font-family: var(--vscode-editor-font-family);
                font-weight: 200;
        `;

        const root = output.stackFrame;

        const titlebar = document.createElement("div");
        titlebar.className = "methods-titlebar";
        mainElement.appendChild(titlebar);

        const method = document.createElement("div");
        method.style.width = "50%";
        titlebar.appendChild(method);

        const methodText = document.createElement("p");
        methodText.textContent = "Method";
        method.appendChild(methodText);

        const samples = document.createElement("div");
        samples.style.width = "20%";
        titlebar.appendChild(samples);

        const samplesText = document.createElement("p");
        samplesText.textContent = "Samples";
        samples.appendChild(samplesText);

        const nodes = [];

        function addNode(node) {
                nodes.push({ name: node.name, value: node.value });
                if (node.children)
                        node.children.forEach(addNode);
        }

        root.children.forEach(addNode);
        nodes.sort((a, b) => b.value - a.value);

        nodes.forEach(node => {
                const div = document.createElement("div");
                div.className = "method";

                const name = document.createElement("p");
                name.textContent = node.name;
                div.appendChild(name);

                const bar = document.createElement("div");
                bar.className = "method-bar";
                div.appendChild(bar);

                const hue = getColorHue(node.value, nodes[0].value);
                const bg = document.createElement("div");
                bg.className        = "method-bar-bg";
                bg.style.width      = `${(node.value / nodes[0].value) * 100}%`;
                bg.style.background = `hsl(${hue}, 100%, 50%)`;
                bar.appendChild(bg);

                mainElement.appendChild(div);
        });
}

function isValidEventData(data) {
        return data.exeName && data.type && data.stackFrame && data.stackFrame.value;
}

window.addEventListener("message", event => {
        if (event.data && isValidEventData(event.data)) {
                currentData = event.data;
                renderCurrentView();
        } else {
                console.error("[Webview] Invalid data format:", event.data);
        }
});

console.log("[Webview] Initialized");
vscode.postMessage({ type: "ready" });