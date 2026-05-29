import mongoose from 'mongoose';
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

const displayAdmins = async () => {
  try {
    await connectDB();
    const admins = await Admin.findOne({ email: 'jayanth@college.com'});
    // if (admins.length === 0) {
    //   console.log('No admin users found.');
    // } else {
    //   console.log('Admin Users:');
    //   admins.forEach(admin => {
    //     console.log(`- ID: ${admin._id}, Email: ${admin.email}`);
    //   });
    // }
    console.log('Admin User:', admins);
  } catch (error) {
    console.error('Error displaying admins:', error.message);
  } finally {
    mongoose.connection.close();
  }
};

displayAdmins();
