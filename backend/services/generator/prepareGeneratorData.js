import Faculty from "../../models/Faculty.js";
import Subject from "../../models/Subject.js";
import ClassModel from "../../models/Class.js";
import ClassSubject from "../../models/ClassSubject.js";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import ElectiveSubjectSetting from "../../models/ElectiveSubjectSetting.js";
import TeachingAllocation from "../../models/TeachingAllocation.js";
import converter from "../../models/lib/convertNewCollegeInputToGeneratorData.js";
import { normalizeAvailabilitySlots } from "../../utils/teacherAvailability.js";
import { normalizeTeacherPreferences } from "../../utils/teacherPreferences.js";

export async function prepareGeneratorData(collegeId, inputMode = "EXPLICIT") {
  if (!collegeId) {
    throw new Error("Missing collegeId in generator.");
  }
  const debugLabs = String(process.env.DEBUG_LAB_ALLOCATION || "").trim().toLowerCase() === "1" ||
    String(process.env.DEBUG_LAB_ALLOCATION || "").trim().toLowerCase() === "true";

  const [
    faculties,
    subjects,
    classes,
    classSubjectsRaw,
    combosRaw,
    electiveSettings,
    teachingAllocations,
  ] = await Promise.all([
    Faculty.find({ collegeId }).lean(),
    Subject.find({ collegeId }).lean(),
    // Avoid populate() for serverless performance; we only need faculty ids.
    ClassModel.find({ collegeId }).lean(),
    ClassSubject.find({ collegeId }).lean(),
    TeacherSubjectCombination.find({ collegeId }).lean(),
    ElectiveSubjectSetting.find({ collegeId }).lean(),
    TeachingAllocation.find({ collegeId }).lean(),
  ]);

  const subjectTypeMap = new Map(subjects.map((s) => [String(s._id), String(s.type || "").toLowerCase()]));

  // Filter inputs based on inputMode
  let filteredTeachingAllocations = teachingAllocations;
  let filteredClassSubjectsRaw = classSubjectsRaw;
  let filteredCombosRaw = combosRaw;

  if (inputMode === "EXPLICIT") {
    // EXPLICIT: Only use explicit TeachingAllocations, ignore derived relations
    filteredClassSubjectsRaw = [];
    filteredCombosRaw = [];
    console.log("[prepareGeneratorData] EXPLICIT mode: using only TeachingAllocations, ignoring derived relations");
  } else if (inputMode === "DERIVED") {
    // DERIVED: Prefer derived relations, but keep explicit lab allocations.
    // Labs often need explicit teacher assignment and block-handling; dropping them can
    // yield required lab hours with zero eligible combos.
    filteredTeachingAllocations = (teachingAllocations || []).filter((allocation) => {
      const allocationType = String(allocation?.type || "").toUpperCase();
      return allocationType === "LAB" || allocationType === "ELECTIVE_LAB";
    });
    console.log(
      `[prepareGeneratorData] DERIVED mode: using derived relations + ${filteredTeachingAllocations.length} LAB TeachingAllocations`
    );
  } else {
    console.warn(`[prepareGeneratorData] Unknown inputMode: ${inputMode}, using all data`);
  }

  const explicitClassSubjectKeys = new Set();
  const explicitClassTeacherKeys = new Set();
  const classSubjects = [];
  const teacherSubjectCombos = [];
  const classTeachers = [];
  const labAllocations = [];

  filteredTeachingAllocations.forEach((allocation) => {
    const classIds = (allocation.classIds || []).map((classId) => String(classId));
    const allocationType = String(allocation.type || "").toUpperCase();
    const isElectiveAllocation = allocationType === "ELECTIVE" || allocationType === "ELECTIVE_LAB";
    const isLabAllocation = allocationType === "LAB";
    const rawPairs = isElectiveAllocation && Array.isArray(allocation.subjects) && allocation.subjects.length > 0
      ? allocation.subjects
      : isLabAllocation
        ? [{
            subject: allocation.subject,
            teacher: allocation.teacher,
          }]
      : [{
          subject: allocation.subject,
          teacher: allocation.teacher,
        }];
    const normalizedPairs = rawPairs
      .map((pair) => ({
        subjectId: String(pair?.subject?._id || pair?.subject || pair?.subjectId || "").trim(),
        teacherId: String(pair?.teacher?._id || pair?.teacher || pair?.teacherId || "").trim(),
      }))
      .filter((pair) => pair.subjectId);

    if (isElectiveAllocation) {
      const subjectTeacherPairs = normalizedPairs.filter((pair) => {
        return pair.teacherId || subjectTypeMap.get(pair.subjectId) === "no_teacher";
      });
      const teacherIds = [...new Set(subjectTeacherPairs.map((pair) => pair.teacherId).filter(Boolean))];
      if (classIds.length > 0 && subjectTeacherPairs.length > 0) {
        teacherSubjectCombos.push({
          type: "ELECTIVE",
          isLab: allocationType === "ELECTIVE_LAB",
          electiveGroupId: String(allocation._id || allocation.combinedClassGroupId || subjectTeacherPairs.map((pair) => pair.subjectId).join("_")),
          subjectId: String(allocation.subject || subjectTeacherPairs[0]?.subjectId || ""),
          subjectTeacherPairs,
          teacherIds,
          classIds,
          hoursPerWeek: allocation.hoursPerWeek,
          combinedClassGroupId: allocation.combinedClassGroupId || null,
        });
      }
      classIds.forEach((classId) => {
        subjectTeacherPairs.forEach((pair) => {
          if (pair.teacherId) {
            explicitClassTeacherKeys.add(`${classId}|${pair.teacherId}`);
            classTeachers.push({ classId, teacherId: pair.teacherId });
          }
        });
      });
      return;
    }

    if (isLabAllocation) {
      const teacherIds = [...new Set(
        (Array.isArray(allocation.teachers) && allocation.teachers.length > 0
          ? allocation.teachers
          : normalizedPairs.map((pair) => pair.teacherId).filter(Boolean)
        ).map((teacherId) => String(teacherId).trim()).filter(Boolean)
      )];
      const subjectId = normalizedPairs[0]?.subjectId;
      const isNoTeacher = subjectTypeMap.get(subjectId) === "no_teacher";
      if ((teacherIds.length > 0 || isNoTeacher) && normalizedPairs.length > 0) {
        labAllocations.push({
          classIds,
          subjectId,
          teacherIds: teacherIds,
          hoursPerWeek: allocation.hoursPerWeek,
          combinedClassGroupId: allocation.combinedClassGroupId || null,
        });
        classIds.forEach((classId) => {
          teacherIds.forEach((teacherId) => {
            explicitClassTeacherKeys.add(`${classId}|${teacherId}`);
            classTeachers.push({ classId, teacherId });
          });
        });
      }
    } else {
      normalizedPairs.forEach((pair) => {
        const isNoTeacher = subjectTypeMap.get(pair.subjectId) === "no_teacher";
        if (!pair.teacherId && !isNoTeacher) return;
        teacherSubjectCombos.push({
          teacherId: pair.teacherId || null,
          teacherIds: pair.teacherId ? [pair.teacherId] : [],
          subjectId: pair.subjectId,
          classIds,
          hoursPerWeek: allocation.hoursPerWeek,
          combinedClassGroupId: allocation.combinedClassGroupId || null,
        });
      });
    }

    classIds.forEach((classId) => {
      normalizedPairs.forEach((pair) => {
        explicitClassSubjectKeys.add(`${classId}|${pair.subjectId}`);
        classSubjects.push({
          classId,
          subjectId: pair.subjectId,
          hoursPerWeek: allocation.hoursPerWeek,
        });
        if (pair.teacherId) {
          explicitClassTeacherKeys.add(`${classId}|${pair.teacherId}`);
          classTeachers.push({ classId, teacherId: pair.teacherId });
        }
      });
    });
  });

  filteredClassSubjectsRaw.forEach((cs) => {
    const key = `${String(cs.class)}|${String(cs.subject)}`;
    if (explicitClassSubjectKeys.has(key)) return;
    classSubjects.push({
      classId: cs.class,
      subjectId: cs.subject,
      hoursPerWeek: cs.hoursPerWeek
    });
  });

  filteredCombosRaw.forEach((c) => {
    teacherSubjectCombos.push({
      teacherId: c.faculty,
      subjectId: c.subject
    });
  });

  classes.forEach(c => {
    (c.faculties || []).forEach(f => {
      const teacherId = String(f?._id || f);
      const key = `${String(c._id)}|${teacherId}`;
      if (explicitClassTeacherKeys.has(key)) return;
      if (teacherId) {
        classTeachers.push({ classId: c._id, teacherId });
      }
    });
  });

  const classElectiveSubjects = electiveSettings.map(setting => ({
    classId: setting.class.toString(),
    subjectId: setting.subject.toString(),
    teacherCategoryRequirements: setting.teacherCategoryRequirements
  }));

  const generatorData = converter.convertNewCollegeInput({
    classes,
    subjects,
    teachers: faculties.map((faculty) => ({
      ...faculty,
      unavailableSlots: normalizeAvailabilitySlots(faculty.unavailableSlots || []),
      preferences: normalizeTeacherPreferences(faculty.preferences || {}),
    })),
    classSubjects,
    classTeachers,
    teacherSubjectCombos,
    labAllocations,
    classElectiveSubjects
  });

  if (debugLabs) {
    const generatorCombos = Array.isArray(generatorData?.combos) ? generatorData.combos : [];
    const generatorClasses = Array.isArray(generatorData?.classes) ? generatorData.classes : [];
    const classComboCounts = new Map();
    generatorCombos.forEach((combo) => {
      (combo.class_ids || []).forEach((classId) => {
        classComboCounts.set(String(classId), (classComboCounts.get(String(classId)) || 0) + 1);
      });
    });
    const classById = new Map(generatorClasses.map((klass) => [String(klass._id), klass]));
    console.log("[prepareGeneratorData] summary", {
      classes: generatorClasses.length,
      combos: generatorCombos.length,
      labAllocations: labAllocations.map((allocation) => ({
        classIds: allocation.classIds,
        subjectId: allocation.subjectId,
        teacherIds: allocation.teacherIds,
        hoursPerWeek: allocation.hoursPerWeek,
        combinedClassGroupId: allocation.combinedClassGroupId,
      })),
      classComboCounts: Array.from(classComboCounts.entries()).map(([classId, count]) => ({
        classId,
        className: classById.get(classId)?.name || classId,
        comboCount: count,
      })),
    });
  }

  return generatorData;
}
