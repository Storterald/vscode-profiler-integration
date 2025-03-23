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
let colorCache = {};
let currentView = "flame";

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
                mainElement.innerHTML = "";

                if (currentData)
                        renderCurrentView();
        });
});

function renderCurrentView() {
        if (!currentData || !currentData.value) {
                console.error('[Render] Invalid root node');
                return;
        }

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

function renderFlamegraph(root) {
        const graph = document.createElement("div");
        graph.className = "flame-graph";

        mainElement.style.cssText = `
                display: flex;
                flex-direction: column-reverse;
                position: relative;
                overflow-y: scroll;
                overflow-x: hidden;
        `;

        function processNode(node, x = 0, depth = 0, rootValue) {
                const width = (node.value / rootValue) * 100;
                if (width < 0.1)
                        return;

                const filteredChildren = [...node.children]
                        .filter(child => (child.value / node.value) * 100 >= 5)
                        .sort((a, b) => b.value - a.value);

                const intensity = Math.min(0.8, (0.6 * node.value) / rootValue + 0.3);
                const hue = 40 - (40 * intensity);

                return {
                        name: node.name,
                        value: node.value,
                        x: x,
                        y: depth * 20,
                        width: width,
                        color: `hsl(${hue}, 100%, 50%)`,
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

        function renderNodes(node) {
                const element = document.createElement("div");
                element.className = "flame-node";
                element.style.cssText = `
                        left: ${node.x}%;
                        bottom: ${node.y}px;
                        width: ${node.width}%;
                        background: ${node.color};
                `;

                element.textContent = node.name;

                element.addEventListener("mouseenter", () => {
                        tooltip.textContent = node.name;
                        tooltip.style.display = "block";
                        tooltip.style.opacity = "1";
                });

                element.addEventListener("mousemove", (e) => {
                        tooltip.style.left = `${e.clientX + 15}px`;
                        tooltip.style.top = `${e.clientY - 10}px`;
                });

                element.addEventListener("mouseleave", () => {
                        tooltip.style.opacity = "0";
                        tooltip.style.display = "none";
                });

                graph.appendChild(element);
                node.children.forEach(renderNodes);
        }

        const processedRoot = processNode(root, 0, 0, root.value);
        renderNodes(processedRoot);

        mainElement.appendChild(graph);
}


function renderCallTree(root) {
        const tree = document.createElement("ul");
        tree.className = "calltree";

        mainElement.style.cssText = `
                overflow-y: scroll;
                overflow-x: hidden;
        `;

        function createListElement(node, rootValue) {
                const li = document.createElement("li");
                li.className = "calltree-item";

                const data = document.createElement("div");
                data.className = "calltree-item-data";

                const intensity = Math.min(0.8, (0.6 * node.value) / rootValue + 0.3);
                const hue = 40 - (40 * intensity);

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

        addNode(root, tree, root.value);
        mainElement.appendChild(tree);

        // Using a single event listener for the whole tree, a tree usually has
        // thousands of elements, and it would be inefficient to have one
        // listener for each one of them.
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
}

function renderMethodList(root) {
        mainElement.innerHTML = `<div class="method-list-view">Method List View for ${root.name}</div>`;
}

window.addEventListener("message", event => {
        if (event.data && event.data.name && event.data.value !== undefined) {
                currentData = event.data;
                renderCurrentView();
        } else {
                console.error("[Webview] Invalid data format:", event.data);
        }
});

console.log("[Webview] Initialized");
vscode.postMessage({ type: "ready" });