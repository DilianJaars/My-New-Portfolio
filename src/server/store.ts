import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Database, WorkItem } from "../shared/types.js";

/** A screenshot received from the upload form, held in memory. */
export interface UploadedImage {
    buffer: Buffer;
    mimetype: string;
}

export const IMAGE_TYPES: Readonly<Record<string, string>> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const BUCKET = "portfolio";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

/**
 * Websites live in two places:
 *  - data/db.json in the repo (permanent, edited by committing), and
 *  - Supabase, when SUPABASE_URL and SUPABASE_SERVICE_KEY are set. Anything
 *    added through the Manage panel goes here and survives redeploys.
 * Without Supabase, the Manage panel falls back to local files, which Render's
 * free plan wipes on every redeploy or restart.
 */
export function createStore(rootDir: string) {
    const uploadsDir = path.join(rootDir, "public", "uploads");
    const dataFile = path.join(rootDir, "data", "db.json");
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });

    // ----- local JSON file -----
    function writeFileDb(db: Database): void {
        const tmp = `${dataFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, dataFile);
    }

    function readFileDb(): Database {
        if (!fs.existsSync(dataFile)) {
            const empty: Database = { websites: [] };
            writeFileDb(empty);
            return empty;
        }
        const parsed = JSON.parse(fs.readFileSync(dataFile, "utf-8")) as Partial<Database>;
        return { websites: Array.isArray(parsed.websites) ? parsed.websites : [] };
    }

    // ----- Supabase over plain HTTPS (no extra packages) -----
    function headers(extra: Record<string, string> = {}): Record<string, string> {
        const h: Record<string, string> = { apikey: SUPABASE_KEY, ...extra };
        // Legacy keys are JWTs and also go in Authorization; new sb_secret_ keys must not.
        if (SUPABASE_KEY.startsWith("eyJ")) h.Authorization = `Bearer ${SUPABASE_KEY}`;
        return h;
    }

    async function sb(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
        const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, {
            ...init,
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
            const detail = (await res.text()).slice(0, 300);
            throw new Error(`Supabase ${res.status} on ${pathAndQuery.split("?")[0]}: ${detail}`);
        }
        return res;
    }

    interface Row {
        id: string;
        title: string;
        description: string;
        url: string;
        tags: string[];
        image: string;
        created_at: string;
    }

    const fromRow = (r: Row): WorkItem => ({
        id: r.id,
        title: r.title,
        description: r.description,
        url: r.url,
        tags: r.tags,
        image: r.image,
        createdAt: r.created_at,
    });

    const publicImageBase = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

    async function listRemote(): Promise<WorkItem[]> {
        const res = await sb("/rest/v1/websites?select=*&order=created_at.desc", {
            headers: headers(),
        });
        return ((await res.json()) as Row[]).map(fromRow);
    }

    async function uploadRemote(image: UploadedImage): Promise<string> {
        const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${IMAGE_TYPES[image.mimetype] ?? ".jpg"}`;
        await sb(`/storage/v1/object/${BUCKET}/${name}`, {
            method: "POST",
            headers: headers({ "Content-Type": image.mimetype }),
            body: new Uint8Array(image.buffer),
        });
        return `${publicImageBase}${name}`;
    }

    async function deleteRemoteImage(url: string): Promise<void> {
        if (!url.startsWith(publicImageBase)) return;
        const name = path.basename(url.slice(publicImageBase.length));
        await sb(`/storage/v1/object/${BUCKET}/${name}`, { method: "DELETE", headers: headers() }).catch(
            (err: unknown) => console.error(err)
        );
    }

    return {
        /** Everything visitors see: repo entries plus Supabase entries, newest first. */
        async list(): Promise<WorkItem[]> {
            let remote: WorkItem[] = [];
            if (usingSupabase) {
                try {
                    remote = await listRemote();
                } catch (err) {
                    console.error(err); // keep the site up with the repo entries
                }
            }
            return [...remote, ...readFileDb().websites].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        },

        async add(fields: Omit<WorkItem, "id" | "image" | "createdAt">, image?: UploadedImage): Promise<WorkItem> {
            const id = crypto.randomUUID();
            const createdAt = new Date().toISOString();

            if (usingSupabase) {
                const imageUrl = image ? await uploadRemote(image) : "";
                const item: WorkItem = { id, ...fields, image: imageUrl, createdAt };
                try {
                    await sb("/rest/v1/websites", {
                        method: "POST",
                        headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
                        body: JSON.stringify({
                            id,
                            title: item.title,
                            description: item.description,
                            url: item.url,
                            tags: item.tags,
                            image: item.image,
                            created_at: createdAt,
                        }),
                    });
                } catch (err) {
                    await deleteRemoteImage(imageUrl);
                    throw err;
                }
                return item;
            }

            let imagePath = "";
            if (image) {
                const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${IMAGE_TYPES[image.mimetype] ?? ".jpg"}`;
                fs.writeFileSync(path.join(uploadsDir, filename), image.buffer);
                imagePath = `/uploads/${filename}`;
            }
            const item: WorkItem = { id, ...fields, image: imagePath, createdAt };
            const db = readFileDb();
            db.websites.unshift(item);
            writeFileDb(db);
            return item;
        },

        /** Returns false if no website has this id. */
        async remove(id: string): Promise<boolean> {
            const db = readFileDb();
            const local = db.websites.find((entry) => entry.id === id);
            if (local) {
                // Only files uploaded through the panel are deleted; images
                // shipped with the repo (under /images) never are.
                if (local.image.startsWith("/uploads/")) {
                    fs.unlink(path.join(uploadsDir, path.basename(local.image)), () => {});
                }
                db.websites = db.websites.filter((entry) => entry.id !== id);
                writeFileDb(db);
                return true;
            }

            if (usingSupabase && UUID.test(id)) {
                const res = await sb(`/rest/v1/websites?id=eq.${id}`, {
                    method: "DELETE",
                    headers: headers({ Prefer: "return=representation" }),
                });
                const rows = (await res.json()) as Row[];
                const row = rows[0];
                if (!row) return false;
                await deleteRemoteImage(row.image);
                return true;
            }
            return false;
        },
    };
}
