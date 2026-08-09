# SECURO

## Project overview

SECURO is an Arabic Node.js/Express application with a PostgreSQL database. The
backend exposes the `/api` routes and the static UI is kept in `attached_assets/`.

## Deployment layout

- Backend: deploy the repository root as a Render Web Service.
- Frontend: deploy `attached_assets/` as a separate static Vercel project.
- Configure `FRONTEND_URL` on Render and `BACKEND_URL` during the Vercel build
  so authenticated requests can use cross-origin session cookies.