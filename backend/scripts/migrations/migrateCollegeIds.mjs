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

const APPLY = process.argv.includes("--apply");
const DB_NAME = process.env.MONGO_DB_NAME || "timetable_jayanth";
const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("MONGO_URI is not defined");
}

function isMissingCollegeId(value) {
  return !value || String(value).trim() === "" || String(value).trim() === "default";
}

function docId(doc) {
  return String(doc?._id || "");
}

function pushIssue(report, collection, issue) {
  report.collections[collection].issues.push(issue);
  report.totals.issues += 1;
}

function pushFix(report, collection, fix) {
  report.collections[collection].fixes.push(fix);
  report.totals.fixable += 1;
}

async function applyUpdate(Model, id, update, report, collection) {
  if (!APPLY) return;
  await Model.updateOne({ _id: id }, update);
  report.collections[collection].updated += 1;
  report.totals.updated += 1;
}

function createCollectionReport() {
  return {
    scanned: 0,
    updated: 0,
    fixes: [],
    issues: [],
  };
}

async function main() {
  await mongoose.connect(uri, { dbName: DB_NAME });

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    database: DB_NAME,
    totals: {
      issues: 0,
      fixable: 0,
      updated: 0,
    },
    collections: {
      admins: createCollectionReport(),
      faculties: createCollectionReport(),
      subjects: createCollectionReport(),
      classes: createCollectionReport(),
      classsubjects: createCollectionReport(),
      teachersubjectcombinations: createCollectionReport(),
      teachingallocations: createCollectionReport(),
      electivesubjectsettings: createCollectionReport(),
      generationjobs: createCollectionReport(),
      timetableresults: createCollectionReport(),
    },
  };

  const admins = await Admin.find({}).select("_id collegeId email").lean();
  const adminCollegeById = new Map(admins.map((doc) => [docId(doc), String(doc.collegeId || "")]));

  const faculties = await Faculty.find({}).select("_id collegeId id name").lean();
  const facultyCollegeById = new Map(faculties.map((doc) => [docId(doc), String(doc.collegeId || "")]));

  const subjects = await Subject.find({}).select("_id collegeId id name").lean();
  const subjectCollegeById = new Map(subjects.map((doc) => [docId(doc), String(doc.collegeId || "")]));

  const classes = await ClassModel.find({}).select("_id collegeId id name section faculties assigned_teacher_subject_combos").lean();
  const classCollegeById = new Map(classes.map((doc) => [docId(doc), String(doc.collegeId || "")]));

  report.collections.admins.scanned = admins.length;
  for (const admin of admins) {
    if (isMissingCollegeId(admin.collegeId)) {
      pushIssue(report, "admins", {
        id: docId(admin),
        reason: "missing_or_default_collegeId",
        detail: admin.email || null,
      });
    }
  }

  report.collections.faculties.scanned = faculties.length;
  for (const faculty of faculties) {
    if (isMissingCollegeId(faculty.collegeId)) {
      pushIssue(report, "faculties", {
        id: docId(faculty),
        reason: "missing_or_default_collegeId",
        detail: faculty.id || faculty.name || null,
      });
    }
  }

  report.collections.subjects.scanned = subjects.length;
  for (const subject of subjects) {
    if (isMissingCollegeId(subject.collegeId)) {
      pushIssue(report, "subjects", {
        id: docId(subject),
        reason: "missing_or_default_collegeId",
        detail: subject.id || subject.name || null,
      });
    }
  }

  report.collections.classes.scanned = classes.length;
  for (const klass of classes) {
    if (isMissingCollegeId(klass.collegeId)) {
      pushIssue(report, "classes", {
        id: docId(klass),
        reason: "missing_or_default_collegeId",
        detail: klass.id || klass.name || null,
      });
    }

    for (const facultyId of (klass.faculties || []).map(String)) {
      const facultyCollegeId = facultyCollegeById.get(facultyId);
      if (
        !isMissingCollegeId(klass.collegeId) &&
        !isMissingCollegeId(facultyCollegeId) &&
        String(klass.collegeId) !== String(facultyCollegeId)
      ) {
        pushIssue(report, "classes", {
          id: docId(klass),
          reason: "cross_tenant_faculty_reference",
          detail: { facultyId, classCollegeId: klass.collegeId, facultyCollegeId },
        });
      }
    }
  }

  const classSubjects = await ClassSubject.find({}).select("_id collegeId class subject hoursPerWeek").lean();
  report.collections.classsubjects.scanned = classSubjects.length;
  for (const row of classSubjects) {
    const classCollegeId = classCollegeById.get(String(row.class));
    const subjectCollegeId = subjectCollegeById.get(String(row.subject));
    const currentCollegeId = String(row.collegeId || "");

    if (
      !isMissingCollegeId(classCollegeId) &&
      !isMissingCollegeId(subjectCollegeId) &&
      classCollegeId === subjectCollegeId
    ) {
      if (isMissingCollegeId(currentCollegeId)) {
        pushFix(report, "classsubjects", {
          id: docId(row),
          action: "set_collegeId",
          collegeId: classCollegeId,
        });
        await applyUpdate(ClassSubject, row._id, { $set: { collegeId: classCollegeId } }, report, "classsubjects");
      } else if (currentCollegeId !== classCollegeId) {
        pushIssue(report, "classsubjects", {
          id: docId(row),
          reason: "cross_tenant_collegeId_mismatch",
          detail: { currentCollegeId, classCollegeId, subjectCollegeId },
        });
      }
    } else {
      pushIssue(report, "classsubjects", {
        id: docId(row),
        reason: "ambiguous_or_cross_tenant_reference",
        detail: { classCollegeId: classCollegeId || null, subjectCollegeId: subjectCollegeId || null },
      });
    }
  }

  const combos = await TeacherSubjectCombination.find({}).select("_id collegeId faculty subject").lean();
  report.collections.teachersubjectcombinations.scanned = combos.length;
  for (const combo of combos) {
    const facultyCollegeId = facultyCollegeById.get(String(combo.faculty));
    const subjectCollegeId = subjectCollegeById.get(String(combo.subject));
    const currentCollegeId = String(combo.collegeId || "");

    if (
      !isMissingCollegeId(facultyCollegeId) &&
      !isMissingCollegeId(subjectCollegeId) &&
      facultyCollegeId === subjectCollegeId
    ) {
      if (isMissingCollegeId(currentCollegeId)) {
        pushFix(report, "teachersubjectcombinations", {
          id: docId(combo),
          action: "set_collegeId",
          collegeId: facultyCollegeId,
        });
        await applyUpdate(
          TeacherSubjectCombination,
          combo._id,
          { $set: { collegeId: facultyCollegeId } },
          report,
          "teachersubjectcombinations"
        );
      } else if (currentCollegeId !== facultyCollegeId) {
        pushIssue(report, "teachersubjectcombinations", {
          id: docId(combo),
          reason: "cross_tenant_collegeId_mismatch",
          detail: { currentCollegeId, facultyCollegeId, subjectCollegeId },
        });
      }
    } else {
      pushIssue(report, "teachersubjectcombinations", {
        id: docId(combo),
        reason: "ambiguous_or_cross_tenant_reference",
        detail: { facultyCollegeId: facultyCollegeId || null, subjectCollegeId: subjectCollegeId || null },
      });
    }
  }

  const allocations = await TeachingAllocation.find({})
    .select("_id collegeId classIds subject teacher combinedClassGroupId")
    .lean();
  report.collections.teachingallocations.scanned = allocations.length;
  for (const allocation of allocations) {
    const classCollegeIds = [...new Set((allocation.classIds || []).map((id) => classCollegeById.get(String(id))).filter(Boolean))];
    const subjectCollegeId = subjectCollegeById.get(String(allocation.subject));
    const teacherCollegeId = allocation.teacher ? facultyCollegeById.get(String(allocation.teacher)) : null;
    const candidates = [
      ...classCollegeIds.filter((value) => !isMissingCollegeId(value)),
      subjectCollegeId,
      teacherCollegeId,
    ].filter((value) => !isMissingCollegeId(value));
    const uniqueCandidates = [...new Set(candidates.map(String))];
    const currentCollegeId = String(allocation.collegeId || "");

    if (uniqueCandidates.length === 1) {
      const inferredCollegeId = uniqueCandidates[0];
      if (isMissingCollegeId(currentCollegeId)) {
        pushFix(report, "teachingallocations", {
          id: docId(allocation),
          action: "set_collegeId",
          collegeId: inferredCollegeId,
        });
        await applyUpdate(
          TeachingAllocation,
          allocation._id,
          { $set: { collegeId: inferredCollegeId } },
          report,
          "teachingallocations"
        );
      } else if (currentCollegeId !== inferredCollegeId) {
        pushIssue(report, "teachingallocations", {
          id: docId(allocation),
          reason: "cross_tenant_collegeId_mismatch",
          detail: { currentCollegeId, inferredCollegeId, classCollegeIds, subjectCollegeId, teacherCollegeId },
        });
      }
    } else {
      pushIssue(report, "teachingallocations", {
        id: docId(allocation),
        reason: "ambiguous_or_cross_tenant_reference",
        detail: { currentCollegeId: currentCollegeId || null, classCollegeIds, subjectCollegeId: subjectCollegeId || null, teacherCollegeId: teacherCollegeId || null },
      });
    }
  }

  const electiveSettings = await ElectiveSubjectSetting.find({}).select("_id collegeId class subject").lean();
  report.collections.electivesubjectsettings.scanned = electiveSettings.length;
  for (const setting of electiveSettings) {
    const classCollegeId = classCollegeById.get(String(setting.class));
    const subjectCollegeId = subjectCollegeById.get(String(setting.subject));
    const currentCollegeId = String(setting.collegeId || "");

    if (
      !isMissingCollegeId(classCollegeId) &&
      !isMissingCollegeId(subjectCollegeId) &&
      classCollegeId === subjectCollegeId
    ) {
      if (isMissingCollegeId(currentCollegeId)) {
        pushFix(report, "electivesubjectsettings", {
          id: docId(setting),
          action: "set_collegeId",
          collegeId: classCollegeId,
        });
        await applyUpdate(
          ElectiveSubjectSetting,
          setting._id,
          { $set: { collegeId: classCollegeId } },
          report,
          "electivesubjectsettings"
        );
      } else if (currentCollegeId !== classCollegeId) {
        pushIssue(report, "electivesubjectsettings", {
          id: docId(setting),
          reason: "cross_tenant_collegeId_mismatch",
          detail: { currentCollegeId, classCollegeId, subjectCollegeId },
        });
      }
    } else {
      pushIssue(report, "electivesubjectsettings", {
        id: docId(setting),
        reason: "ambiguous_or_cross_tenant_reference",
        detail: { classCollegeId: classCollegeId || null, subjectCollegeId: subjectCollegeId || null },
      });
    }
  }

  const generationJobs = await GenerationJob.find({}).select("_id collegeId created_by").lean();
  report.collections.generationjobs.scanned = generationJobs.length;
  for (const job of generationJobs) {
    const creatorCollegeId = job.created_by ? adminCollegeById.get(String(job.created_by)) : null;
    const currentCollegeId = String(job.collegeId || "");

    if (!isMissingCollegeId(creatorCollegeId)) {
      if (isMissingCollegeId(currentCollegeId)) {
        pushFix(report, "generationjobs", {
          id: docId(job),
          action: "set_collegeId_from_creator",
          collegeId: creatorCollegeId,
        });
        await applyUpdate(
          GenerationJob,
          job._id,
          { $set: { collegeId: creatorCollegeId } },
          report,
          "generationjobs"
        );
      } else if (currentCollegeId !== creatorCollegeId) {
        pushIssue(report, "generationjobs", {
          id: docId(job),
          reason: "creator_college_mismatch",
          detail: { currentCollegeId, creatorCollegeId },
        });
      }
    } else if (isMissingCollegeId(currentCollegeId)) {
      pushIssue(report, "generationjobs", {
        id: docId(job),
        reason: "missing_or_default_collegeId_without_creator",
      });
    }
  }

  const timetableResults = await TimetableResult.find({}).select("_id collegeId created_by source generated_from_id parent_timetable_id").lean();
  report.collections.timetableresults.scanned = timetableResults.length;
  for (const result of timetableResults) {
    const creatorCollegeId = result.created_by ? adminCollegeById.get(String(result.created_by)) : null;
    const currentCollegeId = String(result.collegeId || "");

    if (!isMissingCollegeId(creatorCollegeId)) {
      if (isMissingCollegeId(currentCollegeId)) {
        pushFix(report, "timetableresults", {
          id: docId(result),
          action: "set_collegeId_from_creator",
          collegeId: creatorCollegeId,
        });
        await applyUpdate(
          TimetableResult,
          result._id,
          { $set: { collegeId: creatorCollegeId } },
          report,
          "timetableresults"
        );
      } else if (currentCollegeId !== creatorCollegeId) {
        pushIssue(report, "timetableresults", {
          id: docId(result),
          reason: "creator_college_mismatch",
          detail: { currentCollegeId, creatorCollegeId, source: result.source || null },
        });
      }
    } else if (isMissingCollegeId(currentCollegeId)) {
      pushIssue(report, "timetableresults", {
        id: docId(result),
        reason: "missing_or_default_collegeId_without_creator",
        detail: result.source || null,
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error("[migrateCollegeIds] Failed:", error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(1);
});
