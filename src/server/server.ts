import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieSession from "cookie-session";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Database, WorkItem } from "../shared/types.js";

// Works both compiled (dist/server) and under tsx (src/server): the project
// root is always two folders up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_FILE = path.join(ROOT, "data", "db.json");
const IS_PROD = process.env.NODE_ENV === "production";

// ---------- configuration ----------
// There is deliberately no fallback password. Without ADMIN_PASSWORD the admin
// login stays switched off and the public site keeps working read-only.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

if (!ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD is not set, so admin login is disabled.");
}
if (IS_PROD && !SESSION_SECRET) {
    console.error("SESSION_SECRET must be set in production. Exiting.");
    process.exit(1);
}

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

// ---------- tiny JSON "database" ----------
function emptyDB(): Database {
    return { websites: [] };
}

// Write to a temp file and rename it so a crash mid-write can't corrupt the data.
function writeDB(db: Database): void {
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
}

function readDB(): Database {
    if (!fs.existsSync(DATA_FILE)) {
        const empty = emptyDB();
        writeDB(empty);
        return empty;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Partial<Database>;
    const db = emptyDB();
    if (Array.isArray(parsed.websites)) db.websites = parsed.websites;
    return db;
}

// ---------- helpers ----------
function safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash("sha256").update(a).digest();
    const hb = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

/** Returns a clean http(s) URL, "" when empty, or null when invalid. */
function cleanUrl(value: unknown): string | null {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try {
        const parsed = new URL(raw);
        return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
    } catch {
        return null;
    }
}

function asText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

// Login throttling: 5 wrong passwords per IP, then a 15 minute lockout.
interface Attempt {
    count: number;
    first: number;
}
const attempts = new Map<string, Attempt>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function lockedOut(ip: string): boolean {
    const entry = attempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > LOCKOUT_MS) {
        attempts.delete(ip);
        return false;
    }
    return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
    const entry = attempts.get(ip);
    if (!entry || Date.now() - entry.first > LOCKOUT_MS) {
        attempts.set(ip, { count: 1, first: Date.now() });
    } else {
        entry.count += 1;
    }
}

// ---------- image uploads ----------
const IMAGE_TYPES: Readonly<Record<string, string>> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const ext = IMAGE_TYPES[file.mimetype] ?? ".jpg";
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (!IMAGE_TYPES[file.mimetype]) {
            cb(new Error("Upload a JPG, PNG, WebP or GIF image."));
            return;
        }
        cb(null, true);
    },
});

// ---------- app setup ----------
const app = express();
app.disable("x-powered-by");
app.set("case sensitive routing", true); // so /My-Services.html and /my-services.html stay different routes
app.set("trust proxy", 1);

app.use((_req, res, next) => {
    res.set({
        "Content-Security-Policy": [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self'",
            "img-src 'self' data: https:",
            "form-action 'self' mailto:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "object-src 'none'",
        ].join("; "),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
});

app.use(express.json({ limit: "20kb" }));
app.use(
    cookieSession({
        name: "session",
        keys: [SESSION_SECRET || crypto.randomBytes(32).toString("hex")],
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: "lax",
        secure: IS_PROD,
    })
);

app.get("/healthz", (_req, res) => {
    res.type("text").send("ok");
});

// Old page names still work, so existing links and bookmarks don't break.
const REDIRECTS: Readonly<Record<string, string>> = {
    "/websites.html": "/view-my-work.html",
    "/logos.html": "/view-my-work.html",
    "/mockups.html": "/view-my-work.html",
    "/My-Services.html": "/my-services.html",
};
for (const [from, to] of Object.entries(REDIRECTS)) {
    app.get(from, (_req, res) => res.redirect(301, to));
}

app.use(
    express.static(PUBLIC_DIR, {
        extensions: ["html"],
        setHeaders: (res, filePath) => {
            const longLived = /\.(jpe?g|png|webp|gif|svg|ico|woff2?)$/i.test(filePath);
            res.set("Cache-Control", longLived ? "public, max-age=604800" : "no-cache");
        },
    })
);

function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.session?.isAdmin) {
        next();
        return;
    }
    res.status(401).json({ error: "Sign in required." });
}

// ---------- auth routes ----------
app.post("/api/login", (req, res) => {
    if (!ADMIN_PASSWORD) {
        res.status(503).json({ error: "Admin login is not set up on this server." });
        return;
    }
    const ip = req.ip ?? "unknown";
    if (lockedOut(ip)) {
        res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
        return;
    }

    const password: unknown = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== "string" || password.length === 0) {
        res.status(400).json({ error: "Password is required." });
        return;
    }
    if (!safeEqual(password, ADMIN_PASSWORD)) {
        recordFailure(ip);
        res.status(401).json({ error: "Incorrect password." });
        return;
    }

    attempts.delete(ip);
    if (req.session) req.session.isAdmin = true;
    res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
        loggedIn: Boolean(req.session?.isAdmin),
        adminEnabled: Boolean(ADMIN_PASSWORD),
    });
});

// ---------- website routes ----------
app.get("/api/websites", (_req, res) => {
    const items = [...readDB().websites].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.set("Cache-Control", "no-cache");
    res.json(items);
});

app.post(
    "/api/websites",
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
        upload.single("image")(req, res, (err: unknown) => {
            if (err) {
                res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
                return;
            }
            next();
        });
    },
    (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const title = asText(body.title).trim();
        const description = asText(body.description).trim();
        const tags = asText(body.tags);
        const discardUpload = (): void => {
            if (req.file) fs.unlink(req.file.path, () => {});
        };

        if (!title) {
            discardUpload();
            res.status(400).json({ error: "A title is required." });
            return;
        }

        const link = cleanUrl(body.url);
        if (link === null) {
            discardUpload();
            res.status(400).json({ error: "Enter a full link starting with http:// or https://." });
            return;
        }
        if (!link) {
            discardUpload();
            res.status(400).json({ error: "A live link is required for websites." });
            return;
        }

        const db = readDB();
        const item: WorkItem = {
            id: crypto.randomUUID(),
            title: title.slice(0, 120),
            description: description.slice(0, 500),
            url: link,
            tags: tags
                .split(",")
                .map((t) => t.trim().slice(0, 30))
                .filter(Boolean)
                .slice(0, 8),
            image: req.file ? `/uploads/${req.file.filename}` : "",
            createdAt: new Date().toISOString(),
        };

        db.websites.unshift(item);
        writeDB(db);
        res.status(201).json(item);
    }
);

app.delete("/api/websites/:id", requireAuth, (req, res) => {
    const id = asText(req.params.id);
    const db = readDB();
    const item = db.websites.find((entry) => entry.id === id);

    if (!item) {
        res.status(404).json({ error: "Item not found." });
        return;
    }

    // Only remove files that were uploaded through the admin panel. Images that
    // ship with the repo (under /images) must never be deleted from here.
    if (item.image.startsWith("/uploads/")) {
        fs.unlink(path.join(UPLOADS_DIR, path.basename(item.image)), () => {});
    }

    db.websites = db.websites.filter((entry) => entry.id !== id);
    writeDB(db);
    res.status(204).end();
});

// ---------- fallback ----------
app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        res.status(404).json({ error: "Not found." });
        return;
    }
    res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"), (err) => {
        if (err) res.status(404).send("Not found");
    });
});

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    if (res.headersSent) {
        next(err);
        return;
    }
    res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
