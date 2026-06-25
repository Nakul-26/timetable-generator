import { Router } from "express";
const router = Router();
import auth from "../middleware/auth.js";
import requireCollegeContext from "../middleware/collegeScope.js";
import requireCollegeId from "../middleware/requireCollegeId.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import ClassModel from "../models/Class.js";
import Faculty from "../models/Faculty.js";
import Subject from "../models/Subject.js";

import {
  clearSlot,
  withTempClearedState,
  placeCombo,
} from "../services/manual-timetable/slot.service.js";

import {
  loadSavedTimetable,
  saveTimetable,
  getProcessedAssignments,
} from "../services/manual-timetable/persistence.service.js";
import {
  resolveCombosFromState,
  getClassCombosForEdit,
  resolveComboFromState,
} from "../services/manual-timetable/comboResolver.service.js";

import { runAutoFill } from "../services/manual-timetable/autofill.service.js";
import { validateAndSimulateMove } from "../services/manual-timetable/manualValidator.service.js";
import TimetableResult from "../models/TimetableResult.js";
import { normalizeCombo } from "../utils/comboNormalizer.js";

import {
  computeAvailableCombos,
  checkTeacherConstraints,
  getTeacherPreferenceWarnings,
} from "../utils/timetableManualUtils.js";

import {
  initializeState,
  loadState,
  getState,
  setState,
  lockSlot,
  unlockSlot,
  assertState,
  deleteState,
} from "../state/timetableState.js";

router.use(auth);
router.use(requireCollegeContext);
router.use(requireCollegeId);   // Hard-fail if collegeId is still undefined
router.use(authLimiter);

async function ensureDurableState(req, res, next) {
  try {
    const timetableId = getStableTimetableId(req);
    if (!timetableId) return next();

    // 1. Check if already in memory
    if (getState(timetableId)) return next();

    // 2. If it's a session ID, try to recover from DB
    if (String(timetableId).startsWith("session-")) {
      const parts = String(timetableId).split("-");
      if (parts.length >= 4) {
        const collegeId = parts[1];
        const userId = parts[2];
        const sourceId = parts.slice(3).join("-");

        const buffer = await TimetableResult.findOne({
          collegeId,
          created_by: userId,
          generated_from_id: sourceId === "new" ? null : sourceId,
          status: "session_buffer",
        }).lean();

        if (buffer) {
          const recovered = await loadSavedTimetable({
            timetableId,
            savedTimetableId: buffer._id,
            collegeId,
          });
          loadState(timetableId, recovered);
          return next();
        }
      }
    }
    next();
  } catch (e) {
    console.error("[ensureDurableState] Error:", e);
    next();
  }
}

function getStableTimetableId(req) {
  const userId = req.user?._id || req.userId;
  const sourceTimetableId = req.body.sourceTimetableId || req.query.sourceTimetableId || null;
  return `session-${req.collegeId}-${userId}-${sourceTimetableId || "new"}`;
}

router.use(ensureDurableState);

async function persistSessionBuffer(timetableId, collegeId, userId) {
  try {
    const state = getState(timetableId);
    if (!state) return;

    const name = state.name || "Session Buffer";
    // We use a specific status to mark this as an auto-saved buffer
    await saveTimetable({
      name,
      state,
      collegeId,
      userId,
      isBuffer: true,
    });
  } catch (e) {
    console.error("[persistSessionBuffer] Error:", e);
  }
}

function buildSessionMeta(existingState = {}, overrides = {}) {
  const sourceId = overrides.sourceTimetableId || existingState.sourceTimetableId || null;
  return {
    slotSources: existingState.slotSources || {},
    lockedSlots: existingState.lockedSlots || {},
    sourceTimetableId: sourceId,
    generatedFromId: sourceId,
    parentTimetableId: existingState.parentTimetableId || null,
    lifecycleStatus: existingState.lifecycleStatus || "draft",
    editVersion: existingState.editVersion || 1,
    ...overrides,
  };
}

/**
 * These helpers work on CANONICAL combo shapes (output of normalizeCombo).
 * Never pass raw DB/generator combos directly to these.
 */
function isNoTeacherCombo(combo) {
  // canonical field: combo.type
  return String(combo?.type || "").toUpperCase() === "NO_TEACHER";
}

function getComboSubjectId(combo) {
  // canonical field: combo.subjectId
  return String(combo?.subjectId || "");
}

function getComboSubjectType(combo) {
  // canonical field: combo.type
  return String(combo?.type || "THEORY").toLowerCase();
}

function getComboFacultyIds(combo) {
  // canonical field: combo.facultyIds
  return Array.isArray(combo?.facultyIds) ? combo.facultyIds : [];
}

router.post("/initialize", async (req, res) => {
  try {
    const {
      timetableId: requestedTimetableId,
      classes = [],
      faculties = [],
      subjects = [],
      electiveGroups = [],
      config = {},
      constraintConfig = {},
      sourceTimetableId = null,
    } = req.body;

    const userId = req.user?._id || req.userId;
    // Derive a stable session ID for this specific user and source
    const timetableId = `session-${req.collegeId}-${userId}-${sourceTimetableId || "new"}`;

    // 1. Check if already in memory
    if (getState(timetableId)) {
      return res.json({ ok: true, ...getState(timetableId) });
    }

    // 2. Check if a session_buffer exists in DB
    const existingBuffer = await TimetableResult.findOne({
      collegeId: req.collegeId,
      created_by: userId,
      generated_from_id: sourceTimetableId || null,
      status: "session_buffer"
    }).lean();

    if (existingBuffer) {
      const recoveredState = await loadSavedTimetable({
        timetableId,
        savedTimetableId: existingBuffer._id,
        collegeId: req.collegeId
      });
      loadState(timetableId, {
        ...recoveredState,
        electiveGroups: electiveGroups.length ? electiveGroups : (recoveredState.electiveGroups || []),
        constraintConfig: Object.keys(constraintConfig).length ? constraintConfig : (recoveredState.constraintConfig || {})
      });
      return res.json({ ok: true, ...getState(timetableId) });
    }

    // 3. Normal initialization
    initializeState(timetableId, classes, faculties, subjects, config, electiveGroups);

    const nextState = {
      ...getState(timetableId),
      ...buildSessionMeta(getState(timetableId), {
        sourceTimetableId,
      }),
      constraintConfig,
      collegeId: req.collegeId,
    };
    loadState(timetableId, nextState);

    return res.json({ ok: true, ...getState(timetableId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Valid options
router.post("/valid-options", async (req, res) => {
  try {
    const { classId, day, hour } = req.body;
    const timetableId = getStableTimetableId(req);
    assertState(timetableId);

    const state = getState(timetableId);
    const { classTimetable, teacherTimetable, subjectHoursAssigned, electiveGroups, teacherAvailability, teacherPreferences, config } = state;

    const classObj = await ClassModel.findOne({ _id: classId, collegeId: req.collegeId }).lean();
    if (!classObj) return res.status(404).json({ ok: false, error: "Class not found" });

    const combos = await getClassCombosForEdit(state, classObj);

    const combosInSlot = classTimetable[classId]?.[day]?.[hour] || [];
    let validCombos = [];

    if (combosInSlot.length > 1) {
      // Slot has multiple electives; find other valid electives from the same group.
      const combosDetailsInSlot = await resolveCombosFromState(state, combosInSlot);
      const subjectIdsInSlot = combosDetailsInSlot.map((c) => c.subjectId).filter(Boolean);

      const relevantGroup = electiveGroups.find(g => g.classId === classId && g.subjects.includes(subjectIdsInSlot[0]));

      const isLabCoTeachingSlot =
        combosDetailsInSlot.length > 0 &&
        subjectIdsInSlot.length > 0 &&
        subjectIdsInSlot.every((subjectId) => String(subjectId) === String(subjectIdsInSlot[0])) &&
        combosDetailsInSlot.every((combo) => getComboSubjectType(combo) === "lab");

      const potentialSubjectIds = relevantGroup
        ? relevantGroup.subjects.filter(s => !subjectIdsInSlot.includes(s))
        : [];

      for (const combo of combos) {
        const subjId = getComboSubjectId(combo);
        const facultyIds = getComboFacultyIds(combo);
        const isValidElectiveOption = potentialSubjectIds.includes(subjId);
        const isValidLabCoTeacherOption =
          isLabCoTeachingSlot &&
          subjId === String(subjectIdsInSlot[0]) &&
          getComboSubjectType(combo) === "lab" &&
          !combosInSlot.map(String).includes(String(combo._id));

        if (!isValidElectiveOption && !isValidLabCoTeacherOption) continue;

        const teacherBlocked = facultyIds.some((facultyId) => {
          const teacherCheck = checkTeacherConstraints(
            teacherTimetable,
            facultyId,
            day,
            hour,
            teacherAvailability
          );
          return !teacherCheck.ok;
        });

        if (!teacherBlocked) {
          validCombos.push({
            ...combo,
            preferenceWarnings: getTeacherPreferenceWarnings(
              facultyIds,
              teacherPreferences,
              day,
              hour,
              Number(config?.hours) || 8
            ),
            placementWarnings: isNoTeacherCombo(combo) && hour < Math.max(0, (Number(config?.hours) || 8) - 2)
              ? ["Recommended for later periods"]
              : [],
          });
        }
      }
    } else {
      // Slot has 0 or 1 items. In either case, the user should see all possible options
      // as they can either place, replace, or add the first co-elective.
      const result = await withTempClearedState(
        timetableId,
        classId,
        day,
        hour,
        (tempState) => {
          return computeAvailableCombos({
            classObj,
            combos,
            classTimetable: tempState.classTimetable,
            teacherTimetable: tempState.teacherTimetable,
            teacherAvailability: tempState.teacherAvailability,
            subjectHoursAssigned: tempState.subjectHoursAssigned,
            day,
            hour,
            allowHourOverflow: true,
          });
        }
      );
      validCombos = result;
    }

    return res.json({
      ok: true,
      validOptions: validCombos.map(c => ({
        comboId: c._id,
        faculty: isNoTeacherCombo(c) ? "No Teacher" : (c.faculty?.name || c.facultyNames?.[0] || "Unknown Teacher"),
        subject: c.subjectName || c.subject?.name || "Unknown Subject",
        subjectId: getComboSubjectId(c),
        facultyIds: getComboFacultyIds(c),
        warnings:
          [
            ...(
              Array.isArray(c.preferenceWarnings) && c.preferenceWarnings.length > 0
                ? c.preferenceWarnings
                : getTeacherPreferenceWarnings(
                getComboFacultyIds(c),
                teacherPreferences,
                day,
                hour,
                Number(config?.hours) || 8
              )
            ),
            ...(
              Array.isArray(c.placementWarnings)
                ? c.placementWarnings
                : (isNoTeacherCombo(c) && hour < Math.max(0, (Number(config?.hours) || 8) - 2))
                  ? ["Recommended for later periods"]
                  : []
            ),
          ],
      }))
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Place
router.post("/place", async (req, res) => {
  const { classId, day, hour, comboId } = req.body;
  const timetableId = getStableTimetableId(req);
  assertState(timetableId);

  const lockKey = `${timetableId}|${classId}|${day}|${hour}`;
  if (!lockSlot(lockKey)) {
    return res.status(409).json({ ok: false, error: "Slot busy" });
  }

  try {
    const newState = await placeCombo({
      timetableId,
      classId,
      day,
      hour,
      comboId
    });

    const placedCombo = await resolveComboFromState(newState, comboId);
    const targetClassIds =
      Array.isArray(placedCombo?.classIds) && placedCombo.classIds.length > 0
        ? placedCombo.classIds
        : [String(classId)];

    for (const targetClassId of targetClassIds) {
      if (!newState.slotSources[targetClassId]) {
        newState.slotSources[targetClassId] = [];
      }
      if (!newState.slotSources[targetClassId][day]) {
        newState.slotSources[targetClassId][day] = [];
      }
      newState.slotSources[targetClassId][day][hour] = "manual";
    }

    setState(timetableId, newState);
    persistSessionBuffer(timetableId, req.collegeId, req.user?._id || req.userId);
    return res.json({ ok: true, ...newState });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  } finally {
    unlockSlot(lockKey);
  }
});

// Auto-fill
router.post("/auto-fill", async (req, res) => {
  const { classId } = req.body;
  const timetableId = getStableTimetableId(req);
  assertState(timetableId);

  const lockKey = `${timetableId}|autofill|${classId}`;
  if (!lockSlot(lockKey)) {
    return res.status(409).json({ ok: false, error: "Auto-fill busy" });
  }

  try {
    const result = await runAutoFill({ timetableId, classId });
    if (result.ok) {
        persistSessionBuffer(timetableId, req.collegeId, req.user?._id || req.userId);
    }
    return res.json(result.ok ? { ok: true, ...result } : result);
  } finally {
    unlockSlot(lockKey);
  }
});

// Clear all
router.post("/clear-all", async (req, res) => {
  const { config } = req.body;
  const timetableId = getStableTimetableId(req);
  assertState(timetableId);

  const [classes, faculties, subjects] = await Promise.all([
    ClassModel.find({ collegeId: req.collegeId }).lean(),
    Faculty.find({ collegeId: req.collegeId }).lean(),
    Subject.find({ collegeId: req.collegeId }).lean()
  ]);

  initializeState(timetableId, classes, faculties, subjects, config);
  const current = getState(timetableId);
  loadState(timetableId, {
    ...current,
    ...buildSessionMeta(current, {
      lifecycleStatus: "draft",
    }),
  });
  persistSessionBuffer(timetableId, req.collegeId, req.user?._id || req.userId);
  return res.json({ ok: true, ...getState(timetableId) });
});

router.post("/validate-move", async (req, res) => {
  try {
    const { from, to } = req.body;
    const timetableId = getStableTimetableId(req);
    assertState(timetableId);

    const state = getState(timetableId);
    const result = await validateAndSimulateMove({ state, from, to });
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/move", async (req, res) => {
  try {
    const { from, to } = req.body;
    const timetableId = getStableTimetableId(req);
    assertState(timetableId);

    const lockKey = `${timetableId}|move|${String(from?.classId || "")}|${from?.day}|${from?.hour}|${String(to?.classId || "")}|${to?.day}|${to?.hour}`;
    if (!lockSlot(lockKey, 5000)) {
      return res.status(409).json({ ok: false, error: "Move busy" });
    }

    try {
      const state = getState(timetableId);
      const result = await validateAndSimulateMove({ state, from, to });

      if (!result.allowed || !result.newState) {
        return res.status(400).json({ ok: false, ...result });
      }

      setState(timetableId, result.newState);
      persistSessionBuffer(timetableId, req.collegeId, req.user?._id || req.userId);
      return res.json({ ok: true, ...result, ...getState(timetableId) });
    } finally {
      unlockSlot(lockKey);
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Load a saved timetable
router.post("/load", async (req, res) => {
  try {
    const { savedTimetableId } = req.body;
    const timetableId = getStableTimetableId(req);
    assertState(timetableId);

    const savedState = await loadSavedTimetable({
      timetableId,
      savedTimetableId,
      collegeId: req.collegeId,
    });

    const currentState = getState(timetableId);
    loadState(timetableId, {
      ...savedState,
      electiveGroups: currentState.electiveGroups || [],
      teacherAvailability: currentState.teacherAvailability || {},
      teacherPreferences: currentState.teacherPreferences || {},
      constraintConfig: currentState.constraintConfig || {},
    });
    res.json({ ok: true, ...getState(timetableId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Save
router.post("/save", async (req, res) => {
  try {
    const { name, savedTimetableId } = req.body;
    const timetableId = getStableTimetableId(req);
    assertState(timetableId);

    const userId = req.user?._id || req.userId;
    const state = getState(timetableId);
    const saved = await saveTimetable({
      name,
      state,
      collegeId: req.collegeId,
      userId,
      savedTimetableId,
    });

    // Clear session buffer on successful save
    await TimetableResult.deleteMany({
      collegeId: req.collegeId,
      created_by: userId,
      generated_from_id: state.sourceTimetableId || null,
      status: "session_buffer"
    });

    res.json({
      ok: true,
      message: "Timetable saved successfully",
      id: saved._id,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get all processed assignments (saved timetables or assignment lists)
router.get("/processed-assignments", async (req, res) => {
  try {
    const results = await getProcessedAssignments(req.collegeId);
    res.json({ ok: true, savedTimetables: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Delete
router.post("/delete", async (req, res) => {
  const timetableId = getStableTimetableId(req);
  assertState(timetableId);
  deleteState(timetableId);
  return res.json({ ok: true });
});

// Clear a specific slot
router.post("/clear-slot", async (req, res) => {
  const { classId, day, hour } = req.body;
  const timetableId = getStableTimetableId(req);
  assertState(timetableId);

  try {
    let newState = JSON.parse(JSON.stringify(getState(timetableId)));
    if (newState.lockedSlots?.[classId]?.[day]?.[hour]) {
      return res.status(400).json({ ok: false, error: "This slot is locked." });
    }
    const comboIds = newState.classTimetable?.[classId]?.[day]?.[hour] || [];
    const resolved = await resolveCombosFromState(newState, comboIds);
    await clearSlot({ classId, day, hour, state: newState });
    const affectedClassIds = new Set([String(classId)]);
    for (const combo of resolved) {
      for (const targetClassId of combo.classIds || []) {
        affectedClassIds.add(String(targetClassId));
      }
    }
    for (const targetClassId of affectedClassIds) {
      if (!newState.slotSources[targetClassId]) {
        newState.slotSources[targetClassId] = [];
      }
      if (!newState.slotSources[targetClassId][day]) {
        newState.slotSources[targetClassId][day] = [];
      }
      newState.slotSources[targetClassId][day][hour] = "manual";
    }
    setState(timetableId, newState);
    persistSessionBuffer(timetableId, req.collegeId, req.user?._id || req.userId);
    return res.json({ ok: true, ...newState });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/toggle-lock", async (req, res) => {
  const { classId, day, hour } = req.body;
  const timetableId = getStableTimetableId(req);
  assertState(timetableId);

  try {
    const newState = JSON.parse(JSON.stringify(getState(timetableId)));
    if (!newState.lockedSlots[classId]) {
      newState.lockedSlots[classId] = [];
    }
    if (!newState.lockedSlots[classId][day]) {
      newState.lockedSlots[classId][day] = [];
    }

    newState.lockedSlots[classId][day][hour] = !newState.lockedSlots[classId][day][hour];
    setState(timetableId, newState);
    persistSessionBuffer(timetableId, req.collegeId, req.user?._id || req.userId);
    return res.json({ ok: true, ...newState });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
