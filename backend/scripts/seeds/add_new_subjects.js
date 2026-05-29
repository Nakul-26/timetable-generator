
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import Subject from '../../models/Subject.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

const subjectsToAdd = [
    { name: 'ENGLISH' },
    { name: 'KANNADA' },
    { name: 'PHYSICS' },
    { name: 'CHEMISTRY' },
    { name: 'MATHS' },
    { name: 'BIOLOGY' },
    { name: 'COMPUTER' },
    { name: 'ACCOUNTS' },
    { name: 'ECONOMICS' },
    { name: 'BUS STD' },
    { name: 'HINDI' },
];

const addSubjects = async () => {
    await connectDB();

    try {
        for (const subject of subjectsToAdd) {
            const existingSubject = await Subject.findOne({ name: subject.name });
            if (existingSubject) {
                console.log(`Subject "${subject.name}" already exists. Skipping.`);
            } else {
                const newSubject = new Subject({
                    id: subject.name.toUpperCase(),
                    name: subject.name,
                    sem: 1, // Assuming default semester 1
                    type: 'theory' // Assuming default type 'theory'
                });
                await newSubject.save();
                console.log(`Added subject: ${subject.name}`);
            }
        }
    } catch (error) {
        console.error('Error adding subjects:', error);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

addSubjects();
