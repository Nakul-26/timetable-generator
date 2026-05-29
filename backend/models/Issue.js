import mongoose from "mongoose";

const { Schema } = mongoose;

const CommentSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  userEmail: String,
  message: {
    type: String,
    required: true
  }
}, { timestamps: true });

const IssueSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: [
      "Bug Report",
      "Feature Request",
      "Timetable Generation Issue",
      "Data Issue",
      "Performance Issue",
      "UI/UX Problem",
      "Account/Permission Issue",
      "Other"
    ],
    default: "Other"
  },
  priority: {
    type: String,
    enum: ["Low", "Medium", "High", "Critical"],
    default: "Medium"
  },
  status: {
    type: String,
    enum: ["Open", "In Progress", "Resolved", "Closed"],
    default: "Open"
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  creatorEmail: String,
  collegeId: {
    type: String,
    required: true,
    index: true
  },
  attachments: [String],
  metadata: {
    browser: String,
    os: String,
    pageUrl: String,
    appVersion: String
  },
  comments: [CommentSchema]
}, { timestamps: true });

export default mongoose.model('Issue', IssueSchema);
