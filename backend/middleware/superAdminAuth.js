const requireSuperAdmin = (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "superadmin") {
      // Log context for debugging why non-superadmin reached a superadmin-protected route
      try {
        console.log('[superAdminAuth] denied:', {
          path: req.originalUrl || req.url,
          user: req.user ? { _id: String(req.user._id), email: req.user.email, role: req.user.role, collegeId: req.user.collegeId } : null,
        });
      } catch (e) {
        // ignore logging errors
      }
      return res.status(403).json({ error: "Forbidden: Super admins only." });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export default requireSuperAdmin;
