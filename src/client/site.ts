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

export {};
