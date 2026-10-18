/**
 * A book of websites for the home page. Each website is one two-page spread:
 * a screenshot on the left page, the details on the right. Visitors turn the
 * pages themselves with the Previous and Next buttons (or the arrow keys).
 */
import type { WorkItem } from "../shared/types.js";
import { byId, el } from "./dom.js";

const wrap = byId("bookWrap");
const book = byId("book");
const prevButton = byId<HTMLButtonElement>("prevBtn");
const nextButton = byId<HTMLButtonElement>("nextBtn");
const status = byId("bookStatus");

const ACCENTS = ["var(--cyan)", "var(--pink)", "var(--yellow)"] as const;
const TURN_MS = 900;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const phone = window.matchMedia("(max-width: 760px)");

let items: WorkItem[] = [];
let index = 0;
let turning = false;
let left: HTMLElement = el("div", "page page-left");
let right: HTMLElement = el("div", "page page-right");
book.append(left, right);

// ---------- pages ----------
function accentFor(i: number): string {
    return ACCENTS[i % ACCENTS.length] ?? ACCENTS[0];
}

function leftPage(i: number): HTMLElement {
    const page = el("div", "page page-left");
    const item = items[i];
    const shot = el("div", "shot");

    if (item?.image) {
        const img = el("img");
        img.src = item.image;
        img.alt = `Screenshot of ${item.title}`;
        shot.append(img);
    } else {
        shot.classList.add("placeholder");
        shot.style.setProperty("--shot", accentFor(i));
        shot.append(el("span", "", item ? initials(item.title) : "Soon"));
        if (item) shot.setAttribute("aria-hidden", "true");
    }

    page.append(shot, el("span", "folio", String(i * 2 + 1)));
    return page;
}

function rightPage(i: number): HTMLElement {
    const page = el("div", "page page-right");
    const item = items[i];
    const body = el("div", "page-body");

    if (!item) {
        body.append(el("h3", "", "No websites yet"));
        const text = el("p", "muted");
        text.append("New sites will turn up here as I finish them. For now, you can browse my code on ");
        const link = el("a", "", "GitHub");
        link.href = "https://github.com/DilianJaars";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        text.append(link, ".");
        body.append(text);
    } else {
        body.append(el("h3", "", item.title));
        if (item.description) body.append(el("p", "desc", item.description));
        if (item.tags.length) body.append(el("p", "tools", item.tags.join(", ")));
        if (item.url) {
            const link = el("a", "btn", "Visit site");
            link.href = item.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.setAttribute("aria-label", `Visit ${item.title} (opens in a new tab)`);
            body.append(link);
        }
    }

    page.append(body, el("span", "folio", String(i * 2 + 2)));
    return page;
}

function initials(title: string): string {
    const words = title.split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((word) => word.charAt(0).toUpperCase()).join("") || "W";
}

// ---------- state ----------
function swap(oldPage: HTMLElement, newPage: HTMLElement): HTMLElement {
    book.replaceChild(newPage, oldPage);
    return newPage;
}

// aria-disabled (not the disabled attribute) so keyboard focus stays on the
// button when a turn finishes or the first or last page is reached.
function setUnavailable(button: HTMLButtonElement, unavailable: boolean): void {
    button.setAttribute("aria-disabled", String(unavailable));
    button.classList.toggle("is-disabled", unavailable);
}

function updateControls(): void {
    const count = items.length;
    setUnavailable(prevButton, index <= 0);
    setUnavailable(nextButton, index >= count - 1);
    const title = items[index]?.title;
    status.textContent = count === 0 ? "No websites yet" : `Website ${index + 1} of ${count}: ${title ?? ""}`;
}

function show(target: number): void {
    left = swap(left, leftPage(target));
    right = swap(right, rightPage(target));
    index = target;
    updateControls();
}

function turn(delta: 1 | -1): void {
    const target = index + delta;
    if (turning || target < 0 || target >= items.length) return;

    if (reduceMotion.matches || phone.matches) {
        show(target);
        return;
    }

    turning = true;

    const forward = delta > 0;
    const leaf = el("div", `leaf ${forward ? "leaf-next" : "leaf-prev"}`);
    const back = forward ? leftPage(target) : rightPage(target);
    back.classList.add("back");

    if (forward) {
        // The next right page waits underneath the leaf that is about to lift.
        right = swap(right, rightPage(target));
        leaf.append(rightPage(index), back);
    } else {
        // The previous left page waits underneath the leaf that is about to lift.
        left = swap(left, leftPage(target));
        leaf.append(leftPage(index), back);
    }

    let finished = false;
    const finish = (): void => {
        if (finished) return;
        finished = true;
        if (forward) left = swap(left, leftPage(target));
        else right = swap(right, rightPage(target));
        leaf.remove();
        index = target;
        turning = false;
        updateControls();
    };

    book.append(leaf);
    void leaf.offsetWidth; // start the animation from the flat position
    leaf.classList.add("turning");
    leaf.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, TURN_MS + 300);
}

prevButton.addEventListener("click", () => turn(-1));
nextButton.addEventListener("click", () => turn(1));
wrap.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") turn(1);
    if (event.key === "ArrowLeft") turn(-1);
});

// ---------- start ----------
void (async () => {
    show(0);
    try {
        const response = await fetch("/api/websites", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        items = (await response.json()) as WorkItem[];
    } catch {
        items = [];
    }
    show(0);
})();
