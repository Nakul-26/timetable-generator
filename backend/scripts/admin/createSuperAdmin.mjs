import "../env.js";
import mongoose from "mongoose";
import Admin from "../../models/Admin.js";

const email = String(process.argv[2] || "").trim().toLowerCase();
const password = String(process.argv[3] || "");
const DB_NAME = process.env.MONGO_DB_NAME || "timetable_jayanth";
const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("MONGO_URI is not defined");
}

if (!email || !password) {
  throw new Error("Usage: node scripts/createSuperAdmin.mjs <email> <password>");
}

await mongoose.connect(uri, { dbName: DB_NAME });

try {
  const existing = await Admin.findOne({ email }).lean();
  if (existing) {
    throw new Error("Admin with this email already exists.");
  }

  const admin = await Admin.create({
    email,
    password,
    role: "superadmin",
    collegeId: null,
  });

  console.log(JSON.stringify({
    id: String(admin._id),
    email: admin.email,
    role: admin.role,
  }, null, 2));
} finally {
  await mongoose.connection.close();
}
