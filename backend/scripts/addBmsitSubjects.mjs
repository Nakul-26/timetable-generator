import "../env.js";

import mongoose from "mongoose";

import College from "../models/College.js";
import ClassSubject from "../models/ClassSubject.js";
import Subject from "../models/Subject.js";
import TeacherSubjectCombination from "../models/TeacherSubjectCombination.js";

// Detailed breakdown from your 2025-2026 timetables.
// NOTE: Subject model requires: { collegeId, id, name, sem, type }.
// Allowed types are: theory | lab | no_teacher
const RAW_SUBJECTS = [
  // VI Semester (EVEN)
  {
    sem: 6,
    name: "Cloud Computing",
    code: "BCS601",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 6,
    name: "Machine Learning",
    code: "BCS602",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 6,
    name: "Compiler Design",
    code: "BCS603",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 6,
    name: "Machine Learning Lab",
    code: "BCSL607",
    subjectType: "Lab",
    isElective: false,
  },
  {
    sem: 6,
    name: "Advanced Cyber Security",
    code: "BCS604A",
    subjectType: "Theory",
    isElective: true,
  },
  {
    sem: 6,
    name: "Full Stack Development",
    code: "BCS604C",
    subjectType: "Theory",
    isElective: true,
  },
  {
    sem: 6,
    name: "Generative AI",
    code: "BCS608A",
    subjectType: "Theory/Skill",
    isElective: true,
  },
  {
    sem: 6,
    name: "DevOps",
    code: "BCS608C",
    subjectType: "Theory/Skill",
    isElective: true,
  },
  {
    sem: 6,
    name: "Indian Knowledge System",
    code: "BIKS610",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 6,
    name: "Major Project Phase - I",
    code: "BCS605",
    subjectType: "Project",
    isElective: false,
  },
  {
    sem: 6,
    name: "Career Readiness Course",
    code: "CRC",
    subjectType: "Training",
    isElective: false,
  },

  // IV Semester (EVEN)
  {
    sem: 4,
    name: "Analysis & Design of Algorithms",
    code: "BCS401",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 4,
    name: "Microcontrollers",
    code: "BCS402",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 4,
    name: "Database Management Systems",
    code: "BCS403",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 4,
    name: "ADA Lab",
    code: "BCSL404",
    subjectType: "Lab",
    isElective: false,
  },
  {
    sem: 4,
    name: "Discrete Mathematical Structures",
    code: "BCS405A",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 4,
    name: "Biology For IT",
    code: "BBOC407",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 4,
    name: "Universal Human Values",
    code: "BUHK408",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 4,
    name: "Advanced Programming (C++)",
    code: "BCS456E",
    subjectType: "Lab/Skill",
    isElective: true,
  },
  {
    sem: 4,
    name: "Introduction to JAVA",
    code: "BCS456F",
    subjectType: "Lab/Skill",
    isElective: true,
  },
  {
    sem: 4,
    name: "Career Readiness Course",
    code: "CRC",
    subjectType: "Training",
    isElective: false,
  },

  // II Semester (EVEN)
  {
    sem: 2,
    name: "Ordinary Diff. Equations (MAT)",
    code: "1BMATCS201",
    subjectType: "Theory/Tutorial",
    isElective: false,
  },
  {
    sem: 2,
    name: "Physics of Quantum Computing",
    code: "1BPHYCS202",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 2,
    name: "Chemistry of Smart Materials",
    code: "1BCHECS102",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 2,
    name: "Engineering Drawing (CAED)",
    code: "1BCEDCS203",
    subjectType: "Theory/Lab",
    isElective: false,
  },
  {
    sem: 2,
    name: "Intro to Electronics Engg",
    code: "1BESC204B",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 2,
    name: "Programming in C (PSC)",
    code: "1BPIC205",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 2,
    name: "Python Programming (PLC)",
    code: "1BPLC205B",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 2,
    name: "Intro to AI & Applications",
    code: "1BA1203",
    subjectType: "Theory",
    isElective: false,
  },
  {
    sem: 2,
    name: "Interdisciplinary Project",
    code: "1BPRJ208",
    subjectType: "Project",
    isElective: false,
  },
];

function parseArgs(argv) {
  const args = {
    collegeId: null,
    code: null,
    name: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }

    if (raw === "--collegeId") {
      args.collegeId = value;
      i += 1;
    } else if (raw === "--code") {
      args.code = value;
      i += 1;
    } else if (raw === "--name") {
      args.name = value;
      i += 1;
    }
  }

  return args;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeSubjectCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code.replace(/^I/, "1");
}

function mapSubjectType(subjectType) {
  const raw = String(subjectType || "").trim().toLowerCase();

  if (!raw) return "theory";
  if (raw.includes("lab")) return "lab";

  // In this system, these can exist without teacher assignment.
  if (raw.includes("training") || raw.includes("project")) return "no_teacher";

  return "theory";
}

async function resolveCollege({ collegeId, code, name }) {
  const queries = [];

  if (collegeId) {
    queries.push({ collegeId: String(collegeId).trim().toLowerCase() });
  }

  if (code) {
    queries.push({ code: String(code).trim().toUpperCase() });
  }

  if (name) {
    queries.push({ name: new RegExp(String(name).trim(), "i") });
  }

  // Default BMSIT heuristics
  queries.push({ collegeId: "bmsit" });
  queries.push({ code: "BMSIT" });
  queries.push({ name: /bmsit/i });

  const colleges = await College.find({ $or: queries }).lean();

  const unique = new Map(colleges.map((c) => [String(c._id), c]));
  const list = Array.from(unique.values());

  if (list.length === 0) {
    throw new Error(
      "BMSIT college not found. Provide --collegeId/--code, or create it via /api/superadmin/colleges."
    );
  }

  if (list.length > 1) {
    const choices = list
      .map((c) => `- _id=${c._id} collegeId=${c.collegeId} code=${c.code} name=${c.name}`)
      .join("\n");
    throw new Error(
      `Multiple colleges matched. Re-run with --collegeId or --code to disambiguate:\n${choices}`
    );
  }

  return list[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not defined");
  }

  const dbName = process.env.MONGO_DB_NAME || "timetable_jayanth";

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 20000,
  });

  try {
    const college = await resolveCollege(args);
    const targetCollegeId = String(college.collegeId);

    // First pass: normalize/dedupe by (sem + code)
    const byKey = new Map();
    for (const entry of RAW_SUBJECTS) {
      const sem = Number(entry.sem);
      const code = normalizeSubjectCode(entry.code);
      const name = String(entry.name || "").trim();
      if (!sem || !code || !name) continue;

      const key = `${sem}|${normalizeKey(code)}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          sem,
          code,
          name,
          subjectType: entry.subjectType,
          isElective: Boolean(entry.isElective),
        });
      }
    }

    const deduped = Array.from(byKey.values());

    // Second pass: ensure unique ids within the college.
    // Some official codes (e.g. CRC) appear across semesters.
    // Since this DB enforces unique (collegeId, id), we suffix duplicates.
    const usedIds = new Map();
    const subjects = deduped
      .sort((a, b) => (a.sem - b.sem) || a.name.localeCompare(b.name))
      .map((s) => {
        const canonical = normalizeSubjectCode(s.code);
        let id = canonical;
        if (usedIds.has(id)) {
          id = `${canonical}-S${s.sem}`;
        }
        usedIds.set(id, 1);

        return {
          collegeId: targetCollegeId,
          id,
          name: s.name,
          sem: s.sem,
          type: mapSubjectType(s.subjectType),
          isElective: Boolean(s.isElective),
        };
      });

    const existingSubjects = await Subject.find({ collegeId: targetCollegeId }).lean();
    const existingById = new Map(
      existingSubjects.map((subject) => [String(subject.id || "").trim().toUpperCase(), subject])
    );
    const existingBySemAndName = new Map(
      existingSubjects.map((subject) => [
        `${Number(subject.sem)}|${normalizeKey(subject.name)}`,
        subject,
      ])
    );

    if (args.dryRun) {
      console.log(`[DRY RUN] College: ${college.name} (${college.collegeId})`);
      console.log(`[DRY RUN] Would upsert ${subjects.length} subject records:`);
      for (const s of subjects) {
        console.log(
          `- sem=${s.sem} type=${s.type} elective=${s.isElective ? "yes" : "no"  }  id=${s.id}  name=${s.name}`
        );
      }
      return;
    }

    const bulkOps = subjects.map((s) => {
      const existingExact = existingById.get(String(s.id).trim().toUpperCase());
      const existingByName = existingBySemAndName.get(`${s.sem}|${normalizeKey(s.name)}`);
      const existing = existingExact || existingByName;

      if (existing) {
        return {
          updateOne: {
            filter: { _id: existing._id, collegeId: s.collegeId },
            update: {
              $set: {
                id: s.id,
                name: s.name,
                sem: s.sem,
                type: s.type,
                isElective: Boolean(s.isElective),
              },
            },
          },
        };
      }

      return {
        updateOne: {
          filter: { collegeId: s.collegeId, id: s.id },
          update: {
            $set: {
              name: s.name,
              sem: s.sem,
              type: s.type,
              isElective: Boolean(s.isElective),
            },
            $setOnInsert: {
              collegeId: s.collegeId,
              id: s.id,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await Subject.collection.bulkWrite(bulkOps, { ordered: false });

    const refreshedSubjects = await Subject.find({ collegeId: targetCollegeId }).lean();
    const canonicalBySemAndName = new Map(
      refreshedSubjects
        .filter((subject) => !String(subject.id || "").trim().toUpperCase().startsWith("I"))
        .map((subject) => [
          `${Number(subject.sem)}|${normalizeKey(subject.name)}`,
          subject,
        ])
    );

    const legacySubjects = refreshedSubjects.filter((subject) =>
      String(subject.id || "").trim().toUpperCase().startsWith("I")
    );

    let deletedLegacyCount = 0;
    for (const legacy of legacySubjects) {
      const key = `${Number(legacy.sem)}|${normalizeKey(legacy.name)}`;
      const replacement = canonicalBySemAndName.get(key);
      if (!replacement) continue;

      const [classRefCount, comboRefCount] = await Promise.all([
        ClassSubject.countDocuments({ collegeId: targetCollegeId, subject: legacy._id }),
        TeacherSubjectCombination.countDocuments({ collegeId: targetCollegeId, subject: legacy._id }),
      ]);

      if (classRefCount > 0 || comboRefCount > 0) {
        continue;
      }

      const deleteResult = await Subject.deleteOne({ _id: legacy._id, collegeId: targetCollegeId });
      deletedLegacyCount += deleteResult.deletedCount || 0;
    }

    console.log(`College: ${college.name} (${college.collegeId})`);
    console.log(`Subjects requested (unique after normalization): ${subjects.length}`);
    console.log(`Upserted: ${result.upsertedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);
    console.log(`Matched (already existed): ${result.matchedCount}`);
    console.log(`Deleted legacy I* duplicates: ${deletedLegacyCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("❌ addBmsitSubjects failed:");
  console.error(err?.stack || err);
  process.exitCode = 1;
});
