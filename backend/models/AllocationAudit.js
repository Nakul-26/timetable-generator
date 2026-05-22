import mongoose from "mongoose";

const { Schema } = mongoose;

const AllocationAuditSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      index: true,
    },
    allocationId: {
      type: Schema.Types.ObjectId,
      ref: "TeachingAllocation",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["CREATE", "UPDATE", "DELETE", "SYNC_UPSERT"],
      required: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    source: {
      type: String,
      enum: ["DIRECT", "MAPPING_SYNC"],
      required: true,
    },
    snapshot: {
      before: { type: Schema.Types.Mixed, default: null },
      after: { type: Schema.Types.Mixed, default: null },
    },
    schemaVersion: {
      type: Number,
      default: 1,
    },
    message: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("AllocationAudit", AllocationAuditSchema);
