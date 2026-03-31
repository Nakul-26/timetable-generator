import { parentPort } from "worker_threads";
import { runGeneration } from "../services/generator/generate.service.js";

let stopped = false;

parentPort.on("message", async (message) => {
  const { action, payload } = message;

  if (action === "STOP") {
    stopped = true;
    return;
  }

  if (action !== "GENERATE") return;

  try {
    const result = await runGeneration({
      ...payload,
      onProgress: ({ progress, partialData, phase }) => {
        if (stopped) {
          throw new Error("Generation stopped by user");
        }

        parentPort.postMessage({
          type: "PROGRESS",
          progress,
          phase,
          partialData
        });
      }
    });

    parentPort.postMessage({
      type: "RESULT",
      data: result
    });
  } catch (err) {
    parentPort.postMessage({
      type: "ERROR",
      error: err.message || "Worker error"
    });
  }
});
