import ClassModel from "../../models/Class.js";

import {
  computeRemainingHours,
  checkClassConstraints,
  checkTeacherConstraints
} from "../../utils/timetableManualUtils.js";

import { getState } from "../../state/timetableState.js";
import {
  resolveComboFromState,
  resolveCombosFromState,
} from "./comboResolver.service.js";

/* ------------------------------------------------ */
/* ---------------- Slot Utilities ---------------- */
/* ------------------------------------------------ */

function isLabCombo(combo) {
  return String(combo?.subjectType || combo?.subject?.type || combo?.subject_type || combo?.type || "").toLowerCase() === "lab";
}

async function slotHasSubject({ state, classId, day, hour, subjectId, excludeComboId = null }) {
  const comboIds = state.classTimetable?.[classId]?.[day]?.[hour] || [];
  if (!Array.isArray(comboIds) || comboIds.length === 0) return false;

  const combos = await resolveCombosFromState(
    state,
    excludeComboId
      ? comboIds.filter((id) => String(id) !== String(excludeComboId))
      : comboIds
  );
  return combos.some((combo) => String(combo.subjectId) === String(subjectId));
}

export async function clearSlot({ classId, day, hour, state }) {
  const {
    classTimetable,
    teacherTimetable,
    subjectHoursAssigned,
    teacherAvailability,
  } = state;

  const comboIds = classTimetable[classId]?.[day]?.[hour];
  if (!comboIds || !Array.isArray(comboIds) || comboIds.length === 0) return;

  for (const comboId of comboIds) {
    if (!comboId) continue;

    const combo = await resolveComboFromState(state, comboId);
    if (!combo) continue;

    const targetClassIds = Array.isArray(combo.classIds) && combo.classIds.length > 0
      ? combo.classIds
      : [String(classId)];

    for (const facultyId of combo.facultyIds) {
      if (teacherTimetable[facultyId]?.[day]?.[hour] === comboId) {
        teacherTimetable[facultyId][day][hour] = null;
      }
    }

    for (const targetClassId of targetClassIds) {
      if (
        combo.subjectId &&
        subjectHoursAssigned[targetClassId]?.[combo.subjectId] > 0
      ) {
        subjectHoursAssigned[targetClassId][combo.subjectId]--;
      }
      if (
        Array.isArray(classTimetable[targetClassId]?.[day]?.[hour]) &&
        classTimetable[targetClassId][day][hour].includes(comboId)
      ) {
        classTimetable[targetClassId][day][hour] = classTimetable[targetClassId][day][hour]
          .filter((id) => String(id) !== String(comboId));
      }
    }
  }

  classTimetable[classId][day][hour] = [];
}

export async function withTempClearedState(
  timetableId,
  classId,
  day,
  hour,
  cb
) {
  const state = getState(timetableId);
  const tempState = JSON.parse(JSON.stringify(state));

  await clearSlot({ classId, day, hour, state: tempState });
  return cb(tempState);
}

export async function placeCombo({
  stateOverride = null,
  timetableId,
  classId,
  day,
  hour,
  comboId
}) {
  if (!comboId) {
    throw new Error("comboId is required for placeCombo.");
  }

  const state = stateOverride || getState(timetableId);
  let newState = stateOverride || JSON.parse(JSON.stringify(state));

  const {
    classTimetable,
    teacherTimetable,
    subjectHoursAssigned,
    config,
    electiveGroups,
    lockedSlots,
  } = newState;

  const classObj = newState.classMap?.get?.(String(classId)) || await ClassModel.findOne({ _id: classId, collegeId: newState?.collegeId }).lean();
  if (!classObj) throw new Error("Class not found");

  if (lockedSlots?.[classId]?.[day]?.[hour]) {
    throw new Error("This slot is locked.");
  }

  const combosInSlot = classTimetable[classId]?.[day]?.[hour] || [];
  if (combosInSlot.includes(comboId)) return newState;

  const combo = await resolveComboFromState(newState, comboId);

  if (!combo) throw new Error("Combo not found");

  const subjectId = combo.subjectId;
  const targetClassIds = Array.isArray(combo.classIds) && combo.classIds.length > 0
    ? combo.classIds
    : [String(classId)];
  let isReplacement = false;
  let isAdditivePlacement = false;

  for (const targetClassId of targetClassIds) {
    if (lockedSlots?.[targetClassId]?.[day]?.[hour]) {
      throw new Error("One of the combined class slots is locked.");
    }
  }

  if (combosInSlot.length > 0) {
    const existing = await resolveCombosFromState(newState, combosInSlot);
    const subjectIdsInSlot = existing.map((c) => c.subjectId).filter(Boolean);
    const allSubjects = [...subjectIdsInSlot, subjectId];

    const group = electiveGroups.find(
      g => g.classId === classId && g.subjects.includes(subjectId)
    );

    const validElective =
      group &&
      allSubjects.every(s => group.subjects.includes(s)) &&
      allSubjects.length <= group.subjects.length;

    const validLabCoTeaching =
      subjectId &&
      isLabCombo(combo) &&
      existing.length > 0 &&
      existing.every((existingCombo) =>
        String(existingCombo.subjectId) === String(subjectId) &&
        isLabCombo(existingCombo)
      );

    isAdditivePlacement = validElective || validLabCoTeaching;

    if (!isAdditivePlacement) {
      if (combosInSlot.length === 1) {
        isReplacement = true;
        await clearSlot({ classId, day, hour, state: newState });
      } else {
        throw new Error(
          "Invalid placement: slot full, not part of an elective group, or not a same-subject lab co-teacher."
        );
      }
    }
  }

  const remainingHours = computeRemainingHours(classObj, subjectHoursAssigned);

  if (!isReplacement && !isAdditivePlacement) {
    const c1 = checkClassConstraints(
      classTimetable,
      classObj,
      day,
      hour,
      subjectId,
      remainingHours,
      { allowHourOverflow: true }
    );
    if (!c1.ok) throw new Error(c1.error);
  }

  for (const targetClassId of targetClassIds) {
    const targetClassObj = targetClassId === String(classObj._id)
      ? classObj
      : newState.classMap?.get?.(String(targetClassId)) || await ClassModel.findOne({ _id: targetClassId, collegeId: newState?.collegeId }).lean();
    if (!targetClassObj) {
      throw new Error("Combined class not found");
    }
    const targetRemainingHours = computeRemainingHours(targetClassObj, subjectHoursAssigned);
    if (!isAdditivePlacement) {
      const c1 = checkClassConstraints(
        classTimetable,
        targetClassObj,
        day,
        hour,
        subjectId,
        targetRemainingHours,
        { allowHourOverflow: true }
      );
      if (!c1.ok) throw new Error(c1.error);
    }
  }

  for (const facultyId of combo.facultyIds) {
      const c2 = checkTeacherConstraints(
      teacherTimetable,
      facultyId,
      day,
      hour,
      teacherAvailability
    );
    if (!c2.ok) throw new Error(c2.error);
  }

  for (const targetClassId of targetClassIds) {
    if (!Array.isArray(classTimetable[targetClassId]?.[day]?.[hour])) {
      classTimetable[targetClassId][day][hour] = [];
    }
    if (!classTimetable[targetClassId][day][hour].includes(comboId)) {
      classTimetable[targetClassId][day][hour].push(comboId);
    }
  }

  for (const facultyId of combo.facultyIds) {
    if (!teacherTimetable[facultyId]) {
      const { days, hours } = config;
      teacherTimetable[facultyId] = Array(days)
        .fill(null)
        .map(() => Array(hours).fill(null));
    }

    teacherTimetable[facultyId][day][hour] = comboId;
  }
  for (const targetClassId of targetClassIds) {
    if (!subjectHoursAssigned[targetClassId]) {
      subjectHoursAssigned[targetClassId] = {};
    }

    const alreadyCountedInSlot = isAdditivePlacement && await slotHasSubject({
      state: newState,
      classId: targetClassId,
      day,
      hour,
      subjectId,
      excludeComboId: comboId,
    });

    if (!alreadyCountedInSlot) {
      subjectHoursAssigned[targetClassId][subjectId] =
        (subjectHoursAssigned[targetClassId][subjectId] || 0) + 1;
    }
  }

  return newState;
}
