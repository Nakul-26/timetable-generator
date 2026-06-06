import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import timetableRouter from "../routes/api/timetable.js";
import GenerationJob from "../models/GenerationJob.js";
import TimetableUserSettings from "../models/TimetableUserSettings.js";
import { prepareGeneratorData } from "../services/generator/prepareGeneratorData.js";

vi.mock("../models/GenerationJob.js");
vi.mock("../models/TimetableUserSettings.js");
vi.mock("../models/TimetableResult.js");
vi.mock("../models/Subject.js");
vi.mock("../services/generator/prepareGeneratorData.js");
vi.mock("../utils/ec2.js");

// Mock global fetch for solver push
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ ok: true }),
});

// Mock middlewares
vi.mock("../middleware/auth.js", () => ({
  default: (req, res, next) => {
    req.user = { _id: "admin-1", role: "admin", collegeId: "bmsit" };
    next();
  },
}));

describe("Timetable API Routes", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.collegeId = "bmsit";
      next();
    });
    app.use("/api", timetableRouter);
  });

  describe("POST /api/generate", () => {
    it("should create a generation job and return taskId", async () => {
      process.env.SOLVER_JOB_START_MODE = "pull";
      const mockJob = { _id: "job-123", status: "pending", payload: { collegeId: "bmsit" } };
      GenerationJob.create.mockResolvedValue(mockJob);
      TimetableUserSettings.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ inputMode: "EXPLICIT" }) });
      prepareGeneratorData.mockResolvedValue({
        classes: [{ _id: "class-1", assigned_teacher_subject_combos: ["combo-1"] }],
        combos: [{ _id: "combo-1", class_ids: ["class-1"] }],
        faculties: [],
        skippedClasses: [],
      });

      const res = await request(app)
        .post("/api/generate")
        .send({
          constraintConfig: { solver: { timeLimitSec: 60 } },
          solutionCount: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.taskId).toBe("job-123");
      expect(GenerationJob.create).toHaveBeenCalled();
    });
  });

  describe("GET /api/generation-status/:taskId", () => {
    it("should return job status", async () => {
      const mockJob = {
        _id: "job-123",
        status: "completed",
        progress: 100,
        phase: "done",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      GenerationJob.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockJob) });

      const res = await request(app).get("/api/generation-status/job-123");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("completed");
      expect(res.body.progress).toBe(100);
    });

    it("should return 404 if job not found", async () => {
      GenerationJob.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const res = await request(app).get("/api/generation-status/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/timetable-settings", () => {
    it("should return default settings if none found", async () => {
      TimetableUserSettings.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

      const res = await request(app).get("/api/timetable-settings");

      expect(res.status).toBe(200);
      expect(res.body.settings.inputMode).toBe("EXPLICIT");
    });

    it("should return saved settings", async () => {
      const mockSettings = { inputMode: "DERIVED", blockGenerateOnHealthErrors: true };
      TimetableUserSettings.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(mockSettings) });

      const res = await request(app).get("/api/timetable-settings");

      expect(res.status).toBe(200);
      expect(res.body.settings.inputMode).toBe("DERIVED");
    });
  });
});
