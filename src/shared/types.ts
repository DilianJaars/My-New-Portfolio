import type { Collection } from "./collections.js";

/** One entry in a collection, as stored in data/db.json and returned by the API. */
export interface WorkItem {
    id: string;
    title: string;
    description: string;
    url: string;
    tags: string[];
    image: string;
    createdAt: string;
}

export type Database = Record<Collection, WorkItem[]>;

export interface SessionInfo {
    loggedIn: boolean;
    adminEnabled: boolean;
}

export interface ApiError {
    error: string;
}
