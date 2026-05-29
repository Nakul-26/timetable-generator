import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: 'timetable_jayanth',
      serverSelectionTimeoutMS: 20000
    });
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ Mongoose connection error:', err);
    process.exit(1);
  }
};

const clearFaculties = async () => {
  try {
    await connectDB();
    console.log('Dropping faculties collection...');
    await mongoose.connection.db.dropCollection('faculties');
    console.log('✅ Faculties collection dropped successfully.');
  } catch (error) {
    if (error.code === 26) {
      console.log('ℹ️ Faculties collection did not exist, no action taken.');
    } else {
      console.error('Error dropping faculties collection:', error.message);
    }
  } finally {
    mongoose.connection.close();
  }
};

clearFaculties();
