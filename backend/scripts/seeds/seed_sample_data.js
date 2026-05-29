// backend/seed_sample_data.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { sampleData } from "../../data/sample_data.js";

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  throw new Error("❌ MONGO_URI is not defined in .env");
}

const client = new MongoClient(uri);

async function seedDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("timetable_jayanth");

    // Clear existing data
    await db.collection("faculties").deleteMany({});
    await db.collection("subjects").deleteMany({});
    await db.collection("classes").deleteMany({});
    await db.collection("classsubjects").deleteMany({});
    await db.collection("teachersubjectcombinations").deleteMany({});

    console.log("✅ Cleared existing data");

    // Insert sample data
    await db.collection("faculties").insertMany(sampleData.teachers);
    await db.collection("subjects").insertMany(sampleData.subjects);
    await db.collection("classes").insertMany(sampleData.classes);
    await db.collection("classsubjects").insertMany(sampleData.classSubjects);
    await db.collection("teachersubjectcombinations").insertMany(sampleData.teacherSubjectCombos);

    console.log("✅ Inserted sample data");

  } catch (err) {
    console.error("❌ MongoDB seeding error:", err);
  } finally {
    await client.close();
    console.log("✅ Disconnected from MongoDB");
  }
}

seedDB();
