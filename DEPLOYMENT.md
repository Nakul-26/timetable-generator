# Deployment

This repo is split into three deploy targets:

- `frontend` -> Cloudflare Pages
- `backend` -> Vercel Serverless Functions
- `backend/solver` -> Render web service

## 1. Frontend on Cloudflare Pages

Project settings:

- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`

Environment variables:

- `VITE_BACKEND_URL=https://your-backend-project.vercel.app/api`
- `VITE_GENERATION_STATUS_POLL_MS=3000`

Notes:

- `frontend/public/_redirects` enables SPA routing on Cloudflare Pages.
- If you use a custom domain, add that exact origin to the backend `CORS_ORIGINS`.

## 2. Backend on Vercel

Deploy the `backend` directory as its own Vercel project.

Project settings:

- Root directory: `backend`
- Framework preset: `Other`

Environment variables:

- `MONGO_URI`
- `MONGO_DB_NAME=timetable_jayanth`
- `JWT_SECRET`
- `CORS_ORIGINS=https://your-frontend.pages.dev,https://your-custom-domain.com`
- `SOLVER_URL=https://your-solver-service.onrender.com`
- `SOLVER_TIMEOUT_MS=210000`

Notes:

- `backend/api/index.js` is the Vercel serverless entrypoint.
- `backend/app.js` now owns Express app setup and lazy Mongo connection reuse.
- `backend/vercel.json` routes all requests to the serverless function.
- The frontend should call `https://your-backend.vercel.app/api`.

## 3. Solver on Render

Deploy `backend/solver` as a Render web service. You can use the included blueprint file or create the service manually.

Manual settings:

- Root directory: `backend/solver`
- Runtime: `Python 3`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`

Environment variables:

- `MONGO_URI`
- `MONGO_DB_NAME=timetable_jayanth`
- `SOLVER_WORKERS=8`

Notes:

- `backend/solver/render.yaml` is included for Render Blueprint deployment.
- Health endpoint: `GET /health`
- Job endpoint used by the backend: `POST /jobs`

## Wiring order

1. Deploy the solver on Render and copy its public URL.
2. Deploy the backend on Vercel with `SOLVER_URL` pointing to the Render URL.
3. Deploy the frontend on Cloudflare Pages with `VITE_BACKEND_URL` pointing to the Vercel `/api` URL.
4. Add the Cloudflare Pages origin and any custom domain to backend `CORS_ORIGINS`.

## Important constraint

The backend is serverless, but timetable generation still depends on the long-running Python solver on Render. The current Vercel setup is suitable because the backend only creates jobs, polls MongoDB, and proxies normal API traffic. The heavy computation stays out of Vercel.

Generation policy values such as solver time, option count, early-abort thresholds, and diversity thresholds are controlled from the timetable settings page and sent as part of `constraintConfig`, not deployment env vars.
