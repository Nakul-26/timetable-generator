import mongoose from "mongoose";
const { Schema } = mongoose;

const ClassSubjectSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      default: "default",
      index: true,
    },
    class: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    hoursPerWeek: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { timestamps: true }
);

ClassSubjectSchema.index(
  { collegeId: 1, class: 1, subject: 1 },
  { unique: true }
);

export default mongoose.model('ClassSubject', ClassSubjectSchema);
