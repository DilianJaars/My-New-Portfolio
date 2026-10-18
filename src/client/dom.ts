/** Finds an element by id and fails loudly if the page markup changed. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing element #${id}`);
    return node as T;
}

/** Creates an element with an optional class name and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Shows (or clears) a form message. */
export function setMessage(node: HTMLElement, text = "", success = false): void {
    node.textContent = text;
    node.classList.toggle("visible", Boolean(text));
    node.classList.toggle("success", success);
}
