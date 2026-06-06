import { describe, it, expect } from "vitest";
import { buildConstraintHealthReport } from "../services/generator/healthCheck.service.js";

describe("healthCheck.service - buildConstraintHealthReport", () => {
  const defaultFaculties = [{ _id: "teacher-1", name: "Teacher 1" }];
  const defaultSubjects = [{ _id: "subject-1", name: "Subject 1", no_of_hours_per_week: 4 }];
  const defaultClasses = [{
    _id: "class-1",
    name: "Class 1",
    days_per_week: 5,
    subject_hours: { "subject-1": 4 },
    assigned_teacher_subject_combos: ["combo-1"],
  }];
  const defaultCombos = [{
    _id: "combo-1",
    subject_id: "subject-1",
    faculty_id: "teacher-1",
    class_ids: ["class-1"],
  }];
  const defaultConstraintConfig = {
    schedule: { daysPerWeek: 5, hoursPerDay: 8, breakHours: [4] },
  };

  it("should return ok: true for a valid configuration", () => {
    const report = buildConstraintHealthReport({
      faculties: defaultFaculties,
      subjects: defaultSubjects,
      classes: defaultClasses,
      combos: defaultCombos,
      constraintConfig: defaultConstraintConfig,
    });

    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it("should detect class over-capacity", () => {
    const classes = [{
      ...defaultClasses[0],
      subject_hours: { "subject-1": 40 }, // 40 hours > 5 days * 7 hours (1 break) = 35 capacity
    }];

    const report = buildConstraintHealthReport({
      faculties: defaultFaculties,
      subjects: defaultSubjects,
      classes,
      combos: defaultCombos,
      constraintConfig: defaultConstraintConfig,
    });

    expect(report.ok).toBe(false);
    expect(report.warnings.some(w => w.type === "class_over_capacity")).toBe(true);
  });

  it("should detect missing subject coverage", () => {
    const classes = [{
      ...defaultClasses[0],
      subject_hours: { "subject-1": 4, "subject-2": 2 },
    }];
    const subjects = [
        ...defaultSubjects,
        { _id: "subject-2", name: "Subject 2" }
    ];

    const report = buildConstraintHealthReport({
      faculties: defaultFaculties,
      subjects,
      classes,
      combos: defaultCombos, // Missing combo for subject-2
      constraintConfig: defaultConstraintConfig,
    });

    expect(report.ok).toBe(false);
    expect(report.warnings.some(w => w.type === "missing_coverage")).toBe(true);
  });

  it("should detect teacher forced overload", () => {
    const classes = [
        { ...defaultClasses[0], _id: "class-1", subject_hours: { "subject-1": 30 } },
        { ...defaultClasses[0], _id: "class-2", subject_hours: { "subject-1": 30 } },
    ];
    // Both classes force teacher-1 to take 30 hours each = 60 hours > 35 capacity
    const combos = [
        { _id: "combo-1", subject_id: "subject-1", faculty_id: "teacher-1", class_ids: ["class-1"] },
        { _id: "combo-2", subject_id: "subject-1", faculty_id: "teacher-1", class_ids: ["class-2"] },
    ];

    const report = buildConstraintHealthReport({
      faculties: defaultFaculties,
      subjects: defaultSubjects,
      classes,
      combos,
      constraintConfig: defaultConstraintConfig,
    });

    expect(report.ok).toBe(false);
    expect(report.warnings.some(w => w.type === "teacher_forced_overload")).toBe(true);
  });
});
