import { Router } from "express";
import auth from "../../middleware/auth.js";
import ClassModel from "../../models/Class.js";
import Subject from "../../models/Subject.js";
import Faculty from "../../models/Faculty.js";
import ClassSubject from "../../models/ClassSubject.js";
import TeacherSubjectCombination from "../../models/TeacherSubjectCombination.js";
import TeachingAllocation from "../../models/TeachingAllocation.js";
import AllocationAudit from "../../models/AllocationAudit.js";
import { validateOwnership, validateOwnershipMany } from "../../utils/validateTenantRefs.js";
import { buildTeachingAllocationKey } from "../../utils/allocationKey.js";

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
  return entries.flatMap((entry) => {
    const subjectId = entry?.subjectId || entry?.subject || fallbackSubjectId;
    const teacherIds = Array.isArray(entry?.teacherIds)
      ? entry.teacherIds
      : Array.isArray(entry?.teachers)
        ? entry.teachers
        : [entry?.teacherId || entry?.teacher || null];
    return teacherIds
      .map((teacherId) => normalizePair({ subjectId, teacherId }))
      .filter(Boolean);
  });
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
    isElectiveBlock: type === "ELECTIVE" || type === "ELECTIVE_LAB" || (type !== "LAB" && uniqueSubjectIds.length > 1),
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
      .populate("subject", "name id type")
      .populate("teacher", "name id")
      .populate("teachers", "name id")
      .populate("subjects.subject", "name id type")
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
    const isRequestedElective = requestedType === "ELECTIVE" || requestedType === "ELECTIVE_LAB";
    const electivePairs = isRequestedElective
      ? parseElectivePairs(req.body.subjects, req.body.subjectId)
      : [];
    const subjectId = toId(req.body.subjectId || electivePairs[0]?.subject?._id || electivePairs[0]?.subject);
    const teacherIdsRaw = isRequestedElective
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
    const effectiveType = isRequestedElective
      ? requestedType
      : requestedType === "LAB" || isLab
        ? "LAB"
        : "NORMAL";
    const isEffectiveElective = effectiveType === "ELECTIVE" || effectiveType === "ELECTIVE_LAB";
    const allowGroupedTeachers = isLab || effectiveType === "LAB" || isEffectiveElective;
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

    if (isEffectiveElective && electivePairs.length === 0) {
      return res.status(400).json({ error: "subjects is required for elective allocations." });
    }

    const upsertPairs = isEffectiveElective
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

    if (subjectIdsForValidation.length > 1 && !isEffectiveElective) {
      return res.status(400).json({ error: "A normal allocation can only contain one subject." });
    }

    if (subjectIdsForValidation.length > 0) {
      const validatedSubjects = await validateOwnershipMany(Subject, subjectIdsForValidation, req.collegeId, "subjectIds");
      if (effectiveType === "ELECTIVE_LAB") {
        const nonLabSubject = validatedSubjects.find((item) => String(item.type || "").toLowerCase() !== "lab");
        if (nonLabSubject) {
          return res.status(400).json({ error: "Elective lab allocations can contain only lab subjects." });
        }
      }
    }
    if (teacherIdsForValidation.length > 0) {
      await validateOwnershipMany(Faculty, teacherIdsForValidation, req.collegeId, "teacherIds");
    }
    const allocationSubjects = upsertPairs.map((pair) => ({
      subject: pair.subject?._id || pair.subjectId || pair.subject,
      teacher: pair.teacher?._id || pair.teacherId || pair.teacher || null,
    }));
    const allocationKey = buildTeachingAllocationKey({
      collegeId: req.collegeId,
      type: effectiveType,
      classIds,
      subjectId: isEffectiveElective
        ? [...subjectIdsForValidation].sort().join("+")
        : subjectId,
      teacherIds,
      subjects: allocationSubjects,
      combinedClassGroupId,
      electiveGroupId: isEffectiveElective
        ? [...subjectIdsForValidation].sort().join("+")
        : null,
    });
    const existingAllocation = await TeachingAllocation.findOne({
      collegeId: req.collegeId,
      allocationKey,
    }).select("_id").lean();
    if (existingAllocation) {
      return res.status(409).json({ error: "This teaching allocation already exists." });
    }

    const allocation = await TeachingAllocation.create({
      collegeId: req.collegeId,
      classIds,
      type: effectiveType,
      subject: subjectId,
      teacher: teacherIds.length === 1 ? teacherIds[0] : null,
      teachers: teacherIds,
      subjects: allocationSubjects,
      hoursPerWeek,
      combinedClassGroupId,
      allocationKey,
      source: "DIRECT",
    });

    // Audit Logging
    await AllocationAudit.create({
      collegeId: req.collegeId,
      allocationId: allocation._id,
      action: "CREATE",
      performedBy: req.user?._id || req.userId,
      source: "DIRECT",
      snapshot: {
        after: allocation.toObject(),
      },
      message: "Manually created teaching allocation.",
    });

    const populatedAllocation = await TeachingAllocation.findOne({ _id: allocation._id, collegeId: req.collegeId })
      .populate("classIds", "name id sem section")
      .populate("subject", "name id type")
      .populate("teacher", "name id")
      .populate("teachers", "name id")
      .populate("subjects.subject", "name id type")
      .populate("subjects.teacher", "name id")
      .lean();

    res.status(201).json({
      ok: true,
      message: "Teaching allocation saved.",
      allocation: populatedAllocation,
    });
  } catch (e) {
    console.error("[POST /teaching-allocations] Error:", e);
    if (e?.code === 11000) {
      return res.status(409).json({ error: "This teaching allocation already exists." });
    }
    res.status(e.status || 500).json({ error: e.message || "Internal Server Error" });
  }
});

protectedRouter.post("/teaching-allocations/calculate", async (req, res) => {
  try {
    const isPreview = req.body.preview === true;
    const [classes, classSubjects, combos, existingAllocations] = await Promise.all([
      ClassModel.find({ collegeId: req.collegeId }).select("_id name faculties").lean(),
      ClassSubject.find({ collegeId: req.collegeId }).select("_id class subject hoursPerWeek").lean(),
      TeacherSubjectCombination.find({ collegeId: req.collegeId }).select("_id faculty subject").lean(),
      TeachingAllocation.find({ collegeId: req.collegeId }).select("allocationKey source hoursPerWeek classIds subject teacher teachers subjects combinedClassGroupId type").lean(),
    ]);
    const subjects = await Subject.find({ collegeId: req.collegeId }).select("_id name type classesPerWeek").lean();
    const subjectById = new Map(subjects.map((s) => [toId(s._id), s]));
    
    const existingMap = new Map(existingAllocations.map((a) => [a.allocationKey, a]));
    const processedKeys = new Set();

    const subjectIdsByClassId = new Map();
    const hoursByClassSubject = new Map();
    const classSubjectIdByClassSubject = new Map();

    for (const row of classSubjects) {
      const cid = toId(row.class);
      const sid = toId(row.subject);
      if (!cid || !sid) continue;
      if (!subjectIdsByClassId.has(cid)) subjectIdsByClassId.set(cid, new Set());
      subjectIdsByClassId.get(cid).add(sid);
      hoursByClassSubject.set(`${cid}|${sid}`, Number(row.hoursPerWeek || 1) || 1);
      classSubjectIdByClassSubject.set(`${cid}|${sid}`, toId(row._id));
    }

    const combosByTeacherSubject = new Map();
    const combosBySubjectGlobal = new Map();
    for (const combo of combos) {
      const tid = toId(combo.faculty);
      const sid = toId(combo.subject);
      if (!tid || !sid) continue;
      const key = `${tid}|${sid}`;
      if (!combosByTeacherSubject.has(key)) combosByTeacherSubject.set(key, []);
      combosByTeacherSubject.get(key).push(combo);
      
      if (!combosBySubjectGlobal.has(sid)) combosBySubjectGlobal.set(sid, []);
      combosBySubjectGlobal.get(sid).push(combo);
    }

    const summary = [];
    const conflicts = [];
    let totalCreates = 0;
    let totalUpdates = 0;
    let totalUnchanged = 0;
    let totalAllocations = 0;

    const areEqual = (a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return JSON.stringify(a) === JSON.stringify(b);
    };

    const checkUnchanged = (existing, payload) => {
      if (!existing) return false;
      // Compare core fields that the sync manages
      const fields = ["hoursPerWeek", "type", "combinedClassGroupId", "subject", "teacher"];
      for (const f of fields) {
        const ev = toId(existing[f]);
        const pv = toId(payload[f]);
        if (ev !== pv) return false;
      }
      
      // Compare arrays
      const arrayFields = ["classIds", "teachers"];
      for (const f of arrayFields) {
        const evs = (existing[f] || []).map(toId).sort();
        const pvs = (payload[f] || []).map(toId).sort();
        if (evs.length !== pvs.length) return false;
        if (evs.some((v, i) => v !== pvs[i])) return false;
      }

      // Compare subjects array (pairs)
      const es = (existing.subjects || []).map(s => ({ subject: toId(s.subject), teacher: toId(s.teacher) })).sort((a, b) => a.subject.localeCompare(b.subject) || a.teacher.localeCompare(b.teacher));
      const ps = (payload.subjects || []).map(s => ({ subject: toId(s.subject), teacher: toId(s.teacher) })).sort((a, b) => a.subject.localeCompare(b.subject) || a.teacher.localeCompare(b.teacher));
      if (es.length !== ps.length) return false;
      return es.every((v, i) => v.subject === ps[i].subject && v.teacher === ps[i].teacher);
    };

    for (const klass of classes) {
      const classId = toId(klass._id);
      const teacherIds = (klass.faculties || []).map((id) => toId(id)).filter(Boolean);
      const subjectIds = Array.from(subjectIdsByClassId.get(classId) || []);

      const combosBySubject = new Map();
      for (const sid of subjectIds) {
        const globalCombos = combosBySubjectGlobal.get(sid) || [];
        const eligibleCombos = teacherIds.length > 0
          ? globalCombos.filter((combo) => teacherIds.includes(toId(combo.faculty)))
          : globalCombos;
        combosBySubject.set(sid, eligibleCombos);
      }

      for (const sid of subjectIds) {
        const subject = subjectById.get(sid);
        const subjectType = String(subject?.type || "").toLowerCase();
        const subjectCombos = combosBySubject.get(sid) || [];
        const comboTeacherIds = [...new Set(subjectCombos.map((c) => toId(c.faculty)))];
        const hoursPerWeek = hoursByClassSubject.get(`${classId}|${sid}`) || Number(subject?.classesPerWeek || 1) || 1;
        const classSubjectId = classSubjectIdByClassSubject.get(`${classId}|${sid}`);

        if (subjectType === "no_teacher") {
          const allocationSubjects = [{ subject: sid, teacher: null }];
          const allocationKey = buildTeachingAllocationKey({
            collegeId: req.collegeId,
            type: "NORMAL",
            classIds: [klass._id],
            subjectId: sid,
            teacherIds: [],
            subjects: allocationSubjects,
            combinedClassGroupId: null,
          });

          const payload = {
            classIds: [klass._id],
            subject: sid,
            teacher: null,
            teachers: [],
            collegeId: req.collegeId,
            type: "NORMAL",
            hoursPerWeek,
            combinedClassGroupId: null,
            subjects: allocationSubjects,
            allocationKey,
            source: "MAPPING_SYNC",
            sourceMappings: {
              classSubjectId,
              teacherSubjectIds: [],
            },
          };

          let existing = existingMap.get(allocationKey);
          if (!existing) {
            // Find placeholder (same class, same subject, no teacher)
            const placeholder = existingAllocations.find(a => 
              !processedKeys.has(a.allocationKey) &&
              a.classIds.map(toId).includes(classId) &&
              toId(a.subject) === sid &&
              (!a.teacher || a.teachers.length === 0)
            );
            if (placeholder) {
              existing = placeholder;
              existing.allocationKey = allocationKey;
              existingMap.delete(placeholder.allocationKey);
              existingMap.set(allocationKey, placeholder);
            }
          }

          if (existing) {
            if (existing.source === "DIRECT" && existing.teacher) {
              conflicts.push({
                type: "OVERWRITING_DIRECT_ALLOCATION",
                message: `Sync will overwrite a manual allocation for "${subject?.name || sid}" in class "${klass.name}".`,
                classId,
                className: klass.name,
              });
            }
            if (checkUnchanged(existing, payload)) {
              totalUnchanged++;
            } else {
              totalUpdates++;
              if (!isPreview) {
                await TeachingAllocation.findOneAndUpdate(
                  { collegeId: req.collegeId, _id: existing._id },
                  { $set: payload }
                );
                await AllocationAudit.create({
                  collegeId: req.collegeId,
                  allocationId: existing._id,
                  action: "UPDATE",
                  performedBy: req.user?._id || req.userId,
                  source: "MAPPING_SYNC",
                  snapshot: { before: existing, after: payload },
                  message: "Updated via Mapping Sync.",
                });
              }
            }
          } else {
            totalCreates++;
            if (!isPreview) {
              const created = await TeachingAllocation.create(payload);
              await AllocationAudit.create({
                collegeId: req.collegeId,
                allocationId: created._id,
                action: "CREATE",
                performedBy: req.user?._id || req.userId,
                source: "MAPPING_SYNC",
                snapshot: { after: payload },
                message: "Created via Mapping Sync.",
              });
            }
          }
          totalAllocations++;
          processedKeys.add(allocationKey);
        } else {
          if (subjectCombos.length === 0) {
            conflicts.push({
              type: "NO_TEACHERS_MAPPED",
              message: `Subject "${subject?.name || sid}" in class "${klass.name}" has no matching teacher mapping.`,
              classId,
              className: klass.name,
              subjectId: sid,
              subjectName: subject?.name,
            });
            continue;
          }

          if (subjectType !== "lab" && subjectType !== "elective" && subjectCombos.length > 1) {
            conflicts.push({
              type: "MULTIPLE_TEACHERS_FOR_NORMAL",
              message: `Normal subject "${subject?.name || sid}" in class "${klass.name}" has multiple teachers mapped (${subjectCombos.length}). This will create separate allocations for each.`,
              classId,
              className: klass.name,
              subjectId: sid,
              subjectName: subject?.name,
            });
          }

          if (subjectType === "lab") {
            const allocationSubjects = comboTeacherIds.map((tid) => ({
              subject: sid,
              teacher: tid,
            }));
            const allocationKey = buildTeachingAllocationKey({
              collegeId: req.collegeId,
              type: "LAB",
              classIds: [klass._id],
              subjectId: sid,
              teacherIds: comboTeacherIds,
              subjects: allocationSubjects,
              combinedClassGroupId: null,
            });

            const payload = {
              classIds: [klass._id],
              subject: sid,
              teacher: comboTeacherIds[0] || null,
              teachers: comboTeacherIds,
              collegeId: req.collegeId,
              type: "LAB",
              hoursPerWeek,
              combinedClassGroupId: null,
              subjects: allocationSubjects,
              allocationKey,
              source: "MAPPING_SYNC",
              sourceMappings: {
                classSubjectId,
                teacherSubjectIds: subjectCombos.map((c) => c._id),
              },
            };

            let existing = existingMap.get(allocationKey);
            if (!existing) {
              const placeholder = existingAllocations.find(a => 
                !processedKeys.has(a.allocationKey) &&
                a.classIds.map(toId).includes(classId) &&
                toId(a.subject) === sid &&
                (!a.teacher || a.teachers.length === 0)
              );
              if (placeholder) {
                existing = placeholder;
                existing.allocationKey = allocationKey;
                existingMap.delete(placeholder.allocationKey);
                existingMap.set(allocationKey, placeholder);
              }
            }

            if (existing) {
              if (existing.source === "DIRECT" && existing.teacher) {
                conflicts.push({
                  type: "OVERWRITING_DIRECT_ALLOCATION",
                  message: `Sync will overwrite a manual allocation for "${subject?.name || sid}" in class "${klass.name}".`,
                  classId,
                  className: klass.name,
                });
              }
              if (checkUnchanged(existing, payload)) {
                totalUnchanged++;
              } else {
                totalUpdates++;
                if (!isPreview) {
                  await TeachingAllocation.findOneAndUpdate(
                    { collegeId: req.collegeId, _id: existing._id },
                    { $set: payload }
                  );
                  await AllocationAudit.create({
                    collegeId: req.collegeId,
                    allocationId: existing._id,
                    action: "UPDATE",
                    performedBy: req.user?._id || req.userId,
                    source: "MAPPING_SYNC",
                    snapshot: { before: existing, after: payload },
                    message: "Updated via Mapping Sync.",
                  });
                }
              }
            } else {
              totalCreates++;
              if (!isPreview) {
                const created = await TeachingAllocation.create(payload);
                await AllocationAudit.create({
                  collegeId: req.collegeId,
                  allocationId: created._id,
                  action: "CREATE",
                  performedBy: req.user?._id || req.userId,
                  source: "MAPPING_SYNC",
                  snapshot: { after: payload },
                  message: "Created via Mapping Sync.",
                });
              }
            }
            totalAllocations++;
            processedKeys.add(allocationKey);
          } else {
            for (const combo of subjectCombos) {
              const tid = toId(combo.faculty);
              const allocationSubjects = [{ subject: sid, teacher: tid }];
              const allocationKey = buildTeachingAllocationKey({
                collegeId: req.collegeId,
                type: "NORMAL",
                classIds: [klass._id],
                subjectId: sid,
                teacherIds: [tid],
                subjects: allocationSubjects,
                combinedClassGroupId: null,
              });

              const payload = {
                classIds: [klass._id],
                subject: sid,
                teacher: tid,
                teachers: [tid],
                collegeId: req.collegeId,
                type: "NORMAL",
                hoursPerWeek,
                combinedClassGroupId: null,
                subjects: allocationSubjects,
                allocationKey,
                source: "MAPPING_SYNC",
                sourceMappings: {
                  classSubjectId,
                  teacherSubjectIds: [combo._id],
                },
              };

              let existing = existingMap.get(allocationKey);
              if (!existing) {
                const placeholder = existingAllocations.find(a => 
                  !processedKeys.has(a.allocationKey) &&
                  a.classIds.map(toId).includes(classId) &&
                  toId(a.subject) === sid &&
                  (!a.teacher || a.teachers.length === 0)
                );
                if (placeholder) {
                  existing = placeholder;
                  existing.allocationKey = allocationKey;
                  existingMap.delete(placeholder.allocationKey);
                  existingMap.set(allocationKey, placeholder);
                }
              }

              if (existing) {
                if (existing.source === "DIRECT" && existing.teacher) {
                  conflicts.push({
                    type: "OVERWRITING_DIRECT_ALLOCATION",
                    message: `Sync will overwrite a manual allocation for "${subject?.name || sid}" in class "${klass.name}".`,
                    classId,
                    className: klass.name,
                  });
                }
                if (checkUnchanged(existing, payload)) {
                  totalUnchanged++;
                } else {
                  totalUpdates++;
                  if (!isPreview) {
                    await TeachingAllocation.findOneAndUpdate(
                      { collegeId: req.collegeId, _id: existing._id },
                      { $set: payload }
                    );
                    await AllocationAudit.create({
                      collegeId: req.collegeId,
                      allocationId: existing._id,
                      action: "UPDATE",
                      performedBy: req.user?._id || req.userId,
                      source: "MAPPING_SYNC",
                      snapshot: { before: existing, after: payload },
                      message: "Updated via Mapping Sync.",
                    });
                  }
                }
              } else {
                totalCreates++;
                if (!isPreview) {
                  const created = await TeachingAllocation.create(payload);
                  await AllocationAudit.create({
                    collegeId: req.collegeId,
                    allocationId: created._id,
                    action: "CREATE",
                    performedBy: req.user?._id || req.userId,
                    source: "MAPPING_SYNC",
                    snapshot: { after: payload },
                    message: "Created via Mapping Sync.",
                  });
                }
              }
              totalAllocations++;
              processedKeys.add(allocationKey);
            }
          }
        }
      }

      summary.push({
        classId,
        className: klass.name,
        teachersInClass: teacherIds.length,
        classSubjects: subjectIds.length,
        potentialAllocations: combosBySubject.size,
      });
    }

    // Detect Orphans (Sync allocations that are no longer produced by mappings)
    const orphans = [];
    for (const [key, existing] of existingMap.entries()) {
      if (existing.source === "MAPPING_SYNC" && !processedKeys.has(key)) {
        orphans.push(existing._id);
        conflicts.push({
          type: "ORPHANED_SYNC_ALLOCATION",
          message: isPreview
            ? `Allocation for "${subjectById.get(toId(existing.subject))?.name || "Unknown"}" is no longer matched by any mapping. It will be deleted when changes are applied.`
            : `Allocation for "${subjectById.get(toId(existing.subject))?.name || "Unknown"}" is no longer matched by any mapping. It was deleted.`,
          allocationId: existing._id,
        });
      }
    }

    if (!isPreview && orphans.length > 0) {
      await TeachingAllocation.deleteMany({ _id: { $in: orphans }, collegeId: req.collegeId });
      // Log audit for deletion
      for (const orphanId of orphans) {
        await AllocationAudit.create({
          collegeId: req.collegeId,
          allocationId: orphanId,
          action: "DELETE",
          performedBy: req.user?._id || req.userId,
          source: "MAPPING_SYNC",
          message: "Deleted orphaned teaching allocation during mapping sync.",
        });
      }
    }

    res.json({
      ok: true,
      isPreview,
      message: isPreview
        ? `Preview: ${totalAllocations} allocations analyzed.`
        : `Successfully synced ${totalAllocations} allocations.`,
      totalAllocations,
      totalCreates,
      totalUpdates,
      totalUnchanged,
      totalOrphans: orphans.length,
      conflicts,
      summary,
    });
  } catch (e) {
    console.error("[POST /teaching-allocations/calculate] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

protectedRouter.post("/teaching-allocations/sync-to-mappings", async (req, res) => {
  try {
    const allocations = await TeachingAllocation.find({ collegeId: req.collegeId }).lean();
    
    let totalMappingsCreated = 0;
    let totalFacultiesLinked = 0;

    for (const alloc of allocations) {
      const classIds = Array.isArray(alloc.classIds) ? alloc.classIds : [];
      const pairs = extractAllocationPairs(alloc);
      const hoursPerWeek = Number(alloc.hoursPerWeek || 1) || 1;

      for (const pair of pairs) {
        if (!pair.subject) continue;
        
        // 1. Sync Teacher-Subject Combination
        if (pair.teacher) {
          const combo = await TeacherSubjectCombination.findOneAndUpdate(
            { faculty: pair.teacher, subject: pair.subject, collegeId: req.collegeId },
            { $setOnInsert: { faculty: pair.teacher, subject: pair.subject, collegeId: req.collegeId } },
            { upsert: true, new: true }
          );
          if (combo) totalMappingsCreated++;
        }

        // 2. Sync Class-Subject Mappings
        for (const classId of classIds) {
          await ClassSubject.findOneAndUpdate(
            { class: classId, subject: pair.subject, collegeId: req.collegeId },
            { $set: { hoursPerWeek, collegeId: req.collegeId } },
            { upsert: true }
          );
          
          // 3. Link Faculty to Class
          if (pair.teacher) {
            const updatedClass = await ClassModel.findOneAndUpdate(
              { _id: classId, collegeId: req.collegeId },
              { $addToSet: { faculties: pair.teacher } }
            );
            if (updatedClass) totalFacultiesLinked++;
          }
        }
      }
    }

    res.json({
      ok: true,
      message: "Successfully synchronized allocations back to mappings.",
      totalMappingsCreated,
      totalFacultiesLinked
    });
  } catch (e) {
    console.error("[POST /teaching-allocations/sync-to-mappings] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

protectedRouter.get("/teaching-allocations/:id/history", async (req, res) => {
  try {
    const allocationId = toId(req.params.id);
    const history = await AllocationAudit.find({
      collegeId: req.collegeId,
      allocationId,
    })
      .populate("performedBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    res.json(history);
  } catch (e) {
    console.error("[GET /teaching-allocations/:id/history] Error:", e);
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

    // Audit Logging
    await AllocationAudit.create({
      collegeId: req.collegeId,
      allocationId,
      action: "DELETE",
      performedBy: req.user?._id || req.userId,
      source: allocation.source || "DIRECT",
      snapshot: {
        before: allocation,
      },
      message: "Deleted teaching allocation.",
    });

    res.json({ ok: true, message: "Allocation deleted." });
  } catch (e) {
    console.error("[DELETE /teaching-allocations] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default protectedRouter;
