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
      enum: ['generated', 'draft', 'edited', 'approved', 'locked'],
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
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true }, // Ensure virtuals are included in toJSON
    toObject: { virtuals: true } // Ensure virtuals are included in toObject
  }
);

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

// Post-find hook to populate assignments when the source is 'assignments'
ResultSchema.post('find', async function(docs, next) {
  // Check if we need to populate.
  const needsPopulation = docs.some(doc => doc.source === 'assignments' && doc.assignments_only);

  if (!needsPopulation) {
    return next();
  }

  try {
    for (const doc of docs) {
      if (doc.source === 'assignments' && doc.assignments_only) {
        const populated_assignments = {};
        const classIds = Object.keys(doc.assignments_only);

        for (const classId of classIds) {
          const comboIds = doc.assignments_only[classId];
          if (Array.isArray(comboIds) && comboIds.length > 0) {
            // CRITICAL FIX: Filter for valid ObjectIds before querying to prevent CastError
            const validMongoIds = comboIds.filter(id => mongoose.Types.ObjectId.isValid(id));
            
            let populatedCombos = [];
            if (validMongoIds.length > 0) {
                populatedCombos = await TeacherSubjectCombination.find({
                    collegeId: doc.collegeId,
                    '_id': { $in: validMongoIds }
                }).populate('faculty', 'name').populate('subject', 'name').lean();
            }
            populated_assignments[classId] = populatedCombos;
          } else {
            populated_assignments[classId] = [];
          }
        }
        // Attach the populated data to a virtual field.
        doc.populated_assignments = populated_assignments;
      }
    }
    next();
  } catch (error) {
    console.error("Error during post-find population:", error);
    next(error);
  }
});


export default mongoose.model('TimetableResult', ResultSchema);
