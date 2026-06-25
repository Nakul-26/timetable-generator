#!/usr/bin/env node
/**
 * scripts/check-architecture.mjs
 *
 * CI Architecture Guard
 * ---------------------
 * Enforces the banned import list defined in ARCHITECTURE.md.
 *
 * Usage:
 *   node scripts/check-architecture.mjs
 *
 * Exits 1 if any violation is found. Exits 0 if clean.
 *
 * Add to package.json scripts:
 *   "arch:check": "node scripts/check-architecture.mjs"
 *
 * Add to CI (GitHub Actions example):
 *   - run: npm run arch:check
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const BACKEND_ROOT = join(REPO_ROOT, "backend");

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RULES = [
  // ── Banned imports ────────────────────────────────────────────────────────
  {
    id: "NO_TSC_OUTSIDE_ADAPTER",
    description:
      "TeacherSubjectCombination must only be imported inside services/legacy/. " +
      "Do not import it in routes, domain services, or utilities.",
    test: (filePath, content) => {
      // Only flag actual import statements, not comments or string mentions
      if (!/import\s+TeacherSubjectCombination\s+from/.test(content)) return false;
      // Allowed locations
      if (filePath.includes("services/legacy/")) return false;       // the adapter itself
      if (filePath.includes("models/TeacherSubjectCombination")) return false; // the model definition
      if (filePath.includes("scripts/")) return false;               // migration scripts
      if (filePath.includes("seeds/")) return false;                 // seed scripts
      if (filePath.includes("tests/")) return false;                 // test files
      // comboResolver is legacy — flag it so we know it still needs cleanup
      // but treat it as a warning not an error (it's being replaced by assignmentResolver)
      return true;
    },
    severity: "error",
    // Per-file severity overrides: files in active migration get downgraded to warning
    warnInstead: [
      "services/manual-timetable/comboResolver.service.js",  // superseded by assignmentResolver — Phase 4 delete
      "routes/api/class.js",              // cascade delete only — Phase 3
      "routes/api/faculty.js",            // cascade delete only — Phase 3
      "routes/api/subject.js",            // cascade delete only — Phase 3
      "routes/api/teacherSubject.js",     // TSC CRUD — Phase 3 convert to read-only
      "routes/api/teachingAllocation.js", // sync with TSC — Phase 3 remove sync
      "services/export/timetableExport.service.js", // reads TSC for export — Phase 3
      "services/generator/prepareGeneratorData.js",  // reads TSC for derived mode — Phase 4
    ],
  },
  {
    id: "NO_CLASS_SUBJECT_OUTSIDE_ADAPTER",
    description:
      "ClassSubject must only be imported inside services/legacy/ or scripts/",
    test: (filePath, content) =>
      /import\s+ClassSubject\s+from/.test(content) &&
      !filePath.includes("services/legacy/") &&
      !filePath.includes("scripts/") &&
      !filePath.includes("tests/"),
    severity: "warning", // still active in some routes during Phase 3
  },
  {
    id: "NO_ELECTIVE_SETTING_OUTSIDE_ADAPTER",
    description:
      "ElectiveSubjectSetting must only be imported inside services/legacy/ or generator/",
    test: (filePath, content) =>
      /import\s+ElectiveSubjectSetting\s+from/.test(content) &&
      !filePath.includes("services/legacy/") &&
      !filePath.includes("services/generator/") &&
      !filePath.includes("scripts/") &&
      !filePath.includes("tests/"),
    severity: "warning", // still active during Phase 3
  },

  // ── Banned field names (in new code) ────────────────────────────────────
  {
    id: "NO_FACULTY_IDS_FIELD",
    description:
      'The field "faculty_ids" is banned outside generator adapter. Use "teacherIds".',
    test: (filePath, content) =>
      content.includes("faculty_ids") &&
      !filePath.includes("services/generator/") &&
      !filePath.includes("models/lib/") &&
      !filePath.includes("utils/comboNormalizer") &&
      !filePath.includes("scripts/") &&
      !filePath.includes("tests/") &&
      !filePath.includes("prepareGeneratorData"),
    severity: "warning",
  },
  {
    id: "NO_SUBJECT_ID_SNAKE_FIELD",
    description:
      'The field "subject_id" is banned outside generator adapter. Use "subjectId".',
    test: (filePath, content) =>
      content.includes("subject_id") &&
      !filePath.includes("services/generator/") &&
      !filePath.includes("models/lib/") &&
      !filePath.includes("utils/comboNormalizer") &&
      !filePath.includes("scripts/") &&
      !filePath.includes("tests/"),
    severity: "warning",
  },

  // ── Banned patterns ──────────────────────────────────────────────────────
  {
    id: "NO_COMBO_SNAPSHOT_IN_SLOT",
    description:
      "Slot grids must store assignmentId strings, not inline combo objects. Never push a combo object into classTimetable[...][day][hour].",
    test: (_filePath, content) =>
      /classTimetable\[.*\]\[.*\]\[.*\]\s*=\s*\[?\s*\{/.test(content),
    severity: "error",
  },
  {
    id: "NO_TSC_CREATE",
    description:
      "Creating new TeacherSubjectCombination records is banned. Use TeachingAllocation.",
    test: (_filePath, content) =>
      /TeacherSubjectCombination\.(create|insertMany|new TeacherSubjectCombination)/.test(content),
    severity: "error",
    warnInstead: [
      "scripts/seeds/", // historical seed scripts — not new application code
    ],
  },
  {
    id: "NO_MULTI_ALIAS_COMBO_ACCESS",
    description:
      'The pattern "combo.subject?._id || combo.subjectId || combo.subject_id" is banned. Use a single canonical field.',
    test: (_filePath, content) =>
      /subject\??\._id.*\|\|.*subjectId.*\|\|.*subject_id/.test(content) ||
      /subject_id.*\|\|.*subjectId.*\|\|.*subject\??\._id/.test(content),
    severity: "error",
  },
];

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const TARGET_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);

function walkDir(dir, results = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(fullPath, results);
    } else if (TARGET_EXTENSIONS.has(extname(entry))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = walkDir(BACKEND_ROOT);
const violations = [];

for (const filePath of files) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  const relPath = relative(REPO_ROOT, filePath).replace(/\\/g, "/");

  for (const rule of RULES) {
    if (rule.test(relPath, content)) {
      // Check if this file is in the per-file warning override list
      const overrideToWarn =
        Array.isArray(rule.warnInstead) &&
        rule.warnInstead.some((pattern) => relPath.includes(pattern));
      violations.push({
        rule,
        filePath: relPath,
        effectiveSeverity: overrideToWarn ? "warning" : rule.severity,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const errors = violations.filter((v) => v.effectiveSeverity === "error");
const warnings = violations.filter((v) => v.effectiveSeverity === "warning");

if (violations.length === 0) {
  console.log("✅ Architecture check passed — no violations found.");
  process.exit(0);
}

if (warnings.length > 0) {
  console.warn("\n⚠️  Architecture warnings (permitted during migration):");
  for (const v of warnings) {
    console.warn(`  [${v.rule.id}] ${v.filePath}`);
    console.warn(`    → ${v.rule.description}\n`);
  }
}

if (errors.length > 0) {
  console.error("\n🚨 Architecture violations (must fix before merging):");
  for (const v of errors) {
    console.error(`  [${v.rule.id}] ${v.filePath}`);
    console.error(`    → ${v.rule.description}\n`);
  }
  console.error(`\nFound ${errors.length} error(s). Fix these before merging.\n`);
  process.exit(1);
}

// Only warnings — still exit 0 but print a reminder
console.log(
  `\n⚠️  ${warnings.length} warning(s) found. These are expected during migration but must be resolved before Phase 3.\n`
);
process.exit(0);
