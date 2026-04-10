export const TIMETABLE_CONSTRAINTS_STORAGE_KEY = "timetable.constraintConfig";

export const DEFAULT_CONSTRAINT_CONFIG = {
  schedule: {
    daysPerWeek: 6,
    hoursPerDay: 8,
    breakHours: [],
  },
  structural: {
    labBlockSize: 2,
    theoryBlockSize: 1,
  },
  weeklySubjectHours: {
    hard: true,
    shortageWeight: 1000,
  },
  noGaps: {
    hard: true,
    weight: 500,
  },
  teacherContinuity: {
    enabled: true,
    maxConsecutive: 3,
    weight: 100,
  },
  classContinuity: {
    enabled: true,
    maxConsecutive: 3,
    weight: 80,
  },
  teacherDailyOverload: {
    enabled: true,
    max: 6,
    weight: 120,
  },
  teacherRecoveryBreak: {
    enabled: false,
    minHours: 1,
    hard: false,
    weight: 140,
  },
  subjectClustering: {
    enabled: true,
    maxPerDay: 3,
    weight: 50,
  },
  subjectDistribution: {
    enabled: false,
    mode: "spread",
    weight: 70,
  },
  highLoadSubjectTiming: {
    enabled: false,
    mode: "early",
    minHoursPerWeek: 4,
    weight: 60,
  },
  frontLoading: {
    enabled: true,
    weight: 400,
    transitionWeight: 400,
    emptyBeforeLaterOccupiedWeight: 400,
    lateSlotWeight: 400,
  },
  teacherAvailability: {
    enabled: false,
    hard: true,
    weight: 250,
    globallyUnavailableSlots: [],
    unavailableSlotsByTeacher: {},
  },
  teacherWeeklyLoadBalance: {
    enabled: false,
    minWeeklyLoad: 0,
    targetWeeklyLoad: 0,
    maxWeeklyLoad: 48,
    hardMin: false,
    hardMax: false,
    underWeight: 40,
    overWeight: 40,
  },
  classDailyMinimumLoad: {
    enabled: false,
    hard: false,
    minPerDay: 1,
    weight: 100,
  },
  teacherBoundaryPreference: {
    enabled: false,
    avoidFirstPeriod: true,
    avoidLastPeriod: true,
    weight: 60,
    teacherOverrides: {},
  },
  solver: {
    timeLimitSec: 180,
    solutionCount: 5,
    maxCandidatesPerCombo: 15,
    earlyAbortNoSolution: true,
    noSolutionAbortRatio: 0.4,
    noSolutionAbortMinSec: 10,
    minTimePerAttemptSec: 15,
    minCandidateDifferenceRatio: 0.02,
  },
};

function safeNum(value, fallback, min = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  return n;
}

function safeInt(value, fallback, min = null) {
  const n = Math.trunc(safeNum(value, fallback, min));
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  return n;
}

function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function normalizeSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  const day = safeInt(slot.day, null, 0);
  const hour = safeInt(slot.hour, null, 0);
  if (!Number.isInteger(day) || !Number.isInteger(hour)) return null;
  return { day, hour };
}

function normalizeSlotArray(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const slot of list) {
    const normalized = normalizeSlot(slot);
    if (!normalized) continue;
    const key = `${normalized.day}|${normalized.hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeSlotMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [teacherIdRaw, slotsRaw] of Object.entries(raw)) {
    const teacherId = String(teacherIdRaw || "").trim();
    if (!teacherId) continue;
    const slots = normalizeSlotArray(slotsRaw);
    if (slots.length > 0) {
      out[teacherId] = slots;
    }
  }
  return out;
}

function normalizeTeacherOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [teacherIdRaw, value] of Object.entries(raw)) {
    const teacherId = String(teacherIdRaw || "").trim();
    if (!teacherId || !value || typeof value !== "object" || Array.isArray(value)) continue;
    out[teacherId] = {
      avoidFirstPeriod: toBool(value.avoidFirstPeriod, DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.avoidFirstPeriod),
      avoidLastPeriod: toBool(value.avoidLastPeriod, DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.avoidLastPeriod),
    };
  }
  return out;
}

export function normalizeConstraintConfig(input = {}) {
  const cfg = input || {};
  const schedule = cfg.schedule || {};
  const structural = cfg.structural || {};
  const weeklySubjectHours = cfg.weeklySubjectHours || {};
  const noGaps = cfg.noGaps || {};
  const teacherContinuity = cfg.teacherContinuity || {};
  const classContinuity = cfg.classContinuity || {};
  const teacherDailyOverload = cfg.teacherDailyOverload || {};
  const teacherRecoveryBreak = cfg.teacherRecoveryBreak || {};
  const subjectClustering = cfg.subjectClustering || {};
  const subjectDistribution = cfg.subjectDistribution || {};
  const highLoadSubjectTiming = cfg.highLoadSubjectTiming || {};
  const frontLoading = cfg.frontLoading || {};
  const teacherAvailability = cfg.teacherAvailability || {};
  const teacherWeeklyLoadBalance = cfg.teacherWeeklyLoadBalance || {};
  const classDailyMinimumLoad = cfg.classDailyMinimumLoad || {};
  const teacherBoundaryPreference = cfg.teacherBoundaryPreference || {};
  const solver = cfg.solver || {};

  const breakHoursRaw = Array.isArray(schedule.breakHours) ? schedule.breakHours : [];
  const breakHours = Array.from(
    new Set(
      breakHoursRaw
        .map((h) => safeInt(h, null))
        .filter((h) => Number.isInteger(h) && h >= 0)
    )
  ).sort((a, b) => a - b);

  return {
    schedule: {
      daysPerWeek: safeInt(schedule.daysPerWeek, DEFAULT_CONSTRAINT_CONFIG.schedule.daysPerWeek, 1),
      hoursPerDay: safeInt(schedule.hoursPerDay, DEFAULT_CONSTRAINT_CONFIG.schedule.hoursPerDay, 1),
      breakHours,
    },
    structural: {
      labBlockSize: safeInt(structural.labBlockSize, DEFAULT_CONSTRAINT_CONFIG.structural.labBlockSize, 1),
      theoryBlockSize: safeInt(
        structural.theoryBlockSize,
        DEFAULT_CONSTRAINT_CONFIG.structural.theoryBlockSize,
        1
      ),
    },
    weeklySubjectHours: {
      hard: toBool(weeklySubjectHours.hard, DEFAULT_CONSTRAINT_CONFIG.weeklySubjectHours.hard),
      shortageWeight: safeInt(
        weeklySubjectHours.shortageWeight,
        DEFAULT_CONSTRAINT_CONFIG.weeklySubjectHours.shortageWeight,
        0
      ),
    },
    noGaps: {
      hard: toBool(noGaps.hard, DEFAULT_CONSTRAINT_CONFIG.noGaps.hard),
      weight: safeInt(noGaps.weight, DEFAULT_CONSTRAINT_CONFIG.noGaps.weight, 0),
    },
    teacherContinuity: {
      enabled: toBool(teacherContinuity.enabled, DEFAULT_CONSTRAINT_CONFIG.teacherContinuity.enabled),
      maxConsecutive: safeInt(
        teacherContinuity.maxConsecutive,
        DEFAULT_CONSTRAINT_CONFIG.teacherContinuity.maxConsecutive,
        1
      ),
      weight: safeInt(teacherContinuity.weight, DEFAULT_CONSTRAINT_CONFIG.teacherContinuity.weight, 0),
    },
    classContinuity: {
      enabled: toBool(classContinuity.enabled, DEFAULT_CONSTRAINT_CONFIG.classContinuity.enabled),
      maxConsecutive: safeInt(
        classContinuity.maxConsecutive,
        DEFAULT_CONSTRAINT_CONFIG.classContinuity.maxConsecutive,
        1
      ),
      weight: safeInt(classContinuity.weight, DEFAULT_CONSTRAINT_CONFIG.classContinuity.weight, 0),
    },
    teacherDailyOverload: {
      enabled: toBool(
        teacherDailyOverload.enabled,
        DEFAULT_CONSTRAINT_CONFIG.teacherDailyOverload.enabled
      ),
      max: safeInt(teacherDailyOverload.max, DEFAULT_CONSTRAINT_CONFIG.teacherDailyOverload.max, 0),
      weight: safeInt(
        teacherDailyOverload.weight,
        DEFAULT_CONSTRAINT_CONFIG.teacherDailyOverload.weight,
        0
      ),
    },
    teacherRecoveryBreak: {
      enabled: toBool(
        teacherRecoveryBreak.enabled,
        DEFAULT_CONSTRAINT_CONFIG.teacherRecoveryBreak.enabled
      ),
      minHours: safeInt(
        teacherRecoveryBreak.minHours,
        DEFAULT_CONSTRAINT_CONFIG.teacherRecoveryBreak.minHours,
        0
      ),
      hard: toBool(
        teacherRecoveryBreak.hard,
        DEFAULT_CONSTRAINT_CONFIG.teacherRecoveryBreak.hard
      ),
      weight: safeInt(
        teacherRecoveryBreak.weight,
        DEFAULT_CONSTRAINT_CONFIG.teacherRecoveryBreak.weight,
        0
      ),
    },
    subjectClustering: {
      enabled: toBool(subjectClustering.enabled, DEFAULT_CONSTRAINT_CONFIG.subjectClustering.enabled),
      maxPerDay: safeInt(subjectClustering.maxPerDay, DEFAULT_CONSTRAINT_CONFIG.subjectClustering.maxPerDay, 1),
      weight: safeInt(subjectClustering.weight, DEFAULT_CONSTRAINT_CONFIG.subjectClustering.weight, 0),
    },
    subjectDistribution: {
      enabled: toBool(
        subjectDistribution.enabled,
        DEFAULT_CONSTRAINT_CONFIG.subjectDistribution.enabled
      ),
      mode:
        String(subjectDistribution.mode || DEFAULT_CONSTRAINT_CONFIG.subjectDistribution.mode).toLowerCase() ===
        "compact"
          ? "compact"
          : "spread",
      weight: safeInt(
        subjectDistribution.weight,
        DEFAULT_CONSTRAINT_CONFIG.subjectDistribution.weight,
        0
      ),
    },
    highLoadSubjectTiming: {
      enabled: toBool(
        highLoadSubjectTiming.enabled,
        DEFAULT_CONSTRAINT_CONFIG.highLoadSubjectTiming.enabled
      ),
      mode:
        String(highLoadSubjectTiming.mode || DEFAULT_CONSTRAINT_CONFIG.highLoadSubjectTiming.mode).toLowerCase() ===
        "late"
          ? "late"
          : "early",
      minHoursPerWeek: safeInt(
        highLoadSubjectTiming.minHoursPerWeek,
        DEFAULT_CONSTRAINT_CONFIG.highLoadSubjectTiming.minHoursPerWeek,
        1
      ),
      weight: safeInt(
        highLoadSubjectTiming.weight,
        DEFAULT_CONSTRAINT_CONFIG.highLoadSubjectTiming.weight,
        0
      ),
    },
    frontLoading: {
      enabled: toBool(frontLoading.enabled, DEFAULT_CONSTRAINT_CONFIG.frontLoading.enabled),
      weight: safeInt(frontLoading.weight, DEFAULT_CONSTRAINT_CONFIG.frontLoading.weight, 0),
      transitionWeight: safeInt(
        frontLoading.transitionWeight,
        frontLoading.weight ?? DEFAULT_CONSTRAINT_CONFIG.frontLoading.transitionWeight,
        0
      ),
      emptyBeforeLaterOccupiedWeight: safeInt(
        frontLoading.emptyBeforeLaterOccupiedWeight,
        frontLoading.weight ?? DEFAULT_CONSTRAINT_CONFIG.frontLoading.emptyBeforeLaterOccupiedWeight,
        0
      ),
      lateSlotWeight: safeInt(
        frontLoading.lateSlotWeight,
        frontLoading.weight ?? DEFAULT_CONSTRAINT_CONFIG.frontLoading.lateSlotWeight,
        0
      ),
    },
    teacherAvailability: {
      enabled: toBool(teacherAvailability.enabled, DEFAULT_CONSTRAINT_CONFIG.teacherAvailability.enabled),
      hard: toBool(teacherAvailability.hard, DEFAULT_CONSTRAINT_CONFIG.teacherAvailability.hard),
      weight: safeInt(teacherAvailability.weight, DEFAULT_CONSTRAINT_CONFIG.teacherAvailability.weight, 0),
      globallyUnavailableSlots: normalizeSlotArray(teacherAvailability.globallyUnavailableSlots),
      unavailableSlotsByTeacher: normalizeSlotMap(teacherAvailability.unavailableSlotsByTeacher),
    },
    teacherWeeklyLoadBalance: {
      enabled: toBool(
        teacherWeeklyLoadBalance.enabled,
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.enabled
      ),
      minWeeklyLoad: safeInt(
        teacherWeeklyLoadBalance.minWeeklyLoad,
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.minWeeklyLoad,
        0
      ),
      targetWeeklyLoad: safeInt(
        teacherWeeklyLoadBalance.targetWeeklyLoad,
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.targetWeeklyLoad,
        0
      ),
      maxWeeklyLoad: safeInt(
        teacherWeeklyLoadBalance.maxWeeklyLoad,
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.maxWeeklyLoad,
        0
      ),
      hardMin: toBool(teacherWeeklyLoadBalance.hardMin, DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.hardMin),
      hardMax: toBool(teacherWeeklyLoadBalance.hardMax, DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.hardMax),
      underWeight: safeInt(
        teacherWeeklyLoadBalance.underWeight,
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.underWeight,
        0
      ),
      overWeight: safeInt(
        teacherWeeklyLoadBalance.overWeight,
        DEFAULT_CONSTRAINT_CONFIG.teacherWeeklyLoadBalance.overWeight,
        0
      ),
    },
    classDailyMinimumLoad: {
      enabled: toBool(
        classDailyMinimumLoad.enabled,
        DEFAULT_CONSTRAINT_CONFIG.classDailyMinimumLoad.enabled
      ),
      hard: toBool(classDailyMinimumLoad.hard, DEFAULT_CONSTRAINT_CONFIG.classDailyMinimumLoad.hard),
      minPerDay: safeInt(
        classDailyMinimumLoad.minPerDay,
        DEFAULT_CONSTRAINT_CONFIG.classDailyMinimumLoad.minPerDay,
        0
      ),
      weight: safeInt(
        classDailyMinimumLoad.weight,
        DEFAULT_CONSTRAINT_CONFIG.classDailyMinimumLoad.weight,
        0
      ),
    },
    teacherBoundaryPreference: {
      enabled: toBool(
        teacherBoundaryPreference.enabled,
        DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.enabled
      ),
      avoidFirstPeriod: toBool(
        teacherBoundaryPreference.avoidFirstPeriod,
        DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.avoidFirstPeriod
      ),
      avoidLastPeriod: toBool(
        teacherBoundaryPreference.avoidLastPeriod,
        DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.avoidLastPeriod
      ),
      weight: safeInt(
        teacherBoundaryPreference.weight,
        DEFAULT_CONSTRAINT_CONFIG.teacherBoundaryPreference.weight,
        0
      ),
      teacherOverrides: normalizeTeacherOverrides(teacherBoundaryPreference.teacherOverrides),
    },
    solver: {
      timeLimitSec: safeInt(solver.timeLimitSec, DEFAULT_CONSTRAINT_CONFIG.solver.timeLimitSec, 1),
      solutionCount: Math.min(
        5,
        safeInt(solver.solutionCount, DEFAULT_CONSTRAINT_CONFIG.solver.solutionCount, 1)
      ),
      maxCandidatesPerCombo: safeInt(
        solver.maxCandidatesPerCombo,
        DEFAULT_CONSTRAINT_CONFIG.solver.maxCandidatesPerCombo,
        1
      ),
      earlyAbortNoSolution: toBool(
        solver.earlyAbortNoSolution,
        DEFAULT_CONSTRAINT_CONFIG.solver.earlyAbortNoSolution
      ),
      noSolutionAbortRatio: Math.min(
        0.95,
        Math.max(
          0,
          safeNum(
            solver.noSolutionAbortRatio,
            DEFAULT_CONSTRAINT_CONFIG.solver.noSolutionAbortRatio
          )
        )
      ),
      noSolutionAbortMinSec: safeNum(
        solver.noSolutionAbortMinSec,
        DEFAULT_CONSTRAINT_CONFIG.solver.noSolutionAbortMinSec,
        1
      ),
      minTimePerAttemptSec: safeNum(
        solver.minTimePerAttemptSec,
        DEFAULT_CONSTRAINT_CONFIG.solver.minTimePerAttemptSec,
        5
      ),
      minCandidateDifferenceRatio: Math.min(
        0.25,
        Math.max(
          0,
          safeNum(
            solver.minCandidateDifferenceRatio,
            DEFAULT_CONSTRAINT_CONFIG.solver.minCandidateDifferenceRatio
          )
        )
      ),
    },
  };
}

export function loadConstraintConfig() {
  if (typeof window === "undefined") return { ...DEFAULT_CONSTRAINT_CONFIG };
  try {
    const raw = window.localStorage.getItem(TIMETABLE_CONSTRAINTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONSTRAINT_CONFIG };
    return normalizeConstraintConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONSTRAINT_CONFIG };
  }
}

export function saveConstraintConfig(config) {
  if (typeof window === "undefined") return;
  const normalized = normalizeConstraintConfig(config);
  window.localStorage.setItem(
    TIMETABLE_CONSTRAINTS_STORAGE_KEY,
    JSON.stringify(normalized)
  );
}
