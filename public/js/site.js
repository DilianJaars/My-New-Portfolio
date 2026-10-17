// Keeps the footer year current.
document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
});
