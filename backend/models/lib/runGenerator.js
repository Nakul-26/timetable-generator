// runGenerator.js
const DEFAULT_SOLVER_URL = process.env.SOLVER_URL || "http://localhost:8001";
const DEFAULT_SOLVER_TIME_LIMIT_SEC = Number(process.env.SOLVER_TIME_LIMIT_SEC || 180);
const DEFAULT_TIMEOUT_MS = Number(
  process.env.SOLVER_TIMEOUT_MS || (DEFAULT_SOLVER_TIME_LIMIT_SEC * 1000 + 30000)
);
const DEFAULT_SOLUTION_COUNT = Math.max(
  1,
  Math.min(5, Number(process.env.GENERATOR_SOLUTION_COUNT || 5))
);
const MIN_SOLVER_TIME_PER_ATTEMPT_SEC = Math.max(
  5,
  Number(process.env.MIN_SOLVER_TIME_PER_ATTEMPT_SEC || 15)
);
const MIN_CANDIDATE_DIFFERENCE_RATIO = Math.min(
  0.25,
  Math.max(0, Number(process.env.MIN_CANDIDATE_DIFFERENCE_RATIO || 0.02))
);

function analyzeClassInternalGaps(classTimetables) {
  let gapCount = 0;

  if (!classTimetables || typeof classTimetables !== "object") {
    return { gapCount: 0 };
  }

  for (const rows of Object.values(classTimetables)) {
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!Array.isArray(row)) continue;

      const teachingSlots = row
        .map((slot, idx) => ({ slot, idx }))
        .filter(
          ({ slot }) =>
            slot !== -1 &&
            slot !== "BREAK" &&
            slot !== null &&
            slot !== undefined
        )
        .map(({ idx }) => idx);

      if (teachingSlots.length <= 1) continue;

      const first = teachingSlots[0];
      const last = teachingSlots[teachingSlots.length - 1];
      for (let h = first + 1; h < last; h++) {
        const slot = row[h];
        if (slot === -1 || slot === null || slot === undefined) {
          gapCount += 1;
        }
      }
    }
  }

  return { gapCount };
}

async function callCpSatSolver({
  faculties,
  subjects,
  classes,
  combos,
  fixedSlots,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  constraintConfig,
  random_seed,
  onProgress,
  progressStart = 0,
  progressEnd = 95,
  stopFlag,
  solverTimeLimitSecOverride,
}) {
  if (stopFlag?.is_set) {
    return {
      ok: false,
      error: "Stopped by user",
      class_timetables: {},
      faculty_timetables: {},
      classes: classes || [],
      config: constraintConfig || {},
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const solverTimeLimitSec =
    Number(solverTimeLimitSecOverride) ||
    Number(constraintConfig?.solver?.timeLimitSec) ||
    DEFAULT_SOLVER_TIME_LIMIT_SEC;
  const expectedMs = Math.max(15_000, Math.round(solverTimeLimitSec * 1000));
  const progressSpan = Math.max(1, progressEnd - progressStart);
  const capBeforeDone = Math.min(99, Math.max(progressStart, progressEnd - 1));
  const startedAt = Date.now();
  let heartbeat = null;

  const emitProgress = (value, phase = "running") => {
    const clamped = Math.max(progressStart, Math.min(capBeforeDone, Math.round(value)));
    onProgress?.({ progress: clamped, phase });
  };

  emitProgress(progressStart, "start");
  heartbeat = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const ratio = Math.min(1, elapsed / expectedMs);
    const eased = 1 - Math.pow(1 - ratio, 2);
    emitProgress(progressStart + eased * progressSpan, "running");
  }, 2000);

  try {
    const res = await fetch(`${DEFAULT_SOLVER_URL}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        faculties,
        subjects,
        classes,
        combos,
        DAYS_PER_WEEK,
        HOURS_PER_DAY,
        fixed_slots: fixedSlots || [],
        constraintConfig,
        random_seed,
        solver_time_limit_sec: solverTimeLimitSec,
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      return {
        ok: false,
        error: data?.error || `Solver HTTP ${res.status}`,
        class_timetables: {},
        faculty_timetables: {},
        classes: classes || [],
        config: constraintConfig || {},
      };
    }

    if (!data.ok) {
      return {
        ok: false,
        error: data.error || "Solver error",
        class_timetables: data.class_timetables || {},
        faculty_timetables: data.faculty_timetables || {},
        classes: data.classes || classes || [],
        unmet_requirements: data.unmet_requirements || [],
        warnings: data.warnings || [],
        config: data.config || constraintConfig || {},
      };
    }

    onProgress?.({
      progress: Math.max(progressStart, Math.min(99, Math.round(progressEnd))),
      phase: "solver_done",
    });

    return {
      ok: true,
      class_timetables: data.class_timetables || {},
      faculty_timetables: data.faculty_timetables || {},
      faculty_daily_hours: data.faculty_daily_hours || null,
      classes: data.classes || classes || [],
      unmet_requirements: data.unmet_requirements || [],
      warnings: data.warnings || [],
      config: data.config || constraintConfig || {},
      allocations_report: data.allocations_report || null,
      solver_stats: data.solver_stats || null,
      objective_value:
        Number.isFinite(Number(data.objective_value)) ? Number(data.objective_value) : null,
    };
  } catch (err) {
    const msg =
      err?.name === "AbortError" ? "Solver timeout" : (err?.message || "Solver request failed");
    return {
      ok: false,
      error: msg,
      class_timetables: {},
      faculty_timetables: {},
      classes: classes || [],
      config: constraintConfig || {},
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}

async function runGenerate({
  faculties,
  subjects,
  classes,
  combos,
  fixedSlots,
  DAYS_PER_WEEK = 6,
  HOURS_PER_DAY = 8,
  constraintConfig = {},
  onProgress,
  attempts = 3,
  solutionCount = DEFAULT_SOLUTION_COUNT,
}) {
  const enforceHardNoGaps =
    constraintConfig?.noGaps?.hard !== undefined
      ? Boolean(constraintConfig.noGaps.hard)
      : String(process.env.ENFORCE_HARD_NO_GAPS || "true").toLowerCase() !== "false";

  let lastError = null;
  let bestPartial = null;
  let bestPartialFilled = -1;
  const generationBatchId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const desiredSolutions = Math.max(1, Math.min(5, Number(solutionCount) || DEFAULT_SOLUTION_COUNT));
  const maxAttempts = Math.max(attempts, desiredSolutions * 2);
  const configuredSolverTimeLimitSec =
    Number(constraintConfig?.solver?.timeLimitSec) || DEFAULT_SOLVER_TIME_LIMIT_SEC;
  const candidates = [];
  const seenTimetableHashes = new Set();
  const generationStartedAt = Date.now();
  let attemptsRun = 0;

  const countFilledSlots = (classTimetables) => {
    if (!classTimetables || typeof classTimetables !== "object") return 0;
    let filled = 0;
    for (const rows of Object.values(classTimetables)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        for (const slot of row) {
          if (slot !== -1 && slot !== "BREAK" && slot !== null && slot !== undefined) {
            filled += 1;
          }
        }
      }
    }
    return filled;
  };

  const stableSerialize = (value) => {
    if (Array.isArray(value)) {
      return value.map(stableSerialize);
    }
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          acc[key] = stableSerialize(value[key]);
          return acc;
        }, {});
    }
    return value;
  };

  const hashTimetable = (classTimetables) => {
    if (!classTimetables || typeof classTimetables !== "object") return "";
    return JSON.stringify(stableSerialize(classTimetables));
  };

  const compareTimetableDifference = (left, right) => {
    const classIds = Array.from(
      new Set([
        ...Object.keys(left || {}),
        ...Object.keys(right || {}),
      ])
    );
    let totalSlots = 0;
    let differentSlots = 0;

    for (const classId of classIds) {
      const leftDays = Array.isArray(left?.[classId]) ? left[classId] : [];
      const rightDays = Array.isArray(right?.[classId]) ? right[classId] : [];
      const dayCount = Math.max(leftDays.length, rightDays.length);
      for (let day = 0; day < dayCount; day++) {
        const leftRow = Array.isArray(leftDays[day]) ? leftDays[day] : [];
        const rightRow = Array.isArray(rightDays[day]) ? rightDays[day] : [];
        const hourCount = Math.max(leftRow.length, rightRow.length);
        for (let hour = 0; hour < hourCount; hour++) {
          const leftValue = leftRow[hour] ?? null;
          const rightValue = rightRow[hour] ?? null;
          totalSlots += 1;
          if (leftValue !== rightValue) {
            differentSlots += 1;
          }
        }
      }
    }

    return { totalSlots, differentSlots };
  };

  const rankCandidates = () =>
    [...candidates].sort((a, b) => {
      const objectiveA = Number.isFinite(a.objectiveValue)
        ? a.objectiveValue
        : (Number.isFinite(a.score) ? a.score : Number.POSITIVE_INFINITY);
      const objectiveB = Number.isFinite(b.objectiveValue)
        ? b.objectiveValue
        : (Number.isFinite(b.score) ? b.score : Number.POSITIVE_INFINITY);
      if (objectiveA !== objectiveB) return objectiveA - objectiveB;
      return a.seed - b.seed;
    });

  const buildOptionLabel = (candidate, index) => {
    if (index === 0) return "Option 1 (Best balanced)";
    if ((candidate.unmet_requirements || []).length === 0 && (candidate.warnings || []).length === 0) {
      return `Option ${index + 1} (Cleanest fit)`;
    }
    if ((candidate.score ?? 0) <= 0) {
      return `Option ${index + 1} (Compact schedule)`;
    }
    if ((candidate.warnings || []).length <= 1) {
      return `Option ${index + 1} (Lower friction)`;
    }
    return `Option ${index + 1} (Alternative)`;
  };

  const buildSelectedResult = (option) => {
    const rankedOptions = rankCandidates().slice(0, desiredSolutions).map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      label: buildOptionLabel(candidate, index),
    }));
    const selectedOption = option || rankedOptions[0] || null;

    return {
      ok: Boolean(selectedOption),
      error: selectedOption ? null : (lastError || "Failed to generate timetable"),
      generation_batch_id: generationBatchId,
      optionsGenerated: rankedOptions.length,
      selected_option_id: selectedOption?.optionId || null,
      score: selectedOption?.score ?? null,
      objectiveValue: selectedOption?.objectiveValue ?? null,
      class_timetables: selectedOption?.class_timetables || null,
      faculty_timetables: selectedOption?.faculty_timetables || null,
      faculty_daily_hours: selectedOption?.faculty_daily_hours || null,
      classes: selectedOption?.classes || null,
      combos: selectedOption?.combos || null,
      config: selectedOption?.config || constraintConfig || {},
      allocations_report: selectedOption?.allocations_report || null,
      unmet_requirements: selectedOption?.unmet_requirements || [],
      warnings: selectedOption?.warnings || [],
      solver_stats: selectedOption?.solver_stats || null,
      attemptsTried: attemptsRun,
      generation_options: rankedOptions,
      bestClassTimetables: selectedOption?.class_timetables || null,
      bestFacultyTimetables: selectedOption?.faculty_timetables || null,
      bestFacultyDailyHours: selectedOption?.faculty_daily_hours || null,
      bestScore: selectedOption?.score ?? null,
    };
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const elapsedSec = (Date.now() - generationStartedAt) / 1000;
    const remainingBudgetSec = configuredSolverTimeLimitSec - elapsedSec;
    if (remainingBudgetSec <= 0) {
      lastError = "Solver time budget exhausted";
      break;
    }
    const remainingAttempts = maxAttempts - attempt;
    const perAttemptTimeLimitSec = Math.max(
      MIN_SOLVER_TIME_PER_ATTEMPT_SEC,
      Math.min(
        configuredSolverTimeLimitSec / Math.max(1, desiredSolutions),
        remainingBudgetSec / Math.max(1, remainingAttempts)
      )
    );
    if (perAttemptTimeLimitSec > remainingBudgetSec) {
      break;
    }
    const progressStart = Math.floor((attempt * 95) / Math.max(1, maxAttempts));
    const progressEnd = Math.floor(((attempt + 1) * 95) / Math.max(1, maxAttempts));
    const shuffledClasses = [...classes];
    const shuffledCombos = [...combos];
    const shuffledFaculties = [...faculties];
    const shuffledSubjects = [...subjects];
    const seed = attempt + 1;
    attemptsRun += 1;

    const result = await callCpSatSolver({
      faculties: shuffledFaculties,
      subjects: shuffledSubjects,
      classes: shuffledClasses,
      combos: shuffledCombos,
      fixedSlots,
      DAYS_PER_WEEK,
      HOURS_PER_DAY,
      constraintConfig,
      random_seed: seed,
      onProgress,
      progressStart,
      progressEnd,
      solverTimeLimitSecOverride: perAttemptTimeLimitSec,
    });

    if (!result.ok) {
      lastError = result.error || "Unknown generator failure";
      const partialFilled = countFilledSlots(result.class_timetables);
      if (partialFilled > bestPartialFilled) {
        bestPartialFilled = partialFilled;
        bestPartial = {
          class_timetables: result.class_timetables || {},
          faculty_timetables: result.faculty_timetables || {},
          classes: result.classes || shuffledClasses,
          combos: shuffledCombos,
          config: result.config || constraintConfig || {},
          unmet_requirements: result.unmet_requirements || [],
          warnings: result.warnings || [],
        };
      }
      if (process.env.NODE_ENV !== "production") {
        console.log(`Attempt ${attempt + 1}: Failed to generate - ${lastError}`);
      }
      continue;
    }

    const { gapCount } = analyzeClassInternalGaps(result.class_timetables);
    if (enforceHardNoGaps && gapCount > 0) {
      lastError = `Generated timetable has ${gapCount} internal class gaps`;
      if (process.env.NODE_ENV !== "production") {
        console.log(`Attempt ${attempt + 1}: Rejected due to gaps (${gapCount})`);
      }
      continue;
    }

    const score = gapCount;
    const objectiveValue =
      Number.isFinite(Number(result.objective_value)) ? Number(result.objective_value) : score;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `Attempt ${attempt + 1}: Score = ${score}, Objective = ${objectiveValue}`
      );
    }

    const timetableHash = hashTimetable(result.class_timetables);
    if (!timetableHash || seenTimetableHashes.has(timetableHash)) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`Attempt ${attempt + 1}: Duplicate timetable skipped`);
      }
      continue;
    }

    const isTooSimilar = candidates.some((candidate) => {
      const { totalSlots, differentSlots } = compareTimetableDifference(
        candidate.class_timetables,
        result.class_timetables
      );
      if (totalSlots <= 0) return false;
      return differentSlots < Math.max(3, Math.floor(totalSlots * MIN_CANDIDATE_DIFFERENCE_RATIO));
    });
    if (isTooSimilar) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`Attempt ${attempt + 1}: Near-duplicate timetable skipped`);
      }
      continue;
    }

    seenTimetableHashes.add(timetableHash);
    candidates.push({
      optionId: `${generationBatchId}_opt_${candidates.length + 1}`,
      seed,
      score,
      objectiveValue,
      class_timetables: result.class_timetables,
      faculty_timetables: result.faculty_timetables,
      faculty_daily_hours: result.faculty_daily_hours,
      classes: result.classes,
      combos: shuffledCombos,
      config: result.config || constraintConfig || {},
      allocations_report: result.allocations_report,
      unmet_requirements: result.unmet_requirements || [],
      warnings: result.warnings || [],
      solver_stats: result.solver_stats || null,
    });

    onProgress?.({
      progress: Math.max(progressStart, Math.min(99, Math.round(progressEnd))),
      phase: "candidate_ready",
      partialData: buildSelectedResult(rankCandidates()[0] || null),
    });

    if (candidates.length >= desiredSolutions) {
      break;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const bestCandidate = rankCandidates()[0] || null;
    if (bestCandidate) {
      console.log("Best timetable found. Score:", bestCandidate.score);
    } else {
      console.error("Could not generate a valid timetable.", lastError ? `Last error: ${lastError}` : "");
    }
  }

  if (!candidates.length && (!bestPartial || bestPartialFilled <= 0)) {
    bestPartial = null;
  }

  onProgress?.({ progress: 100, phase: "done" });

  return buildSelectedResult(rankCandidates()[0] || null);
}

export default runGenerate;
