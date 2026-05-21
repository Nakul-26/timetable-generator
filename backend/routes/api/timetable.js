import { Router } from 'express';
// import { fileURLTo__dirname } from 'url';
import fs from 'fs';
import Faculty from '../../models/Faculty.js';
import Subject from '../../models/Subject.js';
import ClassModel from '../../models/Class.js';
import ClassSubject from '../../models/ClassSubject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import TimetableResult from '../../models/TimetableResult.js';
import GenerationJob from '../../models/GenerationJob.js';
import TimetableUserSettings from '../../models/TimetableUserSettings.js';
import ElectiveSubjectSetting from '../../models/ElectiveSubjectSetting.js';
import runGenerate from '../../models/lib/runGenerator.js';
// Removed: import converter from '../../models/lib/convertNewCollegeInputToGeneratorData.js';
import { prepareGeneratorData } from '../../services/generator/prepareGeneratorData.js';
import { buildConstraintHealthReport } from '../../services/generator/healthCheck.service.js';
import auth from '../../middleware/auth.js';
import { mergeTeacherAvailabilityConstraintConfig } from '../../utils/teacherAvailability.js';
import { mergeTeacherPreferenceConstraintConfig } from '../../utils/teacherPreferences.js';
import { exportTimetableExcel } from "../../services/export/timetableExport.service.js";
import { buildSubjectMap, collectSubjectIdsFromEncodedSubjectId, getComboSubjectDisplayName } from "../../utils/subjectDisplay.js";
import { startEC2, waitForEC2, waitForSolver } from '../../utils/ec2.js';

const SOLVER_BASE_URL = String(process.env.SOLVER_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');
console.log("Using SOLVER_BASE_URL:", SOLVER_BASE_URL);
if (!SOLVER_BASE_URL) {
  throw new Error("SOLVER_URL is not defined");
}

const serializeJobStatus = (job) => {
  if (!job) return null;
  const timeLimitSec = Math.max(
    0,
    Number(job?.input?.constraintConfig?.solver?.timeLimitSec) ||
      Number(job?.payload?.constraintConfig?.solver?.timeLimitSec) ||
      0
  );
  const deadlineAt = timeLimitSec > 0 && job.createdAt
    ? new Date(new Date(job.createdAt).getTime() + timeLimitSec * 1000)
    : null;
  const remainingSec = deadlineAt
    ? Math.max(0, Math.ceil((deadlineAt.getTime() - Date.now()) / 1000))
    : null;
  return {
    taskId: String(job._id),
    status: job.status,
    progress: Number(job.progress || 0),
    phase: job.phase || "queued",
    partialData: job.partial_data || null,
    result: job.result || null,
    error: job.error || null,
    cancelRequested: Boolean(job.cancel_requested),
    timeLimitSec,
    deadlineAt,
    remainingSec,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
};

const filterGeneratorDataForSolver = (generatorData) => {
  const classes = Array.isArray(generatorData?.classes) ? generatorData.classes : [];
  const combos = Array.isArray(generatorData?.combos) ? generatorData.combos : [];

  const activeClasses = classes.filter((cls) => {
    const assigned = Array.isArray(cls?.assigned_teacher_subject_combos)
      ? cls.assigned_teacher_subject_combos.filter(Boolean)
      : [];
    return assigned.length > 0;
  });

  const skippedClasses = classes.filter((cls) => {
    const assigned = Array.isArray(cls?.assigned_teacher_subject_combos)
      ? cls.assigned_teacher_subject_combos.filter(Boolean)
      : [];
    return assigned.length === 0;
  });

  const activeClassIds = new Set(activeClasses.map((cls) => String(cls._id)));
  const activeComboIds = new Set();
  const activeCombos = [];

  for (const combo of combos) {
    const classIds = Array.isArray(combo?.class_ids)
      ? combo.class_ids.map((classId) => String(classId)).filter((classId) => activeClassIds.has(classId))
      : [];

    if (classIds.length === 0) continue;

    const comboId = String(combo?._id || "");
    if (comboId) activeComboIds.add(comboId);
    activeCombos.push({
      ...combo,
      class_ids: classIds,
    });
  }

  const filteredClasses = activeClasses.map((cls) => {
    const assigned = Array.isArray(cls?.assigned_teacher_subject_combos)
      ? cls.assigned_teacher_subject_combos
          .map((id) => String(id))
          .filter((id) => activeComboIds.has(id))
      : [];
    return {
      ...cls,
      assigned_teacher_subject_combos: assigned,
    };
  });

  return {
    ...generatorData,
    classes: filteredClasses,
    combos: activeCombos,
    skippedClasses,
  };
};


const protectedRouter = Router();
protectedRouter.use(auth);

// --- Timetable Settings (per-user, per-college) ---
protectedRouter.get('/timetable-settings', async (req, res) => {
  try {
    const doc = await TimetableUserSettings.findOne({
      collegeId: req.collegeId,
      userId: req.user?._id,
    }).lean();

    res.json({
      ok: true,
      settings: doc
        ? {
            constraintConfig: doc.constraintConfig ?? null,
            blockGenerateOnHealthErrors: Boolean(doc.blockGenerateOnHealthErrors),
            fixedSlots: doc.fixedSlots ?? null,
            inputMode: doc.inputMode ?? "EXPLICIT",
            updatedAt: doc.updatedAt,
          }
        : {
            constraintConfig: null,
            blockGenerateOnHealthErrors: false,
            fixedSlots: null,
            inputMode: "EXPLICIT",
            updatedAt: null,
          },
    });
  } catch (e) {
    console.error('[GET /timetable-settings] Error:', e);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

protectedRouter.put('/timetable-settings', async (req, res) => {
  try {
    const { constraintConfig = null, blockGenerateOnHealthErrors = false, fixedSlots = null, inputMode = "EXPLICIT" } =
      req.body || {};

    const updated = await TimetableUserSettings.findOneAndUpdate(
      { collegeId: req.collegeId, userId: req.user?._id },
      {
        $set: {
          collegeId: req.collegeId,
          userId: req.user?._id,
          constraintConfig,
          blockGenerateOnHealthErrors: Boolean(blockGenerateOnHealthErrors),
          fixedSlots,
          inputMode,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({
      ok: true,
      settings: {
        constraintConfig: updated.constraintConfig ?? null,
        blockGenerateOnHealthErrors: Boolean(updated.blockGenerateOnHealthErrors),
        fixedSlots: updated.fixedSlots ?? null,
        inputMode: updated.inputMode ?? "EXPLICIT",
        updatedAt: updated.updatedAt,
      },
    });
  } catch (e) {
    console.error('[PUT /timetable-settings] Error:', e);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

// --- Timetable ---
protectedRouter.post('/process-new-input', async (req, res) => {
    try {
        console.log("[POST /process-new-input] Starting data processing for assignments...");

        // Step 1: Use prepareGeneratorData to get all necessary processed data
        const generatorData = await prepareGeneratorData(req.collegeId, "DERIVED"); // Health check uses derived mode
        const { classes: classesOut, combos: generatedCombos, subjects, faculties } = generatorData;
        
        // Step 2: Create lookup maps for names
        const subjectMap = new Map(subjects.map(s => [s._id, s.name]));
        const facultyMap = new Map(faculties.map(f => [f._id, f.name]));

        const assignmentsOnly = {}; // Note: This will be handled differently now
        const classAssignmentsForFrontend = [];

        // Step 3: Process assignments for each class for frontend display
        for (const classData of classesOut) {
            const classCombos = generatedCombos.filter(c => c.class_ids.includes(classData._id.toString()));
            
            const assignedCombosDetails = [];
            const comboIdsToSave = [];

            for (const combo of classCombos) {
                const subjectName = subjectMap.get(combo.subject_id) || 'Unknown Subject';

                if (combo.faculty_id) { // Non-elective with a single teacher
                    const teacherName = facultyMap.get(combo.faculty_id) || 'Unknown Teacher';
                    assignedCombosDetails.push({
                        _id: combo._id,
                        faculty: { name: teacherName },
                        subject: { name: subjectName }
                    });
                    // This is a pre-existing combo, so we can try to find its ID to save
                    // This part is complex because we don't have the original TeacherSubjectCombination _id here.
                    // For now, we will focus on the frontend display.
                } else if (combo.faculty_ids) { // Elective with multiple teachers
                    const teacherNames = combo.faculty_ids
                        .map(teacherId => facultyMap.get(teacherId) || 'Unknown Teacher')
                        .join(' & ');

                    assignedCombosDetails.push({
                        _id: combo._id,
                        faculty: { name: teacherNames },
                        subject: { name: subjectName }
                    });
                }
            }
            
            // For now, we'll save the raw generated combo IDs to assignments_only.
            // This will not work with the frontend's "Previously Saved Assignments" display
            // because the population hook expects TeacherSubjectCombination IDs.
            // This is a known limitation to address the user's primary request.
            assignmentsOnly[classData._id.toString()] = classCombos.map(c => c._id);

            classAssignmentsForFrontend.push({
                classId: classData._id.toString(),
                className: classData.name,
                combos: assignedCombosDetails
            });
        }

        // 4. Save the generated assignments as a new TimetableResult
        const newAssignmentName = `Processed Assignments - ${new Date().toLocaleString()}`;
    const newAssignmentResult = new TimetableResult({
      collegeId: req.collegeId,
      name: newAssignmentName,
      source: 'assignments',
      status: 'draft',
      // Storing raw combo data instead of refs.
            // We are creating a new property 'raw_combos' to not break the existing schema.
            // Note: This is a placeholder for a more robust solution.
            assignments_only: assignmentsOnly, // This won't populate correctly.
            combos: generatedCombos // Saving the generated combos directly for future use.
        });
        await newAssignmentResult.save();
        console.log(`[POST /process-new-input] Successfully saved assignments: ${newAssignmentName}`);
        
        res.json({ 
            ok: true, 
            message: `Successfully processed and saved new assignments: "${newAssignmentName}"`,
            classAssignments: classAssignmentsForFrontend
        });

    } catch (err) {
        console.error("[POST /process-new-input] Error:", err);
        res.status(500).json({ ok: false, error: 'Internal Server Error' });
    }
});

protectedRouter.post('/generate', async (req, res) => {
    try {
      // Load user settings to get inputMode
      const userSettings = await TimetableUserSettings.findOne({
        collegeId: req.collegeId,
        userId: req.user?._id,
      }).lean();

      const { fixedSlots, constraintConfig = {}, solutionCount } = req.body;
      const inputMode = userSettings?.inputMode || "EXPLICIT";
      const daysPerWeek = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
      const hoursPerDay = Number(constraintConfig?.schedule?.hoursPerDay) || 8;

      console.log("[POST /generate] Generation request:", {
        fixedSlots: !!fixedSlots,
        constraintConfig: !!constraintConfig,
        solutionCount,
        inputMode,
        userSettingsLoaded: !!userSettings,
      });

      const generatorData = await prepareGeneratorData(req.collegeId, inputMode);
      
      const filteredGeneratorData = filterGeneratorDataForSolver(generatorData);
      if (String(process.env.DEBUG_LAB_ALLOCATION || "").trim().toLowerCase() === "1" ||
        String(process.env.DEBUG_LAB_ALLOCATION || "").trim().toLowerCase() === "true") {
        const classSummary = (filteredGeneratorData.classes || []).map((klass) => ({
          classId: String(klass._id),
          className: klass.name || String(klass._id),
          assignedCombos: Array.isArray(klass.assigned_teacher_subject_combos) ? klass.assigned_teacher_subject_combos.length : 0,
          subjectHours: klass.subject_hours || {},
        }));
        const comboSummary = (filteredGeneratorData.combos || []).map((combo) => ({
          comboId: String(combo._id),
          subjectId: String(combo.subject_id),
          subjectName: combo.subject?.name || String(combo.subject_id),
          classIds: combo.class_ids || [],
          facultyIds: combo.faculty_ids || [],
          hoursPerWeek: combo.hours_per_week,
        }));
        console.log("[POST /generate] filtered generator summary", {
          classes: classSummary,
          combos: comboSummary,
        });
      }
      const mergedConstraintConfig = mergeTeacherPreferenceConstraintConfig(
        mergeTeacherAvailabilityConstraintConfig(
          constraintConfig,
          filteredGeneratorData.faculties || []
        ),
        filteredGeneratorData.faculties || []
      );

      console.log("[POST /generate] Merged constraint config:", mergedConstraintConfig,

        "22222222222222222222222222222222222222222222222222222222222222"
      );

      if (filteredGeneratorData.skippedClasses.length > 0) {
        console.warn(
          "[POST /generate] Skipping classes without assigned teacher-subject combos:",
          filteredGeneratorData.skippedClasses.map((cls) => ({
            classId: String(cls._id),
            className: cls.name || String(cls._id),
          }))
        );
      }

      console.log("33333333333333333333333333333333333333333333333333333333333333333");

      const normalizedSolutionCount = Math.max(
        1,
        Math.min(5, Number(solutionCount) || Number(constraintConfig?.solver?.solutionCount) || 5)
      );

      console.log("44444444444444444444444444444444444444444444444444444444444444");

      const job = await GenerationJob.create({
        collegeId: req.collegeId,
        status: "pending",
        phase: "queued",
        progress: 0,
        solution_count: normalizedSolutionCount,
        created_by: req.user?._id || null,
        input: {
          fixedSlots: fixedSlots || [],
          constraintConfig: mergedConstraintConfig,
          skippedClasses: filteredGeneratorData.skippedClasses.map((cls) => ({
            classId: String(cls._id),
            className: cls.name || String(cls._id),
          })),
          schedule: {
            daysPerWeek,
            hoursPerDay,
          },
        },
        payload: {
          collegeId: req.collegeId,
          inputMode,
          ...filteredGeneratorData,
          fixedSlots,
          DAYS_PER_WEEK: daysPerWeek,
          HOURS_PER_DAY: hoursPerDay,
          constraintConfig: mergedConstraintConfig,
          solutionCount: normalizedSolutionCount,
        },
      });

      console.log("555555555555555555555555555555555555555555555555555555555555555555555");
      // IMPORTANT (Vercel/serverless): avoid keeping the event loop alive with long-running
      // fire-and-forget requests. Default to "pull" mode on Vercel: solver polls MongoDB
      // for pending jobs and starts them itself.
      const solverStartMode = String(
        process.env.SOLVER_JOB_START_MODE || (process.env.VERCEL ? "pull" : "push")
      ).toLowerCase();

      console.log("666666666666666666666666666666666666666666666666666666666666");

      if (solverStartMode === "push") {
        // If an EC2 instance id is provided and we're in production, ensure the instance is running before calling the solver
        if (process.env.EC2_INSTANCE_ID && process.env.NODE_ENV === 'production') {
          try {
            await startEC2();
            await waitForEC2();
            await waitForSolver();
          } catch (ec2Err) {
            console.error("[POST /generate] EC2/Solver control failed:", ec2Err);
            await GenerationJob.findOneAndUpdate({ _id: job._id, collegeId: req.collegeId }, {
              status: "failed",
              phase: "error",
              error: `EC2/Solver control failed: ${String(ec2Err)}`,
              progress: 100,
            });
            return res.status(500).json({ error: "Failed to start EC2 instance or solver." });
          }
        }

        console.log("77777777777777777777777777777777777777777777777777777777777777");

        const requestBody = {
          jobId: String(job._id),
          payload: job.payload,
        };

        console.log("**************************************************************************************[POST /generate] Sending job to solver with payload:", {
          jobId: requestBody.jobId,
          payloadSummary: {
            collegeId: requestBody.payload.collegeId,
            inputMode: requestBody.payload.inputMode,
            solutionCount: requestBody.payload.solutionCount,
          },
          constraintConfig: requestBody.payload.constraintConfig,
          completePayload: requestBody.payload, // This can be very large; be cautious when logging in production
        });

        // Best-effort push with a short timeout; do not block the response.
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2500);

          fetch(`${SOLVER_BASE_URL}/jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          })
            .then(() => {})
            .catch(() => {})
            .finally(() => clearTimeout(timeoutId));
        } catch {
          // ignore
        }
      }

      // Return immediately without waiting for solver
      return res.json({ taskId: String(job._id) });
    } catch (e) {
      console.error("Error in /generate:", e);
      return res.status(500).json({ error: "Internal Server Error" });
    }
});

protectedRouter.post('/health-check', async (req, res) => {
    try {
      // Load user settings to get inputMode
      const userSettings = await TimetableUserSettings.findOne({
        collegeId: req.collegeId,
        userId: req.user?._id,
      }).lean();

      const { fixedSlots = [], constraintConfig = {} } = req.body || {};
      const inputMode = userSettings?.inputMode || "EXPLICIT";

      const generatorData = await prepareGeneratorData(req.collegeId, inputMode);
      const mergedConstraintConfig = mergeTeacherPreferenceConstraintConfig(
        mergeTeacherAvailabilityConstraintConfig(
          constraintConfig,
          generatorData.faculties || []
        ),
        generatorData.faculties || []
      );

      const report = buildConstraintHealthReport({
        ...generatorData,
        fixedSlots,
        constraintConfig: mergedConstraintConfig,
      });

      res.json(report);
    } catch (e) {
      console.error("Error in /health-check:", e);
      res.status(500).json({ ok: false, error: "Internal Server Error" });
    }
});

protectedRouter.post('/audit', async (req, res) => {
    try {
      // Load user settings to get inputMode
      const userSettings = await TimetableUserSettings.findOne({
        collegeId: req.collegeId,
        userId: req.user?._id,
      }).lean();

      const { fixedSlots, constraintConfig = {} } = req.body || {};
      const inputMode = userSettings?.inputMode || "EXPLICIT";
      const daysPerWeek = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
      const hoursPerDay = Number(constraintConfig?.schedule?.hoursPerDay) || 8;

      const generatorData = await prepareGeneratorData(req.collegeId, inputMode);
      const filteredGeneratorData = filterGeneratorDataForSolver(generatorData);
      
      const mergedConstraintConfig = mergeTeacherPreferenceConstraintConfig(
        mergeTeacherAvailabilityConstraintConfig(
          constraintConfig,
          filteredGeneratorData.faculties || []
        ),
        filteredGeneratorData.faculties || []
      );

      const requestBody = {
        payload: {
          collegeId: req.collegeId,
          inputMode,
          ...filteredGeneratorData,
          fixedSlots,
          DAYS_PER_WEEK: daysPerWeek,
          HOURS_PER_DAY: hoursPerDay,
          constraintConfig: mergedConstraintConfig,
        },
      };

      const response = await fetch(`${SOLVER_BASE_URL}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const auditResult = await response.json();
      res.json(auditResult);
    } catch (e) {
      console.error("Error in /audit:", e);
      res.status(500).json({ ok: false, error: "Internal Server Error" });
    }
});

protectedRouter.get('/elective-settings/:classId', async (req, res) => {
    try {
        const { classId } = req.params;
        const settings = await ElectiveSubjectSetting.find({ class: classId, collegeId: req.collegeId }).lean();
        
        const settingsMap = settings.map(setting => ({
            subjectId: setting.subject.toString(),
            teacherCategoryRequirements: setting.teacherCategoryRequirements || {}
        }));

        res.json(settingsMap);
    } catch (error) {
        console.error("Error fetching elective settings:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

    protectedRouter.get('/elective-groups', async (req, res) => {
      try {
        const settings = await ElectiveSubjectSetting.find({ collegeId: req.collegeId }).lean();

        const groups = [];
        const seen = new Set();

        for (const setting of settings || []) {
          const classId = String(setting?.class || "");

          const requirementsRaw = setting?.teacherCategoryRequirements;
          const requirements = requirementsRaw instanceof Map
            ? Object.fromEntries(requirementsRaw.entries())
            : (requirementsRaw || {});

          const subjects = Object.keys(requirements || {}).map(String).filter(Boolean);
          if (!classId || subjects.length === 0) continue;

          subjects.sort();
          const key = `${classId}|${subjects.join(',')}`;
          if (seen.has(key)) continue;
          seen.add(key);

          groups.push({ classId, subjects });
        }

        res.json(groups);
      } catch (error) {
        console.error('Error fetching elective groups:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

protectedRouter.post('/elective-settings', async (req, res) => {
    try {
        const { classId, settings } = req.body;
        if (!classId || !Array.isArray(settings)) {
            return res.status(400).json({ error: 'Invalid request body' });
        }

        await ElectiveSubjectSetting.deleteMany({ class: classId, collegeId: req.collegeId });

        const settingsToInsert = settings.map(setting => ({
            collegeId: req.collegeId,
            class: classId,
            subject: setting.subjectId,
            teacherCategoryRequirements: setting.teacherCategoryRequirements || {}
        }));

        if (settingsToInsert.length > 0) {
            await ElectiveSubjectSetting.insertMany(settingsToInsert);
        }

        res.status(200).json({ ok: true, message: 'Elective settings saved successfully.' });
    } catch (error) {
        console.error('Error saving elective settings:', error);
        res.status(500).json({ ok: false, error: 'Internal Server Error' });
    }
});

protectedRouter.post('/stop-generator/:taskId', (req, res) => {
  GenerationJob.findOneAndUpdate({ _id: req.params.taskId, collegeId: req.collegeId }, {
    cancel_requested: true,
    phase: "cancel_requested",
  })
    .then((job) => {
      if (!job) {
        return res.status(404).json({ error: "Task not found" });
      }
      return res.json({ ok: true, message: `Stop signal recorded for task ${req.params.taskId}` });
    })
    .catch(() => res.status(500).json({ error: "Internal Server Error" }));
});

protectedRouter.get('/generation-status/:taskId', async (req, res) => {
  try {
    const job = await GenerationJob.findOne({ _id: req.params.taskId, collegeId: req.collegeId }).lean();
    if (!job) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json(serializeJobStatus(job));
  } catch {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

protectedRouter.get('/generation-payload/latest', async (req, res) => {
  try {
    const job = await GenerationJob.findOne({
      collegeId: req.collegeId,
      payload: { $ne: null },
    }).sort({ updatedAt: -1 }).lean();
    if (!job) {
      return res.status(404).json({ error: "No generation payload found." });
    }
    res.json({
      taskId: String(job._id),
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      payload: job.payload || null,
      input: job.input || null,
    });
  } catch (e) {
    console.error("[GET /generation-payload/latest] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

protectedRouter.get('/generation-payload/:taskId', async (req, res) => {
  try {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId || taskId.toLowerCase() === "latest") {
      return res.status(400).json({ error: "Use /generation-payload/latest for the latest payload." });
    }
    const job = await GenerationJob.findOne({ _id: taskId, collegeId: req.collegeId }).lean();
    if (!job) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json({
      taskId: String(job._id),
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      payload: job.payload || null,
      input: job.input || null,
    });
  } catch (e) {
    console.error("[GET /generation-payload/:taskId] Error:", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


protectedRouter.get('/result/latest', async (req, res) => {
  console.log("[GET /result/latest] Fetching latest timetable result");
  try {
    const latestJob = await GenerationJob.findOne({
      collegeId: req.collegeId,
      status: 'completed',
      result: { $ne: null },
    }).sort({ updatedAt: -1 }).lean();
    if (latestJob?.result) {
      console.log("[GET /result/latest] Found completed generation job result");
      return res.json(latestJob.result);
    }

    const r = await TimetableResult.findOne({ collegeId: req.collegeId, source: 'generator' }).sort({ createdAt: -1 }).lean();
    console.log("[GET /result/latest] Found:", r ? "Yes" : "No");
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

protectedRouter.get('/timetables', async (req, res) => {
    console.log("[GET /timetables] Fetching all saved timetables");
    try {
        const timetables = await TimetableResult.find({
          collegeId: req.collegeId,
          source: { $in: ['manual', 'generator'] }
        })
          .sort({ createdAt: -1 })
          .lean();
        console.log("[GET /timetables] Found:", timetables.length, "records");
        res.json(timetables);
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

protectedRouter.get('/processed-assignments', async (req, res) => {
    console.log("[GET /processed-assignments] Fetching all saved assignment-only results");
    try {
        // The post-find hook on TimetableResult will populate 'populated_assignments'
        const timetables = await TimetableResult.find({ collegeId: req.collegeId, source: 'assignments' }).sort({ createdAt: -1 });
        console.log("[GET /processed-assignments] Found:", timetables.length, "records");
        res.json({ savedTimetables: timetables });
    } catch (e) {
        console.error("[GET /processed-assignments] Error:", e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

protectedRouter.get('/timetable/:id', async (req, res) => {
    console.log("[GET /timetable/:id] Fetching timetable with id:", req.params.id);
    try {
        const timetable = await TimetableResult.findOne({ _id: req.params.id, collegeId: req.collegeId }).lean();
        if (!timetable) {
            return res.status(404).json({ error: 'Timetable not found.' });
        }
        if (Array.isArray(timetable?.combos)) {
          const storedSubjectMap = buildSubjectMap(timetable.subjects || []);
          const missingSubjectIds = new Set();
          timetable.combos.forEach((combo) => {
            const subjectId = String(combo?.subject?._id || combo?.subject_id || combo?.subject || "");
            if (/^[0-9a-fA-F]{24}$/.test(subjectId)) {
              missingSubjectIds.add(subjectId);
            }
            collectSubjectIdsFromEncodedSubjectId(subjectId).forEach((id) => missingSubjectIds.add(id));
          });
          const subjectDocs = missingSubjectIds.size
            ? await Subject.find({ _id: { $in: [...missingSubjectIds] }, collegeId: req.collegeId }).select("name type").lean()
            : [];
          const subjectMap = new Map([
            ...storedSubjectMap.entries(),
            ...subjectDocs.map((subject) => [String(subject._id), subject]),
          ]);
          timetable.combos = timetable.combos.map((combo) => {
            const subjectId = String(combo?.subject?._id || combo?.subject_id || combo?.subject || "");
            if (combo?.subject?.name) {
              return combo;
            }
            return {
              ...combo,
              subject: {
                _id: subjectId,
                name: getComboSubjectDisplayName(combo, subjectMap),
                type:
                  combo?.subject?.type ||
                  subjectMap.get(subjectId)?.type ||
                  combo?.subject_type ||
                  combo?.type ||
                  "theory",
                isVirtual: Boolean(combo?.subject?.isVirtual || subjectMap.get(subjectId)?.isVirtual),
              },
            };
          });
        }
        console.log("[GET /timetable/:id] Found timetable:", timetable.name);
        res.json(timetable);
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

protectedRouter.get('/timetable/:id/export/excel', async (req, res) => {
    try {
        const mode = String(req.query.mode || 'class').toLowerCase();
        if (!['class', 'teacher', 'full'].includes(mode)) {
            return res.status(400).json({ error: 'Invalid export mode.' });
        }

        const timetable = await TimetableResult.findOne({ _id: req.params.id, collegeId: req.collegeId }).lean();
        if (!timetable) {
            return res.status(404).json({ error: 'Timetable not found.' });
        }

        const workbook = await exportTimetableExcel({ timetable, mode });
        const safeName = String(timetable.name || 'timetable')
          .replace(/[<>:"/\\|?*]+/g, '_')
          .replace(/\s+/g, '_')
          .toLowerCase();

        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${safeName}_${mode}.xlsx"`
        );

        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error('[GET /timetable/:id/export/excel] Error:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

protectedRouter.post("/result/regenerate", async (req, res) => {
    try {
      // Load user settings to get inputMode
      const userSettings = await TimetableUserSettings.findOne({
        collegeId: req.collegeId,
        userId: req.user?._id,
      }).lean();

      const { fixedSlots, constraintConfig = {}, solutionCount } = req.body;
      const inputMode = userSettings?.inputMode || "EXPLICIT";
      const daysPerWeek = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
      const hoursPerDay = Number(constraintConfig?.schedule?.hoursPerDay) || 8;
  
      const generatorData = await prepareGeneratorData(req.collegeId, inputMode);
      const mergedConstraintConfig = mergeTeacherPreferenceConstraintConfig(
        mergeTeacherAvailabilityConstraintConfig(
          constraintConfig,
          generatorData.faculties || []
        ),
        generatorData.faculties || []
      );
    
    const { faculties, subjects, classes, combos } = generatorData;

    const {
      bestClassTimetables,
      bestFacultyTimetables,
      bestFacultyDailyHours,
      bestScore,
      objectiveValue,
      config,
      generation_batch_id,
      selected_option_id,
      generation_options,
    } = await runGenerate({
      faculties,
      subjects,
      classes,
      combos,
      fixedSlots,
      DAYS_PER_WEEK: daysPerWeek,
      HOURS_PER_DAY: hoursPerDay,
      constraintConfig: mergedConstraintConfig,
    });

    if (!bestClassTimetables) {
      console.warn("[POST /generate] Generation failed: No valid timetable found.");
      return res.status(400).json({ ok: false, error: "Failed to generate timetable." });
    }

    const rec = new TimetableResult({
      collegeId: req.collegeId,
      name: `Generated Timetable - ${new Date().toLocaleString()}`,
      source: 'generator',
      status: 'generated',
      class_timetables: bestClassTimetables,
      faculty_timetables: bestFacultyTimetables,
      faculty_daily_hours: bestFacultyDailyHours,
      score: bestScore,
      objective_value: objectiveValue ?? null,
      generation_batch_id: generation_batch_id ?? null,
      selected_option_id: selected_option_id ?? null,
      generation_options: generation_options ?? [],
      subjects,
      faculties,
      combos,
      config,
    });

    await rec.save();
    console.log("[POST /generate] Saved timetable result");

    res.json({
      ok: true,
      score: bestScore,
      class_timetables: bestClassTimetables,
      faculty_timetables: bestFacultyTimetables,
      faculty_daily_hours: bestFacultyDailyHours,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

protectedRouter.delete("/timetables", async (req, res) => {
  try {
    // Delete all timetables
    const result = await TimetableResult.deleteMany({ collegeId: req.collegeId });

    res.status(200).json({
      ok: true,
      deletedCount: result.deletedCount, // tells how many docs were removed
      message: "All timetables deleted successfully"
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// Save a new timetable
protectedRouter.post("/timetables", async (req, res) => {
  try {
    const { name, timetableData } = req.body;
    if (!name || !timetableData) {
      return res.status(400).json({ error: "Missing name or timetable data." });
    }

    const newTimetable = new TimetableResult({
      collegeId: req.collegeId,
      name,
      source: 'generator', // Mark as from the generator
      status: 'generated',
      created_by: req.user?._id || null,
      class_timetables: timetableData.class_timetables,
      faculty_timetables: timetableData.faculty_timetables,
      faculty_daily_hours: timetableData.faculty_daily_hours,
      score: timetableData.score,
      objective_value: timetableData.objectiveValue ?? timetableData.objective_value ?? null,
      generation_batch_id: timetableData.generation_batch_id ?? null,
      selected_option_id: timetableData.selected_option_id ?? null,
      generation_options: timetableData.generation_options ?? [],
      subjects: timetableData.subjects,
      faculties: timetableData.faculties,
      combos: timetableData.combos,
      allocations_report: timetableData.allocations_report,
      config: timetableData.config,
    });

    const saved = await newTimetable.save();
    res.status(201).json(saved);

  } catch (err) {
    console.error("Error saving timetable:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

export default protectedRouter;
