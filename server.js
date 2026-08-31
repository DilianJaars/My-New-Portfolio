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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Dilly@2005";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

if (!process.env.ADMIN_PASSWORD) {
    console.warn(
        "WARNING: ADMIN_PASSWORD is not set. Using the default 'changeme'. " +
        "Set ADMIN_PASSWORD in your environment before deploying."
    );
}

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

// ---------- tiny JSON "database" ----------
function readDB() {
    if (!fs.existsSync(DATA_FILE)) {
        const empty = { websites: [], logos: [], mockups: [] };
        fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2));
        return empty;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    for (const key of COLLECTIONS) {
        if (!Array.isArray(parsed[key])) parsed[key] = [];
    }
    return parsed;
}

function writeDB(db) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ---------- image uploads ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
        const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
        cb(null, name);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image files are allowed"));
        }
        cb(null, true);
    },
});

// ---------- app setup ----------
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(
    cookieSession({
        name: "session",
        keys: [SESSION_SECRET],
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
    })
);
app.use(express.static(PUBLIC_DIR));

function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    return res.status(401).json({ error: "Sign in required." });
}

function validCollection(req, res, next) {
    const { collection } = req.params;
    if (!COLLECTIONS.includes(collection)) {
        return res.status(404).json({ error: "Unknown collection." });
    }
    next();
}

// ---------- auth routes ----------
app.post("/api/login", (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length === 0) {
        return res.status(400).json({ error: "Password is required." });
    }
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Incorrect password." });
    }
    req.session.isAdmin = true;
    res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
    res.json({ loggedIn: Boolean(req.session && req.session.isAdmin) });
});

// ---------- collection routes (websites / logos / mockups) ----------
app.get("/api/:collection", validCollection, (req, res) => {
    const db = readDB();
    const items = [...db[req.params.collection]].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
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

        if (!title || !title.trim()) {
            return res.status(400).json({ error: "A title is required." });
        }
        if (collection === "websites" && (!url || !url.trim())) {
            return res.status(400).json({ error: "A live link is required for websites." });
        }

        const db = readDB();
        const item = {
            id: crypto.randomUUID(),
            title: title.trim(),
            description: (description || "").trim(),
            url: (url || "").trim(),
            tags: (tags || "")
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
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

    if (item.image) {
        const imagePath = path.join(PUBLIC_DIR, item.image);
        fs.unlink(imagePath, () => {}); // best effort, ignore errors
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
    res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"), (err) => {
        if (err) res.status(404).send("Not found");
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
