import { Router } from 'express';
import { Worker } from 'worker_threads';
import path from 'path';
// import { fileURLTo__dirname } from 'url';
import Faculty from '../../models/Faculty.js';
import Subject from '../../models/Subject.js';
import ClassModel from '../../models/Class.js';
import ClassSubject from '../../models/ClassSubject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import TimetableResult from '../../models/TimetableResult.js';
import ElectiveSubjectSetting from '../../models/ElectiveSubjectSetting.js';
import runGenerate from '../../models/lib/runGenerator.js';
// Removed: import converter from '../../models/lib/convertNewCollegeInputToGeneratorData.js';
import { prepareGeneratorData } from '../../services/generator/prepareGeneratorData.js';
import { buildConstraintHealthReport } from '../../services/generator/healthCheck.service.js';
import {
  startGenerationWorker,
  stopGenerationWorker,
  getGenerationStatus,
} from "../../services/generator/workerManager.service.js";
import auth from '../../middleware/auth.js';
import { mergeTeacherAvailabilityConstraintConfig } from '../../utils/teacherAvailability.js';
import { mergeTeacherPreferenceConstraintConfig } from '../../utils/teacherPreferences.js';
import { exportTimetableExcel } from "../../services/export/timetableExport.service.js";


const protectedRouter = Router();
protectedRouter.use(auth);

// --- Timetable ---
protectedRouter.post('/process-new-input', async (req, res) => {
    try {
        console.log("[POST /process-new-input] Starting data processing for assignments...");

        // Step 1: Use prepareGeneratorData to get all necessary processed data
        const generatorData = await prepareGeneratorData({});
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
      const { fixedSlots, constraintConfig = {} } = req.body;
      const daysPerWeek = Number(constraintConfig?.schedule?.daysPerWeek) || 6;
      const hoursPerDay = Number(constraintConfig?.schedule?.hoursPerDay) || 8;
  
      // Fetch elective subject settings from the database
      const electiveSettings = await ElectiveSubjectSetting.find().lean();
      const classElectiveSubjects = electiveSettings.map(s => ({
          classId: s.class.toString(),
          subjectId: s.subject.toString(),
          numberOfTeachers: s.numberOfTeachers
      }));
  
      const generatorData = await prepareGeneratorData({
        classElectiveSubjects, // Pass the fetched settings
      });
      const mergedConstraintConfig = mergeTeacherPreferenceConstraintConfig(
        mergeTeacherAvailabilityConstraintConfig(
          constraintConfig,
          generatorData.faculties || []
        ),
        generatorData.faculties || []
      );
  
      const taskId = startGenerationWorker({
        payload: {
          ...generatorData,
          fixedSlots,
          DAYS_PER_WEEK: daysPerWeek,
          HOURS_PER_DAY: hoursPerDay,
          constraintConfig: mergedConstraintConfig,
        },
      });
  
      res.json({ taskId });
    } catch (e) {
      console.error("Error in /generate:", e)
      res.status(500).json({ error: "Internal Server Error" });
    }
});

protectedRouter.post('/health-check', async (req, res) => {
    try {
      const { fixedSlots = [], constraintConfig = {} } = req.body || {};

      const electiveSettings = await ElectiveSubjectSetting.find().lean();
      const classElectiveSubjects = electiveSettings.map(s => ({
          classId: s.class.toString(),
          subjectId: s.subject.toString(),
          numberOfTeachers: s.numberOfTeachers
      }));

      const generatorData = await prepareGeneratorData({
        classElectiveSubjects,
      });
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
        const settings = await ElectiveSubjectSetting.find({ class: classId }).lean();
        
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

        await ElectiveSubjectSetting.deleteMany({ class: classId });

        const settingsToInsert = settings.map(setting => ({
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
  const taskId = Number(req.params.taskId);

  const stopped = stopGenerationWorker(taskId);
  if (!stopped) {
    return res.status(404).json({ error: "Task not found" });
  }

  res.json({ ok: true, message: `Stop signal sent to task ${taskId}` });
});

protectedRouter.get('/generation-status/:taskId', (req, res) => {
  const taskId = Number(req.params.taskId);
  const status = getGenerationStatus(taskId);

  if (!status) {
    return res.status(404).json({ error: "Task not found" });
  }

  res.json(status);
});


protectedRouter.get('/result/latest', async (req, res) => {
  console.log("[GET /result/latest] Fetching latest timetable result");
  try {
    const r = await TimetableResult.findOne({ source: 'generator' }).sort({ createdAt: -1 }).lean();
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
        const timetables = await TimetableResult.find({ source: 'assignments' }).sort({ createdAt: -1 });
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
        const timetable = await TimetableResult.findById(req.params.id).lean();
        if (!timetable) {
            return res.status(404).json({ error: 'Timetable not found.' });
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

        const timetable = await TimetableResult.findById(req.params.id).lean();
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
  
      // Fetch elective subject settings from the database
      const electiveSettings = await ElectiveSubjectSetting.find().lean();
      const classElectiveSubjects = electiveSettings.map(s => ({
          classId: s.class.toString(),
          subjectId: s.subject.toString(),
          numberOfTeachers: s.numberOfTeachers
      }));
  
      const generatorData = await prepareGeneratorData({ classElectiveSubjects });
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
    const result = await TimetableResult.deleteMany({});

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
