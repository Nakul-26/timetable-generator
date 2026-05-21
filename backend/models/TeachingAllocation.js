import mongoose from "mongoose";

const { Schema } = mongoose;

const TeachingAllocationSubjectSchema = new Schema(
  {
    subject: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    teacher: {
      type: Schema.Types.ObjectId,
      ref: "Faculty",
      default: null,
    },
  },
  { _id: false }
);

const TeachingAllocationSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    classIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Class",
        required: true,
      },
    ],
    subject: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      default: null,
    },
    teacher: {
      type: Schema.Types.ObjectId,
      ref: "Faculty",
      default: null,
    },
    teachers: [
      {
        type: Schema.Types.ObjectId,
        ref: "Faculty",
      },
    ],
    type: {
      type: String,
      enum: ["NORMAL", "LAB", "ELECTIVE"],
      default: "NORMAL",
      index: true,
    },
    subjects: {
      type: [TeachingAllocationSubjectSchema],
      default: [],
    },
    hoursPerWeek: {
      type: Number,
      required: true,
      min: 1,
    },
    combinedClassGroupId: {
      type: String,
      default: null,
      trim: true,
    },
    allocationKey: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

TeachingAllocationSchema.index(
  { collegeId: 1, teacher: 1, subject: 1, combinedClassGroupId: 1 },
  { partialFilterExpression: { type: "NORMAL" } }
);
TeachingAllocationSchema.index(
  { collegeId: 1, allocationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { allocationKey: { $type: "string" } },
  }
);

export default mongoose.model("TeachingAllocation", TeachingAllocationSchema);
