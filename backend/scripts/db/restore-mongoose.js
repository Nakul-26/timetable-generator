import { exec } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'timetable_jayanth';
const BACKUP_PATH = path.resolve(__dirname, 'mongoose_backup');

if (!MONGO_URI) {
  console.error("❌ MONGO_URI not found in .env file.");
  process.exit(1);
}

if (!fs.existsSync(BACKUP_PATH)) {
  console.error(`❌ Backup directory not found: ${BACKUP_PATH}`);
  console.error("Please ensure you have created a backup first using 'node backend/backup-mongoose.js'");
  process.exit(1);
}

const collections = [
  'faculties',
  'admins',
  'subjects',
  'classes',
  'classsubjects',
  'teachersubjectcombinations',
  'timetableresults',
];

async function restoreData() {
  console.log("🚀 Starting database restore...");
  console.log(`💾 Database: ${DB_NAME}`);
  console.log(`📂 Reading from: ${BACKUP_PATH}`);

  // Optional: Drop database before restore to ensure a clean state
  // This is a dangerous operation, so I will comment it out by default
  // and warn the user.
  // console.log("⚠️  WARNING: Dropping existing database. Comment this out if you want to merge.");
  // await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  // await mongoose.connection.db.dropDatabase();
  // await mongoose.disconnect();
  // console.log("✅ Database dropped.");

  for (const collection of collections) {
    const filePath = path.join(BACKUP_PATH, `${collection}.json`);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Backup file not found for collection: ${collection}. Skipping.`);
      continue;
    }

    // Use --drop to replace the existing collection if it exists
    const command = `mongoimport --uri="${MONGO_URI}" --db="${DB_NAME}" --collection="${collection}" --file="${filePath}" --jsonArray --drop`;

    console.log(`✨ Restoring collection: ${collection}`);
    
    await new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Restore failed for ${collection}: ${error.message}`);
          console.error(`   mongoimport stderr: ${stderr}`);
          return reject(error);
        }
        if (stderr && !stderr.includes('already exists')) { // mongoimport often outputs to stderr on success
          console.warn(`⚠️  mongoimport stderr for ${collection}: ${stderr}`);
        }
        console.log(`✅ Collection ${collection} restored successfully.`);
        console.log(stdout);
        resolve();
      });
    });
  }

  console.log("🎉 All collections restored successfully!");
}

restoreData().catch(error => {
  console.error(`🚨 An unexpected error occurred during restore: ${error}`);
  process.exit(1);
});
