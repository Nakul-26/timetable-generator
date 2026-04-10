import runGenerate from "../../models/lib/runGenerator.js"; // Import runGenerate from the correct path

/**
 * Runs the timetable generator.
 * This function MUST be pure (no DB, no side effects).
 */
export async function runGeneration({
  faculties,
  subjects,
  classes,
  combos,
  fixedSlots,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  constraintConfig,
  solutionCount,
  onProgress
}) {
  // Delegate the actual generation to runGenerate which encapsulates the generator.generate call
  return runGenerate({
    faculties,
    subjects,
    classes,
    combos,
    fixedSlots,
    DAYS_PER_WEEK,
    HOURS_PER_DAY,
    constraintConfig,
    solutionCount,
    onProgress
  });
}
