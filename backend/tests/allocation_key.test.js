import { describe, it, expect } from "vitest";
import { buildTeachingAllocationKey } from "../utils/allocationKey.js";

describe("Allocation Key Generation", () => {
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

  it("should be stable across ordering and duplicate input ids", () => {
    expect(buildTeachingAllocationKey(base)).toBe(buildTeachingAllocationKey(reordered));
  });

  it("should change when teacher assignments change", () => {
    expect(buildTeachingAllocationKey(base)).not.toBe(buildTeachingAllocationKey(changedTeacher));
  });

  it("should include combined group", () => {
    expect(buildTeachingAllocationKey({ ...base, combinedClassGroupId: "group-2" })).not.toBe(buildTeachingAllocationKey(base));
  });

  it("should include allocation type", () => {
    expect(buildTeachingAllocationKey({ ...base, type: "LAB" })).not.toBe(buildTeachingAllocationKey(base));
  });

  it("should not duplicate composite elective subject ids", () => {
    const key = buildTeachingAllocationKey({
      ...base,
      subjectId: "ai+cloud",
    });
    expect(key).toContain("subjects=ai+cloud|");
  });
});
