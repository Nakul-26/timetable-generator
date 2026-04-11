import mongoose from "mongoose";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import Subject from "../../models/Subject.js";
import Faculty from "../../models/Faculty.js";

function normalizeCombo(combo) {
  if (!combo?._id) return null;

  const subjectId = String(combo.subject?._id || combo.subject || combo.subject_id || "");
  const facultyIds = Array.isArray(combo.faculty_ids)
    ? combo.faculty_ids.map((id) => String(id))
    : combo.faculty_id
      ? [String(combo.faculty_id)]
      : combo.faculty
        ? [String(combo.faculty?._id || combo.faculty)]
        : [];

  const classIds = Array.isArray(combo.class_ids)
    ? combo.class_ids.map((id) => String(id))
    : combo.class_id
      ? [String(combo.class_id)]
      : combo.class
        ? [String(combo.class?._id || combo.class)]
        : [];

  return {
    _id: String(combo._id),
    subjectId,
    facultyIds,
    classIds,
    combinedClassGroupId: combo.combined_class_group_id || combo.combinedClassGroupId || null,
    subjectName: combo.subject?.name || combo.subject_name || null,
    facultyNames: Array.isArray(combo.faculty_ids)
      ? combo.faculty_names || []
      : [combo.faculty?.name || combo.faculty_name].filter(Boolean),
    subjectType: String(combo.subject?.type || combo.subject_type || combo.type || "theory"),
  };
}

export async function resolveComboFromState(state, comboId) {
  const comboIdStr = String(comboId);
  const storedCombo = Array.isArray(state?.combos)
    ? state.combos.find((combo) => String(combo?._id) === comboIdStr)
    : null;

  if (storedCombo) {
    return normalizeCombo(storedCombo);
  }

  if (!mongoose.Types.ObjectId.isValid(comboIdStr)) {
    return null;
  }

  const combo = await TeacherSubjectCombination.findOne({ _id: comboIdStr, collegeId: state?.collegeId })
    .populate("subject", "name type")
    .populate("faculty", "name")
    .lean();

  return normalizeCombo(combo);
}

export async function resolveCombosFromState(state, comboIds = []) {
  const resolved = [];

  for (const comboId of comboIds) {
    const combo = await resolveComboFromState(state, comboId);
    if (combo) {
      resolved.push(combo);
    }
  }

  return resolved;
}

export async function getClassCombosForEdit(state, classObj) {
  const classId = String(classObj?._id || "");
  let storedCombos = Array.isArray(state?.combos)
    ? state.combos
        .filter((combo) => {
          const classIds = Array.isArray(combo?.class_ids)
            ? combo.class_ids.map((id) => String(id))
            : combo?.class_id
              ? [String(combo.class_id)]
              : combo?.class
                ? [String(combo.class?._id || combo.class)]
                : [];
          return classIds.includes(classId);
        })
        .map((combo) => ({
          _id: String(combo._id),
          subject: {
            _id: String(combo.subject?._id || combo.subject || combo.subject_id || ""),
            name: combo.subject?.name || combo.subject_name || "Unknown Subject",
            type: combo.subject?.type || combo.subject_type || combo.type || "theory",
          },
          faculty: {
            _id: String(
              combo.faculty?._id ||
              combo.faculty ||
              combo.faculty_id ||
              (Array.isArray(combo.faculty_ids) ? combo.faculty_ids[0] : "")
            ),
            name:
              combo.faculty?.name ||
              combo.faculty_name ||
              (Array.isArray(combo.faculty_names) ? combo.faculty_names.join(", ") : null) ||
              ((combo.subject?.type || combo.subject_type || combo.type) === "no_teacher" ? "No Teacher" : "Unknown Teacher"),
          },
          faculty_ids: Array.isArray(combo.faculty_ids)
            ? combo.faculty_ids.map((id) => String(id))
            : combo.faculty_id
              ? [String(combo.faculty_id)]
              : combo.faculty
                ? [String(combo.faculty?._id || combo.faculty)]
                : [],
          subject_id: String(combo.subject?._id || combo.subject || combo.subject_id || ""),
          class_ids: Array.isArray(combo.class_ids)
            ? combo.class_ids.map((id) => String(id))
            : [classId],
          combined_class_group_id: combo.combined_class_group_id || combo.combinedClassGroupId || null,
        }))
    : [];

  if (storedCombos.length > 0) {
    const subjectIds = [...new Set(storedCombos.map((combo) => combo.subject?._id).filter(Boolean))];
    const facultyIds = [...new Set(
      storedCombos.flatMap((combo) => Array.isArray(combo.faculty_ids) ? combo.faculty_ids : []).filter(Boolean)
    )];

    const [subjects, faculties] = await Promise.all([
      subjectIds.length > 0 ? Subject.find({ _id: { $in: subjectIds }, collegeId: state?.collegeId }).select("name type").lean() : Promise.resolve([]),
      facultyIds.length > 0 ? Faculty.find({ _id: { $in: facultyIds }, collegeId: state?.collegeId }).select("name").lean() : Promise.resolve([]),
    ]);

    const subjectMap = new Map(subjects.map((subject) => [String(subject._id), subject]));
    const facultyMap = new Map(faculties.map((faculty) => [String(faculty._id), faculty.name]));

    storedCombos = storedCombos.map((combo) => ({
      ...combo,
      subject: {
        ...combo.subject,
        name:
          combo.subject?.name ||
          subjectMap.get(String(combo.subject?._id || ""))?.name ||
          `Subject ${String(combo.subject?._id || "").slice(-4)}`,
        type:
          combo.subject?.type ||
          subjectMap.get(String(combo.subject?._id || ""))?.type ||
          "theory",
      },
      faculty: {
        ...combo.faculty,
        name:
          combo.faculty?.name ||
          combo.faculty_ids
            .map((facultyId) => facultyMap.get(String(facultyId)) || `Faculty ${String(facultyId).slice(-4)}`)
            .join(", "),
      },
    }));

    return storedCombos;
  }

  const comboIds = Array.isArray(classObj?.assigned_teacher_subject_combos)
    ? classObj.assigned_teacher_subject_combos.map((id) => String(id))
    : [];
  const validMongoIds = comboIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (validMongoIds.length === 0) {
    return [];
  }

  return TeacherSubjectCombination.find({
    _id: { $in: validMongoIds },
    collegeId: state?.collegeId,
  }).populate("faculty subject").lean();
}
