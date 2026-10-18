// Keeps the footer year current.
document.querySelectorAll<HTMLElement>("[data-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
});

export {};
