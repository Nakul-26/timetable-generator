import mongoose from "mongoose";

const { Schema } = mongoose;

const TimetableUserSettingsSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    constraintConfig: {
      type: Schema.Types.Mixed,
      default: null,
    },
    blockGenerateOnHealthErrors: {
      type: Boolean,
      default: false,
    },
    fixedSlots: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

TimetableUserSettingsSchema.index({ collegeId: 1, userId: 1 }, { unique: true });

export default mongoose.model("TimetableUserSettings", TimetableUserSettingsSchema);
