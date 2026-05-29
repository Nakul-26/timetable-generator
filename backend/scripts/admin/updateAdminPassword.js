import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import Admin from '../../models/Admin.js';
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

const updateAdminPassword = async (newPassword) => {
  if (!newPassword) {
    console.error('❌ Please provide a new password.');
    process.exit(1);
  }

  try {
    await connectDB();
    const admin = await Admin.findOne({ email: 'jayanth@college.com' });

    if (!admin) {
      console.error('❌ Admin user not found.');
      process.exit(1);
    }

    admin.password = newPassword;
    await admin.save();

    console.log('✅ Admin password updated successfully.');

  } catch (error) {
    console.error('Error updating admin password:', error.message);
  } finally {
    mongoose.connection.close();
  }
};

const newPassword = process.argv[2];
updateAdminPassword(newPassword);
