import mongoose from "mongoose";

const { Schema } = mongoose;

const AvailabilitySlotSchema = new Schema(
  {
    day: {
      type: Number,
      required: true,
      min: 0,
    },
    hour: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const TeacherPreferencesSchema = new Schema(
  {
    avoidFirstPeriod: {
      type: Boolean,
      default: false,
    },
    avoidLastPeriod: {
      type: Boolean,
      default: false,
    },
    maxConsecutive: {
      type: Number,
      min: 1,
      default: null,
    },
    preferredDays: {
      type: [Number],
      default: [],
    },
  },
  { _id: false }
);

const FacultySchema = new Schema(
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
    unavailableSlots: {
      type: [AvailabilitySlotSchema],
      default: [],
    },
    preferences: {
      type: TeacherPreferencesSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

FacultySchema.index({ collegeId: 1, id: 1 }, { unique: true });

export default mongoose.model('Faculty', FacultySchema);
