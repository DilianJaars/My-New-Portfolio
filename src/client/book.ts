/** Home page: the shelf of websites (read only). */
import type { WorkItem } from "../shared/types.js";
import { byId } from "./dom.js";
import { createShelf } from "./shelf.js";

const shelf = createShelf({ label: "Websites I've built, on a shelf" });
byId("shelfMount").replaceChildren(shelf.element);
shelf.setItems([]);

void (async () => {
    try {
        const response = await fetch("/api/websites", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        shelf.setItems((await response.json()) as WorkItem[]);
    } catch {
        shelf.setItems([]);
    }
})();
