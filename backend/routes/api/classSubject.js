import { Router } from 'express';
import ClassSubject from '../../models/ClassSubject.js';
import ClassModel from '../../models/Class.js';
import Subject from '../../models/Subject.js';
import TeachingAllocation from '../../models/TeachingAllocation.js';
import auth from '../../middleware/auth.js';
import { validateOwnership } from '../../utils/validateTenantRefs.js';
import { buildTeachingAllocationKey } from '../../utils/allocationKey.js';

const toPositiveNumber = (value) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 1 ? parsedValue : null;
};

const protectedRouter = Router();
protectedRouter.use(auth);

// --- Class Subject Assignments CRUD ---

// Get all class-subject assignments
protectedRouter.get('/class-subjects', async (req, res) => {
    try {
        const assignments = await ClassSubject.find({ collegeId: req.collegeId }).populate('class').populate('subject').lean();
        res.json(assignments);
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Create a new class-subject assignment
protectedRouter.post('/class-subjects', async (req, res) => {
    try {
        const { classId, subjectId, hoursPerWeek } = req.body;
        const [classDoc, subjectDoc] = await Promise.all([
            validateOwnership(ClassModel, classId, req.collegeId, "Class"),
            validateOwnership(Subject, subjectId, req.collegeId, "Subject"),
        ]);
        const hasRequestedHours = hoursPerWeek !== undefined && hoursPerWeek !== null && hoursPerWeek !== "";
        const requestedHours = hasRequestedHours ? toPositiveNumber(hoursPerWeek) : null;
        if (hasRequestedHours && !requestedHours) {
            return res.status(400).json({ error: "hoursPerWeek must be a positive number." });
        }
        const subjectDefaultHours = toPositiveNumber(subjectDoc?.classesPerWeek);
        const effectiveHours = requestedHours ?? subjectDefaultHours;

        if (!effectiveHours) {
            return res.status(400).json({ error: "hoursPerWeek is required unless the subject has a default classesPerWeek value." });
        }

        const assignment = new ClassSubject({ collegeId: req.collegeId, class: classDoc._id, subject: subjectDoc._id, hoursPerWeek: effectiveHours });
        await assignment.save();

        // Create a TeachingAllocation (teacher: null initially)
        // This ensures the Class-Subject combo shows up in the Teaching Allocation management page immediately.
        const subjectType = String(subjectDoc.type || "").toLowerCase();
        const allocationType = subjectType === 'lab' ? 'LAB' : 'NORMAL';
        const allocationSubjects = [{ subject: subjectDoc._id, teacher: null }];
        const allocationKey = buildTeachingAllocationKey({
            collegeId: req.collegeId,
            type: allocationType,
            classIds: [classDoc._id],
            subjectId: subjectDoc._id,
            teacherIds: [],
            subjects: allocationSubjects,
            combinedClassGroupId: null,
        });

        await TeachingAllocation.findOneAndUpdate(
            { 
                collegeId: req.collegeId, 
                allocationKey,
            },
            {
                $setOnInsert: {
                    collegeId: req.collegeId,
                    classIds: [classDoc._id],
                    subject: subjectDoc._id,
                    type: allocationType,
                    hoursPerWeek: effectiveHours,
                    teacher: null,
                    teachers: [],
                    subjects: allocationSubjects,
                    allocationKey,
                }
            },
            { upsert: true }
        );

        res.json(assignment);
    } catch (e) {
        res.status(e.status || 400).json({ error: e.message || 'Bad Request' });
    }
});

// Update a class-subject assignment
protectedRouter.put('/class-subjects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { hoursPerWeek } = req.body;
        const updatedAssignment = await ClassSubject.findOneAndUpdate(
            { _id: id, collegeId: req.collegeId },
            { hoursPerWeek },
            { new: true }
        );
        if (!updatedAssignment) {
            return res.status(404).json({ error: 'Assignment not found.' });
        }

        // Sync with TeachingAllocation
        await TeachingAllocation.updateMany(
            {
                collegeId: req.collegeId,
                classIds: updatedAssignment.class,
                $or: [
                    { subject: updatedAssignment.subject },
                    { "subjects.subject": updatedAssignment.subject }
                ]
            },
            { $set: { hoursPerWeek: updatedAssignment.hoursPerWeek } }
        );

        res.json(updatedAssignment);
    } catch (e) {
        res.status(400).json({ error: 'Bad Request' });
    }
});

// Delete a class-subject assignment
protectedRouter.delete('/class-subjects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedAssignment = await ClassSubject.findOneAndDelete({ _id: id, collegeId: req.collegeId });
        if (!deletedAssignment) {
            return res.status(404).json({ error: 'Assignment not found.' });
        }

        // Delete associated teaching allocations
        await TeachingAllocation.deleteMany({
            collegeId: req.collegeId,
            classIds: deletedAssignment.class,
            $or: [
                { subject: deletedAssignment.subject },
                { "subjects.subject": deletedAssignment.subject }
            ]
        });

        res.json({ message: 'Assignment deleted successfully.' });
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default protectedRouter;
