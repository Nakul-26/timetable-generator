import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../routes/api/auth.js";
import Admin from "../models/Admin.js";
import Faculty from "../models/Faculty.js";

vi.mock("../models/Admin.js");
vi.mock("../models/Faculty.js");
vi.mock("express-rate-limit", () => ({
  default: () => (req, res, next) => next(),
}));

describe("Auth Routes", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/auth", authRouter);
  });

  describe("POST /api/auth/login", () => {
    it("should login successfully with correct credentials", async () => {
      const mockAdmin = {
        email: "test@example.com",
        matchPassword: vi.fn().mockResolvedValue(true),
        generateAuthToken: vi.fn().mockReturnValue("mock-token"),
        toObject: vi.fn().mockReturnValue({ email: "test@example.com" }),
      };
      Admin.findOne.mockResolvedValue(mockAdmin);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "test@example.com", password: "password123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("should fail login with incorrect password", async () => {
      const mockAdmin = {
        email: "test@example.com",
        matchPassword: vi.fn().mockResolvedValue(false),
      };
      Admin.findOne.mockResolvedValue(mockAdmin);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "test@example.com", password: "wrongpassword" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Invalid credentials");
    });

    it("should fail login if admin not found", async () => {
      Admin.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "nonexistent@example.com", password: "password123" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should clear cookie and return success", async () => {
      const res = await request(app).post("/api/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
