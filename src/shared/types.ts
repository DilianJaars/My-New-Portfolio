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

export interface Database {
    websites: WorkItem[];
}

export interface SessionInfo {
    loggedIn: boolean;
    adminEnabled: boolean;
}

export interface ApiError {
    error: string;
}
