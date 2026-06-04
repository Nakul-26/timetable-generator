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
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const userQuery =
      decoded.role === "superadmin"
        ? { _id: decoded.id, role: "superadmin" }
        : { _id: decoded.id, collegeId: decoded.collegeId };
    
    const user = await Admin.findOne(userQuery).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    req.user = user;
    req.decoded = decoded; // Keep decoded token for collegeId access
    next();
  } catch (error) {
    console.error("[auth] error:", error.message);
    return res.status(401).json({ error: 'Please authenticate.' });
  }
};

export default auth;
