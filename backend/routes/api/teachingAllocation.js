import { Router } from "express";
import auth from "../../middleware/auth.js";
import ClassModel from "../../models/Class.js";
import Subject from "../../models/Subject.js";
import Faculty from "../../models/Faculty.js";
import ClassSubject from "../../models/ClassSubject.js";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import TeachingAllocation from "../../models/TeachingAllocation.js";
import { validateOwnership, validateOwnershipMany } from "../../utils/validateTenantRefs.js";

const protectedRouter = Router();
protectedRouter.use(auth);

const toId = (value) => String(value || "").trim();
const toPositiveNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 1 ? parsedValue : null;
};
const toUpperTrim = (value, fallback = "") => String(value || fallback).trim().toUpperCase();
const uniqueStrings = (values) => [...new Set((Array.isArray(values) ? values : []).map(toId).filter(Boolean))];
const normalizePair = (pair) => {
  const subjectId = toId(pair?.subjectId || pair?.subject?._id || pair?.subject);
  const teacherId = toId(pair?.teacherId || pair?.teacher?._id || pair?.teacher);
  if (!subjectId) return null;
  return {
    subject: pair?.subject || pair?.subjectId || subjectId,
    teacher: pair?.teacher || pair?.teacherId || teacherId || null,
  };
};
const extractAllocationPairs = (allocation) => {
  if (Array.isArray(allocation?.subjects) && allocation.subjects.length > 0) {
    return allocation.subjects.map(normalizePair).filter(Boolean);
  }
  if (allocation?.subject) {
    return [normalizePair({ subject: allocation.subject, teacher: allocation.teacher })].filter(Boolean);
  }
  return [];
};
const parseElectivePairs = (rawSubjects, fallbackSubjectId = "") => {
  const entries = Array.isArray(rawSubjects) ? rawSubjects : [];
  return entries
    .map((entry) => normalizePair({
      subjectId: entry?.subjectId || entry?.subject || fallbackSubjectId,
      teacherId: entry?.teacherId || entry?.teacher || null,
    }))
    .filter(Boolean);
};
const summarizeAllocation = (allocation) => {
  const pairs = extractAllocationPairs(allocation);
  const subjectIds = uniqueStrings(
    pairs.map((pair) => pair?.subject?._id || pair?.subjectId || pair?.subject)
  );
  const teacherIds = uniqueStrings(
    pairs.map((pair) => pair?.teacher?._id || pair?.teacherId || pair?.teacher)
  );
  const type = toUpperTrim(allocation?.type, pairs.length > 1 ? "ELECTIVE" : "NORMAL");
  const subject = allocation?.subject || pairs[0]?.subject || null;
  const teacher = allocation?.teacher || pairs[0]?.teacher || null;
  const uniqueSubjectIds = [...new Set(subjectIds)];
  return {
    id: toId(allocation?._id),
    classes: Array.isArray(allocation?.classIds) ? allocation.classIds : [],
    class: Array.isArray(allocation?.classIds) && allocation.classIds.length === 1 ? allocation.classIds[0] : null,
    type,
    isElectiveBlock: type === "ELECTIVE" || (type !== "LAB" && uniqueSubjectIds.length > 1),
    subject,
    subjects: pairs,
    subjectIds,
    teacher,
    teachers: Array.isArray(allocation?.teachers) && allocation.teachers.length > 0
      ? allocation.teachers
      : teacherIds,
    teacherIds,
    hoursPerWeek: allocation?.hoursPerWeek,
    combinedClassGroupId: allocation?.combinedClassGroupId || null,
  };
};

protectedRouter.get("/teaching-allocations", async (req, res) => {
  try {
    const allocations = await TeachingAllocation.find({ collegeId: req.collegeId })
      .populate("classIds", "name id sem section")
      .populate("subject", "name id type isElective")
      .populate("teacher", "name id")
      .populate("teachers", "name id")
      .populate("subjects.subject", "name id type isElective")
      .populate("subjects.teacher", "name id")
      .sort({ createdAt: -1 })
      .lean();

    res.json(
      allocations.map((item) => {
        const normalized = summarizeAllocation(item);
        return {
          ...normalized,
          classes: Array.isArray(item.classIds) ? item.classIds : [],
          class: Array.isArray(item.classIds) && item.classIds.length === 1 ? item.classIds[0] : null,
          subject: normalized.subject,
          teacher: normalized.teacher,
          teachers: normalized.teachers,
          hoursPerWeek: item.hoursPerWeek,
          combinedClassGroupId: item.combinedClassGroupId || null,
          isCombined: Array.isArray(item.classIds) && item.classIds.length > 1,
          isLab: String(normalized.subject?.type || "").toLowerCase() === "lab",
          status: "active",
        };
      })
    );
  } catch (e) {
    console.error("[GET /teaching-allocations] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

protectedRouter.post("/teaching-allocations", async (req, res) => {
  try {
    const classIdsRaw = Array.isArray(req.body.classIds)
      ? req.body.classIds
      : req.body.classId
        ? [req.body.classId]
        : [];
    const classIds = [...new Set(classIdsRaw.map(toId).filter(Boolean))];
    const requestedType = toUpperTrim(req.body.type, Array.isArray(req.body.subjects) && req.body.subjects.length > 0 ? "ELECTIVE" : "NORMAL");
    const hasRequestedHours = req.body.hoursPerWeek !== undefined && req.body.hoursPerWeek !== null && req.body.hoursPerWeek !== "";
    const requestedHours = hasRequestedHours ? toPositiveNumber(req.body.hoursPerWeek) : null;
    const combinedClassGroupIdRaw = String(req.body.combinedClassGroupId || "").trim();
    const combinedClassGroupId = combinedClassGroupIdRaw || null;
    const electivePairs = requestedType === "ELECTIVE"
      ? parseElectivePairs(req.body.subjects, req.body.subjectId)
      : [];
    const subjectId = toId(req.body.subjectId || electivePairs[0]?.subject?._id || electivePairs[0]?.subject);
    const teacherIdsRaw = requestedType === "ELECTIVE"
      ? electivePairs.map((pair) => pair.teacher?._id || pair.teacher || pair.teacherId || null)
      : Array.isArray(req.body.teacherIds)
        ? req.body.teacherIds
        : req.body.teacherId
          ? [req.body.teacherId]
          : [];
    const teacherIds = [...new Set(teacherIdsRaw.map(toId).filter(Boolean))];

    if (classIds.length === 0 || !subjectId) {
      return res.status(400).json({ error: "classIds and subjectId are required." });
    }

    if (classIds.length > 1 && !combinedClassGroupId) {
      return res.status(400).json({ error: "combinedClassGroupId is required for combined classes." });
    }

    const [, subject] = await Promise.all([
      validateOwnershipMany(ClassModel, classIds, req.collegeId, "classIds"),
      validateOwnership(Subject, subjectId, req.collegeId, "Subject"),
      teacherIds.length > 0
        ? validateOwnershipMany(Faculty, teacherIds, req.collegeId, "teacherIds")
        : Promise.resolve([]),
    ]);

    const subjectType = String(subject.type || "").toLowerCase();
    const requiresTeacher = subjectType !== "no_teacher";
    const isLab = subjectType === "lab";
    const isElective = Boolean(subject.isElective);
    const effectiveType = requestedType === "ELECTIVE"
      ? "ELECTIVE"
      : requestedType === "LAB" || isLab
        ? "LAB"
        : "NORMAL";
    const allowGroupedTeachers = isLab || isElective || effectiveType === "LAB" || effectiveType === "ELECTIVE";
    if (hasRequestedHours && !requestedHours) {
      return res.status(400).json({ error: "hoursPerWeek must be a positive number." });
    }
    const subjectDefaultHours = toPositiveNumber(subject.classesPerWeek);
    const hoursPerWeek = requestedHours ?? subjectDefaultHours;

    if (!hoursPerWeek) {
      return res.status(400).json({ error: "classIds, subjectId and valid hoursPerWeek are required unless the subject has a default classesPerWeek value." });
    }

    if (!requiresTeacher && teacherIds.length > 0) {
      return res.status(400).json({ error: "No-teacher subjects must not have a teacher assigned." });
    }

    if (requiresTeacher && teacherIds.length === 0) {
      return res.status(400).json({ error: "teacherIds is required for non no-teacher subjects." });
    }

    if (teacherIds.length > 1 && !allowGroupedTeachers) {
      return res.status(400).json({ error: "Multiple teachers in one combo are allowed only for lab or elective subjects." });
    }

    if (effectiveType === "ELECTIVE" && electivePairs.length === 0) {
      return res.status(400).json({ error: "subjects is required for elective allocations." });
    }

    const upsertPairs = effectiveType === "ELECTIVE"
      ? electivePairs
      : effectiveType === "LAB"
        ? teacherIds.map((teacherId) => ({
            subject,
            subjectId,
            teacher: teacherId,
            teacherId,
          }))
      : [{
          subject: subject,
          subjectId,
          teacher: teacherIds[0] || null,
          teacherId: teacherIds[0] || null,
        }];

    const subjectIdsForValidation = uniqueStrings(
      upsertPairs.map((pair) => pair.subject?._id || pair.subjectId || pair.subject)
    );
    const teacherIdsForValidation = uniqueStrings(
      upsertPairs.map((pair) => pair.teacher?._id || pair.teacherId || pair.teacher)
    );

    if (subjectIdsForValidation.length > 1 && effectiveType !== "ELECTIVE") {
      return res.status(400).json({ error: "A normal allocation can only contain one subject." });
    }

    if (subjectIdsForValidation.length > 0) {
      await validateOwnershipMany(Subject, subjectIdsForValidation, req.collegeId, "subjectIds");
    }
    if (teacherIdsForValidation.length > 0) {
      await validateOwnershipMany(Faculty, teacherIdsForValidation, req.collegeId, "teacherIds");
    }

    await Promise.all(
      upsertPairs.map((pair) =>
        pair.teacherId || pair.teacher?._id || pair.teacher
          ? TeacherSubjectCombination.findOneAndUpdate(
              {
                faculty: pair.teacher?._id || pair.teacherId || pair.teacher,
                subject: pair.subject?._id || pair.subjectId || pair.subject,
                collegeId: req.collegeId,
              },
              {
                $setOnInsert: {
                  faculty: pair.teacher?._id || pair.teacherId || pair.teacher,
                  subject: pair.subject?._id || pair.subjectId || pair.subject,
                  collegeId: req.collegeId,
                },
              },
              { new: true, upsert: true }
            )
          : Promise.resolve(null)
      )
    );

    for (const classId of classIds) {
      for (const pair of upsertPairs) {
        const pairSubjectId = toId(pair.subject?._id || pair.subjectId || pair.subject);
        if (!pairSubjectId) continue;
        await ClassSubject.findOneAndUpdate(
          { class: classId, subject: pairSubjectId, collegeId: req.collegeId },
          { $set: { hoursPerWeek, collegeId: req.collegeId } },
          { new: true, upsert: true }
        );
      }
      if (teacherIds.length > 0 && requiresTeacher) {
        await ClassModel.findOneAndUpdate({ _id: classId, collegeId: req.collegeId }, {
          $addToSet: {
            faculties: { $each: teacherIds },
          },
        });
      }
    }

    const allocation = await TeachingAllocation.create({
      collegeId: req.collegeId,
      classIds,
      type: effectiveType,
      subject: subjectId,
      teacher: teacherIds.length === 1 ? teacherIds[0] : null,
      teachers: teacherIds,
      subjects: upsertPairs.map((pair) => ({
        subject: pair.subject?._id || pair.subjectId || pair.subject,
        teacher: pair.teacher?._id || pair.teacherId || pair.teacher || null,
      })),
      hoursPerWeek,
      combinedClassGroupId,
    });

    const populatedAllocation = await TeachingAllocation.findOne({ _id: allocation._id, collegeId: req.collegeId })
      .populate("classIds", "name id sem section")
      .populate("subject", "name id type isElective")
      .populate("teacher", "name id")
      .populate("teachers", "name id")
      .populate("subjects.subject", "name id type isElective")
      .populate("subjects.teacher", "name id")
      .lean();

    res.status(201).json({
      ok: true,
      message: "Teaching allocation saved.",
      allocation: populatedAllocation,
    });
  } catch (e) {
    console.error("[POST /teaching-allocations] Error:", e);
    res.status(e.status || 500).json({ error: e.message || "Internal Server Error" });
  }
});

protectedRouter.post("/teaching-allocations/calculate", async (req, res) => {
  try {
    const [classes, classSubjects, combos] = await Promise.all([
      ClassModel.find({ collegeId: req.collegeId }).select("_id name faculties").lean(),
      ClassSubject.find({ collegeId: req.collegeId }).select("class subject hoursPerWeek").lean(),
      TeacherSubjectCombination.find({ collegeId: req.collegeId }).select("_id faculty subject").lean(),
    ]);
    const subjects = await Subject.find({ collegeId: req.collegeId }).select("_id type classesPerWeek").lean();
    const subjectById = new Map(subjects.map((subject) => [toId(subject._id), subject]));

    const subjectIdsByClassId = new Map();
    const hoursByClassSubject = new Map();
    for (const row of classSubjects) {
      const classId = toId(row.class);
      const subjectId = toId(row.subject);
      if (!classId || !subjectId) continue;
      if (!subjectIdsByClassId.has(classId)) {
        subjectIdsByClassId.set(classId, new Set());
      }
      subjectIdsByClassId.get(classId).add(subjectId);
      hoursByClassSubject.set(`${classId}|${subjectId}`, Number(row.hoursPerWeek || 1) || 1);
    }

    const comboIdByTeacherSubject = new Map();
    for (const combo of combos) {
      const teacherId = toId(combo.faculty);
      const subjectId = toId(combo.subject);
      if (!teacherId || !subjectId) continue;
      comboIdByTeacherSubject.set(`${teacherId}|${subjectId}`, toId(combo._id));
    }

    const summary = [];
    let totalAllocations = 0;

    for (const klass of classes) {
      const classId = toId(klass._id);
      const teacherIds = (klass.faculties || []).map((id) => toId(id)).filter(Boolean);
      const subjectIds = Array.from(subjectIdsByClassId.get(classId) || []);
      const derivedComboIds = new Set();

      for (const teacherId of teacherIds) {
        for (const subjectId of subjectIds) {
          const comboId = comboIdByTeacherSubject.get(`${teacherId}|${subjectId}`);
          if (comboId) derivedComboIds.add(comboId);
        }
      }

      const finalComboIds = Array.from(derivedComboIds);
      const comboIdsBySubject = new Map();
      for (const comboId of finalComboIds) {
        const combo = combos.find((item) => toId(item._id) === comboId);
        if (!combo) continue;
        const subjectId = toId(combo.subject);
        if (!comboIdsBySubject.has(subjectId)) {
          comboIdsBySubject.set(subjectId, []);
        }
        comboIdsBySubject.get(subjectId).push(combo);
      }

      for (const [subjectId, subjectCombos] of comboIdsBySubject.entries()) {
        const subject = subjectById.get(subjectId);
        const subjectType = String(subject?.type || "").toLowerCase();
        const comboTeacherIds = [...new Set(subjectCombos.map((combo) => toId(combo.faculty)).filter(Boolean))];
        const hoursPerWeek = hoursByClassSubject.get(`${classId}|${subjectId}`) || Number(subject?.classesPerWeek || 1) || 1;

        if (subjectType === "lab" && comboTeacherIds.length > 0) {
          await TeachingAllocation.findOneAndUpdate(
            {
              collegeId: req.collegeId,
              classIds: [klass._id],
              subject: subjectId,
              type: "LAB",
              combinedClassGroupId: null,
            },
            {
              $set: {
                classIds: [klass._id],
                subject: subjectId,
                teacher: comboTeacherIds[0] || null,
                teachers: comboTeacherIds,
                collegeId: req.collegeId,
                type: "LAB",
                hoursPerWeek,
                combinedClassGroupId: null,
              },
            },
            { upsert: true, new: true }
          );
          totalAllocations += 1;
          continue;
        }

        for (const combo of subjectCombos) {
          await TeachingAllocation.findOneAndUpdate(
            {
              collegeId: req.collegeId,
              classIds: [klass._id],
              subject: combo.subject,
              teacher: combo.faculty,
              combinedClassGroupId: null,
            },
            {
              $set: {
                classIds: [klass._id],
                subject: combo.subject,
                teacher: combo.faculty,
                collegeId: req.collegeId,
                hoursPerWeek,
                combinedClassGroupId: null,
              },
            },
            { upsert: true, new: true }
          );
          totalAllocations += 1;
        }
      }

      summary.push({
        classId,
        className: klass.name,
        teachersInClass: teacherIds.length,
        classSubjects: subjectIds.length,
        generatedCombos: finalComboIds.length,
      });
    }

    res.json({
      ok: true,
      message: `Calculated allocations for ${classes.length} classes.`,
      classesProcessed: classes.length,
      totalGeneratedCombos: totalAllocations,
      summary,
    });
  } catch (e) {
    console.error("[POST /teaching-allocations/calculate] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

protectedRouter.delete("/teaching-allocations", async (req, res) => {
  try {
    const allocationId = toId(req.body.id || req.body.allocationId);
    if (!allocationId) {
      return res.status(400).json({ error: "allocationId is required." });
    }
    const allocation = await TeachingAllocation.findOneAndDelete({ _id: allocationId, collegeId: req.collegeId }).lean();
    if (!allocation) {
      return res.status(404).json({ error: "Allocation not found." });
    }

    res.json({ ok: true, message: "Allocation deleted." });
  } catch (e) {
    console.error("[DELETE /teaching-allocations] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default protectedRouter;
