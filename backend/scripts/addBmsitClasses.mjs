import "../env.js";

import mongoose from "mongoose";

import College from "../models/College.js";
import ClassModel from "../models/Class.js";

const RAW_CLASSES = [
  // VI Semester (EVEN)
  { sem: 6, id: "VI-A", name: "VI-A", section: "A" },
  { sem: 6, id: "VI-B", name: "VI-B", section: "B" },
  { sem: 6, id: "VI-C", name: "VI-C", section: "C" },
  { sem: 6, id: "VI-D", name: "VI-D", section: "D" },

  // IV Semester (EVEN)
  { sem: 4, id: "IV-A", name: "IV-A", section: "A" },
  { sem: 4, id: "IV-B", name: "IV-B", section: "B" },
  { sem: 4, id: "IV-C", name: "IV-C", section: "C" },

  { sem: 4, id: "IV-D", name: "IV-D", section: "D" },
  { sem: 4, id: "IV-E", name: "IV-E", section: "E" },
  { sem: 4, id: "IV-F", name: "IV-F", section: "F" },

  // These are labeled as IV/SEC-7..9 in your docs, corresponding to sections G,H,I
  { sem: 4, id: "IV-SEC-7", name: "IV-SEC-7", section: "G/SEC-7" },
  { sem: 4, id: "IV-SEC-8", name: "IV-SEC-8", section: "H/SEC-8" },
  { sem: 4, id: "IV-SEC-9", name: "IV-SEC-9", section: "I/SEC-9" },

  { sem: 4, id: "IV-J", name: "IV-J", section: "J" },
  { sem: 4, id: "IV-K", name: "IV-K", section: "K" },
  { sem: 4, id: "IV-L", name: "IV-L", section: "L" },

  { sem: 4, id: "IV-M", name: "IV-M", section: "M" },
  { sem: 4, id: "IV-N", name: "IV-N", section: "N" },
  { sem: 4, id: "IV-O", name: "IV-O", section: "O" },

  // II Semester
  // Physics Group: CSE-1..CSE-13
  ...Array.from({ length: 13 }, (_, idx) => {
    const n = idx + 1;
    return { sem: 2, id: `CSE-${n}`, name: `CSE-${n}`, section: String(n) };
  }),

  // Chemistry Group: CSE-14..CSE-15
  { sem: 2, id: "CSE-14", name: "CSE-14", section: "14" },
  { sem: 2, id: "CSE-15", name: "CSE-15", section: "15" },
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
    .replace(/[^a-z0-9]+/g, "")
    .trim();
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

    const byId = new Map();
    for (const c of RAW_CLASSES) {
      const sem = Number(c.sem);
      const id = String(c.id || "").trim();
      const name = String(c.name || "").trim();
      const section = String(c.section || "").trim();
      if (!sem || !id || !name || !section) continue;

      const key = normalizeKey(id);
      if (!byId.has(key)) {
        byId.set(key, {
          collegeId: targetCollegeId,
          id,
          name,
          section,
          sem,
        });
      }
    }

    const classes = Array.from(byId.values()).sort(
      (a, b) => (a.sem - b.sem) || a.id.localeCompare(b.id)
    );

    if (args.dryRun) {
      console.log(`[DRY RUN] College: ${college.name} (${college.collegeId})`);
      console.log(`[DRY RUN] Would upsert ${classes.length} class records:`);
      for (const c of classes) {
        console.log(`- sem=${c.sem} id=${c.id} name=${c.name} section=${c.section}`);
      }
      return;
    }

    const bulkOps = classes.map((c) => ({
      updateOne: {
        filter: { collegeId: c.collegeId, id: c.id },
        update: {
          $set: {
            name: c.name,
            section: c.section,
            sem: c.sem,
          },
          $setOnInsert: {
            collegeId: c.collegeId,
            id: c.id,
          },
        },
        upsert: true,
      },
    }));

    const result = await ClassModel.bulkWrite(bulkOps, { ordered: false });

    console.log(`College: ${college.name} (${college.collegeId})`);
    console.log(`Classes requested (unique after normalization): ${classes.length}`);
    console.log(`Upserted: ${result.upsertedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);
    console.log(`Matched (already existed): ${result.matchedCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("❌ addBmsitClasses failed:");
  console.error(err?.stack || err);
  process.exitCode = 1;
});
