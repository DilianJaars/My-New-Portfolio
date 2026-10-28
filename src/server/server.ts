import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieSession from "cookie-session";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { IMAGE_TYPES, createStore, usingSupabase } from "./store.js";

// Works both compiled (dist/server) and under tsx (src/server): the project
// root is always two folders up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_DIR = path.join(ROOT, "public");
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
    console.warn("SESSION_SECRET is not set. Using a random one, so admin sessions end whenever the server restarts.");
}

const store = createStore(ROOT);
if (usingSupabase) {
    console.log("Websites added in Manage are saved in Supabase.");
} else {
    console.warn("SUPABASE_URL / SUPABASE_SERVICE_KEY not set: websites added in Manage are stored on local disk and are lost on redeploy.");
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
// Screenshots are held in memory, then handed to the store (Supabase or disk).
const upload = multer({
    storage: multer.memoryStorage(),
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

// ---------- entry gate ----------
// First-time visitors get the basketball page in place of any page of the site.
// Winning (the browser sets the cookie) or entering the skip code (the server
// sets it) lets them through. Search engines and link previews go straight in.
// This is a fun intro, not security: the cookie is not secret.
const SKIP_CODE = process.env.GATE_SKIP_CODE ?? "1234";
const GATE_COOKIE = /(?:^|;\s*)dj_gate=1(?:;|$)/;
const SKIP_GATE_FOR = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview/i;
const skipAttempts = new Map<string, { count: number; first: number }>();

function isPagePath(p: string): boolean {
    if (p === "/") return true;
    if (p.startsWith("/api/") || p === "/healthz") return false;
    if (p === "/enter" || p === "/enter.html" || p === "/404" || p === "/404.html") return false;
    const ext = path.extname(p);
    return ext === "" || ext === ".html";
}

app.post("/api/gate/skip", (req, res) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = skipAttempts.get(ip);
    if (entry && now - entry.first > LOCKOUT_MS) skipAttempts.delete(ip);
    const current = skipAttempts.get(ip);
    if (current && current.count >= 8) {
        res.status(429).json({ error: "Too many tries. Please wait a while." });
        return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!SKIP_CODE || !safeEqual(asText(body.code), SKIP_CODE)) {
        skipAttempts.set(ip, { count: (current?.count ?? 0) + 1, first: current?.first ?? now });
        res.status(401).json({ error: "That code is not right." });
        return;
    }
    skipAttempts.delete(ip);
    res.cookie("dj_gate", "1", { httpOnly: false, sameSite: "lax", secure: IS_PROD, path: "/" });
    res.json({ ok: true });
});

app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !isPagePath(req.path)) {
        next();
        return;
    }
    res.vary("Cookie");
    const passed = GATE_COOKIE.test(req.headers.cookie ?? "");
    const isBot = SKIP_GATE_FOR.test(req.get("user-agent") ?? "");
    if (passed || isBot) {
        next();
        return;
    }
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(PUBLIC_DIR, "enter.html"));
});

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
app.get("/api/websites", async (_req, res, next) => {
    try {
        res.set("Cache-Control", "no-cache");
        res.json(await store.list());
    } catch (err) {
        next(err);
    }
});

const parseUpload = (req: Request, res: Response, next: NextFunction): void => {
    upload.single("image")(req, res, (err: unknown) => {
        if (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
            return;
        }
        next();
    });
};

type Fields = { title: string; description: string; url: string; tags: string[] };

/** Validates the website form. Returns the fields, or an error message. */
function readWebsiteFields(req: Request): Fields | { error: string } {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = asText(body.title).trim();
    if (!title) return { error: "A title is required." };

    const link = cleanUrl(body.url);
    if (link === null) return { error: "Enter a full link starting with http:// or https://." };
    if (!link) return { error: "A live link is required for websites." };

    return {
        title: title.slice(0, 120),
        description: asText(body.description).trim().slice(0, 500),
        url: link,
        tags: asText(body.tags)
            .split(",")
            .map((t) => t.trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 8),
    };
}

const uploadedImage = (req: Request) =>
    req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : undefined;

app.post("/api/websites", requireAuth, parseUpload, async (req: Request, res: Response) => {
    const fields = readWebsiteFields(req);
    if ("error" in fields) {
        res.status(400).json({ error: fields.error });
        return;
    }
    try {
        res.status(201).json(await store.add(fields, uploadedImage(req)));
    } catch (err) {
        console.error(err);
        res.status(502).json({ error: "Could not save the website. Please try again." });
    }
});

app.put("/api/websites/:id", requireAuth, parseUpload, async (req: Request, res: Response) => {
    const fields = readWebsiteFields(req);
    if ("error" in fields) {
        res.status(400).json({ error: fields.error });
        return;
    }
    const removeImage = asText((req.body as Record<string, unknown> | undefined)?.removeImage) === "1";
    try {
        const updated = await store.update(asText(req.params.id), fields, uploadedImage(req), removeImage);
        if (!updated) {
            res.status(404).json({ error: "Item not found." });
            return;
        }
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(502).json({ error: "Could not save the changes. Please try again." });
    }
});

app.delete("/api/websites/:id", requireAuth, async (req, res) => {
    try {
        const removed = await store.remove(asText(req.params.id));
        if (!removed) {
            res.status(404).json({ error: "Item not found." });
            return;
        }
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(502).json({ error: "Could not delete the website. Please try again." });
    }
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
