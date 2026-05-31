import { rateLimit } from 'express-rate-limit';

export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  validate: { 
    xForwardedForHeader: false,
    default: false
  },
  skip: (req) => !!(req.cookies?.token || req.header('Authorization')),
  message: { error: 'Too many requests. Please try again later.' }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // limit each user to 2000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  validate: { 
    default: false,
  },
  message: { error: 'Session rate limit exceeded. Please slow down.' }
});
