# Dilian Jaars — Portfolio

A personal portfolio site with three "manage your own work" collections —
**Websites**, **Logos**, and **Mockups** — each backed by a small Express API
so you can add or delete entries straight from the browser (behind a single
admin password).

## What's inside

```
public/                 All the static pages (this is what gets served)
  index.html             Home page
  my-skills.html         Skills page
  get-in-touch.html      Contact page
  view-my-work.html      Hub linking to the 3 collections below
  websites.html          Websites collection (title, live link, image, tags)
  logos.html             Logos collection (image-first, optional link)
  mockups.html           Mockups collection (image-first, optional link)
  images/                 Your existing photos/logos
  uploads/                Images added later through the admin panel
data/db.json             The "database" — a JSON file with your 3 collections
server.js                The Express server + API
package.json
render.yaml               One-click Render deploy config
.env.example              Copy to .env for local dev
```

## How the admin panel works

Each of the three collection pages has a lock icon top-right ("Manage
websites/logos/mockups"). Clicking it asks for a single password
(`ADMIN_PASSWORD`, set as an environment variable — **not** stored in the
code). Once signed in you can add a new entry (title, optional link, optional
image, description, tags) or delete existing ones. This replaces the old
Netlify Identity login, which only works when a site is hosted on Netlify.

Sessions are stored in a signed cookie, so there's no server-side session
store to manage.

## Running locally

```bash
npm install
cp .env.example .env
# edit .env and set a real ADMIN_PASSWORD + SESSION_SECRET
npm start
```

Then open http://localhost:3000

## Deploying: GitHub → Render

1. **Push this folder to a new GitHub repo.**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. **Create the Render service.**
   - Go to [render.com](https://render.com) → **New** → **Web Service**.
   - Connect the GitHub repo you just pushed.
   - Render should detect `render.yaml` automatically and pre-fill the
     settings. If not, set them manually:
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
     - **Runtime:** Node

3. **Set environment variables** (Render dashboard → your service →
   Environment):
   - `ADMIN_PASSWORD` — the password you'll use to log into the manage panel.
   - `SESSION_SECRET` — any long random string (Render can auto-generate this
     if you used the `render.yaml` blueprint).

4. **Deploy.** Render will build and start the app, then give you a URL like
   `https://dilian-jaars-portfolio.onrender.com`.

## Important: storage is not permanent by default

`data/db.json` and `public/uploads/` live on Render's local disk. That disk
is **ephemeral** — anything added through the admin panel will disappear the
next time Render redeploys or restarts the service (free-tier services also
restart after periods of inactivity). Your original seed content (in the
repo) will still be there; it's just new entries added later that are at
risk.

If you want additions to truly persist, you have two options:

- **Add a Render Persistent Disk** (Render dashboard → your service → Disks)
  mounted at, e.g., `/opt/render/project/src/data` and `/opt/render/project/src/public/uploads`.
  This is the smallest change and keeps everything working as-is. Persistent
  disks are a paid add-on.
- **Move to a real database** (e.g. a free Render PostgreSQL instance) for
  the three collections, and an object storage service (e.g. Cloudflare R2
  or AWS S3) for uploaded images. This is more setup but is the more robust
  long-term option, especially if you ever run more than one server instance.

## Notes on what changed from the original files

- Netlify Identity (Netlify-only) was replaced with a simple password login
  that works anywhere.
- File names were normalized (no spaces/mixed case) so links work reliably
  on any host: `My skills.html` → `my-skills.html`, `Get in touch.html` →
  `get-in-touch.html`, `view my work.html` → `view-my-work.html`.
- `view-my-work.html` didn't exist in the uploaded files (pages linked to it,
  but it wasn't included) — it's been created as a hub page linking to the
  three collections.
- Logos and Mockups pages were rebuilt to match the Websites page's design
  and admin functionality, instead of their older separate designs
  (Bootstrap card grid / localStorage-only image uploads).
