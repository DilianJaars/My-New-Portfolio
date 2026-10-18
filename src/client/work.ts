import { COLLECTIONS, isCollection, type Collection } from "../shared/collections.js";
import type { ApiError, SessionInfo, WorkItem } from "../shared/types.js";
import { byId, el, setMessage } from "./dom.js";

interface Labels {
    singular: string;
    plural: string;
    link: string;
}

const LABELS: Record<Collection, Labels> = {
    websites: { singular: "website", plural: "websites", link: "Visit site" },
    logos: { singular: "logo", plural: "logos", link: "See more" },
    mockups: { singular: "mockup", plural: "mockups", link: "See more" },
};

const panel = byId("panel");
const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
const toolbarText = byId("toolbarText");
const dialog = byId<HTMLDialogElement>("managerDialog");
const loginView = byId("loginView");
const adminView = byId("adminView");
const loginForm = byId<HTMLFormElement>("loginForm");
const itemForm = byId<HTMLFormElement>("itemForm");
const loginMessage = byId("loginMessage");
const itemMessage = byId("itemMessage");
const manageButton = byId<HTMLButtonElement>("manageButton");
const addButton = byId<HTMLButtonElement>("addButton");
const urlInput = byId<HTMLInputElement>("url");

/** null means "not loaded yet". */
const data: Record<Collection, WorkItem[] | null> = {
    websites: null,
    logos: null,
    mockups: null,
};
let current: Collection = "websites";
let isAdmin = false;
let adminEnabled = true;

function collectionOf(tab: HTMLElement): Collection {
    const name = tab.dataset.collection ?? "";
    return isCollection(name) ? name : "websites";
}

function collectionFromHash(): Collection {
    const name = location.hash.replace("#", "");
    return isCollection(name) ? name : "websites";
}

// ---------- rendering ----------
function createItem(item: WorkItem, collection: Collection): HTMLElement {
    const hasImage = Boolean(item.image);
    const root = el("article", `work-item${hasImage ? "" : " no-image"}`);

    if (hasImage) {
        const media = el("div", "work-media");
        const img = el("img");
        img.src = item.image;
        img.alt = item.title;
        img.loading = "lazy";
        media.append(img);
        root.append(media);
    }

    const body = el("div");
    body.append(el("h3", "", item.title));
    if (item.description) body.append(el("p", "desc", item.description));
    if (item.tags.length) body.append(el("p", "tools", item.tags.join(", ")));

    const actions = el("div", "actions");
    if (item.url) {
        const link = el("a", "btn", LABELS[collection].link);
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${LABELS[collection].link}: ${item.title} (opens in a new tab)`);
        actions.append(link);
    }
    if (isAdmin) {
        const remove = el("button", "link-button", "Delete");
        remove.type = "button";
        remove.setAttribute("aria-label", `Delete ${item.title}`);
        remove.addEventListener("click", () => void deleteItem(item, collection));
        actions.append(remove);
    }
    if (actions.childElementCount) body.append(actions);

    root.append(body);
    return root;
}

function createEmpty(collection: Collection): HTMLElement {
    const box = el("div", "empty");
    box.append(el("h3", "", `No ${LABELS[collection].plural} here yet.`));

    const text = el("p", "muted");
    if (isAdmin) {
        text.textContent = `Use Manage to add the first ${LABELS[collection].singular}.`;
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
        el("h3", "", "This collection could not load."),
        el("p", "muted", "Refresh the page to try again.")
    );
    return box;
}

function updateCounts(): void {
    for (const tab of tabs) {
        const list = data[collectionOf(tab)];
        const count = tab.querySelector(".count");
        if (count) count.textContent = list ? String(list.length) : "";
    }
}

function render(): void {
    const list = data[current];
    updateCounts();

    for (const tab of tabs) {
        const selected = collectionOf(tab) === current;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", `tab-${current}`);
    panel.dataset.collection = current;

    manageButton.textContent = isAdmin ? "Manage (signed in)" : "Manage";
    manageButton.hidden = !adminEnabled;

    if (list === null) {
        panel.replaceChildren(el("div", "skeleton"));
        toolbarText.textContent = "Loading";
        return;
    }

    const noun = list.length === 1 ? LABELS[current].singular : LABELS[current].plural;
    toolbarText.textContent = `${list.length} ${noun}`;

    if (list.length === 0) {
        panel.replaceChildren(createEmpty(current));
        return;
    }
    panel.replaceChildren(...list.map((item) => createItem(item, current)));
}

// ---------- data ----------
async function load(collection: Collection): Promise<void> {
    try {
        const response = await fetch(`/api/${collection}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data[collection] = (await response.json()) as WorkItem[];
    } catch {
        data[collection] = [];
        if (collection === current) {
            panel.replaceChildren(createFailure());
            toolbarText.textContent = "Unavailable";
        }
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

async function deleteItem(item: WorkItem, collection: Collection): Promise<void> {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    try {
        const response = await fetch(`/api/${collection}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data[collection] = (data[collection] ?? []).filter((entry) => entry.id !== item.id);
        render();
    } catch {
        alert("Couldn't delete this item. Sign in again and retry.");
    }
}

// ---------- tabs ----------
function selectCollection(name: Collection, updateHash = true): void {
    current = name;
    if (updateHash && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    render();
    if (data[name] === null) void load(name).then(render);
}

tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectCollection(collectionOf(tab)));
    tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = tabs[(index + step + tabs.length) % tabs.length];
        if (!next) return;
        next.focus();
        selectCollection(collectionOf(next));
    });
});

window.addEventListener("hashchange", () => selectCollection(collectionFromHash(), false));

// ---------- admin dialog ----------
function showAuthView(): void {
    loginView.classList.toggle("hidden", isAdmin);
    adminView.classList.toggle("hidden", !isAdmin);
    byId("addTitle").textContent = `Add a ${LABELS[current].singular}`;
    addButton.textContent = `Add ${LABELS[current].singular}`;
    byId("urlLabel").textContent = current === "websites" ? "Live website link" : "Link (optional)";
    urlInput.required = current === "websites";
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
        setMessage(itemMessage);
        dialog.showModal();
    })();
});

dialog.querySelectorAll<HTMLElement>("[data-close]").forEach((button) =>
    button.addEventListener("click", () => dialog.close())
);
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

        try {
            const response = await fetch(`/api/${current}`, { method: "POST", body: new FormData(itemForm) });
            if (!response.ok) throw new Error(await readError(response, "Couldn't add this item."));
            const created = (await response.json()) as WorkItem;
            (data[current] ??= []).unshift(created);
            itemForm.reset();
            render();
            setMessage(itemMessage, "Added.", true);
            setTimeout(() => {
                setMessage(itemMessage);
                dialog.close();
            }, 700);
        } catch (error) {
            setMessage(itemMessage, error instanceof Error ? error.message : "Couldn't add this item.");
        } finally {
            addButton.disabled = false;
        }
    })();
});

// ---------- start ----------
async function init(): Promise<void> {
    current = collectionFromHash();
    render();
    await checkSession();
    await load(current);
    render();
    // Load the other collections in the background so the tab counts fill in.
    await Promise.all(COLLECTIONS.filter((name) => name !== current).map(load));
    render();
}

void init();
