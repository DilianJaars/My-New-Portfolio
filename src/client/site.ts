// Keeps the footer year current.
document.querySelectorAll<HTMLElement>("[data-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
});

// The menu stays hidden until the visitor clicks the name in the header.
const toggle = document.getElementById("brandToggle");
const menu = document.getElementById("siteNav");

if (toggle && menu) {
    const setOpen = (open: boolean): void => {
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.title = open ? "Hide menu" : "Show menu";
    };

    const isOpen = (): boolean => !menu.hidden;

    toggle.addEventListener("click", () => setOpen(!isOpen()));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) {
            setOpen(false);
            toggle.focus();
        }
    });
}

// Scroll progress bar and back-to-top button.
const bar = document.createElement("div");
bar.className = "scroll-progress";
bar.setAttribute("aria-hidden", "true");
const top = document.createElement("button");
top.type = "button";
top.className = "to-top";
top.textContent = "\u2191";
top.setAttribute("aria-label", "Back to top");
top.hidden = true;
document.body.append(bar, top);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let ticking = false;
const paint = (): void => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    top.hidden = y < 600;
};
window.addEventListener(
    "scroll",
    () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(paint);
        }
    },
    { passive: true }
);
top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" }));
paint();

// Footer link to play the entry game again.
const footerList = document.querySelector(".site-footer ul");
if (footerList) {
    const item = document.createElement("li");
    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "link-button";
    replay.textContent = "Replay the game";
    replay.addEventListener("click", () => {
        document.cookie = "dj_gate=; Max-Age=0; path=/";
        window.location.assign("/");
    });
    item.append(replay);
    footerList.append(item);
}

export {};
