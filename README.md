# Timetable Generator

Full-stack timetable management and generation system for colleges and institutions.

The app lets college admins manage faculties, subjects, classes, teacher-subject mappings, and teaching allocations, then generate and manually refine timetables with constraint-aware rules. A superadmin layer can manage colleges and admins across workspaces.

## What It Does

- College-scoped admin workflow with JWT-based login
- Superadmin workspace for managing colleges and admins
- Faculty, subject, and class CRUD
- Teacher-subject combinations and teaching allocations
- Class-subject, class-faculty, and elective subject assignment screens
- Timetable generation with configurable constraints
- Constraint health checks before generation
- Fixed slots and manual timetable editing
- Saved timetable history, viewing, and Excel export
- Generation payload inspection for debugging

## Main Areas

### Frontend

- React + Vite app in `frontend/`
- Main navigation and route protection in `frontend/src/App.jsx`
- Home page quick-start guide in `frontend/src/pages/HomePage.jsx`
- Timetable generation UI in `frontend/src/pages/Timetable.jsx`
- Timetable settings UI in `frontend/src/pages/TimetableSettings.jsx`
- Manual timetable editor in `frontend/src/pages/manual/ManualTimetable.jsx`
- Saved timetable list in `frontend/src/pages/SavedTimetables.jsx`

### Backend

- Express API in `backend/`
- Mongoose models for colleges, admins, faculties, subjects, classes, allocations, settings, and timetable results
- College-scoped API middleware
- Superadmin routes mounted separately under `/api/superadmin`
- Generator data preparation in `backend/services/generator/prepareGeneratorData.js`
- Timetable generation endpoints in `backend/routes/api/timetable.js`
- Manual timetable endpoints in `backend/routes/timetableManual.js`
- Optional solver code under `backend/solver/`

### Testing & Safety Net

The project includes a suite of automated tests to prevent regressions.

**Backend Tests (Node.js/Vitest):**
```powershell
cd backend
npm test
```

**Solver Tests (Python/Pytest):**
```powershell
cd backend/solver
pytest
```

**CI/CD:**
Tests are automatically run on every push to GitHub via GitHub Actions.

## Key User Flows

1. Log in as an admin or superadmin.
2. Add master data: faculties, subjects, and classes.
3. Create teacher-subject combinations and teaching allocations.
4. Configure timetable constraints on the settings page.
5. Run health checks and generate a timetable.
6. Review one or more generated options.
7. Save the selected timetable or open it in the manual editor.
8. Export or revisit saved timetables later.

## Superadmin Flow

Superadmins can:

- Create and manage colleges
- Create and manage admins
- Use the navbar "Act as" selector to work inside a specific college context

When acting as a college, the frontend stores the selected college id and sends it with API requests so tenant-scoped endpoints receive the correct context.

## Timetable Generation Features

The timetable screen supports:

- Per-user, per-college generation settings
- Constraint presets and advanced solver tuning
- Teacher availability and preference merging
- Fixed slots
- Multiple generated options
- Class and faculty timetable views
- Progress tracking for async generation jobs
- Saved result persistence

The manual timetable editor supports:

- Drag-and-drop slot movement
- Slot validation before moves
- Locking and unlocking slots
- Auto-fill for a class
- Saving changes back to a timetable record

## Project Structure

- `frontend/` - UI
- `backend/` - API, data models, generator services, and manual timetable tools
- `backend/solver/` - Python solver and worker utilities
- `backend/scripts/` - migration and admin/college setup helpers

## Development Setup

### Prerequisites

- Node.js 18+
- npm
- MongoDB

### Backend

Backend env vars:

- `MONGO_URI` - MongoDB connection string
- `MONGO_DB_NAME` - optional database name
- `JWT_SECRET` - JWT signing secret
- `CORS_ORIGINS` - optional comma-separated allowed frontend origins
- `SOLVER_URL` - optional solver service base URL

Backend scripts live in `backend/package.json`:

```powershell
cd backend
npm install
npm run dev
```

### Frontend

Frontend env vars:

- `VITE_BACKEND_URL` - API base URL, usually `http://localhost:5000/api`

Frontend scripts live in `frontend/package.json`:

```powershell
cd frontend
npm install
npm run dev
```

Then open the Vite app, usually at `http://localhost:5173`.

## API Highlights

- `/api/login`, `/api/logout`, `/api/me`
- `/api/faculties`, `/api/subjects`, `/api/classes`
- `/api/teacher-subject-combos`
- `/api/class-subjects`, `/api/class-faculties`
- `/api/teaching-allocations`
- `/api/timetable-settings`
- `/api/process-new-input`
- `/api/generate`
- `/api/health-check`
- `/api/result/latest`
- `/api/timetables`
- `/api/timetable/:id`
- `/api/timetable/:id/export/excel`
- `/api/manual/*` for the manual editor
- `/api/superadmin/*` for cross-college administration

## Notes

- The app uses cookie-based authentication.
- Tenant routes are college-scoped, so superadmin requests must include a selected college context.
- Timetable generation is async and stores job/result data in MongoDB.
- The README intentionally reflects the current implementation in the repo rather than a generic product description.

## Related Files

- [frontend/src/App.jsx](frontend/src/App.jsx)
- [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx)
- [frontend/src/pages/Timetable.jsx](frontend/src/pages/Timetable.jsx)
- [frontend/src/pages/TimetableSettings.jsx](frontend/src/pages/TimetableSettings.jsx)
- [frontend/src/pages/manual/ManualTimetable.jsx](frontend/src/pages/manual/ManualTimetable.jsx)
- [backend/routes/api/timetable.js](backend/routes/api/timetable.js)
- [backend/services/generator/prepareGeneratorData.js](backend/services/generator/prepareGeneratorData.js)

Updated: May 14, 2026
