# SECURO

## Project overview

SECURO is an Arabic Node.js/Express application with a PostgreSQL database. The
backend exposes the `/api` routes and the static frontend is in `attached_assets/`.

## Deployment layout

The project is intentionally split into two services:

### Backend — Render Web Service

Create the Render service from the repository root. The checked-in `render.yaml`
contains the service configuration:

- Build command: `npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org/ --replace-registry-host=never && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Runtime: Node.js 20 (`.node-version` / `NODE_VERSION`)

Required environment variables:

- `NODE_ENV=production`
- `NEON_DATABASE_URL` — PostgreSQL/Neon connection string
- `SESSION_SECRET` — long random session secret
- `FRONTEND_URL` — `https://securo-m9ei-seven.vercel.app`
- `COOKIE_SAME_SITE=none`

Run database initialization once before first use:

```bash
npm ci --omit=dev
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
no-cache headers. The current Render service URL in that file is
`https://securo-jmd1.onrender.com`.

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

## Server-owned financial and reward state

The browser is never trusted to write `balance`, withdrawal reservations, VIP
membership, task progress, daily rewards, referral commissions, or wheel spins.
Those values are changed only by authenticated backend transactions:

- `POST /api/deposit-requests` creates a pending request; an admin approval
  credits the user and creates referral commissions.
- `POST /api/withdrawal-requests` creates a pending request and reserves the
  amount. Admin approval debits it; rejection releases the reservation.
- `POST /api/rewards/daily`, `/api/vip/trial`, `/api/vip/purchase`, and
  `/api/wheel/spin` perform their checks and balance changes on the server.
- `/api/tasks/:taskIndex/start` and `/complete` use `task_attempts`; the server
  validates membership, order, one attempt per day, comment, and the 60-second
  minimum duration.

After schema changes, run `npm run db:init` against the intended Neon database.