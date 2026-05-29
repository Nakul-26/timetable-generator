
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Faculty from '../../models/Faculty.js';
import dotenv from 'dotenv';

dotenv.config();

const faculties = [
  { id: 'faculty1', name: 'Faculty 1', email: 'faculty1@example.com', password: 'password123' },
  { id: 'faculty2', name: 'Faculty 2', email: 'faculty2@example.com', password: 'password123' },
  { id: 'faculty3', name: 'Faculty 3', email: 'faculty3@example.com', password: 'password123' }
];

const seedFaculties = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    for (const facultyData of faculties) {
      const hashedPassword = await bcrypt.hash(facultyData.password, 10);
      const faculty = new Faculty({
        ...facultyData,
        password: hashedPassword,
      });
      await faculty.save();
    }

    console.log('Faculties added successfully');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error adding faculties:', error);
    mongoose.connection.close();
  }
};

seedFaculties();
