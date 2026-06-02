import mongoose from "mongoose";
const { Schema } = mongoose;
import TeacherSubjectCombination from './TeacherSubjectCombination.js'; // Import the combo model

const ResultSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true },

    source: {
      type: String,
      enum: ['generator', 'manual', 'assignments'],
      default: 'manual'
    },

    status: {
      type: String,
      enum: ['generated', 'draft', 'edited', 'approved', 'locked', 'session_buffer'],
      default: 'draft',
    },

    generated_from_id: {
      type: Schema.Types.ObjectId,
      ref: 'TimetableResult',
      default: null,
    },

    parent_timetable_id: {
      type: Schema.Types.ObjectId,
      ref: 'TimetableResult',
      default: null,
    },

    edit_version: {
      type: Number,
      default: 1,
    },

    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },

    // Assignment-only results:
    // { [classId]: [teacherSubjectComboId, ...] }
    assignments_only: { type: Object, default: null },

    // Generator / manual outputs
    class_timetables: Object,
    faculty_timetables: Object,
    faculty_daily_hours: Object,
    teacher_timetables: Object,
    subject_hours_assigned: Object,
    slot_sources: Object,
    locked_slots: Object,

    // Metadata
    config: Object,        // { days, hours, fixedSlots, ... }
    version: Number,
    score: Number,
    objective_value: Number,
    generation_batch_id: String,
    source_generation_job_id: {
      type: String,
      default: null,
      index: true,
    },
    selected_option_id: String,
    generation_options: Object,

    subjects: Object,
    faculties: Object,
    combos: Object,
    allocations_report: Object,

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true }, // Ensure virtuals are included in toJSON
    toObject: { virtuals: true } // Ensure virtuals are included in toObject
  }
);

// TTL index for automatic deletion. Documents with a non-null expiresAt
// will be deleted when the current date passes expiresAt.
ResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Indexes for fast queries
ResultSchema.index({ collegeId: 1, createdAt: -1 });
ResultSchema.index({ collegeId: 1, source: 1, createdAt: -1 });
ResultSchema.index(
  { collegeId: 1, source_generation_job_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source_generation_job_id: { $type: "string" },
    },
  }
);

// Helper function to populate assignments for 'assignments' source
async function populateAssignments(docs, collegeId) {
  if (!Array.isArray(docs)) {
    docs = [docs];
  }

  const needsPopulation = docs.some(doc => doc && doc.source === 'assignments' && doc.assignments_only);
  if (!needsPopulation) return;

  for (const doc of docs) {
    if (doc && doc.source === 'assignments' && doc.assignments_only) {
      const populated_assignments = {};
      const classIds = Object.keys(doc.assignments_only);
      
      // Use stored virtual combos if available for better resolution of non-DB IDs
      const virtualCombos = doc.combos || [];
      const virtualComboMap = new Map(virtualCombos.map(c => [String(c._id), c]));

      for (const classId of classIds) {
        const comboIds = doc.assignments_only[classId];
        if (Array.isArray(comboIds) && comboIds.length > 0) {
          const populatedCombos = [];
          const dbComboIds = [];

          for (const id of comboIds) {
            const idStr = String(id);
            if (virtualComboMap.has(idStr)) {
              // It's a virtual combo, use the stored data
              populatedCombos.push(virtualComboMap.get(idStr));
            } else if (mongoose.Types.ObjectId.isValid(id)) {
              // It might be a DB combo
              dbComboIds.push(id);
            }
          }

          if (dbComboIds.length > 0) {
            const dbCombos = await TeacherSubjectCombination.find({
              collegeId: doc.collegeId || collegeId,
              '_id': { $in: dbComboIds }
            }).populate('faculty', 'name').populate('subject', 'name').lean();
            populatedCombos.push(...dbCombos);
          }
          populated_assignments[classId] = populatedCombos;
        } else {
          populated_assignments[classId] = [];
        }
      }
      doc.populated_assignments = populated_assignments;
    }
  }
}

// Post-find hooks to populate assignments
ResultSchema.post('find', async function(docs, next) {
  try {
    await populateAssignments(docs);
    next();
  } catch (error) {
    console.error("Error during post-find population:", error);
    next(error);
  }
});

ResultSchema.post('findOne', async function(doc, next) {
  try {
    if (doc) await populateAssignments(doc);
    next();
  } catch (error) {
    console.error("Error during post-findOne population:", error);
    next(error);
  }
});


export default mongoose.model('TimetableResult', ResultSchema);
