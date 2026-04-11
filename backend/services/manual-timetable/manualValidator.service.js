import ClassModel from "../../models/Class.js";
import { clearSlot, placeCombo } from "./slot.service.js";
import { resolveComboFromState } from "./comboResolver.service.js";
import { getTeacherPreferenceWarnings } from "../../utils/timetableManualUtils.js";

function getConstraintConfig(state = {}) {
  const config = state.constraintConfig || {};
  return {
    schedule: {
      breakHours: Array.isArray(config?.schedule?.breakHours) ? config.schedule.breakHours.map(Number) : [],
      hoursPerDay: Number(config?.schedule?.hoursPerDay || state?.config?.hours || 8),
    },
    structural: {
      labBlockSize: Math.max(1, Number(config?.structural?.labBlockSize || 2)),
    },
    teacherContinuity: {
      enabled: config?.teacherContinuity?.enabled !== false,
      maxConsecutive: Math.max(1, Number(config?.teacherContinuity?.maxConsecutive || 3)),
    },
    classContinuity: {
      enabled: config?.classContinuity?.enabled !== false,
      maxConsecutive: Math.max(1, Number(config?.classContinuity?.maxConsecutive || 3)),
    },
    teacherDailyOverload: {
      enabled: config?.teacherDailyOverload?.enabled !== false,
      max: Math.max(0, Number(config?.teacherDailyOverload?.max || 6)),
    },
    subjectClustering: {
      enabled: config?.subjectClustering?.enabled !== false,
      maxPerDay: Math.max(1, Number(config?.subjectClustering?.maxPerDay || 3)),
    },
    frontLoading: {
      enabled: config?.frontLoading?.enabled !== false,
    },
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function getSlotComboIds(state, classId, day, hour) {
  const slot = state?.classTimetable?.[classId]?.[day]?.[hour];
  return Array.isArray(slot) ? slot.filter(Boolean).map(String) : [];
}

function getSlotLock(state, classId, day, hour) {
  return Boolean(state?.lockedSlots?.[classId]?.[day]?.[hour]);
}

function getConsecutiveSpan(row = [], hour) {
  let before = 0;
  let after = 0;

  for (let idx = hour - 1; idx >= 0; idx -= 1) {
    if (row[idx] !== undefined && row[idx] !== null) before += 1;
    else break;
  }

  for (let idx = hour + 1; idx < row.length; idx += 1) {
    if (row[idx] !== undefined && row[idx] !== null) after += 1;
    else break;
  }

  return before + 1 + after;
}

function getDailyLoad(row = []) {
  return row.reduce(
    (count, slot) => count + ((slot !== undefined && slot !== null) ? 1 : 0),
    0
  );
}

function hasEarlierGapBeforeOccupancy(slotRow = [], hour) {
  if (hour <= 0) return false;

  let foundEarlierEmpty = false;
  for (let idx = 0; idx < hour; idx += 1) {
    if (slotRow[idx] === undefined || slotRow[idx] === null || (Array.isArray(slotRow[idx]) && slotRow[idx].length === 0)) {
      foundEarlierEmpty = true;
      continue;
    }
    if (foundEarlierEmpty) return true;
  }

  return false;
}

function getContiguousSameComboCount(slotRow = [], hour, comboId) {
  if (!Array.isArray(slotRow) || !comboId) return 0;

  let total = 1;

  for (let idx = hour - 1; idx >= 0; idx -= 1) {
    const slot = Array.isArray(slotRow[idx]) ? slotRow[idx] : [];
    if (slot.includes(comboId)) total += 1;
    else break;
  }

  for (let idx = hour + 1; idx < slotRow.length; idx += 1) {
    const slot = Array.isArray(slotRow[idx]) ? slotRow[idx] : [];
    if (slot.includes(comboId)) total += 1;
    else break;
  }

  return total;
}

function addUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function getComboClassIds(combo, fallbackClassId = null) {
  const classIds = Array.isArray(combo?.classIds) ? combo.classIds.map(String).filter(Boolean) : [];
  if (classIds.length > 0) return classIds;
  return fallbackClassId ? [String(fallbackClassId)] : [];
}

async function getClassMap(classIds = []) {
  const docs = await ClassModel.find({ _id: { $in: classIds }, collegeId: state?.collegeId }).lean();
  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

function markManualSlotSources(state, entries = []) {
  for (const entry of entries) {
    const classIds = Array.isArray(entry.classIds) && entry.classIds.length > 0
      ? entry.classIds
      : [String(entry.classId)];

    for (const classId of classIds.map(String)) {
      if (!state.slotSources[classId]) state.slotSources[classId] = [];
      if (!state.slotSources[classId][entry.day]) state.slotSources[classId][entry.day] = [];
      state.slotSources[classId][entry.day][entry.hour] = "manual";
    }
  }
}

function validateBreakHour(hardViolations, cfg, hour) {
  if (cfg.schedule.breakHours.includes(Number(hour))) {
    addUnique(hardViolations, "Cannot place a lesson in a configured break hour.");
  }
}

function validateLabBlock(hardViolations, state, combo, day, hour, cfg, fallbackClassId = null) {
  if (!combo || String(combo.subjectType || "").toLowerCase() !== "lab") return;

  const requiredBlock = cfg.structural.labBlockSize;
  if (requiredBlock <= 1) return;

  const classIds = getComboClassIds(combo, fallbackClassId);

  for (const classId of classIds) {
    const row = state?.classTimetable?.[classId]?.[day] || [];
    const contiguous = getContiguousSameComboCount(row, hour, String(combo._id));
    if (contiguous < requiredBlock) {
      addUnique(
        hardViolations,
        `Lab must stay in a ${requiredBlock}-hour consecutive block.`
      );
      return;
    }
  }
}

function collectSoftWarnings({
  state,
  cfg,
  placements,
  teacherPreferences = {},
}) {
  const warnings = [];

  for (const placement of placements) {
    const combo = placement.combo;
    if (!combo) continue;

    const classIds = getComboClassIds(combo, placement.classId);
    const facultyIds = Array.isArray(combo.facultyIds) ? combo.facultyIds : [];

    for (const facultyId of facultyIds) {
      const row = state?.teacherTimetable?.[facultyId]?.[placement.day] || [];
      if (
        cfg.teacherContinuity.enabled &&
        getConsecutiveSpan(row, placement.hour) > cfg.teacherContinuity.maxConsecutive
      ) {
        addUnique(
          warnings,
          `Teacher exceeds preferred consecutive limit of ${cfg.teacherContinuity.maxConsecutive}.`
        );
      }

      if (
        cfg.teacherDailyOverload.enabled &&
        getDailyLoad(row) > cfg.teacherDailyOverload.max
      ) {
        addUnique(
          warnings,
          `Teacher exceeds preferred daily load of ${cfg.teacherDailyOverload.max}.`
        );
      }

      for (const warning of getTeacherPreferenceWarnings(
        [facultyId],
        teacherPreferences,
        placement.day,
        placement.hour,
        cfg.schedule.hoursPerDay
      )) {
        addUnique(warnings, warning);
      }
    }

    for (const classId of classIds) {
      const row = state?.classTimetable?.[classId]?.[placement.day] || [];
      if (
        cfg.classContinuity.enabled &&
        getConsecutiveSpan(row, placement.hour) > cfg.classContinuity.maxConsecutive
      ) {
        addUnique(
          warnings,
          `Class exceeds preferred consecutive limit of ${cfg.classContinuity.maxConsecutive}.`
        );
      }

      if (cfg.subjectClustering.enabled && combo.subjectId) {
        const count = row.reduce((total, slot) => {
          if (!Array.isArray(slot) || slot.length === 0) return total;
          if (slot.includes(String(combo._id))) return total + 1;
          return total;
        }, 0);

        if (count > cfg.subjectClustering.maxPerDay) {
          addUnique(
            warnings,
            `Subject clustering exceeds preferred daily limit of ${cfg.subjectClustering.maxPerDay}.`
          );
        }
      }

      if (
        cfg.frontLoading.enabled &&
        placement.hour >= Math.ceil(cfg.schedule.hoursPerDay / 2)
      ) {
        addUnique(warnings, "Placed in a later period than preferred.");
      }

      if (cfg.frontLoading.enabled && hasEarlierGapBeforeOccupancy(row, placement.hour)) {
        addUnique(warnings, "Creates a front-loading penalty for this class.");
      }
    }
  }

  return warnings;
}

function validateMovableSlot(hardViolations, state, combo, classId, day, hour, label) {
  if (getSlotLock(state, classId, day, hour)) {
    addUnique(hardViolations, `${label} slot is locked.`);
  }

  for (const targetClassId of getComboClassIds(combo, classId)) {
    if (getSlotLock(state, targetClassId, day, hour)) {
      addUnique(hardViolations, `${label} slot is locked.`);
      break;
    }
  }
}

export async function validateAndSimulateMove({
  state,
  from,
  to,
}) {
  const hardViolations = [];
  const cfg = getConstraintConfig(state);
  const fromClassId = String(from?.classId || "");
  const toClassId = String(to?.classId || "");
  const fromDay = Number(from?.day);
  const fromHour = Number(from?.hour);
  const toDay = Number(to?.day);
  const toHour = Number(to?.hour);

  if (!fromClassId || !toClassId) {
    return {
      allowed: false,
      hardViolations: ["Move request is missing class information."],
      softWarnings: [],
      operation: "invalid",
      newState: null,
    };
  }

  if (fromClassId === toClassId && fromDay === toDay && fromHour === toHour) {
    return {
      allowed: true,
      hardViolations: [],
      softWarnings: [],
      operation: "noop",
      newState: cloneState(state),
    };
  }

  const sourceIds = getSlotComboIds(state, fromClassId, fromDay, fromHour);
  const targetIds = getSlotComboIds(state, toClassId, toDay, toHour);

  if (sourceIds.length === 0) {
    addUnique(hardViolations, "Source slot is empty.");
  }
  if (sourceIds.length > 1) {
    addUnique(hardViolations, "Drag-and-drop currently supports slots with one lesson only.");
  }
  if (targetIds.length > 1) {
    addUnique(hardViolations, "Swap is not available for slots containing multiple lessons.");
  }

  const sourceCombo = sourceIds[0] ? await resolveComboFromState(state, sourceIds[0]) : null;
  const targetCombo = targetIds[0] ? await resolveComboFromState(state, targetIds[0]) : null;
  const sourceComboClassIds = getComboClassIds(sourceCombo, fromClassId);
  const targetComboClassIds = getComboClassIds(targetCombo, toClassId);

  if (!sourceCombo) {
    addUnique(hardViolations, "Source lesson could not be resolved.");
  }

  if (sourceCombo && !sourceComboClassIds.includes(toClassId)) {
    addUnique(hardViolations, "Lesson cannot be moved into a different class timetable.");
  }

  if (targetCombo && !targetComboClassIds.includes(fromClassId)) {
    addUnique(hardViolations, "Swap target belongs to a different class timetable.");
  }

  if (sourceCombo) {
    validateMovableSlot(hardViolations, state, sourceCombo, fromClassId, fromDay, fromHour, "Source");
  }
  if (targetCombo) {
    validateMovableSlot(hardViolations, state, targetCombo, toClassId, toDay, toHour, "Target");
  } else if (getSlotLock(state, toClassId, toDay, toHour)) {
    addUnique(hardViolations, "Target slot is locked.");
  }

  validateBreakHour(hardViolations, cfg, toHour);
  if (targetCombo) {
    validateBreakHour(hardViolations, cfg, fromHour);
  }

  if (hardViolations.length > 0) {
    return {
      allowed: false,
      hardViolations,
      softWarnings: [],
      operation: targetCombo ? "swap" : "move",
      newState: null,
    };
  }

  const classIdsToFetch = new Set([
    ...sourceComboClassIds,
    ...targetComboClassIds,
  ]);
  const classMap = await getClassMap([...classIdsToFetch]);
  const newState = cloneState(state);

  try {
    await clearSlot({ classId: fromClassId, day: fromDay, hour: fromHour, state: newState });
    if (targetCombo) {
      await clearSlot({ classId: toClassId, day: toDay, hour: toHour, state: newState });
    }

    newState.classMap = classMap;
    await placeCombo({
      timetableId: null,
      classId: toClassId,
      day: toDay,
      hour: toHour,
      comboId: sourceCombo._id,
      stateOverride: newState,
    });

    if (targetCombo) {
      await placeCombo({
        timetableId: null,
        classId: fromClassId,
        day: fromDay,
        hour: fromHour,
        comboId: targetCombo._id,
        stateOverride: newState,
      });
    }
  } catch (error) {
    addUnique(hardViolations, error.message || "Move is not allowed.");
  } finally {
    delete newState.classMap;
  }

  validateLabBlock(hardViolations, newState, sourceCombo, toDay, toHour, cfg, toClassId);
  if (targetCombo) {
    validateLabBlock(hardViolations, newState, targetCombo, fromDay, fromHour, cfg, fromClassId);
  }

  if (hardViolations.length > 0) {
    return {
      allowed: false,
      hardViolations,
      softWarnings: [],
      operation: targetCombo ? "swap" : "move",
      newState: null,
    };
  }

  markManualSlotSources(newState, [
    {
      classId: fromClassId,
      classIds: sourceComboClassIds,
      day: fromDay,
      hour: fromHour,
    },
    {
      classId: toClassId,
      classIds: sourceComboClassIds,
      day: toDay,
      hour: toHour,
    },
    ...(targetCombo
      ? [
          {
            classId: fromClassId,
            classIds: targetComboClassIds,
            day: fromDay,
            hour: fromHour,
          },
          {
            classId: toClassId,
            classIds: targetComboClassIds,
            day: toDay,
            hour: toHour,
          },
        ]
      : []),
  ]);

  const softWarnings = collectSoftWarnings({
    state: newState,
    cfg,
    placements: [
      { classId: toClassId, day: toDay, hour: toHour, combo: sourceCombo },
      ...(targetCombo ? [{ classId: fromClassId, day: fromDay, hour: fromHour, combo: targetCombo }] : []),
    ],
    teacherPreferences: state.teacherPreferences || {},
  });

  return {
    allowed: true,
    hardViolations: [],
    softWarnings,
    operation: targetCombo ? "swap" : "move",
    newState,
  };
}
