import { Router } from "express";
import College from "../../models/College.js";
import Admin from "../../models/Admin.js";
import auth from "../../middleware/auth.js";
import requireSuperAdmin from "../../middleware/superAdminAuth.js";

const router = Router();
// Require authentication first so `req.user` is populated, then enforce superadmin role
router.use(auth);
router.use(requireSuperAdmin);

function toCollegeSlug(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

router.get("/superadmin/colleges", async (_req, res) => {
  try {
    const colleges = await College.find({})
      .sort({ createdAt: -1 })
      .lean();

    res.json({ colleges });
  } catch (error) {
    console.error("[GET /superadmin/colleges] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/superadmin/admins", async (_req, res) => {
  try {
    const admins = await Admin.find({ role: "admin" }).select("-password").lean();
    res.json({ admins });
  } catch (error) {
    console.error("[GET /superadmin/admins] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/superadmin/colleges", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const code = String(req.body?.code || "").trim().toUpperCase();
    const requestedCollegeId = String(req.body?.collegeId || "").trim();
    const collegeId = toCollegeSlug(requestedCollegeId || code || name);

    if (!name || !code || !collegeId) {
      return res.status(400).json({ error: "name, code, and resolvable collegeId are required." });
    }

    const existing = await College.findOne({
      $or: [{ code }, { collegeId }],
    }).lean();
    if (existing) {
      return res.status(409).json({ error: "College with this code or collegeId already exists." });
    }

    const college = await College.create({
      name,
      code,
      collegeId,
      createdBy: req.user?._id || null,
    });

    console.log(`[AUDIT] Superadmin ${req.user?._id} created college ${college._id} (${collegeId})`);

    res.status(201).json({ college });
  } catch (error) {
    console.error("[POST /superadmin/colleges] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/superadmin/admins", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const collegeId = String(req.body?.collegeId || "").trim().toLowerCase();

    if (!email || !password || !collegeId) {
      return res.status(400).json({ error: "email, password, and collegeId are required." });
    }

    const college = await College.findOne({ collegeId }).lean();
    if (!college) {
      return res.status(404).json({ error: "College not found." });
    }

    const existingCollegeAdmin = await Admin.findOne({ collegeId, role: "admin" }).lean();
    if (existingCollegeAdmin) {
      return res.status(409).json({ error: "An admin already exists for this college." });
    }

    const existingAdmin = await Admin.findOne({ email }).lean();
    if (existingAdmin) {
      return res.status(409).json({ error: "Admin with this email already exists." });
    }

    let admin;
    try {
      admin = await Admin.create({
        email,
        password,
        role: "admin",
        collegeId,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: "An admin already exists for this college." });
      }
      throw err;
    }

    console.log(`[AUDIT] Superadmin ${req.user?._id} created admin ${admin._id} for college ${collegeId}`);

    const adminUser = admin.toObject();
    delete adminUser.password;

    res.status(201).json({
      admin: adminUser,
      college,
    });
  } catch (error) {
    console.error("[POST /superadmin/admins] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/superadmin/colleges-with-admin", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const code = String(req.body?.code || "").trim().toUpperCase();
    const requestedCollegeId = String(req.body?.collegeId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const collegeId = toCollegeSlug(requestedCollegeId || code || name);

    if (!name || !code || !collegeId || !email || !password) {
      return res.status(400).json({ error: "name, code, email, password, and resolvable collegeId are required." });
    }

    const existingCollege = await College.findOne({
      $or: [{ code }, { collegeId }],
    }).lean();
    if (existingCollege) {
      return res.status(409).json({ error: "College with this code or collegeId already exists." });
    }

    const existingAdmin = await Admin.findOne({ email }).lean();
    if (existingAdmin) {
      return res.status(409).json({ error: "Admin with this email already exists." });
    }

    const college = await College.create({
      name,
      code,
      collegeId,
      createdBy: req.user?._id || null,
    });

    const admin = await Admin.create({
      email,
      password,
      role: "admin",
      collegeId,
    });

    console.log(`[AUDIT] Superadmin ${req.user?._id} created college ${college._id} (${collegeId}) and admin ${admin._id}`);

    const adminUser = admin.toObject();
    delete adminUser.password;

    res.status(201).json({
      college,
      admin: adminUser,
    });
  } catch (error) {
    console.error("[POST /superadmin/colleges-with-admin] Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
