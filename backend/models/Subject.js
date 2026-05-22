import mongoose from "mongoose";
const { Schema } = mongoose;

const SubjectSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
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
    sem: {
      type: Number,
      required: true,
      min: 1,
    },
    type: {
      type: String,
      enum: ["theory", "lab", "no_teacher"],
      required: true,
    },
    classesPerWeek: {
      type: Number,
      min: 1,
      default: null,
    }
  },
  { timestamps: true }
);

SubjectSchema.index({ collegeId: 1, id: 1 }, { unique: true });

export default mongoose.model('Subject', SubjectSchema);
