// Skill cards fade up as they scroll into view.
const cards = document.querySelectorAll<HTMLElement>(".skill-card");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if ("IntersectionObserver" in window && !reduceMotion) {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("in");
                    observer.unobserve(entry.target);
                }
            }
        },
        { threshold: 0.15 }
    );
    cards.forEach((card) => {
        card.classList.add("reveal");
        observer.observe(card);
    });
}

export {};
