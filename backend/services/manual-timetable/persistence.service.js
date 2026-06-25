import mongoose from "mongoose";
import TimetableResult from "../../models/TimetableResult.js";
import TeachingAllocation from "../../models/TeachingAllocation.js";
import { normalizeCombo } from "../../utils/comboNormalizer.js";

/* ------------------------------------------------ */
/* -------------- Normalization Utils ------------- */
/* ------------------------------------------------ */

function normalizeClassTimetables(classTimetables) {
  if (!classTimetables) return classTimetables;

  for (const classId in classTimetables) {
    for (const day in classTimetables[classId]) {
      for (const hour in classTimetables[classId][day]) {
        const slot = classTimetables[classId][day][hour];
        if (!Array.isArray(slot)) {
          classTimetables[classId][day][hour] = slot ? [slot] : [];
        }
      }
    }
  }
  return classTimetables;
}

function createSlotSourceGrid(classTimetable, defaultSource) {
  const slotSources = {};

  for (const classId in classTimetable || {}) {
    slotSources[classId] = [];
    const days = classTimetable[classId] || [];

    for (let day = 0; day < days.length; day++) {
      slotSources[classId][day] = [];
      const hours = days[day] || [];

      for (let hour = 0; hour < hours.length; hour++) {
        const slot = hours[hour];
        slotSources[classId][day][hour] =
          Array.isArray(slot) && slot.length > 0 ? defaultSource : null;
      }
    }
  }

  return slotSources;
}

function createLockedSlotGrid(classTimetable) {
  const lockedSlots = {};

  for (const classId in classTimetable || {}) {
    lockedSlots[classId] = [];
    const days = classTimetable[classId] || [];

    for (let day = 0; day < days.length; day++) {
      lockedSlots[classId][day] = [];
      const hours = days[day] || [];

      for (let hour = 0; hour < hours.length; hour++) {
        lockedSlots[classId][day][hour] = false;
      }
    }
  }

  return lockedSlots;
}

async function buildDerivedState(saved, collegeId) {
  const classTimetable = normalizeClassTimetables(
    JSON.parse(JSON.stringify(saved.class_timetables || {}))
  );

  const config = saved.config || {};
  const days = Number(config.days || config.daysPerWeek || 6);
  const hours = Number(config.hours || config.hoursPerDay || 8);

  const comboIds = Object.values(classTimetable)
    .flatMap((classSchedule) => (classSchedule || []).flatMap((day) => (day || []).flat()))
    .filter(Boolean)
    .map((id) => String(id));
  const validComboIds = [...new Set(comboIds)].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );

  // Phase 2c: Read from TeachingAllocation (canonical source) instead of TeacherSubjectCombination
  const comboDocs = validComboIds.length
    ? await TeachingAllocation.find({
        collegeId,
        _id: { $in: validComboIds },
      }).lean()
    : [];

  const comboMap = new Map();
  comboDocs.forEach((alloc) => comboMap.set(String(alloc._id), alloc));

  if (Array.isArray(saved.combos)) {
    saved.combos.forEach((combo) => {
      if (combo && combo._id) comboMap.set(String(combo._id), combo);
    });
  }

  const teacherTimetable = {};
  const subjectHoursAssigned = {};

  for (const classId in classTimetable) {
    if (!subjectHoursAssigned[classId]) {
      subjectHoursAssigned[classId] = {};
    }

    for (let day = 0; day < days; day++) {
      if (!Array.isArray(classTimetable[classId][day])) {
        classTimetable[classId][day] = Array.from({ length: hours }, () => []);
      }

      for (let hour = 0; hour < hours; hour++) {
        if (!Array.isArray(classTimetable[classId][day][hour])) {
          classTimetable[classId][day][hour] = classTimetable[classId][day][hour]
            ? [classTimetable[classId][day][hour]]
            : [];
        }

        const slot = classTimetable[classId][day][hour];
        for (const comboId of slot) {
          const raw = comboMap.get(String(comboId));
          if (!raw) continue;

          // Always go through canonical normalizer – no direct field access
          const combo = normalizeCombo(raw);
          if (!combo) continue;

          const { subjectId, facultyIds } = combo;

          if (subjectId) {
            subjectHoursAssigned[classId][subjectId] =
              (subjectHoursAssigned[classId][subjectId] || 0) + 1;
          }

          for (const facultyId of facultyIds) {
            if (!teacherTimetable[facultyId]) {
              teacherTimetable[facultyId] = Array.from({ length: days }, () => Array(hours).fill(null));
            }
            teacherTimetable[facultyId][day][hour] = String(comboId);
          }
        }
      }
    }
  }

  return {
    classTimetable,
    teacherTimetable,
    subjectHoursAssigned,
    combos: saved.combos || comboDocs,
    config: { ...config, days, hours },
    version: saved.version || 1,
    createdAt: saved.createdAt,
    slotSources:
      saved.slot_sources ||
      createSlotSourceGrid(
        classTimetable,
        saved.status === "generated" || saved.source === "generator" ? "generated" : "manual"
      ),
    lockedSlots: saved.locked_slots || createLockedSlotGrid(classTimetable),
    sourceTimetableId: saved._id?.toString() || null,
    generatedFromId:
      saved.generated_from_id?.toString() ||
      (saved.source === "generator" ? saved._id?.toString() : null),
    parentTimetableId:
      saved.parent_timetable_id?.toString() || saved._id?.toString() || null,
    lifecycleStatus: saved.status || (saved.source === "generator" ? "generated" : "draft"),
    editVersion: saved.edit_version || 1,
  };
}

/* ------------------------------------------------ */
/* ------------------- Load / Save ---------------- */
/* ------------------------------------------------ */

export async function loadSavedTimetable({ timetableId, savedTimetableId, collegeId }) {
  const saved = await TimetableResult.findOne({ _id: savedTimetableId, collegeId }).lean();
  if (!saved) {
    throw new Error("Saved timetable not found");
  }

  return buildDerivedState(saved, collegeId);
}

export async function saveTimetable({
  name,
  state,
  collegeId,
  userId = null,
  savedTimetableId = null,
  isBuffer = false,
}) {
  const isEditedDraft = !!state.generatedFromId;
  const status = isBuffer
    ? "session_buffer"
    : isEditedDraft
      ? "edited"
      : state.lifecycleStatus || "draft";

  const payload = {
    collegeId,
    name,
    source: "manual",
    status,
    generated_from_id: state.generatedFromId || null,
    parent_timetable_id: state.parentTimetableId || null,
    edit_version: state.editVersion || 1,
    created_by: userId || null,
    class_timetables: state.classTimetable,
    // Use faculty_timetables as the canonical field name.
    // teacher_timetables is the legacy alias – kept null to avoid confusion.
    faculty_timetables: state.teacherTimetable,
    teacher_timetables: null,
    subject_hours_assigned: state.subjectHoursAssigned,
    slot_sources: state.slotSources || null,
    locked_slots: state.lockedSlots || null,
    combos: state.combos || null,
    config: state.config,
    version: state.version,
  };

  if (isBuffer && userId) {
    // If we are saving a buffer, try to find an existing buffer for this user and source
    return TimetableResult.findOneAndUpdate(
      {
        collegeId,
        created_by: userId,
        generated_from_id: state.generatedFromId || null,
        status: "session_buffer",
      },
      payload,
      { upsert: true, new: true }
    );
  }

  if (savedTimetableId) {
    const updated = await TimetableResult.findOneAndUpdate(
      { _id: savedTimetableId, collegeId },
      payload,
      { new: true }
    );
    if (!updated) {
      throw new Error("Timetable to update not found");
    }
    return updated;
  }

  if (state.parentTimetableId) {
    const latestSibling = await TimetableResult.find({
      collegeId,
      $or: [
        { parent_timetable_id: state.parentTimetableId },
        { _id: state.parentTimetableId },
      ],
    })
      .sort({ edit_version: -1, createdAt: -1 })
      .lean();

    const maxVersion = latestSibling.reduce((max, item) => {
      const value = Number(item.edit_version || 0);
      return value > max ? value : max;
    }, 0);

    payload.edit_version = maxVersion + 1;
  }

  const created = new TimetableResult(payload);
  return created.save();
}

/* ------------------------------------------------ */
/* -------- Processed Assignments / Results -------- */
/* ------------------------------------------------ */

/**
 * Fetch and normalize a batch of assignment ids from the DB.
 * Phase 2c: Reads from TeachingAllocation (canonical source) — NOT TeacherSubjectCombination.
 * Returns canonical combo objects (via normalizeCombo for backward compat with callers).
 */
async function populateCombos(comboIds, collegeId) {
  if (!comboIds || comboIds.length === 0) return [];

  const uniqueIds = [...new Set(comboIds.filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)));

  if (uniqueIds.length === 0) return [];

  // TeachingAllocation is the canonical source; TSC is no longer read here
  const raws = await TeachingAllocation.find({ _id: { $in: uniqueIds }, collegeId }).lean();

  // normalizeCombo handles TeachingAllocation shapes — it reads teacherIds/subjectId/classIds
  return raws.map(normalizeCombo).filter(Boolean);
}

export async function getProcessedAssignments(collegeId) {
  const results = await TimetableResult.find({ collegeId })
    .sort({ createdAt: -1 })
    .lean();

  return Promise.all(
    results.map(async (result) => {
      if (result.source === "assignments" && result.assignments_only) {
        const populatedAssignments = {};
        for (const classId in result.assignments_only) {
          populatedAssignments[classId] = await populateCombos(
            result.assignments_only[classId],
            collegeId
          );
        }
        result.populated_assignments = populatedAssignments;
        return result;
      }

      if (!result.class_timetables) return result;

      const allComboIds = Object.values(result.class_timetables)
        .flatMap((classSchedule) =>
          Object.values(classSchedule).flatMap((day) =>
            Object.values(day).flat()
          )
        )
        .filter(Boolean);

      const populated = await populateCombos(allComboIds, collegeId);
      const comboMap = new Map(
        populated.map((c) => [c._id.toString(), c])
      );

      const populatedTimetables = {};
      for (const classId in result.class_timetables) {
        populatedTimetables[classId] = {};
        for (const day in result.class_timetables[classId]) {
          populatedTimetables[classId][day] = {};
          for (const hour in result.class_timetables[classId][day]) {
            const slot = result.class_timetables[classId][day][hour];
            populatedTimetables[classId][day][hour] = Array.isArray(slot)
              ? slot.map((id) => comboMap.get(id.toString())).filter(Boolean)
              : [];
          }
        }
      }

      result.class_timetables = populatedTimetables;
      return result;
    })
  );
}
