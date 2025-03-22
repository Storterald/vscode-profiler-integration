const vscode = acquireVsCodeApi();
const mainElement = document.getElementById('main');
const tooltip = document.getElementById('tooltip');
let currentData = null;
let colorCache = {};

function nameToColor(name) {
        if (!colorCache[name]) {
                let hash = 0;
                for (let i = 0; i < name.length; i++)
                        hash = name.charCodeAt(i) + ((hash << 5) - hash);

                colorCache[name] = 'hsl(' + (hash % 360) + ', 70%, 50%)';
        }
        return colorCache[name];
}

function processNode(node, x = 0, depth = 0, rootTotal) {
        const width = (node.value / rootTotal) * 100;
        const sortedChildren = [...node.children].sort((a, b) => b.value - a.value);
        return {
                name: node.name,
                value: node.value,
                x: x,
                y: depth * 20,
                width: width,
                height: 18,
                color: nameToColor(node.name),
                children: sortedChildren.reduce((acc, child) => {
                        const processed = processNode(child, acc.nextX, depth + 1, rootTotal);
                        acc.nextX += processed.width;
                        acc.nodes.push(processed);
                        return acc;
                }, { nodes: [], nextX: x }).nodes
        };
}

function createFlamegraph(root) {
        console.log('[Render] Starting render', root);
        if (!root || !root.value) {
                console.error('[Render] Invalid root node');
                return;
        }

        const startTime = performance.now();
        mainElement.innerHTML = '';
        const rootTotal = root.value;
        const processedRoot = processNode(root, 0, 0, rootTotal);
        renderNodes(processedRoot);
}

function renderNodes(node) {
        const element = document.createElement('div');
        element.className = 'flame-node';
        element.style.cssText = `
                left: ${node.x}%;
                bottom: ${node.y}px;
                width: ${node.width}%;
                height: ${node.height}px;
                background: ${node.color};
                position: absolute;
            `;

        if (node.width > 5)
                element.textContent = `${node.name} (${node.value})`;

        // Tooltip handlers
        element.addEventListener('mouseenter', () => {
                tooltip.textContent = node.name;
                tooltip.style.display = 'block';
                tooltip.style.opacity = '1';
        });

        element.addEventListener('mousemove', (e) => {
                tooltip.style.left = `${e.clientX + 15}px`;
                tooltip.style.top = `${e.clientY - 10}px`;
        });

        element.addEventListener('mouseleave', () => {
                tooltip.style.opacity = '0';
                tooltip.style.display = 'none';
        });

        mainElement.appendChild(element);
        node.children.forEach(renderNodes);
}

window.addEventListener('message', event => {
        if (event.data && event.data.name && event.data.value !== undefined) {
                currentData = event.data;
                createFlamegraph(currentData);
        } else {
                console.error('[Webview] Invalid data format:', event.data);
        }
});

console.log('[Webview] Initialized');
vscode.postMessage({ type: 'ready' });