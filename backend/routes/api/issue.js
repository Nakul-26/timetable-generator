import { Router } from 'express';
import Issue from '../../models/Issue.js';
import upload from '../../middleware/upload.js';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Rate limiters
const issueCreateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 tickets per hour
  message: { error: 'Too many tickets created. Please try again later.' },
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  validate: { default: false }
});

const commentCreateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 comments per hour
  message: { error: 'Too many comments. Please try again later.' },
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  validate: { default: false }
});

/**
 * @route   POST /api/issues
 * @desc    Create a new issue
 * @access  Private (Admin/Superadmin)
 */
router.post('/', issueCreateLimit, upload.array('images', 5), async (req, res) => {
  try {
    const { title, description, category, priority, metadata } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    // Duplicate detection (same title & category by same user in last 5 mins)
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existing = await Issue.findOne({
      createdBy: req.user._id,
      title: title.trim(),
      category,
      createdAt: { $gte: fiveMinsAgo }
    });

    if (existing) {
      return res.status(409).json({ error: 'A similar ticket was recently submitted. Please wait a few minutes.' });
    }

    const attachments = req.files ? req.files.map(file => file.path) : [];
    
    // Parse metadata if it's a string (FormData sends it as string)
    let parsedMetadata = {};
    if (typeof metadata === 'string') {
      try { parsedMetadata = JSON.parse(metadata); } catch (e) {}
    } else if (metadata) {
      parsedMetadata = metadata;
    }

    const issue = new Issue({
      title: title.trim(),
      description,
      category,
      priority,
      createdBy: req.user._id,
      creatorEmail: req.user.email,
      collegeId: req.collegeId,
      attachments,
      metadata: parsedMetadata
    });
    
    await issue.save();
    res.status(201).json(issue);
  } catch (err) {
    console.error('[Issue Create Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route   GET /api/issues
 * @desc    Get all issues for the current college context
 * @access  Private (Admin/Superadmin)
 */
router.get('/', async (req, res) => {
  try {
    const query = { collegeId: req.collegeId };
    const issues = await Issue.find(query).sort({ createdAt: -1 });
    res.json(issues);
  } catch (err) {
    console.error('[Issue List Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route   GET /api/issues/:id
 * @desc    Get specific issue details
 * @access  Private (Admin/Superadmin)
 */
router.get('/:id', async (req, res) => {
  try {
    const issue = await Issue.findOne({ _id: req.params.id, collegeId: req.collegeId });
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    res.json(issue);
  } catch (err) {
    console.error('[Issue Detail Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route   PATCH /api/issues/:id
 * @desc    Update issue status or priority
 * @access  Private (Admin/Superadmin)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { status, priority } = req.body;
    const update = {};
    if (status) update.status = status;
    if (priority) update.priority = priority;

    const issue = await Issue.findOneAndUpdate(
      { _id: req.params.id, collegeId: req.collegeId },
      { $set: update },
      { new: true }
    );
    
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    res.json(issue);
  } catch (err) {
    console.error('[Issue Update Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route   POST /api/issues/:id/comments
 * @desc    Add a comment to an issue
 * @access  Private (Admin/Superadmin)
 */
router.post('/:id/comments', commentCreateLimit, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const comment = {
      user: req.user._id,
      userEmail: req.user.email,
      message
    };

    const issue = await Issue.findOneAndUpdate(
      { _id: req.params.id, collegeId: req.collegeId },
      { $push: { comments: comment } },
      { new: true }
    );
    
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    res.json(issue);
  } catch (err) {
    console.error('[Comment Create Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
