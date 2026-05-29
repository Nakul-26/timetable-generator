import mongoose from "mongoose";
import ElectiveSubjectSetting from "../../models/ElectiveSubjectSetting.js";
import ClassModel from "../../models/Class.js";
import Subject from "../../models/Subject.js";

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

await mongoose.connect(uri, { dbName: "timetable_jayanth" });

const settings = await ElectiveSubjectSetting.find({}).lean();
const classIds = settings.map((s) => s.class);
const subjectIds = settings.map((s) => s.subject);

const classes = await ClassModel.find({ _id: { $in: classIds } }).lean();
const subjects = await Subject.find({ _id: { $in: subjectIds } }).lean();

const classById = new Map(classes.map((c) => [String(c._id), c]));
const subjectById = new Map(subjects.map((s) => [String(s._id), s]));

const rows = settings.map((s) => ({
  classId: String(s.class),
  className: classById.get(String(s.class))?.name,
  classSem: classById.get(String(s.class))?.sem,
  classSection: classById.get(String(s.class))?.section,
  subjectId: String(s.subject),
  subjectName: subjectById.get(String(s.subject))?.name,
  teacherCategoryRequirements: s.teacherCategoryRequirements || {},
}));

console.log(JSON.stringify(rows, null, 2));

await mongoose.disconnect();
