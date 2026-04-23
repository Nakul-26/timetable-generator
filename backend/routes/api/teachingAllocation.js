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

protectedRouter.get("/teaching-allocations", async (req, res) => {
  try {
    const allocations = await TeachingAllocation.find({ collegeId: req.collegeId })
      .populate("classIds", "name id sem section")
      .populate("subject", "name id type")
      .populate("teacher", "name id")
      .populate("teachers", "name id")
      .sort({ createdAt: -1 })
      .lean();

    res.json(
      allocations.map((item) => ({
        id: toId(item._id),
        classes: Array.isArray(item.classIds) ? item.classIds : [],
        class: Array.isArray(item.classIds) && item.classIds.length === 1 ? item.classIds[0] : null,
        subject: item.subject,
        teacher: item.teacher,
        teachers: Array.isArray(item.teachers) && item.teachers.length > 0
          ? item.teachers
          : item.teacher
            ? [item.teacher]
            : [],
        hoursPerWeek: item.hoursPerWeek,
        combinedClassGroupId: item.combinedClassGroupId || null,
        isCombined: Array.isArray(item.classIds) && item.classIds.length > 1,
        isLab: String(item.subject?.type || "").toLowerCase() === "lab",
        status: "active",
      }))
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
    const subjectId = toId(req.body.subjectId);
    const teacherIdsRaw = Array.isArray(req.body.teacherIds)
      ? req.body.teacherIds
      : req.body.teacherId
        ? [req.body.teacherId]
        : [];
    const teacherIds = [...new Set(teacherIdsRaw.map(toId).filter(Boolean))];
    const normalizedTeacherId = teacherIds[0] || null;
    const hoursPerWeek = Number(req.body.hoursPerWeek);
    const combinedClassGroupIdRaw = String(req.body.combinedClassGroupId || "").trim();
    const combinedClassGroupId = combinedClassGroupIdRaw || null;

    if (classIds.length === 0 || !subjectId || !Number.isFinite(hoursPerWeek) || hoursPerWeek < 1) {
      return res.status(400).json({ error: "classIds, subjectId and valid hoursPerWeek are required." });
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

    if (!requiresTeacher && teacherIds.length > 0) {
      return res.status(400).json({ error: "No-teacher subjects must not have a teacher assigned." });
    }

    if (requiresTeacher && teacherIds.length === 0) {
      return res.status(400).json({ error: "teacherIds is required for non no-teacher subjects." });
    }

    if (teacherIds.length > 1 && !isLab) {
      return res.status(400).json({ error: "Multiple teachers in one combo are allowed only for lab subjects." });
    }

    if (requiresTeacher) {
      await Promise.all(
        teacherIds.map((teacherId) =>
          TeacherSubjectCombination.findOneAndUpdate(
            { faculty: teacherId, subject: subjectId, collegeId: req.collegeId },
            { $setOnInsert: { faculty: teacherId, subject: subjectId, collegeId: req.collegeId } },
            { new: true, upsert: true }
          )
        )
      );
    }

    for (const classId of classIds) {
      await ClassSubject.findOneAndUpdate(
        { class: classId, subject: subjectId, collegeId: req.collegeId },
        { $set: { hoursPerWeek, collegeId: req.collegeId } },
        { new: true, upsert: true }
      );
      if (requiresTeacher) {
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
      subject: subjectId,
      teacher: normalizedTeacherId,
      teachers: teacherIds,
      hoursPerWeek,
      combinedClassGroupId,
    });

    const populatedAllocation = await TeachingAllocation.findOne({ _id: allocation._id, collegeId: req.collegeId })
      .populate("classIds", "name id sem section")
      .populate("subject", "name id type")
      .populate("teacher", "name id")
      .populate("teachers", "name id")
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
      ClassSubject.find({ collegeId: req.collegeId }).select("class subject").lean(),
      TeacherSubjectCombination.find({ collegeId: req.collegeId }).select("_id faculty subject").lean(),
    ]);

    const subjectIdsByClassId = new Map();
    for (const row of classSubjects) {
      const classId = toId(row.class);
      const subjectId = toId(row.subject);
      if (!classId || !subjectId) continue;
      if (!subjectIdsByClassId.has(classId)) {
        subjectIdsByClassId.set(classId, new Set());
      }
      subjectIdsByClassId.get(classId).add(subjectId);
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
      for (const comboId of finalComboIds) {
        const combo = combos.find((item) => toId(item._id) === comboId);
        if (!combo) continue;
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
              hoursPerWeek: 1,
              combinedClassGroupId: null,
            },
          },
          { upsert: true, new: true }
        );
      }
      totalAllocations += finalComboIds.length;

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
