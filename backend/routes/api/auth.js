import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Admin from '../../models/Admin.js';
import Faculty from '../../models/Faculty.js';
import adminAuth from '../../middleware/adminAuth.js';
import auth from '../../middleware/auth.js';

const router = Router();
const protectedRouter = Router();
protectedRouter.use(auth);

// --- Rate Limiter for Login ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login requests per windowMs
  message: 'Too many login attempts from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// --- User Authentication ---
router.post('/register', async (req, res) => {
  try {
    const { id, name } = req.body;
    const user = new Faculty({ id, name });
    await user.save();
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Bad Request' });
  }
});

protectedRouter.post('/users/create', adminAuth, async (req, res) => {
  try {
    const { id, name } = req.body;
    const user = new Faculty({ id, name });
    await user.save();
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Bad Request' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        console.log('Login request body:', req.body);
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        console.log('Attempting login for email:', email);
        console.log('Found admin:', admin);
        if (!admin) {
            console.error('Login failed: Admin not found for email', email);
            return res.status(400).json({ success: false, message: 'Invalid credentials' });
        }
        const isMatch = await admin.matchPassword(password);
        console.log('Password match result:', isMatch);
        if (!isMatch) {
            console.error('Login failed: Incorrect password for email', email);
            return res.status(400).json({ success: false, message: 'Invalid credentials' });
        }
        const token = admin.generateAuthToken();
        res.cookie('token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            path: '/'
        });
        res.json({ success: true, user: admin });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/'
    }).json({ success: true });
});

protectedRouter.get('/me', (req, res) => {
    res.json(req.user);
});

router.use(protectedRouter);

export default router;
