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

    const user = await Admin.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'Please authenticate.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Please authenticate.' });
  }
};

export default auth;
