import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_FILE = path.join(__dirname, "data", "db.json");
const COLLECTIONS = ["websites", "logos", "mockups"];
const IS_PROD = process.env.NODE_ENV === "production";

// ---------- configuration ----------
// There is deliberately no fallback password. Without ADMIN_PASSWORD the admin
// login stays switched off and the public site keeps working read-only.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

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
function readDB() {
    if (!fs.existsSync(DATA_FILE)) {
        const empty = { websites: [], logos: [], mockups: [] };
        writeDB(empty);
        return empty;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    for (const key of COLLECTIONS) {
        if (!Array.isArray(parsed[key])) parsed[key] = [];
    }
    return parsed;
}

// Write to a temp file and rename it so a crash mid-write can't corrupt the data.
function writeDB(db) {
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
}

// ---------- helpers ----------
function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function cleanUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        const parsed = new URL(raw);
        return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
    } catch {
        return null;
    }
}

// Login throttling: 5 wrong passwords per IP, then a 15 minute lockout.
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function lockedOut(ip) {
    const entry = attempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > LOCKOUT_MS) {
        attempts.delete(ip);
        return false;
    }
    return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
    const entry = attempts.get(ip);
    if (!entry || Date.now() - entry.first > LOCKOUT_MS) {
        attempts.set(ip, { count: 1, first: Date.now() });
    } else {
        entry.count += 1;
    }
}

// ---------- image uploads ----------
const IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = IMAGE_TYPES[file.mimetype] || ".jpg";
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (!IMAGE_TYPES[file.mimetype]) {
            return cb(new Error("Upload a JPG, PNG, WebP or GIF image."));
        }
        cb(null, true);
    },
});

// ---------- app setup ----------
const app = express();
app.disable("x-powered-by");
app.set("case sensitive routing", true); // so /My-Services.html and /my-services.html stay different routes
app.set("trust proxy", 1);

app.use((req, res, next) => {
    res.set({
        "Content-Security-Policy": [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
            "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com",
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

app.get("/healthz", (req, res) => res.type("text").send("ok"));

// Old page names still work, so existing links and bookmarks don't break.
const REDIRECTS = {
    "/websites.html": "/view-my-work.html#websites",
    "/logos.html": "/view-my-work.html#logos",
    "/mockups.html": "/view-my-work.html#mockups",
    "/My-Services.html": "/my-services.html",
};
for (const [from, to] of Object.entries(REDIRECTS)) {
    app.get(from, (req, res) => res.redirect(301, to));
}

app.use(
    express.static(PUBLIC_DIR, {
        extensions: ["html"],
        setHeaders: (res, filePath) => {
            const longLived = /\.(jpg|jpeg|png|webp|gif|svg|ico|woff2?)$/i.test(filePath);
            res.set("Cache-Control", longLived ? "public, max-age=604800" : "no-cache");
        },
    })
);

function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    return res.status(401).json({ error: "Sign in required." });
}

function validCollection(req, res, next) {
    if (!COLLECTIONS.includes(req.params.collection)) {
        return res.status(404).json({ error: "Unknown collection." });
    }
    next();
}

// ---------- auth routes ----------
app.post("/api/login", (req, res) => {
    if (!ADMIN_PASSWORD) {
        return res.status(503).json({ error: "Admin login is not set up on this server." });
    }
    if (lockedOut(req.ip)) {
        return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    }

    const { password } = req.body || {};
    if (typeof password !== "string" || password.length === 0) {
        return res.status(400).json({ error: "Password is required." });
    }
    if (!safeEqual(password, ADMIN_PASSWORD)) {
        recordFailure(req.ip);
        return res.status(401).json({ error: "Incorrect password." });
    }

    attempts.delete(req.ip);
    req.session.isAdmin = true;
    res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
        loggedIn: Boolean(req.session && req.session.isAdmin),
        adminEnabled: Boolean(ADMIN_PASSWORD),
    });
});

// ---------- collection routes (websites / logos / mockups) ----------
app.get("/api/:collection", validCollection, (req, res) => {
    const items = [...readDB()[req.params.collection]].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.set("Cache-Control", "no-cache");
    res.json(items);
});

app.post(
    "/api/:collection",
    validCollection,
    requireAuth,
    (req, res, next) => {
        upload.single("image")(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message });
            next();
        });
    },
    (req, res) => {
        const { collection } = req.params;
        const { title, url, description, tags } = req.body || {};
        const discardUpload = () => req.file && fs.unlink(req.file.path, () => {});

        if (!title || !title.trim()) {
            discardUpload();
            return res.status(400).json({ error: "A title is required." });
        }

        const link = cleanUrl(url);
        if (link === null) {
            discardUpload();
            return res.status(400).json({ error: "Enter a full link starting with http:// or https://." });
        }
        if (collection === "websites" && !link) {
            discardUpload();
            return res.status(400).json({ error: "A live link is required for websites." });
        }

        const db = readDB();
        const item = {
            id: crypto.randomUUID(),
            title: title.trim().slice(0, 120),
            description: (description || "").trim().slice(0, 500),
            url: link,
            tags: (tags || "")
                .split(",")
                .map((t) => t.trim().slice(0, 30))
                .filter(Boolean)
                .slice(0, 8),
            image: req.file ? `/uploads/${req.file.filename}` : "",
            createdAt: new Date().toISOString(),
        };

        db[collection].unshift(item);
        writeDB(db);
        res.status(201).json(item);
    }
);

app.delete("/api/:collection/:id", validCollection, requireAuth, (req, res) => {
    const { collection, id } = req.params;
    const db = readDB();
    const item = db[collection].find((entry) => entry.id === id);

    if (!item) {
        return res.status(404).json({ error: "Item not found." });
    }

    // Only remove files that were uploaded through the admin panel. Images that
    // ship with the repo (under /images) must never be deleted from here.
    if (item.image && item.image.startsWith("/uploads/")) {
        const imagePath = path.join(UPLOADS_DIR, path.basename(item.image));
        fs.unlink(imagePath, () => {});
    }

    db[collection] = db[collection].filter((entry) => entry.id !== id);
    writeDB(db);
    res.status(204).end();
});

// ---------- fallback ----------
app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "Not found." });
    }
    res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"), (err) => {
        if (err) res.status(404).send("Not found");
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "Something went wrong on the server." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
