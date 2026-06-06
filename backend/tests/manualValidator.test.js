import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateAndSimulateMove } from "../services/manual-timetable/manualValidator.service.js";
import * as slotService from "../services/manual-timetable/slot.service.js";
import * as comboResolver from "../services/manual-timetable/comboResolver.service.js";
import ClassModel from "../models/Class.js";

vi.mock("../services/manual-timetable/slot.service.js");
vi.mock("../services/manual-timetable/comboResolver.service.js");
vi.mock("../models/Class.js");
vi.mock("../utils/timetableManualUtils.js", () => ({
  getTeacherPreferenceWarnings: vi.fn(() => []),
}));

describe("manualValidator - validateAndSimulateMove", () => {
  let state;

  beforeEach(() => {
    vi.clearAllMocks();

    state = {
      collegeId: "college-1",
      config: { hours: 8, days: 5 },
      classTimetable: {
        "class-1": [
          [["combo-1"], [], [], [], [], [], [], []], // Day 0
          [[], [], [], [], [], [], [], []],
          [[], [], [], [], [], [], [], []],
          [[], [], [], [], [], [], [], []],
          [[], [], [], [], [], [], [], []],
        ],
      },
      teacherTimetable: {
        "teacher-1": [
          ["combo-1", null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
          [null, null, null, null, null, null, null, null],
        ],
      },
      combos: [
        {
          _id: "combo-1",
          subject_id: "subject-1",
          faculty_ids: ["teacher-1"],
          class_ids: ["class-1"],
          subject_type: "theory",
        },
      ],
      lockedSlots: {},
      slotSources: {},
    };

    comboResolver.resolveComboFromState.mockImplementation((state, comboId) => {
      const combo = state.combos.find((c) => c._id === comboId);
      if (!combo) return null;
      return {
        _id: combo._id,
        subjectId: combo.subject_id,
        facultyIds: combo.faculty_ids,
        classIds: combo.class_ids,
        subjectType: combo.subject_type,
      };
    });

    ClassModel.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: "class-1", collegeId: "college-1" }]),
    });
  });

  it("should allow moving a lesson to an empty slot", async () => {
    const from = { classId: "class-1", day: 0, hour: 0 };
    const to = { classId: "class-1", day: 0, hour: 1 };

    slotService.clearSlot.mockImplementation(({ state, classId, day, hour }) => {
      state.classTimetable[classId][day][hour] = [];
    });

    slotService.placeCombo.mockImplementation(({ stateOverride, classId, day, hour, comboId }) => {
      stateOverride.classTimetable[classId][day][hour] = [comboId];
    });

    const result = await validateAndSimulateMove({ state, from, to });

    expect(result.allowed).toBe(true);
    expect(result.operation).toBe("move");
    expect(result.newState.classTimetable["class-1"][0][0]).toEqual([]);
    expect(result.newState.classTimetable["class-1"][0][1]).toEqual(["combo-1"]);
  });

  it("should block moving to a break hour", async () => {
    state.constraintConfig = {
      schedule: { breakHours: [2] },
    };
    const from = { classId: "class-1", day: 0, hour: 0 };
    const to = { classId: "class-1", day: 0, hour: 2 };

    const result = await validateAndSimulateMove({ state, from, to });

    expect(result.allowed).toBe(false);
    expect(result.hardViolations).toContain("Cannot place a lesson in a configured break hour.");
  });

  it("should block moving a locked slot", async () => {
    state.lockedSlots = {
      "class-1": [
        [true, false, false, false, false, false, false, false],
      ],
    };
    const from = { classId: "class-1", day: 0, hour: 0 };
    const to = { classId: "class-1", day: 0, hour: 1 };

    const result = await validateAndSimulateMove({ state, from, to });

    expect(result.allowed).toBe(false);
    expect(result.hardViolations).toContain("Source slot is locked.");
  });

  it("should allow swapping two lessons", async () => {
    state.classTimetable["class-1"][0][1] = ["combo-2"];
    state.combos.push({
      _id: "combo-2",
      subject_id: "subject-2",
      faculty_ids: ["teacher-2"],
      class_ids: ["class-1"],
    });

    slotService.clearSlot.mockImplementation(({ state, classId, day, hour }) => {
      state.classTimetable[classId][day][hour] = [];
    });

    slotService.placeCombo.mockImplementation(({ stateOverride, classId, day, hour, comboId }) => {
      stateOverride.classTimetable[classId][day][hour] = [comboId];
    });

    const from = { classId: "class-1", day: 0, hour: 0 };
    const to = { classId: "class-1", day: 0, hour: 1 };

    const result = await validateAndSimulateMove({ state, from, to });

    expect(result.allowed).toBe(true);
    expect(result.operation).toBe("swap");
    expect(result.newState.classTimetable["class-1"][0][0]).toEqual(["combo-2"]);
    expect(result.newState.classTimetable["class-1"][0][1]).toEqual(["combo-1"]);
  });

  it("should block move if it breaks lab block constraint", async () => {
    state.combos[0].subject_type = "lab";
    state.constraintConfig = {
      structural: { labBlockSize: 2 },
    };

    // Mocking placeCombo to not magically fix contiguous blocks if not intended by test setup
    slotService.placeCombo.mockImplementation(({ stateOverride, classId, day, hour, comboId }) => {
      stateOverride.classTimetable[classId][day][hour] = [comboId];
    });

    const from = { classId: "class-1", day: 0, hour: 0 };
    const to = { classId: "class-1", day: 0, hour: 5 }; // Move to hour 5, where it will be isolated

    const result = await validateAndSimulateMove({ state, from, to });

    expect(result.allowed).toBe(false);
    expect(result.hardViolations).toContain("Lab must stay in a 2-hour consecutive block.");
  });

  it("should include soft warnings for teacher continuity", async () => {
    state.constraintConfig = {
      teacherContinuity: { enabled: true, maxConsecutive: 2 },
    };

    // Setup state where moving combo-1 to hour 2 makes teacher-1 have 3 consecutive hours
    // (We need to simulate teacherTimetable in newState)
    slotService.placeCombo.mockImplementation(({ stateOverride, classId, day, hour, comboId }) => {
      stateOverride.classTimetable[classId][day][hour] = [comboId];
      // Simulate teacher timetable update
      const combo = stateOverride.combos.find(c => c._id === comboId);
      combo.faculty_ids.forEach(fId => {
        if (!stateOverride.teacherTimetable[fId]) stateOverride.teacherTimetable[fId] = [[],[],[],[],[]];
        stateOverride.teacherTimetable[fId][day][hour] = comboId;
      });
    });

    // Manually set existing hours for teacher-1
    state.teacherTimetable["teacher-1"][0][0] = "combo-1";
    state.teacherTimetable["teacher-1"][0][1] = "other-combo";
    state.classTimetable["class-1"][0][1] = ["other-combo"];
    state.combos.push({ _id: "other-combo", faculty_ids: ["teacher-1"], class_ids: ["class-1"] });

    const from = { classId: "class-1", day: 0, hour: 0 };
    const to = { classId: "class-1", day: 0, hour: 2 };

    const result = await validateAndSimulateMove({ state, from, to });

    expect(result.allowed).toBe(true);
    expect(result.softWarnings).toContain("Teacher exceeds preferred consecutive limit of 2.");
  });
});
