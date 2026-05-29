import { exec } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'timetable_jayanth';
const BACKUP_PATH = path.resolve(__dirname, 'backup');

if (!MONGO_URI) {
  console.error("❌ MONGO_URI not found in .env file.");
  process.exit(1);
}

const command = `mongodump --uri="${MONGO_URI}" --db="${DB_NAME}" --out="${BACKUP_PATH}"`;

console.log("🚀 Starting database backup...");
console.log(`💾 Database: ${DB_NAME}`);
console.log(`📂 Outputting to: ${BACKUP_PATH}`);

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`❌ Backup failed: ${error.message}`);
    return;
  }
  if (stderr) {
    // mongodump can output to stderr on success, so we check for actual errors
    if (stderr.includes('error') || stderr.includes('failed')) {
        console.error(`❌ mongodump stderr: ${stderr}`);
        return;
    }
  }
  console.log(`✅ Backup successful!`);
  console.log(stdout);
});
