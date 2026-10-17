const LABELS = {
    websites: { singular: "website", plural: "websites", link: "Visit site" },
    logos: { singular: "logo", plural: "logos", link: "See more" },
    mockups: { singular: "mockup", plural: "mockups", link: "See more" },
};
const COLLECTIONS = Object.keys(LABELS);

const panel = document.getElementById("panel");
const tabs = [...document.querySelectorAll(".tab")];
const toolbarText = document.getElementById("toolbarText");
const dialog = document.getElementById("managerDialog");
const loginView = document.getElementById("loginView");
const adminView = document.getElementById("adminView");
const loginForm = document.getElementById("loginForm");
const itemForm = document.getElementById("itemForm");
const loginMessage = document.getElementById("loginMessage");
const itemMessage = document.getElementById("itemMessage");
const manageButton = document.getElementById("manageButton");

const data = { websites: null, logos: null, mockups: null };
let current = "websites";
let isAdmin = false;
let adminEnabled = true;

// ---------- small helpers ----------
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function setMessage(node, text = "", success = false) {
    node.textContent = text;
    node.classList.toggle("visible", Boolean(text));
    node.classList.toggle("success", success);
}

function collectionFromHash() {
    const name = location.hash.replace("#", "");
    return COLLECTIONS.includes(name) ? name : "websites";
}

// ---------- rendering ----------
function createItem(item, collection) {
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
    if (item.tags && item.tags.length) body.append(el("p", "tools", item.tags.join(", ")));

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
        remove.addEventListener("click", () => deleteItem(item, collection));
        actions.append(remove);
    }
    if (actions.childElementCount) body.append(actions);

    root.append(body);
    return root;
}

function createEmpty(collection) {
    const box = el("div", "empty");
    const label = LABELS[collection].plural;
    box.append(el("h3", "", `No ${label} here yet.`));

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

function updateCounts() {
    tabs.forEach((tab) => {
        const list = data[tab.dataset.collection];
        tab.querySelector(".count").textContent = list ? String(list.length) : "";
    });
}

function render() {
    const list = data[current];
    updateCounts();

    tabs.forEach((tab) => {
        const selected = tab.dataset.collection === current;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", `tab-${current}`);

    manageButton.textContent = isAdmin ? "Manage (signed in)" : "Manage";
    manageButton.hidden = !adminEnabled;

    if (list === null) {
        panel.replaceChildren(el("div", "skeleton"));
        toolbarText.textContent = "Loading";
        return;
    }

    const noun = list.length === 1 ? LABELS[current].singular : LABELS[current].plural;
    toolbarText.textContent = `${list.length} ${noun}`;

    if (!list.length) {
        panel.replaceChildren(createEmpty(current));
        return;
    }
    panel.replaceChildren(...list.map((item) => createItem(item, current)));
}

// ---------- data ----------
async function load(collection) {
    try {
        const response = await fetch(`/api/${collection}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error();
        data[collection] = await response.json();
    } catch {
        data[collection] = [];
        if (collection === current) {
            panel.replaceChildren(el("div", "empty"));
            panel.firstChild.append(
                el("h3", "", "This collection could not load."),
                el("p", "muted", "Refresh the page to try again.")
            );
            toolbarText.textContent = "Unavailable";
            return false;
        }
    }
    return true;
}

async function checkSession() {
    try {
        const response = await fetch("/api/session");
        const result = await response.json();
        isAdmin = Boolean(result.loggedIn);
        adminEnabled = result.adminEnabled !== false;
    } catch {
        isAdmin = false;
    }
}

async function deleteItem(item, collection) {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    try {
        const response = await fetch(`/api/${collection}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error();
        data[collection] = data[collection].filter((entry) => entry.id !== item.id);
        render();
    } catch {
        alert("Couldn't delete this item. Sign in again and retry.");
    }
}

// ---------- tabs ----------
function selectCollection(name, updateHash = true) {
    current = name;
    if (updateHash && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    render();
    if (data[name] === null) load(name).then(render);
}

tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectCollection(tab.dataset.collection));
    tab.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = tabs[(index + step + tabs.length) % tabs.length];
        next.focus();
        selectCollection(next.dataset.collection);
    });
});

window.addEventListener("hashchange", () => selectCollection(collectionFromHash(), false));

// ---------- admin dialog ----------
function showAuthView() {
    loginView.classList.toggle("hidden", isAdmin);
    adminView.classList.toggle("hidden", !isAdmin);
    document.getElementById("addTitle").textContent = `Add a ${LABELS[current].singular}`;
    document.getElementById("addButton").textContent = `Add ${LABELS[current].singular}`;
    document.getElementById("urlLabel").textContent =
        current === "websites" ? "Live website link" : "Link (optional)";
    document.getElementById("url").required = current === "websites";
}

manageButton.addEventListener("click", async () => {
    await checkSession();
    showAuthView();
    setMessage(loginMessage);
    setMessage(itemMessage);
    dialog.showModal();
});

dialog.querySelectorAll("[data-close]").forEach((button) =>
    button.addEventListener("click", () => dialog.close())
);
dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(loginMessage);
    const button = loginForm.querySelector("button[type='submit']");
    button.disabled = true;

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: new FormData(loginForm).get("password") }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            setMessage(loginMessage, result.error || "Sign-in failed. Try again.");
            return;
        }
        isAdmin = true;
        loginForm.reset();
        showAuthView();
        render();
    } catch {
        setMessage(loginMessage, "Couldn't reach the server. Check your connection and try again.");
    } finally {
        button.disabled = false;
    }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    isAdmin = false;
    showAuthView();
    render();
});

itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(itemMessage);
    const button = document.getElementById("addButton");
    button.disabled = true;

    try {
        const response = await fetch(`/api/${current}`, { method: "POST", body: new FormData(itemForm) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Couldn't add this item.");
        data[current].unshift(result);
        itemForm.reset();
        render();
        setMessage(itemMessage, "Added.", true);
        setTimeout(() => {
            setMessage(itemMessage);
            dialog.close();
        }, 700);
    } catch (error) {
        setMessage(itemMessage, error.message || "Couldn't add this item.");
    } finally {
        button.disabled = false;
    }
});

// ---------- start ----------
(async function init() {
    current = collectionFromHash();
    render();
    await checkSession();
    await load(current);
    render();
    // Load the other two in the background so the tab counts fill in.
    await Promise.all(COLLECTIONS.filter((name) => name !== current).map(load));
    render();
})();
