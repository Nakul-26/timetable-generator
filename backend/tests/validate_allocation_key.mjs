import { buildTeachingAllocationKey } from "../utils/allocationKey.js";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const base = {
  collegeId: "college-1",
  type: "ELECTIVE",
  classIds: ["class-b", "class-a", "class-a"],
  subjectId: "ai",
  teacherIds: ["teacher-b", "teacher-a"],
  subjects: [
    { subject: "cloud", teacher: "teacher-b" },
    { subject: "ai", teacher: "teacher-a" },
  ],
  combinedClassGroupId: "group-1",
  electiveGroupId: "elective-1",
};

const reordered = {
  ...base,
  classIds: ["class-a", "class-b"],
  teacherIds: ["teacher-a", "teacher-b"],
  subjects: [
    { subject: "ai", teacher: "teacher-a" },
    { subject: "cloud", teacher: "teacher-b" },
  ],
};

const changedTeacher = {
  ...reordered,
  teacherIds: ["teacher-a", "teacher-c"],
  subjects: [
    { subject: "ai", teacher: "teacher-a" },
    { subject: "cloud", teacher: "teacher-c" },
  ],
};

assert(
  buildTeachingAllocationKey(base) === buildTeachingAllocationKey(reordered),
  "allocation key should be stable across ordering and duplicate input ids"
);
assert(
  buildTeachingAllocationKey(base) !== buildTeachingAllocationKey(changedTeacher),
  "allocation key should change when teacher assignments change"
);
assert(
  buildTeachingAllocationKey({ ...base, combinedClassGroupId: "group-2" }) !== buildTeachingAllocationKey(base),
  "allocation key should include combined group"
);
assert(
  buildTeachingAllocationKey({ ...base, type: "LAB" }) !== buildTeachingAllocationKey(base),
  "allocation key should include allocation type"
);
assert(
  buildTeachingAllocationKey({
    ...base,
    subjectId: "ai+cloud",
  }).includes("subjects=ai+cloud|"),
  "allocation key should not duplicate composite elective subject ids"
);

console.log("OK: allocation key");
