const requireSuperAdmin = (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Forbidden: Super admins only." });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export default requireSuperAdmin;
