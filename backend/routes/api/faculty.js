import { Router } from 'express';
import Faculty from '../../models/Faculty.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import ClassModel from '../../models/Class.js';
import auth from '../../middleware/auth.js';
import { normalizeAvailabilitySlots } from '../../utils/teacherAvailability.js';
import { normalizeTeacherPreferences } from '../../utils/teacherPreferences.js';


const protectedRouter = Router();
protectedRouter.use(auth);

// --- Faculties CRUD ---
//add faculties
protectedRouter.post('/faculties', async (req, res) => {
  console.log("[POST /faculties] Body:", req.body);
  try {
    const f = new Faculty();
    f.collegeId = req.collegeId;
    f.id = req.body.id;
    f.name = req.body.name;
    f.unavailableSlots = normalizeAvailabilitySlots(req.body.unavailableSlots || []);
    f.preferences = normalizeTeacherPreferences(req.body.preferences || {});
    await f.save();
    console.log("[POST /faculties] Saved faculty:", f);
    res.json(f);
  } catch (e) {
    console.log(e);
    res.status(400).json({ error: 'Bad Request' });
  }
});

//get all faculties
protectedRouter.get('/faculties', async (req, res) => {
  console.log("[GET /faculties] Fetching all faculties, collegeId=", req.collegeId);
  try {
    // Debug: log distinct collegeIds and a sample doc when unexpected results
    try {
      const distinct = await Faculty.distinct('collegeId');
      console.log('[GET /faculties] distinct collegeIds sample:', distinct.slice(0,10));
      const sample = await Faculty.findOne().lean();
      console.log('[GET /faculties] sample doc collegeId:', sample ? sample.collegeId : null);
    } catch (dbgErr) {
      console.error('[GET /faculties] debug error:', dbgErr);
    }

    const faculties = await Faculty.find({ collegeId: req.collegeId }).lean();
    console.log('[GET /faculties] Found:', faculties.length, 'records');
    res.json(faculties);
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update an existing faculty
protectedRouter.put('/faculties/:id', async (req, res) => {
  console.log("[PUT /faculties/:id] Params:", req.params, "Body:", req.body);
  try {
    const { id } = req.params;
    const { name, id: facultyId } = req.body;
    const updateData = { name, id: facultyId };
    if (Object.prototype.hasOwnProperty.call(req.body, "unavailableSlots")) {
      updateData.unavailableSlots = normalizeAvailabilitySlots(req.body.unavailableSlots);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "preferences")) {
      updateData.preferences = normalizeTeacherPreferences(req.body.preferences);
    }

    const updatedFaculty = await Faculty.findOneAndUpdate(
      { _id: id, collegeId: req.collegeId },
      updateData,
      { new: true, runValidators: true }
    );
    if (!updatedFaculty) {
      console.warn("[PUT /faculties/:id] Faculty not found for _id:", id);
      return res.status(404).json({ error: 'Faculty not found.' });
    }
    console.log("[PUT /faculties/:id] Updated faculty:", updatedFaculty);
    res.json(updatedFaculty);
  } catch (e) {
    res.status(400).json({ error: 'Bad Request' });
  }
});

protectedRouter.get('/faculties/:id/preferences', async (req, res) => {
  try {
    const faculty = await Faculty.findOne({ _id: req.params.id, collegeId: req.collegeId }).select('name preferences').lean();
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found.' });
    }

    res.json({
      teacherId: String(faculty._id),
      teacherName: faculty.name,
      preferences: normalizeTeacherPreferences(faculty.preferences),
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

protectedRouter.post('/faculties/:id/preferences', async (req, res) => {
  try {
    const preferences = normalizeTeacherPreferences(req.body?.preferences || req.body || {});
    const faculty = await Faculty.findOneAndUpdate(
      { _id: req.params.id, collegeId: req.collegeId },
      { preferences },
      { new: true, runValidators: true }
    ).select('name preferences');

    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found.' });
    }

    res.json({
      teacherId: String(faculty._id),
      teacherName: faculty.name,
      preferences: normalizeTeacherPreferences(faculty.preferences),
    });
  } catch (e) {
    res.status(400).json({ error: 'Bad Request' });
  }
});

protectedRouter.get('/faculties/:id/availability', async (req, res) => {
  try {
    const faculty = await Faculty.findOne({ _id: req.params.id, collegeId: req.collegeId }).select('name unavailableSlots').lean();
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found.' });
    }

    res.json({
      teacherId: String(faculty._id),
      teacherName: faculty.name,
      unavailableSlots: normalizeAvailabilitySlots(faculty.unavailableSlots),
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

protectedRouter.post('/faculties/:id/availability', async (req, res) => {
  try {
    const unavailableSlots = normalizeAvailabilitySlots(req.body?.unavailableSlots || []);
    const faculty = await Faculty.findOneAndUpdate(
      { _id: req.params.id, collegeId: req.collegeId },
      { unavailableSlots },
      { new: true, runValidators: true }
    ).select('name unavailableSlots');

    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found.' });
    }

    res.json({
      teacherId: String(faculty._id),
      teacherName: faculty.name,
      unavailableSlots: normalizeAvailabilitySlots(faculty.unavailableSlots),
    });
  } catch (e) {
    res.status(400).json({ error: 'Bad Request' });
  }
});

// Delete a faculty
protectedRouter.delete('/faculties/:id', async (req, res) => {
  console.log("[DELETE /faculties/:id] Params:", req.params);
  try {
    const { id } = req.params;
    const deletedFaculty = await Faculty.findOneAndDelete({ _id: id, collegeId: req.collegeId });
    if (!deletedFaculty) {
      console.warn("[DELETE /faculties/:id] Faculty not found:", id);
      return res.status(404).json({ error: 'Faculty not found.' });
    }

    // Delete associated teacher-subject combinations
    await TeacherSubjectCombination.deleteMany({ faculty: id, collegeId: req.collegeId });

    // Remove faculty from all classes
    await ClassModel.updateMany({ collegeId: req.collegeId }, { $pull: { faculties: id } });

    console.log("[DELETE /faculties/:id] Deleted faculty and associated data:", deletedFaculty);
    res.json({ message: 'Faculty deleted successfully.' });
  } catch (e) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default protectedRouter;
