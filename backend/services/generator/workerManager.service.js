import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import TimetableResult from "../../models/TimetableResult.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------------------------ */
/* ---------------- Internal State ---------------- */
/* ------------------------------------------------ */

const workers = new Map();
const taskResults = new Map();
let nextTaskId = 1;

/* ------------------------------------------------ */
/* ---------------- Worker Manager ---------------- */
/* ------------------------------------------------ */

export function startGenerationWorker({ payload }) {
  const taskId = nextTaskId++;

  const worker = new Worker(
    path.resolve(__dirname, "../../workers/worker.js"),
    {
        // IMPORTANT: These must be true to create the output streams
        stdout: true,
        stderr: true
    }
  );

  // Now that the streams are created, we can listen to them
  worker.stdout.on("data", (data) => {
    process.stdout.write(`[WORKER ${taskId}] ${data}`);
  });
  worker.stderr.on("data", (data) => {
    process.stderr.write(`[WORKER ${taskId} ERROR] ${data}`);
  });

  workers.set(taskId, worker);
  taskResults.set(taskId, {
    status: "running",
    progress: 0,
    phase: "queued"
  });

  // Use postMessage to send data to the worker, as it's set up to listen for messages
  worker.postMessage({
    action: "GENERATE",
    payload: { ...payload, taskId }
  });

  worker.on("message", async (message) => {
    if (message.type === "PROGRESS") {
      taskResults.set(taskId, {
        status: "running",
        progress: message.progress,
        phase: message.phase || "running",
        partialData: message.partialData
      });
    }

    if (message.type === "RESULT") {
      const resultData = message.data || {};
      const selectedTimetable = resultData.class_timetables || resultData.bestClassTimetables || null;
      const hasTimetable =
        resultData.ok === true &&
        selectedTimetable &&
        typeof selectedTimetable === "object" &&
        Object.keys(selectedTimetable).length > 0;

      if (hasTimetable) {
        const optionCount = Array.isArray(resultData.generation_options)
          ? resultData.generation_options.length
          : 1;
        const generatedName = `Generated Timetable Batch (${optionCount} options) - ${new Date().toLocaleString()}`;
        try {
          const collegeId = payload.collegeId || resultData.collegeId;

          // 1. Assign 30-day expiry to all existing generated timetables for this college
          // that don't already have one (or refresh their expiry).
          // This follows the rule: latest is permanent, previous ones get 30 days.
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 30);

          await TimetableResult.updateMany(
            { collegeId, source: "generator", expiresAt: null },
            { $set: { expiresAt: expiryDate } }
          );

          // 2. Save the new one without an expiry date (it becomes the "latest")
          const rec = new TimetableResult({
            collegeId,
            name: generatedName,
            source: "generator",
            status: "generated",
            class_timetables: selectedTimetable,
            faculty_timetables: resultData.faculty_timetables,
            faculty_daily_hours: resultData.faculty_daily_hours,
            score: resultData.score,
            objective_value: resultData.objectiveValue ?? null,
            generation_batch_id: resultData.generation_batch_id || null,
            selected_option_id: resultData.selected_option_id || null,
            generation_options: resultData.generation_options || [],
            subjects: resultData.subjects,
            faculties: resultData.faculties,
            combos: resultData.combos,
            allocations_report: resultData.allocations_report,
            config: resultData.config,
            expiresAt: null, // Latest generated has no expiry
          });
          await rec.save();
        } catch (saveErr) {
          console.error(`[WORKER ${taskId}] Failed to persist generated timetable:`, saveErr);
        }
      }

      taskResults.set(taskId, {
        status: "completed",
        progress: 100,
        phase: "done",
        result: resultData
      });
      cleanup(taskId);
    }

    if (message.type === "ERROR") {
      taskResults.set(taskId, {
        status: "error",
        phase: "error",
        error: message.error
      });
      cleanup(taskId);
    }
  });

  worker.on("error", (err) => {
    taskResults.set(taskId, {
      status: "error",
      phase: "error",
      error: err.message
    });
    cleanup(taskId);
  });

  worker.on("exit", (code) => {
    if (code !== 0) {
      const current = taskResults.get(taskId);
      if (!current || current.status === "running") {
        taskResults.set(taskId, {
          status: "error",
          phase: "error",
          error: `Worker exited with code ${code}`
        });
      }
    }
    cleanup(taskId);
  });

  return taskId;
}

export function stopGenerationWorker(taskId) {
  const worker = workers.get(taskId);
  if (!worker) return false;

  worker.postMessage({ action: "STOP" });
  return true;
}

export function getGenerationStatus(taskId) {
  return taskResults.get(taskId) || null;
}

/* ------------------------------------------------ */
/* ------------------ Cleanup --------------------- */
/* ------------------------------------------------ */

function cleanup(taskId) {
  const worker = workers.get(taskId);
  if (worker) {
    worker.terminate();
  }
  workers.delete(taskId);

  // Auto-clean task result after 1 minute
  setTimeout(() => {
    taskResults.delete(taskId);
  }, 60000).unref();
}
