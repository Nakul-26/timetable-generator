import College from "../models/College.js";

const requireCollegeContext = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  // If a superadmin is calling tenant routes, allow them to act within
  // a selected college when they send the `x-college-id` header.
  if (req.user.role === "superadmin") {
    // Allow these superadmin-safe routes without a selected college.
    const safePrefixes = [
      "/api/superadmin",
      "/api/me",
      "/api/logout",
    ];
    const path = req.originalUrl || req.url || "";
    if (safePrefixes.some((p) => path.startsWith(p))) {
      return next();
    }

    const selected = req.headers["x-college-id"] || req.headers["x-collegeid"];
    if (selected) {
      try {
        const collegeId = String(selected).toLowerCase();
        const college = await College.findOne({ collegeId }).select("collegeId name").lean();
        if (!college) {
          return res.status(400).json({ error: "Invalid college context." });
        }
        req.collegeId = college.collegeId;
        req.college = college;
        return next();
      } catch (err) {
        console.error("[collegeScope] validation error:", err);
        return res.status(500).json({ error: "Failed to validate college context." });
      }
    }

    return res.status(403).json({
      error:
        "Superadmin cannot access tenant-specific routes without selecting a college. Send header 'x-college-id' with the college id.",
    });
  }

  // For regular admins, collegeId is mandatory and comes from their account
  if (!req.user.collegeId) {
    return res.status(401).json({ error: "Missing tenant context." });
  }

  req.collegeId = String(req.user.collegeId);
  next();
};

export default requireCollegeContext;
