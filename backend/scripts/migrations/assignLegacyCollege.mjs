import "../env.js";
import mongoose from "mongoose";

import Admin from "../../models/Admin.js";
import Faculty from "../../models/Faculty.js";
import Subject from "../../models/Subject.js";
import ClassModel from "../../models/Class.js";
import ClassSubject from "../../models/ClassSubject.js";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import TeachingAllocation from "../../models/TeachingAllocation.js";
import ElectiveSubjectSetting from "../../models/ElectiveSubjectSetting.js";
import GenerationJob from "../../models/GenerationJob.js";
import TimetableResult from "../../models/TimetableResult.js";

const DEFAULT_COLLEGE_ID = "shreevani-pu-college";
const APPLY = process.argv.includes("--apply");
const collegeIdArgIndex = process.argv.indexOf("--collegeId");
const TARGET_COLLEGE_ID =
  collegeIdArgIndex !== -1 && process.argv[collegeIdArgIndex + 1]
    ? String(process.argv[collegeIdArgIndex + 1]).trim()
    : DEFAULT_COLLEGE_ID;

const DB_NAME = process.env.MONGO_DB_NAME || "timetable_jayanth";
const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("MONGO_URI is not defined");
}

if (!TARGET_COLLEGE_ID) {
  throw new Error("Target collegeId is required.");
}

const collections = [
  { name: "admins", model: Admin },
  { name: "faculties", model: Faculty },
  { name: "subjects", model: Subject },
  { name: "classes", model: ClassModel },
  { name: "classsubjects", model: ClassSubject },
  { name: "teachersubjectcombinations", model: TeacherSubjectCombination },
  { name: "teachingallocations", model: TeachingAllocation },
  { name: "electivesubjectsettings", model: ElectiveSubjectSetting },
  { name: "generationjobs", model: GenerationJob },
  { name: "timetableresults", model: TimetableResult },
];

function buildReportEntry(total, affected) {
  return {
    total,
    wouldUpdate: affected,
    updated: 0,
  };
}

async function main() {
  await mongoose.connect(uri, { dbName: DB_NAME });

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    database: DB_NAME,
    targetCollegeId: TARGET_COLLEGE_ID,
    collections: {},
    totals: {
      documents: 0,
      wouldUpdate: 0,
      updated: 0,
    },
  };

  if (APPLY) {
    try {
      await TimetableResult.collection.dropIndex("collegeId_1_source_generation_job_id_1");
    } catch (error) {
      if (error?.codeName !== "IndexNotFound") {
        throw error;
      }
    }

    await TimetableResult.collection.createIndex(
      { collegeId: 1, source_generation_job_id: 1 },
      {
        unique: true,
        partialFilterExpression: {
          source_generation_job_id: { $type: "string" },
        },
      }
    );

    await TimetableResult.collection.updateMany(
      { source_generation_job_id: null },
      { $unset: { source_generation_job_id: "" } }
    );
  }

  for (const { name, model } of collections) {
    const total = await model.countDocuments({});
    const affected = await model.countDocuments({
      collegeId: { $ne: TARGET_COLLEGE_ID },
    });

    report.collections[name] = buildReportEntry(total, affected);
    report.totals.documents += total;
    report.totals.wouldUpdate += affected;

    if (APPLY && affected > 0) {
      if (name === "timetableresults") {
        const docs = await model
          .find({ collegeId: { $ne: TARGET_COLLEGE_ID } })
          .select("_id source_generation_job_id")
          .lean();

        let updated = 0;
        for (const doc of docs) {
          const update = { $set: { collegeId: TARGET_COLLEGE_ID } };
          if (doc.source_generation_job_id == null) {
            update.$unset = { source_generation_job_id: 1 };
          }
          const result = await model.collection.updateOne({ _id: doc._id }, update);
          updated += Number(result.modifiedCount || 0);
        }

        report.collections[name].updated = updated;
        report.totals.updated += updated;
        continue;
      }

      const result = await model.updateMany(
        { collegeId: { $ne: TARGET_COLLEGE_ID } },
        { $set: { collegeId: TARGET_COLLEGE_ID } }
      );
      report.collections[name].updated = Number(result.modifiedCount || 0);
      report.totals.updated += Number(result.modifiedCount || 0);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error("[assignLegacyCollege] Failed:", error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(1);
});
