
import mongoose from 'mongoose';
import Faculty from '../../models/Faculty.js';
import dotenv from 'dotenv';

dotenv.config();

const teacherData = `
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

const seedTeachers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      dbName: 'timetable_jayanth',
      serverSelectionTimeoutMS: 20000
    });

    const parsedTeacherIds = teacherData
      .trim()
      .split('\n')
      .map(line => {
        const [teacherId] = line.split(',');
        return teacherId.trim();
      });

    for (const teacherId of parsedTeacherIds) {
      let faculty = await Faculty.findOne({ id: teacherId });
      if (!faculty) {
        faculty = new Faculty({
          id: teacherId,
          name: teacherId, // Using teacherId as name as no separate name is provided
        });
        await faculty.save();
        console.log(`Created faculty: ${teacherId}`);
      } else {
        console.log(`Faculty with ID ${teacherId} already exists.`);
      }
    }

    console.log('Teachers seeded successfully.');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error seeding teachers:', error);
    mongoose.connection.close();
  }
};

seedTeachers();
