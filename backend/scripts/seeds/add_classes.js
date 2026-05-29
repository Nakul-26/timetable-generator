
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import Class from '../../models/Class.js';

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

const classesToAdd = [
    { id: 'J1', name: 'I PU - Science (PCMCs) - J1', semester: 'I PU', section: 'Science (PCMCs)', days_per_week: 6 },
    { id: 'J2', name: 'I PU - Science (PCMCs) - J2', semester: 'I PU', section: 'Science (PCMCs)', days_per_week: 6 },
    { id: 'J3', name: 'I PU - Science (PCMB) - J3', semester: 'I PU', section: 'Science (PCMB)', days_per_week: 6 },
    { id: 'J4', name: 'I PU - Science (PCMB) - J4', semester: 'I PU', section: 'Science (PCMB)', days_per_week: 6 },
    { id: 'J5', name: 'I PU - Science (PCMB) - J5', semester: 'I PU', section: 'Science (PCMB)', days_per_week: 6 },
    { id: 'J6', name: 'I PU - Commerce - J6', semester: 'I PU', section: 'Commerce', days_per_week: 6 },
    { id: 'J7', name: 'I PU - Commerce - J7', semester: 'I PU', section: 'Commerce', days_per_week: 6 },
    { id: 'J8', name: 'I PU - Commerce - J8', semester: 'I PU', section: 'Commerce', days_per_week: 6 },
    { id: 'J9', name: 'I PU - Commerce (Implied) - J9', semester: 'I PU', section: 'Commerce (Implied)', days_per_week: 6 },
    { id: 'S1', name: 'II PU - Science (PCMB & Cs) - S1', semester: 'II PU', section: 'Science (PCMB & Cs)', days_per_week: 6 },
    { id: 'S2', name: 'II PU - Science (PCMB & Cs) - S2', semester: 'II PU', section: 'Science (PCMB & Cs)', days_per_week: 6 },
    { id: 'S3', name: 'II PU - Science (PCMB only) - S3', semester: 'II PU', section: 'Science (PCMB only)', days_per_week: 6 },
    { id: 'S4', name: 'II PU - Science (PCMB & Cs) - S4', semester: 'II PU', section: 'Science (PCMB & Cs)', days_per_week: 6 },
    { id: 'S5', name: 'II PU - Commerce - S5', semester: 'II PU', section: 'Commerce', days_per_week: 6 },
    { id: 'S6', name: 'II PU - Commerce - S6', semester: 'II PU', section: 'Commerce', days_per_week: 6 },
    { id: 'S7', name: 'II PU - Commerce - S7', semester: 'II PU', section: 'Commerce', days_per_week: 6 },
];

const getSemesterValue = (semesterString) => {
    if (semesterString === 'I PU') return 1;
    if (semesterString === 'II PU') return 2;
    return null;
};

const addClasses = async () => {
    await connectDB();

    try {
        for (const classData of classesToAdd) {
            const existingClass = await Class.findOne({ id: classData.id });
            if (existingClass) {
                console.log(`Class with id "${classData.id}" already exists. Skipping.`);
            } else {
                const newClass = new Class({
                    id: classData.id,
                    name: classData.name,
                    sem: getSemesterValue(classData.semester),
                    section: classData.section,
                    days_per_week: classData.days_per_week
                });
                await newClass.save();
                console.log(`Added class: ${classData.name}`);
            }
        }
    } catch (error) {
        console.error('Error adding classes:', error);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

addClasses();
