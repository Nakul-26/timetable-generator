import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Import all your models
import Faculty from '../../models/Faculty.js';
import Admin from '../../models/Admin.js';
import Subject from '../../models/Subject.js';
import ClassModel from '../../models/Class.js';
import ClassSubject from '../../models/ClassSubject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import TimetableResult from '../../models/TimetableResult.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'timetable_jayanth';
const BACKUP_DIR = path.resolve(__dirname, '../../data/mongoose_backup');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

if (!MONGO_URI) {
  console.error("❌ MONGO_URI not found in .env file.");
  process.exit(1);
}

const models = {
  Faculty,
  Admin,
  Subject,
  ClassModel,
  ClassSubject,
  TeacherSubjectCombination,
  TimetableResult,
};

async function backupData() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log(`✅ Connected to MongoDB database: ${DB_NAME}`);

    for (const modelName of Object.keys(models)) {
      const Model = models[modelName];
      console.log(`💾 Backing up collection: ${Model.collection.name}`);
      const data = await Model.find({}).lean();
      const filePath = path.join(BACKUP_DIR, `${Model.collection.name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`✅ Saved ${data.length} documents to ${filePath}`);
    }

    console.log("🚀 All collections backed up successfully!");
  } catch (error) {
    console.error(`❌ Backup failed: ${error.message}`);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

backupData();
