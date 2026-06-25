# Architecture

> This document is the **immutable rule set** for this codebase.  
> It overrides any local convention, any historical pattern, and any "we always did it this way."  
> Changes to this document require an explicit team decision and must update the decision log in `docs/architecture-migration.md`.

---

## The one rule

> **No new code may introduce a new representation of `TeachingAssignment`.  
> Every layer must either consume the canonical domain model or translate to/from it at a defined boundary.**

Concretely: if you find yourself writing  
`combo.subject?._id || combo.subjectId || combo.subject_id || combo.subject`  
you are violating this rule. Stop. Use the domain entity.

---

## The two legal translation boundaries

There are exactly **two** places in the codebase where data changes shape:

```
Legacy DB / External Input
        │
        ▼  ── boundary 1 ──
  LegacyMapper  (backend/services/legacy/legacyMapper.js)
        │
        ▼
  TeachingAssignment  ←── everything between these two arrows is the domain
        │
        ▼  ── boundary 2 ──
  GeneratorAdapter  (backend/services/generator/adapter/)
        │
        ▼
  Solver (Python)
```

Anywhere else, `TeachingAssignment` (or its DTO projection) is the only legal type.

---

## Layer responsibilities

| Layer | Allowed input | Allowed output | Banned |
|---|---|---|---|
| **Routes** | Validated request body | Domain DTO (JSON) | Raw Mongoose documents, combo shapes |
| **Domain services** | Domain entities | Domain entities | DB documents, generator types |
| **LegacyMapper** | Raw DB documents | `TeachingAssignment` | Anything domain-layer calls |
| **GeneratorAdapter** | `TeachingAssignment[]` | `Schedule` (assignmentId grid) | Exposing `GeneratorCombo` outside adapter/ |
| **Solver** | `GeneratorInput` | `SolverOutput` | — |
| **Frontend** | `AssignmentDTO`, `SlotDTO` | User events | Combo-shaped objects, raw DB fields |

---

## What lives where

```
backend/
  models/           ← Mongoose schemas only; no business logic
  services/
    legacy/
      legacyAdapter.js           ← ONLY file allowed to read TSC, ClassSubject, ElectiveSetting
    generator/
      adapter/
        toGeneratorInput.js     ← ONLY file allowed to create GeneratorCombo
        fromGeneratorOutput.js  ← ONLY file allowed to map combo ids back to assignmentIds
      runner.js
    planning/
      strategies/               ← One file per PlanningStrategy
    manual-timetable/
      assignmentResolver.service.js  ← replaces comboResolver
      slot.service.js
      persistence.service.js
      manualValidator.service.js
      autofill.service.js
  middleware/
    requireCollegeId.js         ← hard-fail if collegeId missing
  utils/
    comboNormalizer.js          ← TEMPORARY bridge; deleted in Phase 4
```

---

## The banned list

Never introduce these in new code:

### Field names
| Banned | Use instead |
|---|---|
| `faculty` / `facultyId` / `faculty_id` / `faculty_ids` | `teacher` / `teacherId` / `teacherIds` |
| `class_id` / `class_ids` | `classId` / `classIds` |
| `subject_id` / `subject_type` / `subjectType` | `subjectId` / `mode` |
| `combo` / `comboId` (outside generator adapter) | `assignment` / `assignmentId` |
| `type` (for subject delivery mode) | `mode` |

### Patterns
```js
// ❌ banned — multi-alias field access
combo.subject?._id || combo.subjectId || combo.subject_id || combo.subject

// ❌ banned — inline combo snapshots in slot grids
classTimetable[classId][day][hour] = [{ faculty, subject, _id }]

// ❌ banned — creating TeacherSubjectCombination records in new code
await TeacherSubjectCombination.create(...)

// ❌ banned — importing legacy models outside LegacyMapper
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js"
// (only legal in legacyMapper.js)
```

### The canonical alternatives
```js
// ✅ correct — use domain entity from LegacyMapper or AssignmentResolver
const assignment = await AssignmentResolver.resolve(state, assignmentId);
// assignment.teacherIds   ← always string[]
// assignment.subjectId    ← always string
// assignment.classIds     ← always string[]
// assignment.mode         ← always "THEORY" | "LAB" | "ELECTIVE" | "NO_TEACHER"

// ✅ correct — slot grids store assignmentId strings only
classTimetable[classId][day][hour] = ["assignmentId1", "assignmentId2"]
```

---

## Dependency direction

Lower layers never depend on higher layers. Violations are not tolerated.

```
  Frontend (React)
       │
       ▼  (HTTP JSON — DTOs only)
  Routes (Express)
       │
       ▼
  Domain Services
  (AssignmentResolver, TimetableService, etc.)
       │
       ▼
  LegacyAdapter / Repositories
  (reads DB, returns domain entities)
       │
       ▼
  Database (MongoDB)


  Domain Services
       │
       ▼
  GeneratorAdapter  (boundary 2)
       │
       ▼
  Solver (Python)
```

### What this means in practice

| This layer | ❌ Must NEVER import |
|---|---|
| `Routes` | Other route files, domain services that import routes |
| `Domain Services` | Frontend DTOs, Express req/res types |
| `LegacyAdapter` | GeneratorAdapter, domain services |
| `GeneratorAdapter` | Routes, domain services |
| `Models` | Services, routes, utils |
| `Solver` | Anything in backend/ |

---

## CI enforcement

Run `npm run arch:check` (or `node scripts/check-architecture.mjs` from repo root) before any PR.

- **Errors** → must fix before merging
- **Warnings** → expected during active migration phases; must be zero before Phase 3 begins

The guard checks:
- TSC imports outside `services/legacy/`
- `ClassSubject` / `ElectiveSubjectSetting` imports outside allowed layers
- Banned field names (`faculty_ids`, `subject_id` outside generator)
- Inline combo objects pushed into slot grids
- `TeacherSubjectCombination.create()` calls in new code
- Multi-alias field access chains


| Phase | Status | Description |
|---|---|---|
| 0 | ✅ Done | Contracts defined (domain-model.md, architecture-migration.md, this file) |
| 1 | ✅ Done | Canonical normalizer, collegeId guard, post-find hooks removed |
| 2a | ✅ Done | `/process-new-input` stores real `TeachingAllocation._id` values; `populateAssignments` reads from `TeachingAllocation` |
| 2b | ✅ Done | `AssignmentResolver` created; `LegacyMapper` created as sole TSC importer boundary |
| 2c | 🔄 Next | Stop TSC imports in `persistence.service.js`, `autofill.service.js`, `timetableManualUtils.js` |
| 2d | ⬜ Pending | DB-backed session state recovery |
| 3 | ⬜ Pending | Remove legacy collections (ClassSubject, TSC, ElectiveSetting) |
| 4 | ⬜ Pending | Generator boundary: GeneratorCombo fully private |
| 5 | ⬜ Pending | Frontend: AssignmentDTO everywhere, component split |

---

## Read before you write

1. `docs/domain-model.md` — what the entities are and why
2. `docs/architecture-migration.md` — what role every existing file plays and what to do with it
3. This file — what you must never do, what the two legal boundaries are

If a change you're about to make cannot be described in terms of these three documents, stop and discuss before coding.
