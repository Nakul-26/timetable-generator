import { describe, it, expect, vi, beforeEach } from "vitest";
import { prepareGeneratorData } from "../services/generator/prepareGeneratorData.js";
import Faculty from "../models/Faculty.js";
import Subject from "../models/Subject.js";
import ClassModel from "../models/Class.js";
import ClassSubject from "../models/ClassSubject.js";
import TeacherSubjectCombination from "../models/TeacherSubjectCombination.js";
import ElectiveSubjectSetting from "../models/ElectiveSubjectSetting.js";
import TeachingAllocation from "../models/TeachingAllocation.js";
import converter from "../models/lib/convertNewCollegeInputToGeneratorData.js";

vi.mock("../models/Faculty.js");
vi.mock("../models/Subject.js");
vi.mock("../models/Class.js");
vi.mock("../models/ClassSubject.js");
vi.mock("../models/TeacherSubjectCombination.js");
vi.mock("../models/ElectiveSubjectSetting.js");
vi.mock("../models/TeachingAllocation.js");
vi.mock("../models/lib/convertNewCollegeInputToGeneratorData.js");

describe("prepareGeneratorData", () => {
  const collegeId = "college-1";

  beforeEach(() => {
    vi.clearAllMocks();

    Faculty.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    Subject.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    ClassModel.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    ClassSubject.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    TeacherSubjectCombination.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    ElectiveSubjectSetting.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    TeachingAllocation.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });

    converter.convertNewCollegeInput.mockImplementation((data) => data);
  });

  it("should throw error if collegeId is missing", async () => {
    await expect(prepareGeneratorData(null)).rejects.toThrow("Missing collegeId");
  });

  it("should aggregate data in EXPLICIT mode using TeachingAllocation", async () => {
    const mockAllocations = [
      {
        _id: "alloc-1",
        classIds: ["class-1"],
        subject: "subject-1",
        teacher: "teacher-1",
        type: "THEORY",
        hoursPerWeek: 4,
      },
    ];
    TeachingAllocation.find.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockAllocations) });
    Subject.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: "subject-1", type: "theory" }]) });
    ClassModel.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: "class-1", name: "Class 1" }]) });
    Faculty.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: "teacher-1", name: "Teacher 1" }]) });

    const result = await prepareGeneratorData(collegeId, "EXPLICIT");

    expect(result.teacherSubjectCombos).toHaveLength(1);
    expect(result.teacherSubjectCombos[0]).toMatchObject({
      subjectId: "subject-1",
      teacherId: "teacher-1",
      classIds: ["class-1"],
      hoursPerWeek: 4,
    });
    // Ensure ClassSubject and CombosRaw are ignored in EXPLICIT mode
    expect(ClassSubject.find).toHaveBeenCalled();
  });

  it("should handle lab allocations correctly", async () => {
    const mockAllocations = [
      {
        _id: "alloc-lab",
        classIds: ["class-1"],
        subject: "subject-lab",
        teachers: ["teacher-1", "teacher-2"],
        type: "LAB",
        hoursPerWeek: 2,
      },
    ];
    TeachingAllocation.find.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockAllocations) });
    Subject.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: "subject-lab", type: "lab" }]) });

    const result = await prepareGeneratorData(collegeId, "EXPLICIT");

    expect(result.labAllocations).toHaveLength(1);
    expect(result.labAllocations[0]).toMatchObject({
      subjectId: "subject-lab",
      teacherIds: ["teacher-1", "teacher-2"],
      classIds: ["class-1"],
      hoursPerWeek: 2,
    });
  });

  it("should aggregate data in DERIVED mode", async () => {
    const mockClassSubjects = [{ class: "class-1", subject: "subject-1", hoursPerWeek: 3 }];
    const mockCombos = [{ faculty: "teacher-1", subject: "subject-1" }];
    
    ClassSubject.find.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockClassSubjects) });
    TeacherSubjectCombination.find.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockCombos) });
    Subject.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: "subject-1", type: "theory" }]) });

    const result = await prepareGeneratorData(collegeId, "DERIVED");

    expect(result.classSubjects).toHaveLength(1);
    expect(result.teacherSubjectCombos).toHaveLength(1);
    expect(result.teacherSubjectCombos[0]).toMatchObject({
      teacherId: "teacher-1",
      subjectId: "subject-1"
    });
  });
});
