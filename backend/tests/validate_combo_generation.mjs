import converter from "../models/lib/convertNewCollegeInputToGeneratorData.js";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const baseClasses = [
  { _id: "class-a", name: "CSE A", sem: 5, section: "A" },
  { _id: "class-b", name: "CSE B", sem: 5, section: "B" },
];

const baseSubjects = [
  { _id: "math", name: "Math", type: "theory", classesPerWeek: 4 },
  { _id: "ai", name: "AI", type: "theory", classesPerWeek: 3, isElective: true },
  { _id: "cloud", name: "Cloud", type: "theory", classesPerWeek: 3, isElective: true },
  { _id: "iot", name: "IoT", type: "theory", classesPerWeek: 3, isElective: true },
  { _id: "dbms-lab", name: "DBMS Lab", type: "lab", classesPerWeek: 2 },
  { _id: "library", name: "Library", type: "no_teacher", classesPerWeek: 1 },
];

const baseTeachers = [
  { _id: "teacher-a", name: "Teacher A" },
  { _id: "teacher-b", name: "Teacher B" },
  { _id: "teacher-c", name: "Teacher C" },
];

const convert = (overrides) =>
  converter.convertNewCollegeInput({
    classes: baseClasses,
    subjects: baseSubjects,
    teachers: baseTeachers,
    classSubjects: [],
    classTeachers: [],
    teacherSubjectCombos: [],
    labAllocations: [],
    classElectiveSubjects: [],
    ...overrides,
  });

const findClass = (data, classId) => data.classes.find((klass) => klass._id === classId);

function validateDirectTheory() {
  const data = convert({
    classSubjects: [{ classId: "class-a", subjectId: "math", hoursPerWeek: 4 }],
    classTeachers: [{ classId: "class-a", teacherId: "teacher-a" }],
    teacherSubjectCombos: [
      {
        teacherId: "teacher-a",
        subjectId: "math",
        classIds: ["class-a"],
        hoursPerWeek: 4,
      },
    ],
  });

  const mathCombos = data.combos.filter((combo) => combo.subject_id === "math");
  assert(mathCombos.length === 1, `expected one direct theory combo, got ${mathCombos.length}`);
  assert(mathCombos[0].faculty_ids.join(",") === "teacher-a", "direct theory combo should use Teacher A");
  assert(mathCombos[0].class_ids.join(",") === "class-a", "direct theory combo should target class-a");
  assert(mathCombos[0].hours_per_week === 4, "direct theory combo should preserve weekly hours");
  assert(findClass(data, "class-a").subject_hours.math === 4, "class-a should require 4 math hours");
}

function validateDirectElectiveBlock() {
  const data = convert({
    teacherSubjectCombos: [
      {
        type: "ELECTIVE",
        electiveGroupId: "eg-1",
        subjectId: "ai",
        classIds: ["class-a"],
        hoursPerWeek: 3,
        subjectTeacherPairs: [
          { subjectId: "ai", teacherId: "teacher-a" },
          { subjectId: "cloud", teacherId: "teacher-b" },
          { subjectId: "iot", teacherId: "teacher-c" },
        ],
      },
    ],
  });

  const electiveCombos = data.combos.filter((combo) =>
    String(combo.subject_id).startsWith("VIRTUAL_DIRECT_ELECTIVE_")
  );
  assert(electiveCombos.length === 1, `expected one grouped elective combo, got ${electiveCombos.length}`);
  assert(
    electiveCombos[0].faculty_ids.join(",") === "teacher-a,teacher-b,teacher-c",
    "elective combo should occupy all option teachers together"
  );
  assert(electiveCombos[0].hours_per_week === 3, "elective combo should preserve weekly hours");
  assert(!data.combos.some((combo) => ["ai", "cloud", "iot"].includes(combo.subject_id)), "real elective options must not become independent combos");
  const electiveSubjectHours = findClass(data, "class-a").subject_hours;
  assert(Object.keys(electiveSubjectHours).length === 1, "class-a should only require the virtual elective subject");
  assert(Object.values(electiveSubjectHours)[0] === 3, "virtual elective subject should preserve weekly hours");
}

function validateMultiTeacherLab() {
  const data = convert({
    classSubjects: [{ classId: "class-a", subjectId: "dbms-lab", hoursPerWeek: 2 }],
    classTeachers: [
      { classId: "class-a", teacherId: "teacher-a" },
      { classId: "class-a", teacherId: "teacher-b" },
    ],
    labAllocations: [
      {
        classIds: ["class-a"],
        subjectId: "dbms-lab",
        teacherIds: ["teacher-a", "teacher-b"],
        hoursPerWeek: 2,
      },
    ],
  });

  const labCombos = data.combos.filter((combo) => combo.subject_id === "dbms-lab");
  assert(labCombos.length === 1, `expected one lab combo, got ${labCombos.length}`);
  assert(labCombos[0].faculty_ids.join(",") === "teacher-a,teacher-b", "lab combo should include all lab teachers");
  assert(labCombos[0].hours_per_week === 2, "lab combo should preserve weekly hours");
  assert(findClass(data, "class-a").subject_hours["dbms-lab"] === 2, "class-a should require 2 lab hours");
}

function validateCombinedClass() {
  const data = convert({
    classSubjects: [
      { classId: "class-a", subjectId: "math", hoursPerWeek: 4 },
      { classId: "class-b", subjectId: "math", hoursPerWeek: 4 },
    ],
    teacherSubjectCombos: [
      {
        teacherId: "teacher-a",
        subjectId: "math",
        classIds: ["class-a", "class-b"],
        hoursPerWeek: 4,
        combinedClassGroupId: "math-ab",
      },
    ],
  });

  const combined = data.combos.find((combo) => String(combo.subject_id).startsWith("VIRTUAL_COMBINED_"));
  assert(Boolean(combined), "expected combined class combo (virtual)");
  assert(combined.class_ids.join(",") === "class-a,class-b", "combined combo should occupy both classes");
  assert(combined.hours_per_week === 4, "combined combo should preserve weekly hours");
  
  const virtualSub = data.subjects.find(s => String(s._id) === String(combined.subject_id));
  if (!virtualSub) {
    console.log("Available subjects:", data.subjects.map(s => s._id));
    assert(false, `could not find virtual subject with ID ${combined.subject_id}`);
  }
  assert(virtualSub.name.includes("math-ab"), `virtual subject name should include 'math-ab', got ${virtualSub.name}`);
  
  assert(findClass(data, "class-a").subject_hours[combined.subject_id] === 4, "class-a should require virtual math hours");
  assert(findClass(data, "class-b").subject_hours[combined.subject_id] === 4, "class-b should require virtual math hours");
}

function validateNoTeacherSubject() {
  const data = convert({
    classSubjects: [{ classId: "class-a", subjectId: "library", hoursPerWeek: 1 }],
  });

  const libraryCombos = data.combos.filter((combo) => combo.subject_id === "library");
  assert(libraryCombos.length === 1, `expected one no-teacher combo, got ${libraryCombos.length}`);
  assert(Array.isArray(libraryCombos[0].faculty_ids) && libraryCombos[0].faculty_ids.length === 0, "no-teacher combo should have empty faculty_ids");
  assert(libraryCombos[0].hours_per_week === 1, "no-teacher combo should preserve weekly hours");
  assert(findClass(data, "class-a").subject_hours.library === 1, "class-a should require no-teacher hours");
}

function validateExplicitNoTeacher() {
  const data = convert({
    teacherSubjectCombos: [
      {
        teacherId: null,
        subjectId: "library",
        classIds: ["class-a", "class-b"],
        hoursPerWeek: 2,
        combinedClassGroupId: "lib-ab",
      },
    ],
  });

  const combined = data.combos.find((combo) => String(combo.subject_id).startsWith("VIRTUAL_COMBINED_"));
  assert(Boolean(combined), "expected explicit no-teacher combo (virtual)");
  assert(combined.faculty_ids.length === 0, "explicit no-teacher combo should have empty faculty_ids");
  assert(combined.class_ids.join(",") === "class-a,class-b", "explicit no-teacher combo should occupy both classes");
}

function validateNoTeacherInElective() {
  const data = convert({
    teacherSubjectCombos: [
      {
        type: "ELECTIVE",
        electiveGroupId: "eg-nt",
        subjectId: "ai",
        classIds: ["class-a"],
        hoursPerWeek: 3,
        subjectTeacherPairs: [
          { subjectId: "library", teacherId: null }, // library is no_teacher
          { subjectId: "cloud", teacherId: "teacher-b" },
        ],
      },
    ],
  });

  const electiveCombos = data.combos.filter((combo) =>
    String(combo.subject_id).startsWith("VIRTUAL_DIRECT_ELECTIVE_")
  );
  assert(electiveCombos.length === 1, `expected one grouped elective combo, got ${electiveCombos.length}`);
  assert(electiveCombos[0].faculty_ids.join(",") === "teacher-b", "elective combo should only include Teacher B (Library has no teacher)");
}

for (const validate of [
  validateDirectTheory,
  validateDirectElectiveBlock,
  validateMultiTeacherLab,
  validateCombinedClass,
  validateNoTeacherSubject,
  validateExplicitNoTeacher,
  validateNoTeacherInElective,
]) {
  validate();
}

console.log("OK: combo generation");
