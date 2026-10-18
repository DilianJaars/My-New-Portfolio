import { byId } from "./dom.js";

// The about text stays hidden until the photo is clicked, then each
// sentence appears one after the other.
const button = byId<HTMLButtonElement>("portraitBtn");
const text = byId("aboutText");
const hint = byId("aboutHint");

const STEP_MS = 1100;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const sentences: HTMLSpanElement[] = [];

text.querySelectorAll("p").forEach((paragraph) => {
    const parts = (paragraph.textContent ?? "").trim().split(/(?<=[.!?])\s+/);
    paragraph.textContent = "";
    parts.forEach((part, index) => {
        const span = document.createElement("span");
        span.className = "sentence";
        span.textContent = part;
        paragraph.append(span);
        sentences.push(span);
        if (index < parts.length - 1) paragraph.append(" ");
    });
});

text.classList.add("is-hidden");
hint.hidden = false;

let started = false;

function reveal(): void {
    if (started) return;
    started = true;
    button.setAttribute("aria-expanded", "true");
    button.title = "";
    hint.hidden = true;

    if (reduceMotion) {
        sentences.forEach((span) => span.classList.add("shown"));
        return;
    }
    sentences.forEach((span, index) => {
        window.setTimeout(() => span.classList.add("shown"), index * STEP_MS);
    });
}

button.addEventListener("click", reveal);

export {};
