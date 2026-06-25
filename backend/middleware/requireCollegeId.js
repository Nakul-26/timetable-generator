/**
 * requireCollegeId.js
 *
 * Hard-guard middleware: throws a clear 400 if req.collegeId is missing.
 * Apply AFTER collegeScope middleware on any router that queries the DB.
 *
 * Usage:
 *   router.use(auth);
 *   router.use(requireCollegeContext);  // sets req.collegeId
 *   router.use(requireCollegeId);       // guards against it being missing
 *
 * This prevents the silent cross-tenant data leak where an unscoped
 * collegeId query returns ALL records from every college.
 */
const requireCollegeId = (req, res, next) => {
  if (!req.collegeId) {
    return res.status(400).json({
      error:
        "collegeId is missing from the request context. " +
        "Ensure requireCollegeContext middleware runs before this route.",
    });
  }
  next();
};

export default requireCollegeId;
