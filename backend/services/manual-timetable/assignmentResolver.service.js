/**
 * assignmentResolver.service.js
 *
 * Canonical replacement for comboResolver.service.js.
 *
 * All methods return TeachingAssignment domain objects (via LegacyMapper).
 * Nothing here returns a "combo" — that concept does not exist at this layer.
 *
 * See: ARCHITECTURE.md
 */

import mongoose from "mongoose";
import Subject from "../../models/Subject.js";
import Faculty from "../../models/Faculty.js";
import {
  loadAssignment,
  loadAssignmentsForClasses,
  fromTeachingAllocation,
} from "../legacy/legacyAdapter.js";
import TeachingAllocation from "../../models/TeachingAllocation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStr(v) {
  return v == null ? "" : String(v).trim();
}

/**
 * Enrich a bare TeachingAssignment with display-only name fields.
 * The canonical shape is preserved; names are added as extra fields.
 *
 * @param {object} assignment - canonical TeachingAssignment
 * @param {Map<string, object>} subjectMap - subjectId → Subject doc
 * @param {Map<string, string>}  teacherMap - teacherId → name string
 * @returns {object} - assignment with subjectName, teacherNames added
 */
function enrich(assignment, subjectMap, teacherMap) {
  if (!assignment) return null;
  const subjectDoc = subjectMap.get(assignment.subjectId);
  return {
    ...assignment,
    subjectName: subjectDoc?.name || `Subject ${assignment.subjectId.slice(-4)}`,
    subjectMode: subjectDoc?.type
      ? String(subjectDoc.type).toUpperCase()
      : assignment.mode,
    teacherNames: assignment.teacherIds.map(
      (tid) => teacherMap.get(tid) || `Teacher ${tid.slice(-4)}`
    ),
  };
}

/**
 * Fetch subject and teacher display names for a batch of assignments.
 *
 * @param {object[]} assignments
 * @param {string} collegeId
 */
async function fetchDisplayData(assignments, collegeId) {
  const subjectIds = [...new Set(assignments.map((a) => a.subjectId).filter(Boolean))];
  const teacherIds = [...new Set(assignments.flatMap((a) => a.teacherIds))];

  const [subjects, teachers] = await Promise.all([
    subjectIds.length
      ? Subject.find({ _id: { $in: subjectIds }, collegeId }).select("name type").lean()
      : [],
    teacherIds.length
      ? Faculty.find({ _id: { $in: teacherIds }, collegeId }).select("name").lean()
      : [],
  ]);

  const subjectMap = new Map(subjects.map((s) => [toStr(s._id), s]));
  const teacherMap = new Map(teachers.map((t) => [toStr(t._id), t.name]));
  return { subjectMap, teacherMap };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a single assignment by id.
 * Checks in-memory state first, then falls back to DB.
 *
 * @param {object} state - timetable session state (must have .collegeId)
 * @param {string} assignmentId
 * @param {object} [options]
 * @param {boolean} [options.enrich=true] - attach display names
 * @returns {Promise<object | null>}
 */
export async function resolveAssignment(state, assignmentId, { withNames = true } = {}) {
  const idStr = toStr(assignmentId);
  if (!idStr) return null;

  const collegeId = state?.collegeId;

  // 1. Check in-memory combos cache (state.combos holds raw allocation-like objects)
  if (Array.isArray(state?.combos)) {
    const stored = state.combos.find((c) => toStr(c?._id) === idStr);
    if (stored) {
      const assignment = fromTeachingAllocation(stored);
      if (!assignment) return null;
      if (!withNames) return assignment;

      const { subjectMap, teacherMap } = await fetchDisplayData([assignment], collegeId);
      return enrich(assignment, subjectMap, teacherMap);
    }
  }

  // 2. Only valid ObjectIds can exist in DB
  if (!mongoose.Types.ObjectId.isValid(idStr)) return null;

  // 3. DB lookup via LegacyMapper (reads TeachingAllocation)
  const assignment = await loadAssignment(collegeId, idStr);
  if (!assignment) return null;
  if (!withNames) return assignment;

  const { subjectMap, teacherMap } = await fetchDisplayData([assignment], collegeId);
  return enrich(assignment, subjectMap, teacherMap);
}

/**
 * Resolve multiple assignments by id. Order preserved; missing ids omitted.
 *
 * @param {object} state
 * @param {string[]} assignmentIds
 * @param {object} [options]
 * @param {boolean} [options.withNames=true]
 * @returns {Promise<object[]>}
 */
export async function resolveAssignments(state, assignmentIds = [], { withNames = true } = {}) {
  if (!assignmentIds.length) return [];

  const results = [];
  for (const id of assignmentIds) {
    const a = await resolveAssignment(state, id, { withNames });
    if (a) results.push(a);
  }
  return results;
}

/**
 * Get all assignments that apply to a given class, enriched with display names.
 * Reads from TeachingAllocation — the canonical source.
 *
 * Replaces getClassCombosForEdit() from comboResolver.service.js.
 *
 * @param {string} collegeId
 * @param {string} classId
 * @param {object} [stateComboHints] - optional in-memory combos array for fast-path
 * @returns {Promise<object[]>}
 */
export async function getClassAssignmentsForEdit(collegeId, classId, stateComboHints = null) {
  let assignments;

  // Fast path: if state has an in-memory combos array, filter from it
  if (Array.isArray(stateComboHints) && stateComboHints.length > 0) {
    const classIdStr = toStr(classId);
    const matching = stateComboHints.filter((raw) => {
      const ids = Array.isArray(raw?.classIds)
        ? raw.classIds.map(toStr)
        : Array.isArray(raw?.class_ids)
          ? raw.class_ids.map(toStr)
          : raw?.class_id
            ? [toStr(raw.class_id)]
            : [];
      return ids.includes(classIdStr);
    });

    if (matching.length > 0) {
      assignments = matching.map(fromTeachingAllocation).filter(Boolean);
      const { subjectMap, teacherMap } = await fetchDisplayData(assignments, collegeId);
      return assignments.map((a) => enrich(a, subjectMap, teacherMap));
    }
  }

  // DB path: read from TeachingAllocation
  assignments = await loadAssignmentsForClasses(collegeId, [toStr(classId)]);
  if (!assignments.length) return [];

  const { subjectMap, teacherMap } = await fetchDisplayData(assignments, collegeId);
  return assignments.map((a) => enrich(a, subjectMap, teacherMap));
}

/**
 * Build a lookup Map of assignmentId → enriched assignment.
 * Useful for building the TimetableViewDTO lookup table.
 *
 * @param {string} collegeId
 * @param {string[]} assignmentIds
 * @returns {Promise<Map<string, object>>}
 */
export async function buildAssignmentLookup(collegeId, assignmentIds = []) {
  const validIds = [...new Set(assignmentIds.filter(Boolean).filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  ))];

  if (!validIds.length) return new Map();

  const docs = await TeachingAllocation.find({
    _id: { $in: validIds },
    collegeId,
  }).lean();

  const assignments = docs.map(fromTeachingAllocation).filter(Boolean);
  const { subjectMap, teacherMap } = await fetchDisplayData(assignments, collegeId);

  const map = new Map();
  for (const a of assignments) {
    map.set(a.id, enrich(a, subjectMap, teacherMap));
  }
  return map;
}
