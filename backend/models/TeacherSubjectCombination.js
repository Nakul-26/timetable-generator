
import mongoose from "mongoose";
const { Schema } = mongoose;

const TeacherSubjectCombinationSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    faculty: { type: Schema.Types.ObjectId, ref: 'Faculty', required: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
  },
  { timestamps: true }
);

TeacherSubjectCombinationSchema.index(
  { collegeId: 1, faculty: 1, subject: 1 },
  { unique: true }
);

export default mongoose.model(
  'TeacherSubjectCombination',
  TeacherSubjectCombinationSchema
);
