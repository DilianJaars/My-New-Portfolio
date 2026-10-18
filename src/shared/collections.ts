/** The three collections shown on the Work page. Shared by the server and the browser. */
export const COLLECTIONS = ["websites", "logos", "mockups"] as const;

export type Collection = (typeof COLLECTIONS)[number];

export function isCollection(value: string): value is Collection {
    return (COLLECTIONS as readonly string[]).includes(value);
}
