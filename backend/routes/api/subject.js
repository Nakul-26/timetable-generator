import { Router } from 'express';
import Subject from '../../models/Subject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import ClassSubject from '../../models/ClassSubject.js';
import TeachingAllocation from '../../models/TeachingAllocation.js';
import auth from '../../middleware/auth.js';

const parseOptionalPositiveNumber = (value, label, { allowNull = false } = {}) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return allowNull ? null : undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    const error = new Error(`${label} must be a positive number.`);
    error.status = 400;
    throw error;
  }

  return parsedValue;
};

const protectedRouter = Router();
protectedRouter.use(auth);

// --- Subjects CRUD ---
// Add a subject
protectedRouter.post('/subjects', async (req, res) => {
  console.log("[POST /subjects] Body:", req.body);
  try {
    const { id, name, sem, combined_classes, isElective } = req.body;
    const classesPerWeek = parseOptionalPositiveNumber(req.body.classesPerWeek, 'classesPerWeek');
    const s = new Subject({
      collegeId: req.collegeId,
      id,
      name,
      sem,
      type: req.body.type,
      ...(classesPerWeek !== undefined ? { classesPerWeek } : {}),
      combined_classes,
      isElective: Boolean(isElective),
    });

    await s.save();
    console.log("[POST /subjects] Saved subject:", s);
    res.json(s);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Bad Request' });
  }
});

// Get all subjects
protectedRouter.get('/subjects', async (req, res) => {
  console.log("[GET /subjects] Fetching all subjects");
  try {
    const subjects = await Subject.find({ collegeId: req.collegeId }).lean();
    console.log("[GET /subjects] Found:", subjects.length, "records");
    res.json(subjects);
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Edit a subject
protectedRouter.put('/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sem, type, combined_classes, isElective } = req.body;
    const update = {
      name,
      sem,
      type,
      combined_classes,
      isElective,
    };

    if (Object.prototype.hasOwnProperty.call(req.body, 'classesPerWeek')) {
      const classesPerWeek = parseOptionalPositiveNumber(req.body.classesPerWeek, 'classesPerWeek', { allowNull: true });
      update.classesPerWeek = classesPerWeek;
    }

    const updatedSubject = await Subject.findOneAndUpdate(
      { _id: id, collegeId: req.collegeId },
      update,
      { new: true, runValidators: true }
    );

    if (!updatedSubject) {
      return res.status(404).json({ error: "Subject not found." });
    }

    // If classesPerWeek changed, sync with ClassSubject and TeachingAllocation
    if (Object.prototype.hasOwnProperty.call(req.body, 'classesPerWeek') && update.classesPerWeek) {
      // 1. Update ClassSubject
      await ClassSubject.updateMany(
        { subject: id, collegeId: req.collegeId },
        { $set: { hoursPerWeek: update.classesPerWeek } }
      );

      // 2. Update TeachingAllocation
      await TeachingAllocation.updateMany(
        {
          collegeId: req.collegeId,
          $or: [
            { subject: id },
            { "subjects.subject": id }
          ]
        },
        { $set: { hoursPerWeek: update.classesPerWeek } }
      );
    }

    res.json(updatedSubject);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Bad Request' });
  }
});

// Delete a subject
protectedRouter.delete('/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedSubject = await Subject.findOneAndDelete({ _id: id, collegeId: req.collegeId });
    if (!deletedSubject) {
      return res.status(404).json({ error: "Subject not found." });
    }

    // Delete associated teacher-subject combinations
    await TeacherSubjectCombination.deleteMany({ subject: id, collegeId: req.collegeId });

    // Delete associated class-subject assignments
    await ClassSubject.deleteMany({ subject: id, collegeId: req.collegeId });

    // Delete associated teaching allocations
    // For NORMAL and LAB, it matches the subject field
    // For ELECTIVE, it might be in the subjects array
    await TeachingAllocation.deleteMany({
      collegeId: req.collegeId,
      $or: [
        { subject: id },
        { "subjects.subject": id }
      ]
    });

    res.json({ message: "Subject deleted successfully." });
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default protectedRouter;
