/**
 * autofill.service.js
 *
 * Phase 2c: Removed direct TeacherSubjectCombination import.
 * Post-placement detail fetch now uses resolveAssignments from AssignmentResolver.
 */

import { autoFillTimetable } from "../../utils/timetableManualUtils.js";
import { getState, setState } from "../../state/timetableState.js";
import { resolveAssignments } from "./assignmentResolver.service.js";

/* ------------------------------------------------ */
/* ---------------- Auto-fill Service -------------- */
/* ------------------------------------------------ */

export async function runAutoFill({ timetableId, classId }) {
  const state = getState(timetableId);

  const result = await autoFillTimetable(classId, state);
  if (!result.ok) {
    return result;
  }

  // Update global state
  setState(timetableId, result.newState);

  // Populate details for frontend using AssignmentResolver (canonical source)
  const placedAssignments = await resolveAssignments(state, result.placedComboIds);

  const comboIdToDetails = {};
  placedAssignments.forEach((a) => {
    comboIdToDetails[a.id] = {
      assignmentId: a.id,
      subject: a.subjectName || a.subjectId,
      teacher: a.teacherNames?.join(" & ") || a.teacherIds.join(" & "),
      // Keep legacy keys for backward-compat with any frontend still reading them
      faculty: a.teacherNames?.join(" & ") || a.teacherIds.join(" & "),
    };
  });

  return {
    ok: true,
    ...result.newState,
    comboIdToDetails,
  };
}
