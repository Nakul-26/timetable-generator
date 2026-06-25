# Architecture Migration Plan

> **Document type:** Decision record + implementation contract  
> **Supersedes:** ad-hoc refactoring notes in `issues`  
> **Read alongside:** `docs/domain-model.md`  
>
> Every future code change must answer: "Is this moving toward the target state below, or away from it?"

---

## Part 1 — The target architecture

### System boundary diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Browser / Mobile                                            │
│                                                              │
│  Components speak AssignmentDTO, TeacherDTO, SlotDTO only   │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTP (JSON)
┌──────────────────────────▼──────────────────────────────────┐
│  API Layer  (Express routes)                                 │
│                                                              │
│  Input:  validated domain DTOs                              │
│  Output: domain DTOs                                        │
│  Rule:   no raw Mongoose documents escape this layer         │
└──────┬─────────────────────────────────────────┬────────────┘
       │                                         │
┌──────▼──────────────────┐    ┌─────────────────▼───────────┐
│  Domain Services         │    │  Planning Strategy Layer     │
│                          │    │                              │
│  TeacherService          │    │  ManualStrategy              │
│  SubjectService          │    │  AssistedStrategy            │
│  ClassService            │    │  ImportStrategy (future)     │
│  AssignmentService       │    │  AIStrategy (future)         │
│  TimetableService        │    │                              │
│  ConstraintService       │    │  All strategies emit:        │
│                          │    │    TeachingAssignment[]      │
└──────┬───────────────────┘    └──────────────┬──────────────┘
       │                                        │
       └─────────────────┬──────────────────────┘
                         │  TeachingAssignment[]
┌────────────────────────▼────────────────────────────────────┐
│  Generator Adapter                                           │
│                                                              │
│  toGeneratorInput(TeachingAssignment[]) → GeneratorInput     │
│  fromGeneratorOutput(GeneratorOutput)   → Schedule           │
│                                                              │
│  GeneratorCombo is PRIVATE to this layer                    │
└────────────────────────┬────────────────────────────────────┘
                         │  GeneratorInput (Python API)
┌────────────────────────▼────────────────────────────────────┐
│  Solver (Python)                                             │
│  Returns: { class_timetables: { classId → day → hour → assignmentId[] } }
└─────────────────────────────────────────────────────────────┘
```

---

## Part 2 — Domain entities and DTOs (the law)

### 2.1 Domain entities (source of truth)

```ts
// ── Teacher ──────────────────────────────────────────────────
interface Teacher {
  id:               string
  collegeId:        string
  name:             string
  unavailableSlots: { day: number; hour: number }[]
  preferences: {
    avoidFirstPeriod: boolean
    avoidLastPeriod:  boolean
    maxConsecutive:   number | null
    preferredDays:    number[]
  }
}

// ── Subject ───────────────────────────────────────────────────
interface Subject {
  id:                  string
  collegeId:           string
  name:                string
  semester:            number
  mode:                "THEORY" | "LAB" | "NO_TEACHER"
  isElective:          boolean
  defaultHoursPerWeek: number | null
}

// ── Class ─────────────────────────────────────────────────────
interface Class {
  id:          string
  collegeId:   string
  name:        string
  section:     string
  semester:    number
  daysPerWeek: number
}

// ── TeachingAssignment ────────────────────────────────────────
// THE central entity. Every allocation of a teacher to teach
// a subject to a class is a TeachingAssignment.
interface TeachingAssignment {
  id:              string
  collegeId:       string
  teacherIds:      string[]     // empty only for NO_TEACHER subjects
  subjectId:       string
  classIds:        string[]     // ≥1; multiple = combined sections
  hoursPerWeek:    number
  mode:            "THEORY" | "LAB" | "ELECTIVE" | "NO_TEACHER"
  isElective:      boolean
  electiveGroupId: string | null
  combinedGroupId: string | null
  source:          "DIRECT" | "MAPPING_SYNC"
}

// ── Timetable ─────────────────────────────────────────────────
interface Timetable {
  id:        string
  collegeId: string
  name:      string
  status:    "draft" | "generated" | "edited" | "approved" | "locked"
  source:    "generator" | "manual"
  schedule:  Schedule           // classId → day → hour → assignmentId[]
  config:    TimetableConfig
  metadata:  TimetableMetadata
}

interface Schedule {
  [classId: string]: string[][][]   // [day][hour] = assignmentId[]
}

interface TimetableConfig {
  daysPerWeek: number
  hoursPerDay: number
  breakHours:  number[]
}

interface TimetableMetadata {
  createdAt:       string
  editVersion:     number
  generatedFromId: string | null
  parentId:        string | null
}

// ── TimetableSlot ─────────────────────────────────────────────
// A placed lesson in the schedule
interface TimetableSlot {
  assignmentId: string
  classId:      string
  day:          number
  hour:         number
  source:       "generated" | "manual"
  isLocked:     boolean
}

// ── Constraint ───────────────────────────────────────────────
interface Constraint {
  schedule:   { daysPerWeek: number; hoursPerDay: number; breakHours: number[] }
  structural: { labBlockSize: number }
  teacher:    { maxConsecutive: number; maxDailyLoad: number }
  class:      { maxConsecutive: number; maxSubjectPerDay: number }
  compactness:{ enabled: boolean }
}

// ── PlanningStrategy ─────────────────────────────────────────
// Describes HOW a set of TeachingAssignments was produced.
// Not a DB entity – a metadata tag on each TeachingAssignment.
type PlanningStrategy = "DIRECT" | "MAPPING_SYNC" | "IMPORT" | "AI"
// stored as TeachingAssignment.source
```

### 2.2 DTOs (API contract – what routes send and receive)

```ts
// What the frontend sends / receives for teacher data
interface TeacherDTO {
  id:          string
  name:        string
  preferences: Teacher["preferences"]
  // unavailableSlots omitted from list views; included in detail view
}

// What the frontend sends / receives for subject data
interface SubjectDTO {
  id:          string
  name:        string
  semester:    number
  mode:        Subject["mode"]
  isElective:  boolean
  hoursPerWeek: number | null
}

// What the frontend sends / receives for class data
interface ClassDTO {
  id:          string
  name:        string
  section:     string
  semester:    number
}

// *** The most important DTO. This is what the manual editor,
// the saved timetable viewer, and the generator all consume. ***
interface AssignmentDTO {
  id:              string
  teacherIds:      string[]
  teacherNames:    string[]    // display only; populated by API
  subjectId:       string
  subjectName:     string      // display only; populated by API
  subjectMode:     Subject["mode"]
  classIds:        string[]
  hoursPerWeek:    number
  mode:            TeachingAssignment["mode"]
  isElective:      boolean
  electiveGroupId: string | null
  combinedGroupId: string | null
}

// What the manual editor sends/receives for a single slot
interface SlotDTO {
  assignmentId: string
  day:          number
  hour:         number
  source:       "generated" | "manual"
  isLocked:     boolean
}

// What the timetable view receives – the full schedule
interface TimetableViewDTO {
  id:           string
  name:         string
  status:       Timetable["status"]
  config:       TimetableConfig
  schedule:     Schedule                 // [classId][day][hour] = assignmentId[]
  assignments:  { [assignmentId: string]: AssignmentDTO }  // lookup table
  slotMeta:     { [classId: string]: { [day: number]: { [hour: number]: SlotDTO } } }
}
```

---

## Part 3 — Generator adapter contract

This is the **only** place `GeneratorCombo` can exist. No other file imports this type.

```ts
// ── Internal generator types (PRIVATE to generator adapter) ──
interface GeneratorCombo {
  _id:       string       // synthetic id for the solver round-trip
  class_ids: string[]
  faculty_ids: string[]
  subject_id: string
  hours_per_week: number
  type:      "theory" | "lab" | "elective" | "no_teacher"
  elective_group_id?: string
  combined_class_group_id?: string
}

interface GeneratorInput {
  classes:   GeneratorClass[]
  subjects:  GeneratorSubject[]
  teachers:  GeneratorTeacher[]
  combos:    GeneratorCombo[]
  fixed_slots?: FixedSlot[]
  constraints?: GeneratorConstraints
}

// ── Public adapter interface ──────────────────────────────────
// File: backend/services/generator/generatorAdapter.js
//
// toGeneratorInput(assignments: TeachingAssignment[], config: TimetableConfig) → GeneratorInput
// fromGeneratorOutput(output: SolverOutput) → Schedule
//
// The adapter internally creates GeneratorCombo from TeachingAssignment.
// The Schedule it returns uses the original TeachingAssignment.id as slot values,
// NOT the internal GeneratorCombo._id.
```

**Key rule:** When the solver returns a slot grid of `GeneratorCombo._id` values, the adapter **maps them back** to `TeachingAssignment.id` before returning. The slot grid that enters `TimetableResult` contains only `TeachingAssignment.id` values.

---

## Part 4 — Model disposition table

Every existing model/concept gets one of four roles:

| Role | Meaning |
|---|---|
| **CANONICAL** | Permanent; this is the source of truth going forward |
| **ADAPTER** | Kept as a transformation layer; never stored as-is in new documents |
| **LEGACY-COMPAT** | Must not be used in new code; migrated away in a scheduled phase |
| **DELETE** | Scheduled for complete removal; no new code should reference it |

---

### 4.1 Database collections

| Collection | Current name | Domain entity | Role | Action |
|---|---|---|---|---|
| `faculties` | Faculty | Teacher | **CANONICAL** | Rename domain layer to "Teacher"; DB collection stays `faculties` |
| `subjects` | Subject | Subject | **CANONICAL** | Normalise `type` → `mode` at service boundary |
| `classes` | Class | Class | **CANONICAL** | Remove `assigned_teacher_subject_combos` field (Phase 3) |
| `teachingallocations` | TeachingAllocation | TeachingAssignment | **CANONICAL** | This is the primary assignment store. All new assignment reads/writes go here |
| `timetableresults` | TimetableResult | Timetable | **CANONICAL** | Slots store `assignmentId` strings only (Phase 4 migration of existing docs) |
| `timetableuserssettings` | TimetableUserSettings | Constraint | **CANONICAL** | No changes needed |
| `colleges` | College | Tenant | **CANONICAL** | Infrastructure; no changes |
| `admins` | Admin | User | **CANONICAL** | Infrastructure; no changes |
| `generationjobs` | GenerationJob | — (operational task) | **CANONICAL** | No domain meaning; keep as-is |
| `classsubjects` | ClassSubject | — | **LEGACY-COMPAT** | Read-only. Writes replaced by `TeachingAllocation`. Delete in Phase 3 |
| `teachersubjectcombinations` | TeacherSubjectCombination | — | **DELETE** | Phase 2: stop writes. Phase 3: migrate reads. Phase 4: drop collection |
| `electivesubjectsettings` | ElectiveSubjectSetting | — | **ADAPTER** | Absorbed into `TeachingAllocation.type = ELECTIVE` + `electiveGroupId`. Delete in Phase 3 |
| `allocationaudits` | AllocationAudit | — | **LEGACY-COMPAT** | Keep for audit trail; no new writes in new code paths |

---

### 4.2 Backend services

| File | Role | Action |
|---|---|---|
| `services/generator/prepareGeneratorData.js` | **ADAPTER** | Becomes `GeneratorAdapter.toGeneratorInput()`. Reads only from `TeachingAllocation` (Phase 2 removes `ClassSubject` + `TeacherSubjectCombination` reads) |
| `models/lib/convertNewCollegeInputToGeneratorData.js` | **ADAPTER** | Move to `services/generator/adapter/`. Private to generator. Never imported outside generator/ |
| `models/lib/runGenerator.js` | **ADAPTER** | Move to `services/generator/runner.js` |
| `services/manual-timetable/comboResolver.service.js` | **LEGACY-COMPAT** → **DELETE** | Phase 2: replace with `AssignmentResolver` that reads `TeachingAllocation`. Phase 4: delete |
| `services/manual-timetable/slot.service.js` | **CANONICAL** (keep, rename) | Rename to `timetableSlot.service.js`. Replace `comboId` params with `assignmentId`. Reads `AssignmentDTO` not raw combos |
| `services/manual-timetable/persistence.service.js` | **CANONICAL** (keep, refactor) | Slot grid stores `assignmentId` strings. Remove inline combo snapshots from `combos` field |
| `services/manual-timetable/manualValidator.service.js` | **CANONICAL** (keep) | Replace `comboId` with `assignmentId`. Reads `AssignmentDTO` |
| `services/manual-timetable/autofill.service.js` | **CANONICAL** (keep) | Works with `AssignmentDTO` |
| `services/generator/healthCheck.service.js` | **CANONICAL** (keep) | Already reads `TeachingAllocation`; minor cleanup |
| `utils/comboNormalizer.js` | **ADAPTER** (temporary) | Bridge for Phase 1-2 migration. Deleted in Phase 4 when all callers use `AssignmentDTO` |
| `state/timetableState.js` | **CANONICAL** (keep, evolve) | Session slots store `assignmentId`. DB-backed in Phase 2 |

---

### 4.3 Route files

| File | Role | Action |
|---|---|---|
| `routes/api/timetable.js` | **CANONICAL** (refactor) | Fix `/process-new-input` (Phase 2). Remove debug logs |
| `routes/timetableManual.js` | **CANONICAL** (refactor) | Replace `comboId` → `assignmentId` throughout (Phase 2) |
| `routes/api/teachingAllocation.js` | **CANONICAL** | This is the primary assignment CRUD. No major changes |
| `routes/api/teacherSubject.js` | **LEGACY-COMPAT** | Wraps `TeacherSubjectCombination`. Phase 3: convert to read-only, then delete |
| `routes/api/classSubject.js` | **LEGACY-COMPAT** | Phase 3: convert to derived view of `TeachingAllocation`, then delete |
| `routes/api/faculty.js` | **CANONICAL** | Add `TeacherDTO` mapping at response boundary |
| `routes/api/subject.js` | **CANONICAL** | Normalise `type` → `mode` at response boundary |
| `routes/api/class.js` | **CANONICAL** | Remove `assigned_teacher_subject_combos` from response (Phase 3) |

---

### 4.4 Frontend components

| Component | Role | Action |
|---|---|---|
| `Timetable.jsx` | **CANONICAL** (refactor) | Split into focused components (Phase 5). State uses `AssignmentDTO` not combo shapes |
| `ManualTimetable.jsx` | **CANONICAL** (refactor) | Receives `TimetableViewDTO`; uses `assignmentId` for slot placement |
| `ViewTimetable.jsx` | **CANONICAL** (keep) | Receives `TimetableViewDTO` |
| `SavedTimetables.jsx` | **CANONICAL** (keep) | No combo shapes; displays name/status only |

---

## Part 5 — PlanningStrategy layer

The platform currently hard-codes two allocation workflows:
1. **Manual** — admin directly creates `TeachingAssignment` records
2. **Assisted** — `ClassSubject` + `TeacherSubjectCombination` → sync → `TeachingAssignment`

Future workflows (already requested or implied):
3. **Import** — Excel/CSV → parse → `TeachingAssignment`
4. **AI recommendation** — constraint solver suggests allocations → admin approves → `TeachingAssignment`

### Where it lives

```
backend/
  services/
    planning/
      strategies/
        ManualStrategy.js       // directly upserts TeachingAssignment
        AssistedStrategy.js     // syncs from ClassSubject + TSC → TeachingAllocation
        ImportStrategy.js       // (future) parses uploaded file
      PlanningStrategyFactory.js
```

### Contract

```js
// Every strategy implements this interface:
class PlanningStrategy {
  // Returns the upserted/created TeachingAssignment[]
  async execute(input, collegeId): Promise<TeachingAssignment[]>
}
```

The key invariant: **every workflow ends with `TeachingAssignment`**. The generator, the manual editor, and the timetable viewer only ever consume `TeachingAssignment`. They don't care how it was created.

---

## Part 6 — Phased migration plan

### Phase 0 — Contracts (this document) ✅
- [x] Domain model defined (`docs/domain-model.md`)
- [x] DTOs and naming conventions defined (this document)
- [x] Generator adapter contract defined
- [x] Model disposition table complete
- [x] PlanningStrategy layer designed

### Phase 1 — Stop the bleeding ✅
**Goal:** No new breakage. Normaliser gates all combo reads.
- [x] `utils/comboNormalizer.js` — canonical bridge for all existing combo shapes
- [x] `middleware/requireCollegeId.js` — hard-fail guard
- [x] `comboResolver.service.js` — rewritten to return canonical shape
- [x] `persistence.service.js` — uses normaliser; duplicate save field fixed
- [x] `TimetableResult.js` — post-find hooks removed; explicit `populateTimetableAssignments()` exported
- [x] `slot.service.js`, `manualValidator.service.js` — read canonical `type` field
- [x] `routes/api.js`, `timetableManual.js` — `requireCollegeId` guard added

**Files NOT touched in Phase 1:** routes, generator, frontend

---

### Phase 2 — Assignment layer (next)
**Goal:** `TeachingAllocation` is the sole source of truth for all assignment reads in active code paths.

#### 2a — Fix `/process-new-input` route

**File:** `routes/api/timetable.js`

Problem: Stores virtual combo IDs in `assignments_only`. When the hook tries to populate them, `assignments_only` is an `Object` not an `Array`, so nothing renders.

Fix:
```js
// Instead of storing virtual combo IDs:
//   assignments_only: { [classId]: ["C0", "C1", ...] }  ← broken

// Store TeachingAllocation IDs:
//   assignments_only: { [classId]: [assignmentId, ...] }  ← correct

// Populate by joining TeachingAllocation, not TeacherSubjectCombination
```

Specific changes:
1. Rewrite the `POST /process-new-input` handler to store `TeachingAllocation._id` values in `assignments_only`
2. Update `populateTimetableAssignments()` in `TimetableResult.js` to read from `TeachingAllocation`
3. Remove all reads from `TeacherSubjectCombination` in this flow

#### 2b — Replace `comboResolver.service.js` with `AssignmentResolver`

New file: `services/manual-timetable/assignmentResolver.service.js`

```js
// resolveAssignment(state, assignmentId) → AssignmentDTO
// resolveAssignments(state, assignmentIds) → AssignmentDTO[]
// getClassAssignmentsForEdit(collegeId, classId) → AssignmentDTO[]
//   └── reads from TeachingAllocation, NOT TeacherSubjectCombination
```

`comboResolver.service.js` becomes a thin shim that delegates to `AssignmentResolver` for backward compatibility during migration. Deleted in Phase 4.

#### 2c — Stop all writes to `TeacherSubjectCombination`

Audit every route that creates `TeacherSubjectCombination` records. Convert to `TeachingAllocation` write instead. This makes TSC read-only.

Files to audit: `routes/api/teacherSubject.js`, `routes/api/class.js`

#### 2d — DB-backed session state

Now safe because combo shapes are stable.

Changes to `state/timetableState.js`:
- Add `persistState(timetableId)` → writes to `TimetableResult` with `status: "session_buffer"`
- Add `loadState(timetableId)` → reads from `TimetableResult`; calls `buildDerivedState()`
- `ensureDurableState` middleware in `timetableManual.js` becomes the primary recovery path

---

### Phase 3 — Remove legacy models
**Goal:** `ClassSubject` and `TeacherSubjectCombination` collections are retired.

- [ ] `ClassSubject` — convert `GET` routes to derived views from `TeachingAllocation`; block `POST/PUT/DELETE`
- [ ] `TeacherSubjectCombination` — all reads migrated to `TeachingAllocation`; collection dropped
- [ ] `ElectiveSubjectSetting` — absorbed into `TeachingAllocation.type = ELECTIVE` + `electiveGroupId`; collection dropped
- [ ] `Class.assigned_teacher_subject_combos` field removed from schema
- [ ] `Class.faculties` field removed from schema (replaced by `TeachingAllocation.teacherIds`)

**DB migration script required:** For existing data, write a one-time script that:
1. Reads all `TeacherSubjectCombination` + `ClassSubject` pairs
2. Creates corresponding `TeachingAllocation` records if missing
3. Sets `source: "MAPPING_SYNC"` on migrated records

---

### Phase 4 — Generator boundary
**Goal:** `GeneratorCombo` is invisible to everything outside the generator adapter.

- [ ] Move `models/lib/convertNewCollegeInputToGeneratorData.js` → `services/generator/adapter/toGeneratorInput.js`
- [ ] Move `models/lib/runGenerator.js` → `services/generator/runner.js`
- [ ] Rewrite `prepareGeneratorData.js` as `GeneratorAdapter`:
  - Input: `TeachingAssignment[]` (reads from `TeachingAllocation`)
  - Output: `{ schedule: Schedule }` where schedule uses `assignmentId` strings
  - `GeneratorCombo._id` → `assignmentId` remapping happens inside the adapter
- [ ] `TimetableResult.combos` field: remove from new saves; existing docs treated as read-only legacy
- [ ] Delete `utils/comboNormalizer.js` (no longer needed; all callers use `AssignmentDTO`)
- [ ] Delete `services/manual-timetable/comboResolver.service.js`

---

### Phase 5 — Frontend and API contracts
**Goal:** Frontend never touches a combo-shaped object.

- [ ] API routes return `TimetableViewDTO` (schedule + assignment lookup table)
- [ ] `ManualTimetable.jsx` — slot placement sends `{ assignmentId, day, hour }` not `{ comboId, ... }`
- [ ] `Timetable.jsx` — split into:
  - `TimetablePage.jsx` — state management and data fetching only
  - `TimetableGrid.jsx` — renders the slot grid
  - `TimetableControls.jsx` — generation controls
  - `TimetableFilters.jsx` — already extracted ✅
  - `useGenerationTask.js` — polling and task management hook
  - `useTimetableSettings.js` — settings hydration hook
- [ ] All `faculty`/`facultyId` field names in frontend components replaced with `teacher`/`teacherId`

---

## Part 7 — Naming convention enforcement

### The banned list (never introduce in new code)

```
// Field names
faculty       → teacher
facultyId     → teacherId
faculty_id    → teacherId
faculty_ids   → teacherIds
class_id      → classId
class_ids     → classIds
subject_id    → subjectId
subject_type  → mode (or subjectMode)
subjectType   → mode
combo         → assignment (outside generator)
comboId       → assignmentId (outside generator)
type (subject)→ mode

// Object shapes
combo.subject?._id || combo.subjectId || combo.subject_id || combo.subject
                                          ↑ any version of this chain is banned

// DB reads
TeacherSubjectCombination.find(...)  → TeachingAllocation.find(...)
```

### The allowed list (canonical in new code)

```js
// Fields
teacherId, teacherIds
subjectId
classId, classIds
assignmentId
mode           // for subject delivery mode
hoursPerWeek
type           // for assignment type (THEORY, LAB, ELECTIVE, NO_TEACHER)

// Service calls
AssignmentResolver.resolveAssignment(state, assignmentId)
AssignmentResolver.getClassAssignments(collegeId, classId)
GeneratorAdapter.toGeneratorInput(assignments, config)
GeneratorAdapter.fromGeneratorOutput(output)
```

---

## Part 8 — Decision log

Decisions recorded here once made; never re-litigated.

| # | Decision | Rationale | Date |
|---|---|---|---|
| 1 | `TeachingAllocation` is the canonical assignment entity | Already exists in DB with correct shape; TSC is a capability record not an assignment | Phase 0 |
| 2 | `GeneratorCombo` is private to the generator adapter | Combo leaked to 8+ layers causing 5+ shape variants; confinement is the fix | Phase 0 |
| 3 | Slot grids store `assignmentId` strings only | Objects in slots cause population/shape problems; lookup table pattern is correct | Phase 0 |
| 4 | `PlanningStrategy` is a metadata tag, not a DB entity | Keeps the number of DB collections stable; all strategies converge to `TeachingAssignment` | Phase 0 |
| 5 | Post-find/findOne hooks removed from `TimetableResult` | Created dual-population paths producing different shapes for the same data | Phase 1 |
| 6 | `teacher_timetables` field set to `null` in new saves | Duplicate of `faculty_timetables`; one canonical field prevents stale reads | Phase 1 |
| 7 | `comboNormalizer.js` is a temporary migration bridge | Phase 4 deletes it; callers must migrate to `AssignmentDTO` before then | Phase 1 |
