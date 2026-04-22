import "../env.js";

import mongoose from "mongoose";

import College from "../models/College.js";
import Faculty from "../models/Faculty.js";

const RAW_TEACHER_NAMES = [
  // VI Semester
  "Mrs. Packiya Lekshmi",
  "Dr. Dhanalakshmi B K",
  "Mr. Beerappa",
  "Dr. Nagabhushan SV",
  "Dr. Mohammed Khurram",
  "Mrs. Gowthami C H",
  "Mrs. Manjula SD",
  "Mr. Jagadish P",
  "Mrs. Renita Blossum",
  "Mrs. Anusha KL",
  "Dr. Vinutha K",
  "Prof. Chandini A",
  "Prof. Soujanya S D",
  "Prof. Brunda S",
  "Prof. Bhagyashree P",
  "Prof. Chetan D S",
  "Dr. Muneshwara M.S",
  "Dr. Sagargouda Patil",
  "Prof. Shama M",
  "Prof. Simi Sara",
  "Dr. Jai Arul Jose",
  "Dr. Anil G N",
  "Prof. Ashwini A N",
  "Prof. Belji T",
  "Prof. Tanishq Nanda",
  "Prof. Gururaj P",
  "Dr. Anand R",
  "Prof. Mari Kirthima",
  "Dr. Aruna Kumari B N",
  "Dr. Vidya R Pal",
  "Prof. Sanju DJ",
  "Prof. Varshini",
  "Dr. Ambika G N",
  "Prof. Rajesh NV",
  "Dr. Ravi Hosur",

  // IV Semester
  "Dr. Shankar R",
  "Dr. Ashwini N",
  "Dr. Bharathi R",
  "Mrs. Arpitha S",
  "Ms. Chaitanya V",
  "Mrs. Aruna N",
  "Dr. Karbi Sikadar",
  "Ms. Tresa Maria",
  "Mr. Beerappa Belasakarge",
  "Mr. Mallikarjun Patil",
  "Dr. Kavita B",
  "Mrs. Shilpa M",
  "Mr. Puneetha",
  "Mrs. Gowthami CH",
  "Dr. Sreelaksmi",
  "Prof. Srujana SN",
  "Dr. Durga Bhavani A",
  "Dr. Muneshwara M S",
  "Dr. Gireesh Babu",
  "Dr. Usha B A",
  "Dr. Shoba M",
  "Prof. Yamuna",
  "Dr. Kallur V Vijay Kumar",
  "Dr. Jaya Krishna R",
  "Prof. Shama H M",
  "Prof. Rachna Shah",
  "Dr. Satish Kumar T",
  "Dr. Lakshmi B. N",
  "Dr. Annapoorna M S",
  "Lt. Rani M S",
  "Dr. Shankar Narayana",
  "Prof. Varshini S",
  "Prof. Tanya Chandra",
  "Prof. Umme Kulsum",
  "Dr. Radhika K R",
  "Prof. Nagabarana",
  "Prof. Vishakha Yadav",
  "Prof. Likitha M",
  "Dr. Ravi Kumar B N",
  "Dr. Anitha Kiran",
  "Prof. Rajesh N V",
  "Prof. Neha DS",
  "Prof. Bhavya G",
  "Dr. Savitha S",
  "Dr. Swetha MS",
  "Prof. Durgadevi G Y",
  "Prof. Chaitra DB",
  "Mr. Akshay Arya",
  "Prof. Geetha PL",
  "Prof. Umesh",
  "Prof. Malini M",
  "Dr. Narasimhamurthy S",
  "Prof. S Mahalakshmi",
  "Prof. Maneesha Athikam",
  "Prof. Vinay Kumar Y B",
  "Prof. Chaitanya K R",
  "Dr. Harish Kumar N",
  "Dr. Mohan BA",
  "Prof. Annapareddy Haarika",
  "Dr. Priyanka Pal",
  "Ms. Sanjana V Hunashikatti",
  "Dr. Aruna",
  "Dr. Prakash G.L.",
  "Prof. Saritha A.K.",
  "Prof. Mamatha M",
  "Dr. Varun VL",
  "Prof. Sonnegowda K",
  "Dr. Kalaivani Y",
  "Prof. Rachana",
  "Dr. Geeta Patil",
  "Mr. Pushpanathan G.",
  "Dr. Srinivas B.V.",
  "Dr. Saroj Revankar",
  "Prof. Arnab Panda",
  "Dr. Basavaraj G.N.",
  "Dr. Rakesh N.",
  "Dr. Vishnuvardhan SV",
  "Prof. Chandana",
  "Dr. Chandrashekhar K.T.",
  "Dr. Soumya",

  // II Semester
  "T.K. Seelakshmi",
  "T.K. Sreelakshni G",
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

function stripTitlePrefix(value) {
  const v = String(value || "").trim();
  return v
    .replace(/^(mrs|mr|ms|dr|prof|lt)\.?\s+/i, "")
    .trim();
}

function normalizeNameKey(name) {
  const stripped = stripTitlePrefix(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return stripped;
}

function toIdSlug(name) {
  // Use title-stripped text for the id to keep it stable.
  const base = stripTitlePrefix(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");

  return base;
}

function pickBestDisplayName(a, b) {
  if (!a) return b;
  if (!b) return a;

  // Prefer the longer "information-rich" name (helps merge variants like
  // "Mr. Beerappa" + "Mr. Beerappa Belasakarge").
  const score = (s) => stripTitlePrefix(s).replace(/[^a-z0-9]/gi, "").length;
  const scoreA = score(a);
  const scoreB = score(b);
  if (scoreB > scoreA) return b;
  if (scoreA > scoreB) return a;

  // Tie-breaker: keep the first encountered.
  return a;
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

  // De-dupe by _id in case multiple heuristics matched the same record
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

    const deduped = new Map();
    for (const rawName of RAW_TEACHER_NAMES) {
      const cleaned = String(rawName || "").trim();
      if (!cleaned) continue;

      const key = normalizeNameKey(cleaned);
      if (!key) continue;

      const existing = deduped.get(key);
      deduped.set(key, pickBestDisplayName(existing, cleaned));
    }

    const teachers = Array.from(deduped.values())
      .map((displayName) => {
        const slug = toIdSlug(displayName);
        const id = `t-${slug}`;
        return {
          collegeId: targetCollegeId,
          id,
          name: displayName,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (args.dryRun) {
      console.log(`[DRY RUN] College: ${college.name} (${college.collegeId})`);
      console.log(`[DRY RUN] Would upsert ${teachers.length} faculty records:`);
      for (const t of teachers) {
        console.log(`- ${t.name}  ->  id=${t.id}`);
      }
      return;
    }

    const bulkOps = teachers.map((t) => ({
      updateOne: {
        filter: { collegeId: t.collegeId, id: t.id },
        update: {
          $set: {
            name: t.name,
          },
          $setOnInsert: {
            collegeId: t.collegeId,
            id: t.id,
          },
        },
        upsert: true,
      },
    }));

    const result = await Faculty.bulkWrite(bulkOps, { ordered: false });

    console.log(`College: ${college.name} (${college.collegeId})`);
    console.log(`Teachers requested (unique after normalization): ${teachers.length}`);
    console.log(`Upserted: ${result.upsertedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);
    console.log(`Matched (already existed): ${result.matchedCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("❌ addBmsitTeachers failed:");
  console.error(err?.stack || err);
  process.exitCode = 1;
});
