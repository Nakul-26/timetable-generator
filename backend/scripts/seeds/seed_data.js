



// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// THIS IS OUT DATED
// 
// 
// WARNING: Running this script will DELETE existing data in
// the Subject, Faculty, Class, and Combo collections!
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!




import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import Subject from './models/Subject.js';
import Faculty from './models/Faculty.js';
import Class from './models/Class.js';
import Combo from './models/Combo.js';

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

const seedData = async () => {
    await connectDB();

    try {
        // Clear existing data
        await Subject.deleteMany({});
        await Faculty.deleteMany({});
        await Class.deleteMany({});
        await Combo.deleteMany({});
        console.log('Cleared existing data.');

        // --- Data Definitions ---

        const subjectsData = [
            { id: 'ENGLISH', name: 'ENGLISH', no_of_hours_per_week: 4, type: 'theory' },
            { id: 'KANNADA', name: 'KANNADA', no_of_hours_per_week: 4, type: 'theory' },
            { id: 'PHYSICS', name: 'PHYSICS', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'CHEMISTRY', name: 'CHEMISTRY', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'MATHS', name: 'MATHS', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'BIOLOGY', name: 'BIOLOGY', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'COMPUTER SCIENCE', name: 'COMPUTER SCIENCE', no_of_hours_per_week: 4, type: 'theory' },
            { id: 'ACCOUNTS', name: 'ACCOUNTS', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'BUSINESS', name: 'BUSINESS', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'ECONOMICS', name: 'ECONOMICS', no_of_hours_per_week: 5, type: 'theory' },
            { id: 'HINDI', name: 'HINDI', no_of_hours_per_week: 4, type: 'theory' },
        ];

        const facultiesData = [
            // ENGLISH
            { id: 'ARD', name: 'ARD' }, { id: 'ML', name: 'ML' }, { id: 'SPN', name: 'SPN' }, { id: 'NK', name: 'NK' },
            // KANNADA
            { id: 'KSG', name: 'KSG' }, { id: 'MN', name: 'MN' }, { id: 'ASK', name: 'ASK' },
            // PHYSICS
            { id: 'SN', name: 'SN' }, { id: 'MS', name: 'MS' }, { id: 'USA', name: 'USA' }, { id: 'BRV', name: 'BRV' },
            // CHEMISTRY
            { id: 'VM', name: 'VM' }, { id: 'VV', name: 'VV' }, { id: 'SG', name: 'SG' }, { id: 'JK', name: 'JK' },
            // MATHS
            { id: 'YPN', name: 'YPN' }, { id: 'RM', name: 'RM' }, { id: 'RSK', name: 'RSK' }, { id: 'SMS', name: 'SMS' }, { id: 'NNK', name: 'NNK' },
            // BIOLOGY
            { id: 'MHK', name: 'MHK' }, { id: 'HN', name: 'HN' }, { id: 'SRP', name: 'SRP' },
            // COMPUTER SCIENCE
            { id: 'ANB', name: 'ANB' }, { id: 'TNR', name: 'TNR' }, { id: 'ATP', name: 'ATP' }, { id: 'SJ', name: 'SJ' },
            // ACCOUNTS
            { id: 'SPB', name: 'SPB' }, { id: 'GCS', name: 'GCS' }, { id: 'RNK', name: 'RNK' },
            // BUSINESS
            { id: 'GCV', name: 'GCV' }, { id: 'RP', name: 'RP' }, { id: 'KLG', name: 'KLG' },
            // ECONOMICS
            { id: 'SRK', name: 'SRK' }, { id: 'NM', name: 'NM' }, { id: 'GS', name: 'GS' },
        ];

        const classesData = [
            // II PUC
            { id: 'S1', name: 'S1', section: 'S1', sem: 2 }, { id: 'S2', name: 'S2', section: 'S2', sem: 2 }, 
            { id: 'S3', name: 'S3', section: 'S3', sem: 2 }, { id: 'S4', name: 'S4', section: 'S4', sem: 2 },
            { id: 'S5', name: 'S5', section: 'S5', sem: 2 }, { id: 'S6', name: 'S6', section: 'S6', sem: 2 }, 
            { id: 'S7', name: 'S7', section: 'S7', sem: 2 },
            // I PUC
            { id: 'J1', name: 'J1', section: 'J1', sem: 1 }, { id: 'J2', name: 'J2', section: 'J2', sem: 1 },
            { id: 'J3', name: 'J3', section: 'J3', sem: 1 }, { id: 'J4', name: 'J4', section: 'J4', sem: 1 },
            { id: 'J5', name: 'J5', section: 'J5', sem: 1 }, { id: 'J6', name: 'J6', section: 'J6', sem: 1 },
            { id: 'J7', name: 'J7', section: 'J7', sem: 1 }, { id: 'J8', name: 'J8', section: 'J8', sem: 1 },
        ];

        // --- Insert Data ---

        await Subject.insertMany(subjectsData);
        await Faculty.insertMany(facultiesData);
        await Class.insertMany(classesData);
        console.log('Inserted Subjects, Faculties, and Classes.');

        // --- Create Mappings (Combos) ---

        const subjects = await Subject.find({});
        const faculties = await Faculty.find({});
        const classes = await Class.find({});

        const subjectMap = subjects.reduce((map, sub) => ({ ...map, [sub.name]: sub._id }), {});
        const facultyMap = faculties.reduce((map, fac) => ({ ...map, [fac.name]: fac._id }), {});
        const classMap = classes.reduce((map, cls) => ({ ...map, [cls.name]: cls._id }), {});

        const combosData = [];

        const mappings = [
            // Science Subjects
            { subject: 'PHYSICS', teachers: ['SN', 'MS', 'USA'], classes: ['J1', 'J2', 'J3', 'J4', 'J5', 'S1', 'S2', 'S3', 'S4'] },
            { subject: 'PHYSICS', teachers: ['BRV'], classes: ['S1', 'S2', 'S3', 'S4'] },
            { subject: 'CHEMISTRY', teachers: ['VM', 'VV', 'SG', 'JK'], classes: ['J1', 'J2', 'J3', 'J4', 'J5', 'S1', 'S2', 'S3', 'S4'] },
            { subject: 'MATHS', teachers: ['YPN', 'RM', 'RSK', 'SMS'], classes: ['J1', 'J2', 'J3', 'J4', 'J5', 'S1', 'S2', 'S3', 'S4'] },
            { subject: 'MATHS', teachers: ['NNK'], classes: ['S1', 'S2', 'S3', 'S4'] },
            { subject: 'BIOLOGY', teachers: ['MHK', 'HN', 'SRP'], classes: ['J3', 'J4', 'J5', 'S3', 'S4'] },
            { subject: 'COMPUTER SCIENCE', teachers: ['ANB', 'TNR', 'ATP', 'SJ'], classes: ['J1', 'J2', 'J4', 'S1', 'S2', 'S4'] },
            // Commerce Subjects
            { subject: 'ACCOUNTS', teachers: ['SPB', 'GCS', 'RNK'], classes: ['J6', 'J7', 'J8', 'S5', 'S6', 'S7'] },
            { subject: 'BUSINESS', teachers: ['GCV', 'RP', 'KLG'], classes: ['J6', 'J7', 'J8', 'S5', 'S6', 'S7'] },
            { subject: 'ECONOMICS', teachers: ['SRK', 'NM', 'GS'], classes: ['J6', 'J7', 'J8', 'S5', 'S6', 'S7'] },
            // Languages
            { subject: 'ENGLISH', teachers: ['ARD', 'ML', 'SPN', 'NK'], classes: [...classesData.map(c => c.name)] },
            { subject: 'KANNADA', teachers: ['KSG', 'MN', 'ASK'], classes: [...classesData.map(c => c.name)] },
            { subject: 'HINDI', teachers: ['RM'], classes: [...classesData.map(c => c.name)] },
        ];

        for (const mapping of mappings) {
            const subject_id = subjectMap[mapping.subject];
            if (!subject_id) {
                console.warn(`Subject not found: ${mapping.subject}`);
                continue;
            }

            for (const teacherName of mapping.teachers) {
                const faculty_id = facultyMap[teacherName];
                if (!faculty_id) {
                    console.warn(`Faculty not found: ${teacherName}`);
                    continue;
                }

                for (const className of mapping.classes) {
                    const class_id = classMap[className];
                    if (!class_id) {
                        console.warn(`Class not found: ${className}`);
                        continue;
                    }
                    
                    combosData.push({
                        faculty_id,
                        subject_id,
                        class_id,
                        combo_name: `${teacherName}-${mapping.subject}-${className}`
                    });
                }
            }
        }

        await Combo.insertMany(combosData);
        console.log(`Inserted ${combosData.length} combos.`);

        console.log('Database seeding completed successfully!');

    } catch (error) {
        console.error('Error seeding data:', error);
    } finally {
        mongoose.connection.close();
        console.log('MongoDB connection closed.');
    }
};

seedData();
