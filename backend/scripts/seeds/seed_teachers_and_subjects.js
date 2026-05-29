
import mongoose from 'mongoose';
import Faculty from '../../models/Faculty.js';
import Subject from '../../models/Subject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import dotenv from 'dotenv';

dotenv.config();

const teacherSubjectData = `
ARD,ENGLISH
ML,ENGLISH
SPN,ENGLISH
NK,ENGLISH
KSG,KANNADA
MN,KANNADA
ASK,KANNADA
BRV,PHYSICS
SN,PHYSICS
MS,PHYSICS
USA,PHYSICS
VM,CHEMISTRY
VV,CHEMISTRY
SG,CHEMISTRY
JK,CHEMISTRY
NNK,MATHS
YPN,MATHS
RM,MATHS
RSK,MATHS
SMS,MATHS
MHK,BIOLOGY
HN,BIOLOGY
SRP,BIOLOGY
ANB,COMPUTER
TNR,COMPUTER
ATP,COMPUTER
SJ,COMPUTER
SPB,ACCOUNTS
GCS,ACCOUNTS
RNK,ACCOUNTS
SRK,ECONOMICS
NM,ECONOMICS
GS,ECONOMICS
GCV,BUS STD
RP,BUS STD
KLG,BUS STD
RM,HINDI
`;

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const parsedData = teacherSubjectData
      .trim()
      .split('\n')
      .map(line => {
        const [teacherId, subjectName] = line.split(',');
        return { teacherId: teacherId.trim(), subjectName: subjectName.trim() };
      });

    for (const { teacherId, subjectName } of parsedData) {
      // 1. Find or create Subject
      let subject = await Subject.findOne({ name: subjectName });
      if (!subject) {
        // We need to make some assumptions here about the subject properties
        // as they are not provided in the user's input.
        subject = new Subject({
          id: subjectName.toLowerCase().replace(/ /g, '_'),
          name: subjectName,
          sem: 1, // Assuming a default semester
          type: 'theory', // Assuming a default type
          code: subjectName.toUpperCase(), // Add a unique code
        });
        await subject.save();
        console.log(`Created subject: ${subjectName}`);
      }

      // 2. Find or create Faculty
      let faculty = await Faculty.findOne({ id: teacherId });
      if (!faculty) {
        faculty = new Faculty({
          id: teacherId,
          name: teacherId, // Assuming name is the same as ID for now
        });
        await faculty.save();
        console.log(`Created faculty: ${teacherId}`);
      }

      // 3. Create TeacherSubjectCombination
      const combination = await TeacherSubjectCombination.findOne({
        faculty: faculty._id,
        subject: subject._id,
      });

      if (!combination) {
        const newCombination = new TeacherSubjectCombination({
          faculty: faculty._id,
          subject: subject._id,
        });
        await newCombination.save();
        console.log(`Associated faculty ${teacherId} with subject ${subjectName}`);
      } else {
        console.log(`Faculty ${teacherId} is already associated with subject ${subjectName}`);
      }
    }

    console.log('Teacher and subject data seeded successfully.');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error seeding data:', error);
    mongoose.connection.close();
  }
};

seedData();
