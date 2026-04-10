import mongoose from "mongoose";

const { Schema } = mongoose;

const GenerationJobSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    phase: {
      type: String,
      default: "queued",
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    solution_count: {
      type: Number,
      default: 5,
      min: 1,
      max: 5,
    },
    input: {
      type: Object,
      default: null,
    },
    partial_data: {
      type: Object,
      default: null,
    },
    result: {
      type: Object,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    cancel_requested: {
      type: Boolean,
      default: false,
      index: true,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: true,
  }
);

GenerationJobSchema.index({ createdAt: -1 });
GenerationJobSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("GenerationJob", GenerationJobSchema);
