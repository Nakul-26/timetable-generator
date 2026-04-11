import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import { autoFillTimetable } from "../../utils/timetableManualUtils.js";
import { getState, setState } from "../../state/timetableState.js";

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

  // Populate details for frontend
  const placedCombosDetails = await TeacherSubjectCombination.find({
    _id: { $in: result.placedComboIds },
    collegeId: state?.collegeId,
  })
    .populate("faculty", "name")
    .populate("subject", "name")
    .lean();

  const comboIdToDetails = {};
  placedCombosDetails.forEach(c => {
    comboIdToDetails[c._id.toString()] = {
      subject: c.subject.name,
      faculty: c.faculty.name,
    };
  });

  return {
    ok: true,
    ...result.newState,
    comboIdToDetails
  };
}
