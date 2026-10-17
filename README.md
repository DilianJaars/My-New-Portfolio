# Dilian Jaars — Portfolio

A personal portfolio with a small Express server behind it. Visitors see the
home page, skills, services and a **Work** page with three collections
(Websites, Logos, Mockups). The owner can add or delete entries from the
browser behind a single admin password.

## What's inside

```
public/
  index.html             Home
  view-my-work.html      Work: Websites / Logos / Mockups tabs + admin panel
  my-skills.html         Skills, grouped
  my-services.html       Price list and website packages
  get-in-touch.html      Contact links and a mail-ready form
  404.html               Not-found page
  css/site.css           Shared styles (colours, type and layout tokens at the top)
  js/                    site.js (footer year), work.js (collections + admin), contact.js
  images/                Photos and logos that ship with the repo
  uploads/               Images added through the admin panel (not committed)
data/db.json             The "database": three collections as JSON
server.js                Express server + API
render.yaml              Render deploy config
.env.example             Copy to .env for local development
```

Old links still work: `/websites.html`, `/logos.html`, `/mockups.html` and
`/My-Services.html` redirect to their new homes.

## Run it locally

```bash
npm install
cp .env.example .env
# set ADMIN_PASSWORD and SESSION_SECRET in .env
npm start
```

Open http://localhost:3000. If `ADMIN_PASSWORD` is empty, the admin login is
switched off and the site is read-only.

## The admin panel

On the Work page, **Manage** asks for the admin password. Once signed in you
can add an entry (title, link, image, description, tools) to the collection
you're viewing, or delete existing ones. Websites need a link; logos and
mockups don't.

Security notes:

- There is **no default password**. `ADMIN_PASSWORD` must come from the
  environment. In production the server also refuses to start without
  `SESSION_SECRET`.
- After 5 wrong passwords an IP address is locked out for 15 minutes.
- Uploads are limited to JPG, PNG, WebP and GIF (no SVG) up to 8 MB.
- Deleting an entry only removes files it uploaded itself. Images under
  `public/images/` are never deleted.
- Security headers (CSP, `X-Frame-Options` and others) are set on every
  response. Scripts only load from this site.

> If an earlier version of this repo with a hardcoded password was ever
> public, change `ADMIN_PASSWORD` to a new value. Git history keeps old code.

## Deploy: GitHub → Render

1. Push the repo to GitHub.
2. In [Render](https://render.com): **New → Blueprint** (or **Web Service**) and
   connect the repo. `render.yaml` fills in the build and start commands and
   the `/healthz` health check.
3. In the service's **Environment** tab set `ADMIN_PASSWORD`. `SESSION_SECRET`
   is generated for you by the blueprint.
4. Deploy.

## Adding work so it lasts

Render's free disk is **ephemeral**: entries added through the admin panel
(and their uploaded images) disappear when the service redeploys or restarts.
Two ways around that:

- **Commit your work to the repo (free).** Add your projects to
  `data/db.json` and put screenshots in `public/images/`, then push. Example
  entry:

  ```json
  {
    "id": "bakery-site",
    "title": "WeLove2Bake",
    "description": "A bakery site with a menu and order enquiries.",
    "url": "https://example.com",
    "tags": ["HTML", "CSS", "JavaScript"],
    "image": "/images/welove2bake.jpg",
    "createdAt": "2026-09-18T00:00:00.000Z"
  }
  ```

- **Add a Render persistent disk** (paid) mounted on `data/` and
  `public/uploads/`, or move to a real database and image storage.
