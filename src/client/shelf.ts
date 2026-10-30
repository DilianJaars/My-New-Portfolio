/**
 * A shelf of websites. Every website stands on the shelf as an upright spine
 * with its title running down it. The chosen website steps forward as a cover
 * (its screenshot) with its details underneath. Visitors pick a spine, use the
 * arrows, or press the arrow keys.
 */
import type { WorkItem } from "../shared/types.js";
import { el } from "./dom.js";

const ACCENTS = ["cyan", "pink", "yellow", "ink", "paper"] as const;
const GHOSTS = 5; // empty spines that keep a short shelf looking like a shelf

export interface Shelf {
    element: HTMLElement;
    setItems(items: WorkItem[]): void;
}

export interface ShelfOptions {
    label: string;
    /** Extra controls under the details of a website (edit, delete...). */
    actions?: (item: WorkItem) => HTMLElement | null;
    emptyText?: string;
}

function initials(title: string): string {
    const words = title.split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((word) => word.charAt(0).toUpperCase()).join("") || "W";
}

export function createShelf(options: ShelfOptions): Shelf {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const root = el("div", "shelf-wrap");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", options.label);

    const row = el("div", "shelf");
    const board = el("div", "shelf-board");
    board.setAttribute("aria-hidden", "true");
    const details = el("div", "shelf-details");
    details.setAttribute("aria-live", "polite");
    const controls = el("div", "shelf-controls");
    const prev = el("button", "btn btn-ghost", "Previous");
    const next = el("button", "btn", "Next");
    prev.type = next.type = "button";
    const status = el("p", "book-status");
    controls.append(prev, status, next);
    root.append(row, board, details, controls);

    let items: WorkItem[] = [];
    let index = 0;

    function cover(item: WorkItem, i: number): HTMLElement {
        const accent = ACCENTS[i % ACCENTS.length] ?? "cyan";
        const frame = el(item.url ? "a" : "div", `cover ${accent}`) as HTMLAnchorElement;
        if (item.url) {
            frame.href = item.url;
            frame.target = "_blank";
            frame.rel = "noopener noreferrer";
            frame.setAttribute("aria-label", `Visit ${item.title} (opens in a new tab)`);
        }
        if (item.image) {
            const img = el("img");
            img.src = item.image;
            img.alt = `Screenshot of ${item.title}`;
            frame.append(img);
        } else {
            frame.classList.add("no-shot");
            frame.append(el("span", "cover-initials", initials(item.title)));
        }
        frame.append(el("span", "cover-tag", "WEB"));
        if (item.url) frame.append(el("span", "cover-play", "Visit"));
        return frame;
    }

    function spine(item: WorkItem, i: number): HTMLElement {
        const accent = ACCENTS[i % ACCENTS.length] ?? "cyan";
        const button = el("button", `spine ${accent}`);
        button.type = "button";
        button.style.setProperty("--h", `${292 + ((i * 17) % 5) * 9}px`);
        button.setAttribute("aria-label", `Show ${item.title}`);
        button.append(
            el("span", "spine-dot"),
            el("span", "spine-title", item.title),
            el("span", "spine-tag", "WEB")
        );
        button.addEventListener("click", () => select(i));
        return button;
    }

    function renderDetails(): void {
        const item = items[index];
        details.replaceChildren();
        if (!item) {
            details.append(
                el("h3", "", "No websites yet"),
                el("p", "muted", options.emptyText ?? "New sites will turn up here as I finish them.")
            );
            const link = el("a", "", "Browse my code on GitHub");
            link.href = "https://github.com/DilianJaars";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            details.append(link);
            return;
        }
        details.append(el("h3", "", item.title));
        if (item.description) details.append(el("p", "desc", item.description));
        if (item.tags.length) details.append(el("p", "tools", item.tags.join(", ")));
        const actions = el("div", "actions");
        if (item.url) {
            const visit = el("a", "btn", "Visit site");
            visit.href = item.url;
            visit.target = "_blank";
            visit.rel = "noopener noreferrer";
            visit.setAttribute("aria-label", `Visit ${item.title} (opens in a new tab)`);
            actions.append(visit);
        }
        const extra = options.actions?.(item);
        if (extra) actions.append(extra);
        if (actions.childElementCount) details.append(actions);
    }

    function paint(animate: boolean): void {
        const nodes: HTMLElement[] = items.map((item, i) => (i === index ? cover(item, i) : spine(item, i)));
        const ghosts = Math.max(0, GHOSTS - items.length);
        for (let g = 0; g < ghosts; g++) {
            const ghost = el("span", "spine ghost");
            ghost.style.setProperty("--h", `${292 + (((items.length + g) * 17) % 5) * 9}px`);
            ghost.setAttribute("aria-hidden", "true");
            nodes.push(ghost);
        }
        row.replaceChildren(...nodes);

        const current = row.querySelector<HTMLElement>(".cover");
        if (current) {
            if (animate && !reduceMotion.matches) current.classList.add("pop");
            const target = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2;
            row.scrollTo({ left: Math.max(0, target), behavior: animate && !reduceMotion.matches ? "smooth" : "auto" });
        }

        prev.setAttribute("aria-disabled", String(index <= 0));
        prev.classList.toggle("is-disabled", index <= 0);
        next.setAttribute("aria-disabled", String(index >= items.length - 1));
        next.classList.toggle("is-disabled", index >= items.length - 1);
        const item = items[index];
        status.textContent = item ? `Website ${index + 1} of ${items.length}: ${item.title}` : "No websites yet";
        renderDetails();
    }

    function select(i: number): void {
        if (i < 0 || i >= items.length || i === index) return;
        index = i;
        paint(true);
    }

    prev.addEventListener("click", () => select(index - 1));
    next.addEventListener("click", () => select(index + 1));
    root.addEventListener("keydown", (event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select")) return;
        if (event.key === "ArrowRight") select(index + 1);
        if (event.key === "ArrowLeft") select(index - 1);
    });

    return {
        element: root,
        setItems(next: WorkItem[]): void {
            const keep = items[index]?.id;
            items = next;
            const found = keep ? items.findIndex((item) => item.id === keep) : -1;
            index = found >= 0 ? found : 0;
            paint(false);
        },
    };
}
