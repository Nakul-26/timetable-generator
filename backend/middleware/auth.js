import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import College from '../models/College.js';

const auth = async (req, res, next) => {
  try {
    const token =
      req.cookies?.token ||
      req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Please authenticate.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.id || !decoded.role) {
      return res.status(401).json({ error: 'Missing tenant context.' });
    }

    const userQuery =
      decoded.role === "superadmin"
        ? { _id: decoded.id, role: "superadmin" }
        : { _id: decoded.id, collegeId: decoded.collegeId };
    const user = await Admin.findOne(userQuery).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'Please authenticate.' });
    }
    if (
      decoded.role !== "superadmin" &&
      String(user.collegeId || "") !== String(decoded.collegeId || "")
    ) {
      return res.status(401).json({ error: 'Invalid tenant context.' });
    }

    // If a superadmin provided an x-college-id header, validate and attach it
    let effectiveCollegeId = null;
    if (decoded.role === 'superadmin') {
      const header = req.headers['x-college-id'] || req.headers['x-collegeid'];
      if (header) {
        try {
          const cid = String(header).toLowerCase();
          const college = await College.findOne({ collegeId: cid }).select('collegeId').lean();
          if (!college) return res.status(400).json({ error: 'Invalid college context.' });
          effectiveCollegeId = college.collegeId;
        } catch (err) {
          return res.status(500).json({ error: 'Failed to validate college context.' });
        }
      }
    }

    req.user = user;
    req.collegeId = decoded.role === "superadmin" ? effectiveCollegeId : String(user.collegeId);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Please authenticate.' });
  }
};

export default auth;
