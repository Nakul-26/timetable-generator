/**
 * @fileoverview Canonical Combo Normalizer
 *
 * THE SINGLE SOURCE OF TRUTH for combo object shape.
 *
 * The canonical shape is:
 * {
 *   _id:       string   – the combo identifier (may be non-ObjectId for virtual combos)
 *   subjectId: string   – Subject ObjectId reference
 *   facultyIds: string[] – Faculty ObjectId references (empty for no_teacher combos)
 *   classIds:  string[] – Class ObjectId references this combo belongs to
 *   type:      "THEORY" | "LAB" | "ELECTIVE" | "NO_TEACHER"
 *   // Display-only extras (optional, not used by business logic)
 *   subjectName?:  string
 *   facultyNames?: string[]
 *   combinedClassGroupId?: string | null
 * }
 *
 * BANNED fields everywhere else in the codebase:
 *   ✗ combo.subject          (ambiguous – could be an id OR populated object)
 *   ✗ combo.subject_id       (snake_case alias)
 *   ✗ combo.faculty          (ambiguous)
 *   ✗ combo.faculty_id       (snake_case alias)
 *   ✗ combo.faculty_ids      (snake_case alias)
 *   ✗ combo.class_ids        (snake_case alias)
 *   ✗ combo.classIds with no guard (use normalizeCombo first)
 *
 * Usage:
 *   import { normalizeCombo, normalizeCombos } from "../../utils/comboNormalizer.js";
 *   const canonical = normalizeCombo(rawComboFromDB);
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

function toStrArray(v) {
  if (Array.isArray(v)) return v.map(toStr).filter(Boolean);
  if (v != null) {
    const s = toStr(v);
    return s ? [s] : [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Derive canonical type from any raw shape
// ---------------------------------------------------------------------------
function deriveType(raw) {
  // Explicit type fields (generator, route bodies, etc.)
  const explicit = toStr(
    raw.type ||
    raw.subjectType ||
    raw.subject_type ||
    raw.subject?.type ||
    ""
  ).toUpperCase();

  if (explicit === "LAB" || explicit === "ELECTIVE" || explicit === "NO_TEACHER" || explicit === "THEORY") {
    return explicit;
  }

  // Heuristic fallbacks
  if (explicit === "NO-TEACHER" || explicit === "NOTEACHER") return "NO_TEACHER";
  if (explicit === "LAB") return "LAB";
  if (explicit === "ELECTIVE") return "ELECTIVE";

  // Infer from faculty presence
  const hasFaculty = (() => {
    if (Array.isArray(raw.faculty_ids) && raw.faculty_ids.length > 0) return true;
    if (Array.isArray(raw.facultyIds) && raw.facultyIds.length > 0) return true;
    if (raw.faculty_id) return true;
    if (raw.faculty?._id || (raw.faculty && typeof raw.faculty === "string")) return true;
    return false;
  })();

  return hasFaculty ? "THEORY" : "NO_TEACHER";
}

// ---------------------------------------------------------------------------
// Extract subjectId from any raw shape
// ---------------------------------------------------------------------------
function extractSubjectId(raw) {
  return toStr(
    raw.subjectId ||
    raw.subject_id ||
    raw.subject?._id ||
    (typeof raw.subject === "string" ? raw.subject : "") ||
    ""
  );
}

// ---------------------------------------------------------------------------
// Extract facultyIds from any raw shape
// ---------------------------------------------------------------------------
function extractFacultyIds(raw) {
  if (Array.isArray(raw.faculty_ids) && raw.faculty_ids.length > 0) {
    return raw.faculty_ids.map(toStr).filter(Boolean);
  }
  if (Array.isArray(raw.facultyIds) && raw.facultyIds.length > 0) {
    return raw.facultyIds.map(toStr).filter(Boolean);
  }
  if (raw.faculty_id) return [toStr(raw.faculty_id)].filter(Boolean);
  if (raw.faculty?._id) return [toStr(raw.faculty._id)].filter(Boolean);
  if (raw.faculty && typeof raw.faculty === "string") return [raw.faculty];
  return [];
}

// ---------------------------------------------------------------------------
// Extract classIds from any raw shape
// ---------------------------------------------------------------------------
function extractClassIds(raw) {
  if (Array.isArray(raw.class_ids) && raw.class_ids.length > 0) {
    return raw.class_ids.map(toStr).filter(Boolean);
  }
  if (Array.isArray(raw.classIds) && raw.classIds.length > 0) {
    return raw.classIds.map(toStr).filter(Boolean);
  }
  if (raw.class_id) return [toStr(raw.class_id)].filter(Boolean);
  if (raw.class?._id) return [toStr(raw.class._id)].filter(Boolean);
  if (raw.class && typeof raw.class === "string") return [raw.class];
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize any raw combo representation into the canonical shape.
 *
 * Returns null for falsy or id-less input.
 *
 * @param {any} raw
 * @returns {{ _id: string, subjectId: string, facultyIds: string[], classIds: string[], type: string } | null}
 */
export function normalizeCombo(raw) {
  if (!raw) return null;

  const _id = toStr(raw._id || raw.id || raw.comboId || raw.combo_id || "");
  if (!_id) return null;

  const subjectId = extractSubjectId(raw);
  const facultyIds = extractFacultyIds(raw);
  const classIds = extractClassIds(raw);
  const type = deriveType(raw);

  const result = { _id, subjectId, facultyIds, classIds, type };

  // Preserve optional display metadata if present – never used by business logic
  if (raw.subjectName || raw.subject?.name) {
    result.subjectName = raw.subjectName || raw.subject?.name || null;
  }
  if (raw.facultyNames || raw.faculty?.name) {
    result.facultyNames = raw.facultyNames ||
      (raw.faculty?.name ? [raw.faculty.name] : []);
  }
  if (raw.combinedClassGroupId || raw.combined_class_group_id) {
    result.combinedClassGroupId = raw.combinedClassGroupId || raw.combined_class_group_id || null;
  }

  return result;
}

/**
 * Normalize an array of raw combos. Filters out null results.
 *
 * @param {any[]} raws
 * @returns {ReturnType<typeof normalizeCombo>[]}
 */
export function normalizeCombos(raws) {
  if (!Array.isArray(raws)) return [];
  return raws.map(normalizeCombo).filter(Boolean);
}

/**
 * Build a Map of canonical combos keyed by _id string.
 * Useful for fast lookup inside services.
 *
 * @param {any[]} raws
 * @returns {Map<string, ReturnType<typeof normalizeCombo>>}
 */
export function buildComboMap(raws) {
  const map = new Map();
  for (const raw of Array.isArray(raws) ? raws : []) {
    const c = normalizeCombo(raw);
    if (c) map.set(c._id, c);
  }
  return map;
}
