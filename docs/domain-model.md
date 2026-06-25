# Domain Model

> **Status: Authoritative.**  
> Every API, database model, service, and frontend component must be expressible in terms of the entities defined here.  
> Anything that cannot be expressed in these terms is either a **derived view** or an **internal implementation detail** and must be treated as such.

---

## Guiding principle

This is no longer a "timetable generator". It is a **timetable management platform**.

A generator can have messy internal models because it is a one-shot tool.  
A platform cannot. It has to support:

- Manual creation and editing  
- Auto-generation  
- Conflict detection  
- Import / export  
- Reporting  
- Multi-college tenancy  
- Eventual mobile / API integrations  

That requires **stable, well-bounded domain entities** that never change shape as they cross layer boundaries.

---

## Core domain entities

These are the **only** first-class citizens of the domain. Everything else is a view, a projection, or an adapter.

```
┌──────────┐     ┌─────────┐     ┌───────┐
│  Teacher │     │ Subject │     │ Class │
└──────────┘     └─────────┘     └───────┘
      │                │               │
      └────────────────┼───────────────┘
                       │
              ┌────────────────────┐
              │ TeachingAssignment │  ← the central concept
              └────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │   Timetable    │
              └────────────────┘
                       │
              ┌────────────────┐
              │  TimetableSlot │  ← a placed assignment at a specific (day, hour)
              └────────────────┘
```

---

### Entity definitions

#### Teacher
> A person who teaches at the college.

```
Teacher {
  id:               string       // internal stable id (MongoId string)
  collegeId:        string       // tenant scope
  name:             string
  unavailableSlots: Slot[]       // absolute blocked periods
  preferences:      TeacherPreferences
}

TeacherPreferences {
  avoidFirstPeriod:  boolean
  avoidLastPeriod:   boolean
  maxConsecutive:    number | null
  preferredDays:     number[]
}
```

**Database:** `Faculty` collection *(name is legacy; the domain name is Teacher)*

---

#### Subject
> A course or module that is taught.

```
Subject {
  id:        string
  collegeId: string
  name:      string
  semester:  number
  mode:      "THEORY" | "LAB" | "NO_TEACHER"
  isElective: boolean
  defaultHoursPerWeek: number | null   // college-wide default; can be overridden per class
}
```

**Database:** `Subject` collection  
**Note:** `type` in the DB is `"theory" | "lab" | "no_teacher"` (lowercase). The domain model uses uppercase `mode`. All code reading `subject.type` must normalise to uppercase at the boundary.

---

#### Class
> A group of students that shares a timetable.

```
Class {
  id:        string
  collegeId: string
  name:      string
  section:   string
  semester:  number
  daysPerWeek: number        // can override global constraint
}
```

**Database:** `Class` collection  
**Note:** `Class.assigned_teacher_subject_combos` and `Class.faculties` are **legacy linkage fields** that will be removed once `TeachingAssignment` is the sole relationship. Do not use them in new code.

---

#### TeachingAssignment
> The authoritative record that says: *"Teacher T will teach Subject S to Class C for H hours per week."*

This is the **central entity** of the platform. It replaces all of:
- `TeacherSubjectCombination` (old capability record)
- `ClassSubject` (hours record)
- `Combo` (generator implementation detail)

```
TeachingAssignment {
  id:          string
  collegeId:   string

  // Who teaches what
  teacherIds:  string[]     // one or more teachers (lab co-teaching, multi-teacher)
                            // empty only for NO_TEACHER subjects
  subjectId:   string

  // Where it is taught
  //
  // NOTE: co-teaching (multiple teachers, same class) is expressed as teacherIds[].
  // Combined teaching (one teacher, multiple classes) is expressed as classGroupId.
  // These are DIFFERENT concepts and must NOT both be collapsed into simple arrays.
  //
  classGroupId: string | null  // references CombinedClassGroup.id
                               // null when this is a single-class assignment
  classIds:    string[]        // DERIVED from CombinedClassGroup; cached here for query performance
                               // When classGroupId is null, classIds = [the single classId]

  // Scheduling parameters
  hoursPerWeek:    number
  mode:            "THEORY" | "LAB" | "ELECTIVE" | "NO_TEACHER"
  isElective:      boolean
  electiveGroupId: string | null    // references the elective option group

  // Provenance
  source: "DIRECT" | "MAPPING_SYNC"   // how it was created (PlanningStrategy)
}
```

**Database:** `TeachingAllocation` collection *(name is legacy; the domain name is TeachingAssignment)*

**Migration note:** `TeacherSubjectCombination` documents will be deprecated and eventually deleted.  
New code must read from `TeachingAllocation` and never create new `TeacherSubjectCombination` records.

---

#### CombinedClassGroup
> A named group of classes that are taught together for a specific purpose.

```
CombinedClassGroup {
  id:        string
  collegeId: string
  name:      string | null     // optional human label ("CSE A+B Combined")
  classIds:  string[]          // the classes that are merged

  // Future metadata (not implemented yet — but the entity exists to hold it)
  // mergedOnDays:   number[] | null      // only merged on these weekdays
  // roomCapacity:   number | null        // combined room capacity
  // syncRules:      string[]             // "attendance", "same-teacher", etc.
}
```

**Why a separate entity instead of `classIds[]` on `TeachingAssignment`?**

Co-teaching (`teacherIds[]`) and combined teaching (`classGroupId`) are semantically different:
- Co-teaching: multiple teachers share responsibility for ONE class  
- Combined teaching: one assignment spans MULTIPLE classes simultaneously

Collapsing both into arrays on `TeachingAssignment` means you can't later add group-level metadata (room capacity, merge rules, attendance policy) without a schema migration. `CombinedClassGroup` is the right place for that metadata.

Elective groups follow the same pattern (`electiveGroupId` → `ElectiveGroup` entity), so this is consistent.

**Database:** `combinedclassgroups` collection (to be created in Phase 3)  
**Phase 1–2 compatibility:** Until the collection exists, `TeachingAllocation.combinedClassGroupId` string is used as the group identifier and `TeachingAllocation.classIds[]` is the source of truth.

---

#### Timetable
> A completed schedule: a set of TimetableSlots covering all classes for a given week.

```
Timetable {
  id:          string
  collegeId:   string
  name:        string
  status:      "draft" | "generated" | "edited" | "approved" | "locked"
  source:      "generator" | "manual"

  schedule:    Schedule          // the actual slot grid
  config:      TimetableConfig
  metadata:    TimetableMetadata
}

TimetableConfig {
  daysPerWeek: number
  hoursPerDay: number
  breakHours:  number[]
}

TimetableMetadata {
  createdAt:       Date
  editVersion:     number
  generatedFromId: string | null   // source GenerationJob id
  parentId:        string | null   // previous version this was derived from
}
```

**Database:** `TimetableResult` collection *(the schema stores the schedule inside `class_timetables`, which maps classId → day → hour → slot)*

---

#### TimetableSlot
> A single placed lesson: TeachingAssignment at a specific (class, day, hour).

```
TimetableSlot {
  assignmentId: string       // references TeachingAssignment.id
  classId:      string       // which class's grid this appears in
  day:          number       // 0-indexed
  hour:         number       // 0-indexed
  source:       "generated" | "manual"
  isLocked:     boolean
}
```

**Storage:** Inside `TimetableResult.class_timetables` as `classId → day[] → hour[] → assignmentId[]`  
**Note:** The array holds `assignmentId` strings, not combo objects. Objects must not be stored inline in the slot grid.

---

#### Constraint
> A scheduling rule that the generator and manual editor both enforce.

```
Constraint {
  schedule: {
    daysPerWeek: number
    hoursPerDay: number
    breakHours:  number[]
  }
  structural: {
    labBlockSize: number     // consecutive hours required for a lab
  }
  teacher: {
    maxConsecutive:   number
    maxDailyLoad:     number
  }
  class: {
    maxConsecutive:   number
    maxSubjectPerDay: number
  }
  compactness: {
    enabled: boolean
  }
}
```

**Database:** `TimetableUserSettings` collection (stored per college under `constraintConfig`)

---

## Anti-corruption layer

During migration, some routes still read from legacy collections (`ClassSubject`, `TeacherSubjectCombination`). Without a defined translation boundary, legacy data structures will seep back into domain services — exactly the problem being fixed.

The solution is two explicit translation boundaries and nothing else:

```
Legacy DB
    │
    ▼
 LegacyMapper         ← ONE translation boundary
    │
    ▼
TeachingAssignment    ← domain layer; everything else here is pure domain
    │
    ▼
GeneratorAdapter      ← ONE translation boundary
    │
    ▼
  Solver
```

### LegacyMapper contract

```js
// File: backend/services/legacy/legacyMapper.js

// Converts a TeacherSubjectCombination + ClassSubject pair to TeachingAssignment
legacyMapper.fromTSCAndCS(tscDoc, csDoc) → TeachingAssignment

// Converts a raw TeachingAllocation document to domain TeachingAssignment
legacyMapper.fromTeachingAllocation(allocationDoc) → TeachingAssignment

// Converts ElectiveSubjectSetting to an elective TeachingAssignment
legacyMapper.fromElectiveSetting(settingDoc, classDoc) → TeachingAssignment
```

**Rules:**
- `LegacyMapper` is the ONLY file allowed to import `TeacherSubjectCombination`, `ClassSubject`, or `ElectiveSubjectSetting` models in new code
- Routes and services import `LegacyMapper`, not the legacy models directly
- `LegacyMapper` methods are deleted one-by-one as the source collection is dropped


| Existing concept | Domain mapping |
|---|---|
| `TeacherSubjectCombination` | Capability record — **deprecated**. Replace with `TeachingAssignment` |
| `ClassSubject` | Derived view of `TeachingAssignment.hoursPerWeek` — read-only helper |
| `TeachingAllocation` | **= TeachingAssignment** (same thing, rename in progress) |
| `Combo` (generator) | **Internal generator artifact** — must NOT escape the generator boundary |
| `SavedCombo` (in TimetableResult) | Snapshot cache for display — replace with `assignmentId` references |
| `GenerationJob` | Async task — no domain meaning; purely operational |

---

## The Combo problem — solved by this model

The reason `Combo` leaked everywhere is that it was used as both:
1. The generator's internal representation
2. The timetable's slot identity
3. The manual editor's display object
4. The persistence layer's storage format

Under this model, **Combo exists only inside the generator pipeline**:

```
TeachingAssignments (domain)
        │
        ▼
  GeneratorAdapter.toGeneratorInput()
        │
        ▼
  GeneratorCombo[]   ← internal to generator; never exposed via API
        │
        ▼
       Solver
        │
        ▼
  GeneratorOutput (slot grid: classId → day → hour → assignmentId[])
        │
        ▼
  TimetableResult.class_timetables   ← stores assignmentId strings only
```

The frontend and manual editor never see a `Combo`. They see a `TeachingAssignment`. The generator adapter is the only code that knows how to convert between the two.

---

## Layer boundaries and DTOs

### Frontend ↔ Backend API
The API speaks **domain DTOs**. Never raw DB documents.

```
TeacherDTO      { id, name, unavailableSlots, preferences }
SubjectDTO      { id, name, semester, mode, isElective, defaultHoursPerWeek }
ClassDTO        { id, name, section, semester }
AssignmentDTO   { id, teacherIds, subjectId, classIds, hoursPerWeek, mode, isElective, electiveGroupId }
TimetableDTO    { id, name, status, schedule, config }
SlotDTO         { assignmentId, day, hour, source, isLocked }
```

### Backend service ↔ Generator adapter
The generator adapter converts `AssignmentDTO[]` → `GeneratorInput`. The solver returns `GeneratorOutput`. The adapter converts that back to a `schedule` (slot grid of `assignmentId` strings). **No `Combo` objects cross this boundary.**

### Backend ↔ Database
DB documents are always read through a mapper function that produces the domain entity. Raw Mongoose documents must not be passed to services or routes.

---

## Naming conventions (mandatory)

| Concept | Canonical name | Banned aliases |
|---|---|---|
| Teacher | `teacher` / `teacherId` | `faculty`, `facultyId` *(in new code)* |
| Subject | `subject` / `subjectId` | — |
| Class | `class` / `classId` | — |
| Teaching assignment | `assignment` / `assignmentId` | `combo`, `comboId` *(outside generator)* |
| Teacher array | `teacherIds` | `faculty_ids`, `facultyIds`, `faculty_id` *(in new code)* |
| Class array | `classIds` | `class_ids`, `class_id` *(in new code)* |
| Subject mode | `mode` (uppercase enum) | `type`, `subjectType`, `subject_type` |
| Hours per week | `hoursPerWeek` | `no_of_hours_per_week`, `hours`, `classesPerWeek` |

> **Rule:** Legacy names are allowed to exist in DB schemas and old routes during migration. They must never be introduced in new code, and existing code must be migrated file-by-file as each is touched.

---

## Migration roadmap

This document defines the **target state**. Migration is incremental:

### Phase 1 — Stop the bleeding (done)
- [x] Canonical combo normalizer (`utils/comboNormalizer.js`)
- [x] `collegeId` guard middleware (`middleware/requireCollegeId.js`)
- [x] Remove dual-population hooks (`TimetableResult.js`)
- [x] All services read canonical shape from `comboNormalizer`

### Phase 2 — Stabilise the assignment layer
- [ ] Fix `/process-new-input` to store `assignmentId` references, not virtual combo objects
- [ ] Make `TeachingAllocation` the authoritative source for all assignment queries
- [ ] Deprecate direct reads from `TeacherSubjectCombination` in routes (use `TeachingAllocation` instead)
- [ ] Session state DB-backed recovery (only after combo shape is stable)

### Phase 3 — Rename and consolidate
- [ ] Rename `Faculty` → `Teacher` in domain layer (DB collection stays `faculties` for now)
- [ ] Remove `Class.assigned_teacher_subject_combos` linkage field
- [ ] Remove `TeacherSubjectCombination` entirely; replace all reads with `TeachingAllocation` queries
- [ ] `TimetableSlot` stores only `assignmentId` strings; remove inline combo snapshots from `class_timetables`

### Phase 4 — Generator boundary
- [ ] Generator adapter: converts `TeachingAssignment[]` → `GeneratorCombo[]` (internal only)
- [ ] Solver output is `{ classId → day → hour → assignmentId[] }` only
- [ ] All `Combo`-shaped objects in `TimetableResult.combos` are eliminated

### Phase 5 — API contracts and frontend
- [ ] Frontend components accept `AssignmentDTO`, not any combo-like object
- [ ] `ManualTimetable` editor works with `assignmentId` references; populates display from a lookup table
- [ ] Export and reporting APIs work from domain entities only

---

## Appendix: current DB collections and their domain role

| Collection | Domain entity | Status |
|---|---|---|
| `faculties` | Teacher | Active; `id` field is legacy — use `_id` in new code |
| `subjects` | Subject | Active; `type` field maps to `mode` |
| `classes` | Class | Active; `assigned_teacher_subject_combos` is legacy |
| `teachingallocations` | **TeachingAssignment** | Active — this is the primary assignment store |
| `classsubjects` | Derived view of TeachingAssignment | Read-only legacy; eventually remove |
| `teachersubjectcombinations` | Deprecated capability record | Migrate all reads to TeachingAllocation |
| `timetableresults` | Timetable | Active; `class_timetables` maps to slot grid |
| `generationjobs` | Operational task (no domain entity) | Active |
| `timetableuserssettings` | Constraint | Active |
| `colleges` | Tenant (multi-tenancy infrastructure) | Active |
| `admins` | User (auth infrastructure) | Active |
