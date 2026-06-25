/**
 * comboResolver.service.js
 *
 * All combo lookups go through here and always return the CANONICAL shape
 * produced by normalizeCombo(). Nothing downstream should ever access
 * raw combo fields directly.
 */
import mongoose from "mongoose";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import Subject from "../../models/Subject.js";
import Faculty from "../../models/Faculty.js";
import { normalizeCombo, normalizeCombos, buildComboMap } from "../../utils/comboNormalizer.js";

// ---------------------------------------------------------------------------
// Single-combo resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a combo by id from in-memory state, falling back to the DB.
 * Always returns a canonical combo or null.
 *
 * @param {object} state – timetable state object (must have .combos array and .collegeId)
 * @param {string} comboId
 * @returns {Promise<import("../../utils/comboNormalizer.js").normalizeCombo | null>}
 */
export async function resolveComboFromState(state, comboId) {
  const comboIdStr = String(comboId || "").trim();
  if (!comboIdStr) return null;

  // 1. Look in in-memory combos first
  if (Array.isArray(state?.combos)) {
    const stored = state.combos.find((c) => String(c?._id) === comboIdStr);
    if (stored) return normalizeCombo(stored);
  }

  // 2. If the id is not a valid ObjectId it can only exist in memory → not found
  if (!mongoose.Types.ObjectId.isValid(comboIdStr)) return null;

  // 3. Fall back to DB
  const raw = await TeacherSubjectCombination.findOne({
    _id: comboIdStr,
    collegeId: state?.collegeId,
  })
    .populate("subject", "name type")
    .populate("faculty", "name")
    .lean();

  return raw ? normalizeCombo(raw) : null;
}

// ---------------------------------------------------------------------------
// Batch resolution
// ---------------------------------------------------------------------------

/**
 * Resolve multiple combo ids. Order is preserved; unresolvable ids are omitted.
 *
 * @param {object} state
 * @param {string[]} comboIds
 * @returns {Promise<ReturnType<typeof normalizeCombo>[]>}
 */
export async function resolveCombosFromState(state, comboIds = []) {
  const results = [];
  for (const comboId of comboIds) {
    const combo = await resolveComboFromState(state, comboId);
    if (combo) results.push(combo);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Class-specific combo list (for the edit panel / valid-options dropdown)
// ---------------------------------------------------------------------------

/**
 * Return all combos that apply to a given class, normalized.
 * Enriches display names from DB if needed.
 *
 * @param {object} state
 * @param {object} classObj – Class document with _id
 * @returns {Promise<ReturnType<typeof normalizeCombo>[]>}
 */
export async function getClassCombosForEdit(state, classObj) {
  const classId = String(classObj?._id || "");

  // ── Path A: pull from in-memory state.combos ──────────────────────────────
  if (Array.isArray(state?.combos) && state.combos.length > 0) {
    const matching = state.combos.filter((raw) => {
      if (!raw) return false;
      // Check every known classIds field name
      const ids = Array.isArray(raw.class_ids)
        ? raw.class_ids.map(String)
        : Array.isArray(raw.classIds)
          ? raw.classIds.map(String)
          : raw.class_id
            ? [String(raw.class_id)]
            : raw.class?._id
              ? [String(raw.class._id)]
              : raw.class
                ? [String(raw.class)]
                : [];
      return ids.includes(classId);
    });

    if (matching.length > 0) {
      // Enrich display names from DB in one batch
      const normalized = normalizeCombos(matching);

      const subjectIds = [...new Set(normalized.map((c) => c.subjectId).filter(Boolean))];
      const facultyIds = [...new Set(normalized.flatMap((c) => c.facultyIds))];

      const [subjects, faculties] = await Promise.all([
        subjectIds.length > 0
          ? Subject.find({ _id: { $in: subjectIds }, collegeId: state?.collegeId })
              .select("name type")
              .lean()
          : [],
        facultyIds.length > 0
          ? Faculty.find({ _id: { $in: facultyIds }, collegeId: state?.collegeId })
              .select("name")
              .lean()
          : [],
      ]);

      const subjectMap = new Map(subjects.map((s) => [String(s._id), s]));
      const facultyMap = new Map(faculties.map((f) => [String(f._id), f.name]));

      // Attach display-only fields; canonical shape is preserved
      return normalized.map((c) => {
        const subjectDoc = subjectMap.get(c.subjectId);
        return {
          ...c,
          subjectName: c.subjectName || subjectDoc?.name || `Subject ${c.subjectId.slice(-4)}`,
          subjectType: subjectDoc?.type || c.type,
          facultyNames: c.facultyIds.map(
            (fid) => facultyMap.get(fid) || `Faculty ${fid.slice(-4)}`
          ),
          // Legacy fields kept for the route response mapper – do NOT use in logic
          subject: {
            _id: c.subjectId,
            name: c.subjectName || subjectDoc?.name || "Unknown Subject",
            type: subjectDoc?.type || c.type,
          },
          faculty: {
            _id: c.facultyIds[0] || "",
            name:
              c.facultyIds
                .map((fid) => facultyMap.get(fid) || `Faculty ${fid.slice(-4)}`)
                .join(", ") || (c.type === "NO_TEACHER" ? "No Teacher" : "Unknown Teacher"),
          },
        };
      });
    }
  }

  // ── Path B: fall back to DB ────────────────────────────────────────────────
  const comboIds = Array.isArray(classObj?.assigned_teacher_subject_combos)
    ? classObj.assigned_teacher_subject_combos.map(String).filter((id) => mongoose.Types.ObjectId.isValid(id))
    : [];

  if (comboIds.length === 0) return [];

  const raws = await TeacherSubjectCombination.find({
    _id: { $in: comboIds },
    collegeId: state?.collegeId,
  })
    .populate("faculty", "name")
    .populate("subject", "name type")
    .lean();

  return normalizeCombos(raws).map((c) => {
    const raw = raws.find((r) => String(r._id) === c._id);
    return {
      ...c,
      subjectName: raw?.subject?.name || "Unknown Subject",
      subjectType: raw?.subject?.type || c.type,
      facultyNames: raw?.faculty ? [raw.faculty.name] : [],
      // Legacy display fields
      subject: { _id: c.subjectId, name: raw?.subject?.name || "Unknown Subject", type: raw?.subject?.type || c.type },
      faculty: { _id: c.facultyIds[0] || "", name: raw?.faculty?.name || (c.type === "NO_TEACHER" ? "No Teacher" : "Unknown Teacher") },
    };
  });
}
