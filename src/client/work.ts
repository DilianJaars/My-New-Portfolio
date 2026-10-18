import type { ApiError, SessionInfo, WorkItem } from "../shared/types.js";
import { byId, el, setMessage } from "./dom.js";

const panel = byId("panel");
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

/** null means "not loaded yet". */
let websites: WorkItem[] | null = null;
let isAdmin = false;
let adminEnabled = true;

// ---------- rendering ----------
function createItem(item: WorkItem): HTMLElement {
    const hasImage = Boolean(item.image);
    const root = el("article", `work-item${hasImage ? "" : " no-image"}`);

    if (hasImage) {
        const media = el("div", "work-media");
        const img = el("img");
        img.src = item.image;
        img.alt = `Screenshot of ${item.title}`;
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
        const link = el("a", "btn", "Visit site");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `Visit ${item.title} (opens in a new tab)`);
        actions.append(link);
    }
    if (isAdmin) {
        const remove = el("button", "link-button", "Delete");
        remove.type = "button";
        remove.setAttribute("aria-label", `Delete ${item.title}`);
        remove.addEventListener("click", () => void deleteItem(item));
        actions.append(remove);
    }
    if (actions.childElementCount) body.append(actions);

    root.append(body);
    return root;
}

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

    toolbarText.textContent = `${websites.length} ${websites.length === 1 ? "website" : "websites"}`;
    if (websites.length === 0) {
        panel.replaceChildren(createEmpty());
        return;
    }
    panel.replaceChildren(...websites.map(createItem));
}

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
            const response = await fetch("/api/websites", { method: "POST", body: new FormData(itemForm) });
            if (!response.ok) throw new Error(await readError(response, "Couldn't add this website."));
            const created = (await response.json()) as WorkItem;
            (websites ??= []).unshift(created);
            itemForm.reset();
            render();
            setMessage(itemMessage, "Added.", true);
            setTimeout(() => {
                setMessage(itemMessage);
                dialog.close();
            }, 700);
        } catch (error) {
            setMessage(itemMessage, error instanceof Error ? error.message : "Couldn't add this website.");
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
