import type { ApiError, SessionInfo, WorkItem } from "../shared/types.js";
import { byId, el, setMessage } from "./dom.js";
import { createShelf } from "./shelf.js";

const panel = byId("panel");
const toolbarText = byId("toolbarText");
const filters = byId("filters");
const searchBox = byId<HTMLInputElement>("searchBox");
const filterChips = byId("filterChips");
let activeTag = "";
let query = "";
const dialog = byId<HTMLDialogElement>("managerDialog");
const loginView = byId("loginView");
const adminView = byId("adminView");
const loginForm = byId<HTMLFormElement>("loginForm");
const itemForm = byId<HTMLFormElement>("itemForm");
const loginMessage = byId("loginMessage");
const itemMessage = byId("itemMessage");
const manageButton = byId<HTMLButtonElement>("manageButton");
const addButton = byId<HTMLButtonElement>("addButton");
const addTitle = byId("addTitle");
const cancelEdit = byId<HTMLButtonElement>("cancelEdit");
const removeImageField = byId("removeImageField");
const imageHint = byId("imageHint");
const DEFAULT_IMAGE_HINT = imageHint.textContent ?? "";

/** The website being edited, or null when the form adds a new one. */
let editing: WorkItem | null = null;

/** null means "not loaded yet". */
let websites: WorkItem[] | null = null;
let isAdmin = false;
let adminEnabled = true;

// ---------- rendering ----------
const shelf = createShelf({
    label: "My websites, on a shelf",
    actions(item) {
        if (!isAdmin) return null;
        const group = el("span", "admin-actions");
        const edit = el("button", "link-button", "Edit");
        edit.type = "button";
        edit.setAttribute("aria-label", `Edit ${item.title}`);
        edit.addEventListener("click", () => startEdit(item));
        const remove = el("button", "link-button", "Delete");
        remove.type = "button";
        remove.setAttribute("aria-label", `Delete ${item.title}`);
        remove.addEventListener("click", () => void deleteItem(item));
        group.append(edit, remove);
        return group;
    },
});
function createEmpty(): HTMLElement {
    const box = el("div", "empty");
    box.append(el("h3", "", "No websites here yet."));

    const text = el("p", "muted");
    if (isAdmin) {
        text.textContent = "Use Manage to add the first website.";
    } else {
        text.append("New work is added regularly. In the meantime, you can browse my code on ");
        const link = el("a", "", "GitHub");
        link.href = "https://github.com/DilianJaars";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        text.append(link, ".");
    }
    box.append(text);
    return box;
}

function createFailure(): HTMLElement {
    const box = el("div", "empty");
    box.append(
        el("h3", "", "The websites could not load."),
        el("p", "muted", "Refresh the page to try again.")
    );
    return box;
}

function render(): void {
    manageButton.textContent = isAdmin ? "Manage (signed in)" : "Manage";
    manageButton.hidden = !adminEnabled;

    if (websites === null) {
        panel.replaceChildren(el("div", "skeleton"));
        toolbarText.textContent = "Loading";
        return;
    }

    if (websites.length === 0) {
        filters.hidden = true;
        toolbarText.textContent = "0 websites";
        panel.replaceChildren(createEmpty());
        return;
    }

    const tags = [...new Set(websites.flatMap((w) => w.tags))].sort((a, b) => a.localeCompare(b));
    if (activeTag && !tags.includes(activeTag)) activeTag = "";
    filters.hidden = websites.length < 2;
    if (!filters.hidden) renderChips(tags);

    const needle = query.trim().toLowerCase();
    const shown = websites.filter(
        (w) =>
            (!activeTag || w.tags.includes(activeTag)) &&
            (!needle || `${w.title} ${w.description} ${w.tags.join(" ")}`.toLowerCase().includes(needle))
    );
    const filtered = shown.length !== websites.length;
    toolbarText.textContent = filtered
        ? `${shown.length} of ${websites.length} websites`
        : `${websites.length} ${websites.length === 1 ? "website" : "websites"}`;

    if (shown.length === 0) {
        const box = el("div", "empty");
        box.append(el("h3", "", "Nothing matches that."), el("p", "muted", "Try a different word or clear the filter."));
        panel.replaceChildren(box);
        return;
    }
    panel.replaceChildren(shelf.element);
    shelf.setItems(shown);
}

function renderChips(tags: string[]): void {
    const make = (label: string, tag: string): HTMLButtonElement => {
        const chip = el("button", "chip", label);
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(activeTag === tag));
        chip.addEventListener("click", () => {
            activeTag = tag;
            render();
        });
        return chip;
    };
    filterChips.replaceChildren(make("All", ""), ...tags.map((t) => make(t, t)));
}

searchBox.addEventListener("input", () => {
    query = searchBox.value;
    render();
});

// ---------- data ----------
async function load(): Promise<void> {
    try {
        const response = await fetch("/api/websites", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        websites = (await response.json()) as WorkItem[];
        render();
    } catch {
        websites = [];
        panel.replaceChildren(createFailure());
        toolbarText.textContent = "Unavailable";
    }
}

async function checkSession(): Promise<void> {
    try {
        const response = await fetch("/api/session");
        const result = (await response.json()) as SessionInfo;
        isAdmin = Boolean(result.loggedIn);
        adminEnabled = result.adminEnabled !== false;
    } catch {
        isAdmin = false;
    }
}

async function deleteItem(item: WorkItem): Promise<void> {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    try {
        const response = await fetch(`/api/websites/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        websites = (websites ?? []).filter((entry) => entry.id !== item.id);
        render();
    } catch {
        alert("Couldn't delete this website. Sign in again and retry.");
    }
}

// ---------- editing ----------
function setField(name: string, value: string): void {
    const field = itemForm.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
}

/** Switches the form between "add a website" and "edit this website". */
function setEditing(item: WorkItem | null): void {
    editing = item;
    itemForm.reset();
    setMessage(itemMessage);
    addTitle.textContent = item ? "Edit website" : "Add a website";
    addButton.textContent = item ? "Save changes" : "Add website";
    cancelEdit.classList.toggle("hidden", !item);
    removeImageField.classList.toggle("hidden", !item?.image);
    imageHint.textContent = item
        ? item.image
            ? "Leave empty to keep the current screenshot, or choose a new one to replace it."
            : "This website has no screenshot yet. Choose one to add it."
        : DEFAULT_IMAGE_HINT;

    if (item) {
        setField("title", item.title);
        setField("url", item.url);
        setField("description", item.description);
        setField("tags", item.tags.join(", "));
    }
}

function startEdit(item: WorkItem): void {
    setEditing(item);
    showAuthView();
    setMessage(loginMessage);
    dialog.showModal();
    itemForm.querySelector<HTMLInputElement>("#title")?.focus();
}

cancelEdit.addEventListener("click", () => setEditing(null));

// ---------- admin dialog ----------
function showAuthView(): void {
    loginView.classList.toggle("hidden", isAdmin);
    adminView.classList.toggle("hidden", !isAdmin);
}

async function readError(response: Response, fallback: string): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as Partial<ApiError>;
    return body.error ?? fallback;
}

manageButton.addEventListener("click", () => {
    void (async () => {
        await checkSession();
        showAuthView();
        setMessage(loginMessage);
        setEditing(null);
        dialog.showModal();
    })();
});

dialog.querySelectorAll<HTMLElement>("[data-close]").forEach((button) =>
    button.addEventListener("click", () => dialog.close())
);
dialog.addEventListener("close", () => setEditing(null));
dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
});

loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
        setMessage(loginMessage);
        const button = loginForm.querySelector<HTMLButtonElement>("button[type='submit']");
        if (button) button.disabled = true;

        try {
            const response = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: new FormData(loginForm).get("password") }),
            });
            if (!response.ok) {
                setMessage(loginMessage, await readError(response, "Sign-in failed. Try again."));
                return;
            }
            isAdmin = true;
            loginForm.reset();
            showAuthView();
            render();
        } catch {
            setMessage(loginMessage, "Couldn't reach the server. Check your connection and try again.");
        } finally {
            if (button) button.disabled = false;
        }
    })();
});

byId("logoutButton").addEventListener("click", () => {
    void (async () => {
        await fetch("/api/logout", { method: "POST" });
        isAdmin = false;
        showAuthView();
        render();
    })();
});

itemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
        setMessage(itemMessage);
        addButton.disabled = true;
        const wasEditing = editing;

        try {
            const response = await fetch(
                wasEditing ? `/api/websites/${encodeURIComponent(wasEditing.id)}` : "/api/websites",
                { method: wasEditing ? "PUT" : "POST", body: new FormData(itemForm) }
            );
            if (!response.ok) {
                throw new Error(await readError(response, wasEditing ? "Couldn't save the changes." : "Couldn't add this website."));
            }
            const saved = (await response.json()) as WorkItem;
            if (wasEditing) {
                websites = (websites ?? []).map((entry) => (entry.id === saved.id ? saved : entry));
            } else {
                (websites ??= []).unshift(saved);
            }
            setEditing(null);
            render();
            setMessage(itemMessage, wasEditing ? "Saved." : "Added.", true);
            setTimeout(() => {
                setMessage(itemMessage);
                dialog.close();
            }, 700);
        } catch (error) {
            setMessage(itemMessage, error instanceof Error ? error.message : "Something went wrong.");
        } finally {
            addButton.disabled = false;
        }
    })();
});

// ---------- start ----------
void (async () => {
    render();
    await checkSession();
    await load();
})();
