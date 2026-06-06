import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import classRouter from "../routes/api/class.js";
import ClassModel from "../models/Class.js";
import { validateOwnershipMany } from "../utils/validateTenantRefs.js";

vi.mock("../models/Class.js");
vi.mock("../models/ClassSubject.js");
vi.mock("../models/TeachingAllocation.js");
vi.mock("../utils/validateTenantRefs.js", () => ({
  validateOwnership: vi.fn().mockResolvedValue(true),
  validateOwnershipMany: vi.fn().mockResolvedValue(true),
}));

// Mock middlewares
vi.mock("../middleware/auth.js", () => ({
  default: (req, res, next) => {
    req.user = { _id: "admin-1", role: "admin", collegeId: "bmsit" };
    next();
  },
}));

describe("Class API Routes", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // Simulate what api.js does: inject collegeId
    app.use((req, res, next) => {
      req.collegeId = "bmsit";
      next();
    });
    app.use("/api", classRouter);
  });

  describe("GET /api/classes", () => {
    it("should return all classes for the college", async () => {
      const mockClasses = [{ _id: "class-1", name: "Class 1", collegeId: "bmsit" }];
      ClassModel.find.mockReturnValue({
        populate: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockClasses),
      });

      const res = await request(app).get("/api/classes");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockClasses);
      expect(ClassModel.find).toHaveBeenCalledWith({ collegeId: "bmsit" });
    });
  });

  describe("POST /api/classes", () => {
    it("should create a new class", async () => {
      const newClassData = { name: "Class 2", sem: 1, section: "A" };
      ClassModel.prototype.save = vi.fn().mockResolvedValue({ _id: "class-2", ...newClassData, collegeId: "bmsit" });

      const res = await request(app)
        .post("/api/classes")
        .send(newClassData);

      expect(res.status).toBe(200); // Route uses res.json(c) which defaults to 200
      expect(ClassModel).toHaveBeenCalled();
    });

    it("should validate ownership of combos and faculties", async () => {
      const newClassData = { 
        name: "Class 2", 
        assigned_teacher_subject_combos: ["combo-1"],
        faculties: ["faculty-1"]
      };
      
      await request(app).post("/api/classes").send(newClassData);

      expect(validateOwnershipMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("DELETE /api/classes/:id", () => {
    it("should delete a class and associated data", async () => {
      ClassModel.findOneAndDelete.mockResolvedValue({ _id: "class-1" });

      const res = await request(app).delete("/api/classes/class-1");

      expect(res.status).toBe(200);
      expect(ClassModel.findOneAndDelete).toHaveBeenCalledWith({ _id: "class-1", collegeId: "bmsit" });
    });

    it("should return 404 if class not found", async () => {
      ClassModel.findOneAndDelete.mockResolvedValue(null);

      const res = await request(app).delete("/api/classes/nonexistent");

      expect(res.status).toBe(404);
    });
  });
});
