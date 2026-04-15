import { Router } from 'express';
// import { fileURLTo__dirname } from 'url';
import Faculty from '../../models/Faculty.js';
import Subject from '../../models/Subject.js';
import ClassModel from '../../models/Class.js';
import ClassSubject from '../../models/ClassSubject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import TimetableResult from '../../models/TimetableResult.js';
import GenerationJob from '../../models/GenerationJob.js';
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
import { startEC2, waitForEC2 } from '../../utils/ec2.js';

const SOLVER_BASE_URL = String(process.env.SOLVER_URL || 'http://localhost:8001').replace(/\/+$/, '');
if (!SOLVER_BASE_URL) {
  throw new Error("SOLVER_URL is not defined");
}

const serializeJobStatus = (job) => {
  if (!job) return null;
  return {
    taskId: String(job._id),
    status: job.status,
    progress: Number(job.progress || 0),
    phase: job.phase || "queued",
    partialData: job.partial_data || null,
    result: job.result || null,
    error: job.error || null,
    cancelRequested: Boolean(job.cancel_requested),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
};


const protectedRouter = Router();
protectedRouter.use(auth);

// --- Timetable ---
protectedRouter.post('/process-new-input', async (req, res) => {
    try {
        console.log("[POST /process-new-input] Starting data processing for assignments...");

        // Step 1: Use prepareGeneratorData to get all necessary processed data
        const generatorData = await prepareGeneratorData(req.collegeId);
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
      const { fixedSlots, constraintConfig = {}, solutionCount } = req.body;
      const daysPerWeek = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
      const hoursPerDay = Number(constraintConfig?.schedule?.hoursPerDay) || 8;
  
      const generatorData = await prepareGeneratorData(req.collegeId);
      const mergedConstraintConfig = mergeTeacherPreferenceConstraintConfig(
        mergeTeacherAvailabilityConstraintConfig(
          constraintConfig,
          generatorData.faculties || []
        ),
        generatorData.faculties || []
      );

      const normalizedSolutionCount = Math.max(
        1,
        Math.min(5, Number(solutionCount) || Number(constraintConfig?.solver?.solutionCount) || 5)
      );
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
          schedule: {
            daysPerWeek,
            hoursPerDay,
          },
        },
      });

      let solverRes;
      let solverBody = null;
      try {
        // If an EC2 instance id is provided and we're in production, ensure the instance is running before calling the solver
        if (process.env.EC2_INSTANCE_ID && process.env.NODE_ENV === 'production') {
          try {
            await startEC2();
            await waitForEC2();
          } catch (ec2Err) {
            console.error("[POST /generate] EC2 control failed:", ec2Err);
            await GenerationJob.findOneAndUpdate({ _id: job._id, collegeId: req.collegeId }, {
              status: "failed",
              phase: "error",
              error: `EC2 control failed: ${String(ec2Err)}`,
              progress: 100,
            });
            return res.status(500).json({ error: "Failed to start EC2 instance." });
          }
        }

        solverRes = await fetch(`${SOLVER_BASE_URL}/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: String(job._id),
            payload: {
              collegeId: req.collegeId,
              ...generatorData,
              fixedSlots,
              DAYS_PER_WEEK: daysPerWeek,
              HOURS_PER_DAY: hoursPerDay,
              constraintConfig: mergedConstraintConfig,
              solutionCount: normalizedSolutionCount,
            },
          }),
        });
        solverBody = await solverRes.json().catch(() => null);
      } catch (solverErr) {
        const solverUnavailableMessage =
          SOLVER_BASE_URL === "http://localhost:8001"
            ? "Solver service is unreachable at http://localhost:8001. Set SOLVER_URL to your deployed Python solver when the backend runs serverlessly."
            : `Solver service is unreachable at ${SOLVER_BASE_URL}.`;
        await GenerationJob.findOneAndUpdate({ _id: job._id, collegeId: req.collegeId }, {
          status: "failed",
          phase: "error",
          error: solverUnavailableMessage,
          progress: 100,
        });
        return res.status(502).json({ error: solverUnavailableMessage });
      }

      if (!solverRes.ok || solverBody?.ok === false) {
        await GenerationJob.findOneAndUpdate({ _id: job._id, collegeId: req.collegeId }, {
          status: "failed",
          phase: "error",
          error: solverBody?.error || `Solver job start failed (${solverRes.status})`,
          progress: 100,
        });
        return res.status(502).json({ error: "Failed to start solver job." });
      }

      res.json({ taskId: String(job._id) });
    } catch (e) {
      console.error("Error in /generate:", e)
      res.status(500).json({ error: "Internal Server Error" });
    }
});

protectedRouter.post('/health-check', async (req, res) => {
    try {
      const { fixedSlots = [], constraintConfig = {} } = req.body || {};

      const generatorData = await prepareGeneratorData(req.collegeId);
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
      const { fixedSlots, constraintConfig = {} } = req.body;
      const daysPerWeek = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
      const hoursPerDay = Number(constraintConfig?.schedule?.hoursPerDay) || 8;
  
      const generatorData = await prepareGeneratorData(req.collegeId);
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
