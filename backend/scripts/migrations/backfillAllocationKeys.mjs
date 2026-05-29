import "../env.js";
import mongoose from "mongoose";

import TeachingAllocation from "../../models/TeachingAllocation.js";
import { buildTeachingAllocationKey } from "../../utils/allocationKey.js";

const APPLY = process.argv.includes("--apply");
const DB_NAME = process.env.MONGO_DB_NAME || "timetable_jayanth";
const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("MONGO_URI is not defined");
}

const toId = (value) => String(value || "").trim();

function subjectPairs(allocation) {
  if (Array.isArray(allocation.subjects) && allocation.subjects.length > 0) {
    return allocation.subjects
      .map((pair) => ({
        subject: pair?.subject || null,
        teacher: pair?.teacher || null,
      }))
      .filter((pair) => pair.subject);
  }
  if (allocation.subject) {
    return [{ subject: allocation.subject, teacher: allocation.teacher || null }];
  }
  return [];
}

function teacherIdsFor(allocation, pairs) {
  const ids = [];
  if (Array.isArray(allocation.teachers)) {
    ids.push(...allocation.teachers);
  }
  if (allocation.teacher) {
    ids.push(allocation.teacher);
  }
  ids.push(...pairs.map((pair) => pair.teacher).filter(Boolean));
  return [...new Set(ids.map(toId).filter(Boolean))];
}

function canonicalSubjectId(allocation, pairs) {
  const type = toId(allocation.type || "NORMAL").toUpperCase();
  if (type === "ELECTIVE") {
    return [...new Set(pairs.map((pair) => toId(pair.subject)).filter(Boolean))]
      .sort()
      .join("+");
  }
  return toId(allocation.subject || pairs[0]?.subject || "");
}

function electiveGroupIdFor(allocation, pairs) {
  const type = toId(allocation.type || "NORMAL").toUpperCase();
  if (type !== "ELECTIVE") return null;
  return [...new Set(pairs.map((pair) => toId(pair.subject)).filter(Boolean))]
    .sort()
    .join("+");
}

function buildKeyForAllocation(allocation) {
  const pairs = subjectPairs(allocation);
  return buildTeachingAllocationKey({
    collegeId: allocation.collegeId,
    type: allocation.type || "NORMAL",
    classIds: allocation.classIds || [],
    subjectId: canonicalSubjectId(allocation, pairs),
    teacherIds: teacherIdsFor(allocation, pairs),
    subjects: pairs,
    combinedClassGroupId: allocation.combinedClassGroupId || null,
    electiveGroupId: electiveGroupIdFor(allocation, pairs),
  });
}

function summarizeAllocation(allocation, allocationKey) {
  return {
    id: toId(allocation._id),
    collegeId: toId(allocation.collegeId),
    type: toId(allocation.type || "NORMAL").toUpperCase(),
    classIds: (allocation.classIds || []).map(toId).filter(Boolean),
    subject: toId(allocation.subject),
    teacher: toId(allocation.teacher),
    teachers: (allocation.teachers || []).map(toId).filter(Boolean),
    combinedClassGroupId: allocation.combinedClassGroupId || null,
    existingAllocationKey: allocation.allocationKey || null,
    computedAllocationKey: allocationKey,
  };
}

async function main() {
  await mongoose.connect(uri, { dbName: DB_NAME });

  const allocations = await TeachingAllocation.find({})
    .select("_id collegeId classIds subject teacher teachers type subjects hoursPerWeek combinedClassGroupId allocationKey")
    .lean();

  const entries = allocations.map((allocation) => {
    const computedAllocationKey = buildKeyForAllocation(allocation);
    return {
      allocation,
      computedAllocationKey,
      needsBackfill: allocation.allocationKey !== computedAllocationKey,
    };
  });

  const byKey = new Map();
  for (const entry of entries) {
    if (!byKey.has(entry.computedAllocationKey)) {
      byKey.set(entry.computedAllocationKey, []);
    }
    byKey.get(entry.computedAllocationKey).push(entry);
  }

  const duplicateGroups = [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([allocationKey, group]) => ({
      allocationKey,
      count: group.length,
      documents: group.map((entry) => summarizeAllocation(entry.allocation, entry.computedAllocationKey)),
    }));
  const duplicateKeys = new Set(duplicateGroups.map((group) => group.allocationKey));
  const backfillableEntries = entries.filter(
    (entry) => entry.needsBackfill && !duplicateKeys.has(entry.computedAllocationKey)
  );
  const skippedDuplicateEntries = entries.filter(
    (entry) => entry.needsBackfill && duplicateKeys.has(entry.computedAllocationKey)
  );

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    database: DB_NAME,
    totals: {
      scanned: allocations.length,
      missingOrChangedKeys: entries.filter((entry) => entry.needsBackfill).length,
      backfillable: backfillableEntries.length,
      duplicateGroups: duplicateGroups.length,
      duplicateDocuments: duplicateGroups.reduce((total, group) => total + group.count, 0),
      skippedBecauseDuplicate: skippedDuplicateEntries.length,
      updated: 0,
    },
    duplicateGroups,
    backfillable: backfillableEntries.map((entry) =>
      summarizeAllocation(entry.allocation, entry.computedAllocationKey)
    ),
  };

  if (APPLY) {
    for (const entry of backfillableEntries) {
      const result = await TeachingAllocation.updateOne(
        { _id: entry.allocation._id },
        { $set: { allocationKey: entry.computedAllocationKey } }
      );
      report.totals.updated += Number(result.modifiedCount || 0);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error("[backfillAllocationKeys] Failed:", error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(1);
});

