import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';

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

    req.user = user;
    req.collegeId = user.role === "superadmin" ? null : String(user.collegeId);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Please authenticate.' });
  }
};

export default auth;
