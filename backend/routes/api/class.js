import { Router } from 'express';
import ClassModel from '../../models/Class.js';
import ClassSubject from '../../models/ClassSubject.js';
import Faculty from '../../models/Faculty.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import auth from '../../middleware/auth.js';
import { validateOwnership, validateOwnershipMany } from '../../utils/validateTenantRefs.js';


const protectedRouter = Router();
protectedRouter.use(auth);

// --- Classes CRUD ---
//add classes
protectedRouter.post('/classes', async (req, res) => {
  console.log("[POST /classes] Body:", req.body);
  try {
    const comboIds = Array.isArray(req.body.assigned_teacher_subject_combos)
      ? req.body.assigned_teacher_subject_combos
      : [];
    const facultyIds = Array.isArray(req.body.faculties)
      ? req.body.faculties
      : [];

    if (comboIds.length > 0) {
      await validateOwnershipMany(
        TeacherSubjectCombination,
        comboIds,
        req.collegeId,
        "assigned_teacher_subject_combos"
      );
    }
    if (facultyIds.length > 0) {
      await validateOwnershipMany(Faculty, facultyIds, req.collegeId, "faculties");
    }

    const c = new ClassModel({
      ...req.body,
      collegeId: req.collegeId,
      assigned_teacher_subject_combos: req.body.assigned_teacher_subject_combos || [],
      total_class_hours: req.body.total_class_hours || 0
    });
    await c.save();
    console.log("[POST /classes] Saved class:", c);
    res.json(c);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Bad Request' });
  }
});

//get all classes
protectedRouter.get('/classes', async (req, res) => {
  console.log("[GET /classes] Fetching all classes");
  try {
    const classes = await ClassModel.find({ collegeId: req.collegeId }).populate('faculties').lean();
    console.log("[GET /classes] Found:", classes.length, "records");
    res.json(classes);
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Edit a class
protectedRouter.put('/classes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sem, section, id: classId, days_per_week } = req.body;
    const updateData = { name, sem, section, id: classId, days_per_week };

    const updatedClass = await ClassModel.findOneAndUpdate(
      { _id: id, collegeId: req.collegeId },
      updateData,
      { new: true, runValidators: true }
    );
    if (!updatedClass) {
      return res.status(404).json({ error: 'Class not found.' });
    }
    res.json(updatedClass);
  } catch (e) {
    res.status(400).json({ error: 'Bad Request' });
  }
});

// Delete a class
protectedRouter.delete('/classes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedClass = await ClassModel.findOneAndDelete({ _id: id, collegeId: req.collegeId });
    if (!deletedClass) {
      return res.status(404).json({ error: 'Class not found.' });
    }

    // Delete associated class-subject assignments
    await ClassSubject.deleteMany({ class: id, collegeId: req.collegeId });

    res.json({ message: 'Class deleted successfully.' });
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Add a faculty to a class
protectedRouter.post('/classes/:classId/faculties', async (req, res) => {
    try {
        const { classId } = req.params;
        const { facultyId } = req.body;
        await validateOwnership(Faculty, facultyId, req.collegeId, "Faculty");

        const updatedClass = await ClassModel.findOneAndUpdate(
            { _id: classId, collegeId: req.collegeId },
            { $addToSet: { faculties: facultyId } },
            { new: true }
        ).populate('faculties');

        if (!updatedClass) {
            return res.status(404).json({ error: 'Class not found.' });
        }
        res.json(updatedClass);
    } catch (e) {
        res.status(e.status || 400).json({ error: e.message || 'Bad Request' });
    }
});

// Remove a faculty from a class
protectedRouter.delete('/classes/:classId/faculties/:facultyId', async (req, res) => {
    try {
        const { classId, facultyId } = req.params;

        const updatedClass = await ClassModel.findOneAndUpdate(
            { _id: classId, collegeId: req.collegeId },
            { $pull: { faculties: facultyId } },
            { new: true }
        ).populate('faculties');

        if (!updatedClass) {
            return res.status(404).json({ error: 'Class not found.' });
        }
        res.json(updatedClass);
    } catch (e) {
        res.status(400).json({ error: 'Bad Request' });
    }
});

export default protectedRouter;
