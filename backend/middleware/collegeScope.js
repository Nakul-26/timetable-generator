const requireCollegeContext = (req, res, next) => {
  if (req.user?.role === "superadmin") {
    return res.status(403).json({ error: "Superadmin cannot access tenant-specific routes. Use superadmin endpoints." });
  }

  if (!req.collegeId) {
    return res.status(401).json({ error: "Missing tenant context." });
  }

  next();
};

export default requireCollegeContext;
