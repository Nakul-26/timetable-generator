import { describe, it, expect, vi, beforeEach } from "vitest";
import requireCollegeContext from "../middleware/collegeScope.js";
import College from "../models/College.js";

vi.mock("../models/College.js");

describe("collegeScope middleware", () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
      user: null,
      url: "/api/classes",
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it("should return 401 if user is not authenticated", async () => {
    await requireCollegeContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required." });
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow regular admin with collegeId", async () => {
    req.user = { role: "admin", collegeId: "bmsit" };
    await requireCollegeContext(req, res, next);
    expect(req.collegeId).toBe("bmsit");
    expect(next).toHaveBeenCalled();
  });

  it("should return 401 if regular admin has no collegeId", async () => {
    req.user = { role: "admin" };
    await requireCollegeContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing tenant context." });
  });

  it("should return 403 for superadmin without x-college-id header on tenant routes", async () => {
    req.user = { role: "superadmin" };
    await requireCollegeContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("selecting a college") }));
  });

  it("should allow superadmin on safe prefixes without header", async () => {
    req.user = { role: "superadmin" };
    req.url = "/api/me";
    await requireCollegeContext(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should allow superadmin with valid x-college-id header", async () => {
    req.user = { role: "superadmin" };
    req.headers["x-college-id"] = "MIT";
    College.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ collegeId: "mit", name: "MIT" }),
    });

    await requireCollegeContext(req, res, next);
    expect(College.findOne).toHaveBeenCalledWith({ collegeId: "mit" });
    expect(req.collegeId).toBe("mit");
    expect(req.college).toEqual({ collegeId: "mit", name: "MIT" });
    expect(next).toHaveBeenCalled();
  });

  it("should return 400 for superadmin with invalid x-college-id header", async () => {
    req.user = { role: "superadmin" };
    req.headers["x-college-id"] = "INVALID";
    College.findOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    });

    await requireCollegeContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid college context." });
  });
});
