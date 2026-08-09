# SECURO

## Project overview

SECURO is an Arabic Node.js/Express application with a PostgreSQL database. The
backend exposes the `/api` routes and the static frontend is in `attached_assets/`.

## Deployment layout

The project is intentionally split into two services:

### Backend — Render Web Service

Create the Render service from the repository root. The checked-in `render.yaml`
contains the service configuration:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Runtime: Node.js

Required environment variables:

- `NODE_ENV=production`
- `NEON_DATABASE_URL` — PostgreSQL/Neon connection string
- `SESSION_SECRET` — long random session secret
- `FRONTEND_URL` — the exact Vercel URL, without a trailing slash
- `COOKIE_SAME_SITE=none`

Run database initialization once before first use:

```bash
npm ci
npm run db:init
```

### Frontend — Vercel

Create the Vercel project with `attached_assets` as its **Root Directory**.
The frontend is plain HTML/CSS/JavaScript; there is no Node server to run on
Vercel.

- Framework preset: Other
- Build command: `npm run build`
- Output directory: `.`
- Install command: `npm install` (automatic)
- Start command: not applicable — Vercel serves the static files directly

The frontend package has a validation-only build, so no bundling step is needed.
`attached_assets/vercel.json` forwards `/api/*` to the Render backend and sets
no-cache headers. Replace `https://securo-backend.onrender.com` in that file
with the final Render service URL before deploying the frontend.

## Deployment order

1. Create the PostgreSQL database and initialize it with `npm run db:init`.
2. Deploy the repository root to Render and copy the backend URL.
3. Set the Render `FRONTEND_URL` to the final Vercel URL.
4. Replace the backend destination in `attached_assets/vercel.json`.
5. Deploy `attached_assets` to Vercel.
6. Confirm `GET https://<render-service>/api/health` returns JSON.

## Local commands

Backend:

```bash
npm install
npm run build
NEON_DATABASE_URL='postgresql://...' SESSION_SECRET='local-secret' npm start
```

Frontend validation:

```bash
cd attached_assets
npm install
npm run build
```