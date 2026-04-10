
import mongoose from "mongoose";
const { Schema } = mongoose;

const ClassSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      default: "default",
      index: true,
    },
    id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    section: {
      type: String,
      required: true,
      trim: true,
    },

    sem: {
      type: Number,
      required: true,
      min: 1,
    },

    // Can override generator default if needed
    days_per_week: {
      type: Number,
      default: 5,
      min: 1,
      max: 7,
    },

    // Informational / optional
    total_class_hours: {
      type: Number,
      min: 0,
    },

    faculties: [
      { type: Schema.Types.ObjectId, ref: 'Faculty' }
    ],

    // Pre-assigned teacher-subject pairs (assignment-only flow)
    assigned_teacher_subject_combos: [
      { type: Schema.Types.ObjectId, ref: 'TeacherSubjectCombination' }
    ],

    // Optional per-subject hour overrides
    subject_hours: {
      type: Map,
      of: Number,
    },
  },
  { timestamps: true }
);

// Useful indexes
ClassSchema.index({ collegeId: 1, id: 1 }, { unique: true });
ClassSchema.index({ collegeId: 1, sem: 1 });
ClassSchema.index({ collegeId: 1, name: 1, section: 1 });

export default mongoose.model('Class', ClassSchema);
