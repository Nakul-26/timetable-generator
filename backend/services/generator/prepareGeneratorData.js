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

export async function prepareGeneratorData(collegeId) {
  if (!collegeId) {
    throw new Error("Missing collegeId in generator.");
  }

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

  const explicitClassSubjectKeys = new Set();
  const explicitClassTeacherKeys = new Set();
  const classSubjects = [];
  const teacherSubjectCombos = [];
  const classTeachers = [];

  teachingAllocations.forEach((allocation) => {
    const classIds = (allocation.classIds || []).map((classId) => String(classId));
    const teacherId = allocation.teacher ? String(allocation.teacher) : null;
    teacherSubjectCombos.push({
      teacherId,
      subjectId: allocation.subject,
      classIds,
      hoursPerWeek: allocation.hoursPerWeek,
      combinedClassGroupId: allocation.combinedClassGroupId || null,
    });

    classIds.forEach((classId) => {
      explicitClassSubjectKeys.add(`${classId}|${String(allocation.subject)}`);
      classSubjects.push({
        classId,
        subjectId: allocation.subject,
        hoursPerWeek: allocation.hoursPerWeek,
      });
      if (teacherId) {
        explicitClassTeacherKeys.add(`${classId}|${teacherId}`);
        classTeachers.push({ classId, teacherId });
      }
    });
  });

  classSubjectsRaw.forEach((cs) => {
    const key = `${String(cs.class)}|${String(cs.subject)}`;
    if (explicitClassSubjectKeys.has(key)) return;
    classSubjects.push({
      classId: cs.class,
      subjectId: cs.subject,
      hoursPerWeek: cs.hoursPerWeek
    });
  });

  combosRaw.forEach((c) => {
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

  return converter.convertNewCollegeInput({
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
    classElectiveSubjects
  });
}
