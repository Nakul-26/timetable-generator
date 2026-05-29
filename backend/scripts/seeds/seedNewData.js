import mongoose from "mongoose";
import dotenv from "dotenv";
import Faculty from "../../models/Faculty.js";
import Subject from "../../models/Subject.js";
import Class from "../../models/Class.js";
import Combo from "../../models/Combo.js";
import { facultiesData, subjectsData, classesData, comboMappingData } from "./new_seed_data.js";

dotenv.config();

const seedNewData = async () => {
    try {
        const uri = process.env.MONGO_URI;
        if (!uri) {
            throw new Error("❌ MONGO_URI is not defined in .env");
        }

        await mongoose.connect(uri, {
            dbName: 'timetable_jayanth',
            serverSelectionTimeoutMS: 20000
        });
        console.log("✅ Connected to MongoDB via Mongoose for seeding");

        // Clear existing data (optional, but good for a fresh seed)
        console.log("Clearing existing Faculty, Subject, Class, and Combo data...");
        await Faculty.deleteMany({});
        await Subject.deleteMany({});
        await Class.deleteMany({});
        await Combo.deleteMany({});
        console.log("Existing data cleared.");

        // Insert Faculties
        console.log("Inserting faculties...");
        const insertedFaculties = await Faculty.insertMany(facultiesData);
        console.log(`Inserted ${insertedFaculties.length} faculties.`);

        // Insert Subjects
        console.log("Inserting subjects...");
        const insertedSubjects = await Subject.insertMany(subjectsData);
        console.log(`Inserted ${insertedSubjects.length} subjects.`);

        // Insert Classes
        console.log("Inserting classes...");
        const insertedClasses = await Class.insertMany(classesData);
        console.log(`Inserted ${insertedClasses.length} classes.`);

        // Insert Combos
        console.log("Inserting combos...");
        const combosToInsert = [];
        for (const comboMap of comboMappingData) {
            const subjectDoc = insertedSubjects.find(s => s.name === comboMap.subjectName);
            if (!subjectDoc) {
                console.warn(`Subject ${comboMap.subjectName} not found, skipping combo.`);
                continue;
            }

            const facultyDoc = insertedFaculties.find(f => f.id === comboMap.facultyId);
            if (!facultyDoc) {
                console.warn(`Faculty ${comboMap.facultyId} not found, skipping combo.`);
                continue;
            }

            const classObjectIds = [];
            for (const classId of comboMap.classIds) {
                const classDoc = insertedClasses.find(c => c.id === classId);
                if (classDoc) {
                    classObjectIds.push(classDoc._id);
                } else {
                    console.warn(`Class ${classId} not found for combo, skipping this class.`);
                }
            }
            
            if (classObjectIds.length > 0) {
                combosToInsert.push({
                    faculty_id: facultyDoc._id,
                    subject_id: subjectDoc._id,
                    class_ids: classObjectIds,
                    combo_name: comboMap.combo_name,
                    credits: comboMap.credits
                });
            }
        }
        const insertedCombos = await Combo.insertMany(combosToInsert);
        console.log(`Inserted ${insertedCombos.length} combos.`);

        // Associate combos with classes
        console.log("Associating combos with classes...");
        const classComboMap = {};
        for (const combo of insertedCombos) {
            for (const classId of combo.class_ids) {
                if (!classComboMap[classId]) {
                    classComboMap[classId] = [];
                }
                classComboMap[classId].push(combo._id);
            }
        }

        for (const classId in classComboMap) {
            if (Object.hasOwnProperty.call(classComboMap, classId)) {
                const comboIds = classComboMap[classId];
                await Class.updateOne(
                    { _id: classId },
                    { $addToSet: { assigned_teacher_subject_combos: { $each: comboIds } } }
                );
            }
        }
        console.log("Associated combos with classes.");

        console.log("Seeding process completed successfully!");

    } catch (error) {
        console.error("Error during seeding:", error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
};

seedNewData();
