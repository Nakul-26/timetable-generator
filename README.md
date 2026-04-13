# Timetable Generator (ERP)

Comprehensive summary and developer reference for the Timetable Generator project.

This is a full-stack application that generates timetables for educational institutions while providing a management UI for faculties, subjects, classes, and assignments. It supports a multi-tenant/workspace model (colleges) and provides a small superadmin layer for managing colleges and admins.

Table of contents
- Overview
- Features
- Architecture & file structure
- Key flows and components
- Running the project (development)
- Environment variables
- Migration and utility scripts
- Troubleshooting & notes

Overview
--------
The project comprises a React + Vite frontend and a Node.js + Express backend with MongoDB (Mongoose). The backend exposes REST APIs; the frontend consumes those endpoints and provides an admin UI. Timetable generation logic lives in backend services and optionally in a solver worker.

Features
--------
- User authentication (JWT cookie-based)
- Roles: `superadmin` and `admin` (college-scoped)
- Superadmin: manage colleges and admins (CRUD) and act-as a college
- Admin: manage faculties, subjects, classes, teacher-subject combos, assignments
- Timetable generation: enforce hard/soft constraints, save results
- Export/Import helpers, Excel templates for bulk data
- Lightweight migration utilities to convert legacy college IDs to `College` documents

Architecture & file structure
-----------------------------
- `frontend/` — React + Vite application (UI)
	- `src/api/axios.jsx` — centralized axios instance (adds `x-college-id` header)
	- `src/components/` — shared components (Navbar, PrivateRoute, etc.)
	- `src/pages/` — route pages (faculties, subjects, classes, assignments, timetable, superadmin)
	- `src/pages/HomePage.jsx` — landing/home guidance page
	- `src/styles/` and `src/App.css` — global styles and theme variables

- `backend/` — Express server and REST API
	- `server.js` / `app.js` — main express bootstrap
	- `models/` — Mongoose models (`Admin`, `College`, `Faculty`, `Class`, `Subject`, `TimetableResult`, etc.)
	- `routes/` — API routes (prefixed with `/api`) plus `/api/superadmin`
	- `middleware/` — auth, college-scope enforcement, superadmin guard
	- `services/` — generator, export, worker manager
	- `scripts/` — migration and DB helper scripts (inspect, migrate_create_colleges, link_college_admins, fix_admin_roles_and_link)

- `backend/solver/` — optional Python solver, containers, or worker configs

Key flows and components
------------------------
- Authentication
	- Login issues a JWT stored in an HTTP-only cookie; `auth` middleware validates tokens and sets `req.user`.
	- Admin tokens contain a `collegeId` (for normal admins). Superadmin tokens have no default collegeId and must supply `x-college-id` header when acting-as a college.

- Superadmin / act-as
	- Superadmins use the navbar selector to select a `collegeId`; the frontend stores this in `localStorage.selectedCollegeId` and the axios instance attaches it as `x-college-id` to requests so tenant-scoped endpoints receive a college context.
	- Superadmin routes are mounted under `/api/superadmin` on the backend.

- Timetable data flow
	- Admins create classes, subjects, faculties, and teacher-subject combos; assignments map classes to subjects and teachers.
	- Run generator via backend service which enforces constraints and returns a `TimetableResult` persisted to DB.

Running the project (development)
--------------------------------
Prerequisites
- Node.js 18+ and npm
- MongoDB instance (local or Atlas)

Backend
1. Configure env (see `backend/env.js` or set environment variables):
	 - `MONGO_URI` connection string
	 - `MONGO_DB_NAME` (optional)
	 - `JWT_SECRET` (for token signing)

2. Start backend
```powershell
cd backend
npm install
npm run dev
```

Frontend
1. Configure `VITE_BACKEND_URL` in `.env` or your shell (should include `/api` suffix if desired):
	 - Example: `VITE_BACKEND_URL=http://localhost:5000/api`

2. Start frontend
```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL (commonly `http://localhost:5173`).

Environment variables
---------------------
- `MONGO_URI` — MongoDB connection string
- `MONGO_DB_NAME` — optional DB name (overrides default)
- `JWT_SECRET` — JWT signing secret
- `VITE_BACKEND_URL` — frontend runtime API base URL

Migration & helper scripts
--------------------------
Scripts under `backend/scripts/` help migrate legacy data and inspect DB. They generally default to a dry-run. Examples:
- `inspect_db.mjs` — list collections, counts and sample docs
- `migrate_create_colleges.mjs --apply` — find distinct `collegeId` values found in data and create `College` records
- `fix_admin_roles_and_link.mjs --apply` — set missing admin roles and link colleges to admin `createdBy`

Important developer notes
-------------------------
- Tokens: Superadmin tokens do not include `collegeId`. When a superadmin needs to act as a tenant, the frontend must set `selectedCollegeId` and axios will send `x-college-id`.
- Middleware: `collegeScope` enforces the presence of a college context for tenant routes, but allows safe superadmin routes like `/api/superadmin`, `/api/me` and `/api/logout`.
- Router mounting: superadmin API routes are mounted under `/api/superadmin` so tenant middleware does not block them.

Troubleshooting
---------------
- If tenant pages show empty results: ensure `selectedCollegeId` in localStorage and verify `College` records exist with matching `collegeId` values.
- If login redirects unexpectedly: frontend `Login.jsx` now redirects to `/` (home) after successful login.
- If CORS/403 issues appear: verify backend `auth` and `collegeScope` middleware logs and ensure `x-college-id` is present for superadmin requests.

Contributing
------------
- Make feature branches off `main` and open PRs with clear descriptions.
- Add small focused changes and update README or migration scripts when changing DB schema.

Appendix — Files of interest
---------------------------
- Frontend:
	- `frontend/src/api/axios.jsx` — axios instance & interceptors
	- `frontend/src/components/Navbar2.jsx` — navbar and superadmin Act-as selector
	- `frontend/src/pages/*` — pages and route components
- Backend:
	- `backend/models/` — Mongoose models
	- `backend/middleware/` — auth and tenant enforcement
	- `backend/routes/` — API routes (look for `superadmin.js` under `routes/api`)

If you'd like, I can:
- Remove other unused files and tidy imports.
- Start the frontend dev server and confirm the UI changes locally.
- Add a short `CONTRIBUTING.md` with common dev commands.

---
Updated: April 13, 2026
