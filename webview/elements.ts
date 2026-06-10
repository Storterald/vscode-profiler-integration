class HTMLResizableGridElement extends HTMLElement {
        private observer: MutationObserver | undefined;
        private ownedGutters: HTMLElement[] = [];

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

        // noinspection JSUnusedGlobalSymbols
        connectedCallback(): void {
                this.setAttribute("is-resizing", "false");
                this.updateList();
        }

        updateList(): void {
                if (this.children.length === 0)
                        return;

                let reserved: number      = 0;
                let reservedCount: number = 0;
                for (const child of this.children) {
                        if (child.getAttribute("initial-size")) {
                                reserved += parseFloat(child.getAttribute("initial-size")!);
                                ++reservedCount;
                        }
                }

                const defaultFr: number = (1.0 - reserved / 100) / (this.children.length - reservedCount);
                let fr: number[]        = [...this.children].map((child: Element): number => {
                        const attr: string | null = child.getAttribute("initial-size");
                        return attr ? (parseFloat(attr) / 100) : defaultFr;
                });

                let currentChild: HTMLElement | null = null;
                let childIndex: number               = -1;
                let frStart: number                  = 0;
                let frNext: number                   = 0;

                const frToCSS = (): void => {
                        this.style.gridTemplateColumns = fr.join("fr ") + "fr";
                }

                const pointerDown = (e: MouseEvent): void => {
                        if (!e.target || !e.currentTarget)
                                return;

                        const gutter: Element | null = (e.target as HTMLElement).closest(".gutter");
                        if (this.getAttribute("is-resizing") === "true"
                            || !gutter || !this.ownedGutters.includes(gutter as HTMLElement))
                                return;

                        currentChild = (e.currentTarget as HTMLElement).previousElementSibling! as HTMLElement;
                        fr           = [...this.children].map((child: Element): number => child.clientWidth / this.clientWidth);
                        childIndex   = [...this.children].indexOf(currentChild);
                        frStart      = fr[childIndex];
                        frNext       = fr[childIndex + 1];

                        this.setAttribute("is-resizing", "true");
                        this.addEventListener("pointermove", pointerMove);
                        this.addEventListener("pointerup", pointerUp);
                }

                const pointerMove = (e: MouseEvent): void => {
                        e.preventDefault();

                        const paneBCR: DOMRect   = currentChild!.getBoundingClientRect();
                        const parentSize: number = this.clientWidth;
                        const pointer            = {
                                x: Math.max(0, Math.min(e.clientX - paneBCR.left, this.clientWidth)),
                                y: Math.max(0, Math.min(e.clientY - paneBCR.top, this.clientHeight))
                        };

                        const frRel: number  = pointer.x / parentSize;
                        const frDiff: number = frStart - frRel;
                        fr[childIndex]       = Math.max(0.05, frRel);
                        fr[childIndex + 1]   = Math.max(0.05, frNext + frDiff);

                        frToCSS();

                        currentChild!.dispatchEvent(new Event("resize"));
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

                this.ownedGutters = [];
                for (let i: number = 1; i < this.children.length; ++i) {
                        const child: HTMLElement                     = this.children[i] as HTMLElement;
                        const gutters: HTMLCollectionOf<HTMLElement> = child.getElementsByClassName("gutter") as HTMLCollectionOf<HTMLElement>;
                        if (gutters.length === 0) {
                                const last: number = this.ownedGutters.push(elNew("span", { className: "gutter" }));
                                child.append(this.ownedGutters[last - 1]);
                        } else {
                                this.ownedGutters.push(gutters[0]);
                        }

                        child.onpointerdown = pointerDown;
                }

                frToCSS();
                window.dispatchEvent(new Event("resize"));
        }
}
customElements.define("resizable-grid", HTMLResizableGridElement);

class HTMLFunctionTooltipElement extends HTMLElement {
        constructor() {
                super();
        }

        // noinspection JSUnusedGlobalSymbols
        connectedCallback(): void {
                this.innerHTML = `
<div class="tooltip-time tooltip-fire">
        <p id="function-name" class="tooltip-function"></p>
        <div class="tooltip-text-spacer"></div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" id="fire-icon" viewBox="0 0 16 16">
            <path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15"/>
        </svg>
        <p id="value-count-label"></p>
</div>
<div class="tooltip-data">
        <p id="absolute-percentage-label" class="tooltip-percentage"></p>
        <p>of all</p>
        <div class="tooltip-text-spacer"></div>
        <p id="relative-percentage-label" class="tooltip-percentage"></p>
        <p>of</p>
        <p id="parent-name" class="tooltip-function"></p>
</div>`
        }

        show(node: StackFrameBase, parent: StackFrameBase, output: ProfilerOutput): void {
                const absPercentage: number = (node.value / output.stackFrame.value) * 100;
                const relPercentage: number = (node.value / parent.value) * 100;

                const time: HTMLDivElement             = this.querySelector(".tooltip-time")!;
                const funcName: HTMLParagraphElement   = this.querySelector("#function-name")!;
                const flame: SVGElement                = this.querySelector("#fire-icon")!;
                const value: HTMLParagraphElement      = this.querySelector("#value-count-label")!;
                const absolute: HTMLParagraphElement   = this.querySelector("#absolute-percentage-label")!;
                const relative: HTMLParagraphElement   = this.querySelector("#relative-percentage-label")!;
                const parentName: HTMLParagraphElement = this.querySelector("#parent-name")!;

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

                this.style.display = "block";
        }


        move(x: number, y: number): void {
                const rect: DOMRect = this.parentElement!.getBoundingClientRect();
                if (rect.right - x < rect.width * 0.5) {
                        this.style.right = `${rect.width - x + 15}px`;
                        this.style.left  = "";
                } else {
                        this.style.left  = `${x + 15}px`;
                        this.style.right = "";
                }

                if (rect.bottom - y < rect.height * 0.2) {
                        this.style.bottom = `${rect.height - y + 10}px`
                        this.style.top     = "";
                } else {
                        this.style.top    = `${y - 10}px`;
                        this.style.bottom = "";
                }
        }

        hide(): void {
                this.style.display = "none";
        }
}
customElements.define("function-tooltip", HTMLFunctionTooltipElement);
