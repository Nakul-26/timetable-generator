import mongoose from 'mongoose';
import Faculty from '../../models/Faculty.js';
import Subject from '../../models/Subject.js';
import TeacherSubjectCombination from '../../models/TeacherSubjectCombination.js';
import dotenv from 'dotenv';

dotenv.config();

const teacherSubjectCombosData = `Teacher ID,Subject
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
RM,HINDI`;

const seedCombos = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const teachers = await Faculty.find();
    const subjects = await Subject.find();

    const teacherIdMap = new Map(teachers.map(t => [t.id, t._id]));
    const subjectIdMap = new Map(subjects.map(s => [s.name, s._id]));

    const lines = teacherSubjectCombosData.trim().split('\n').slice(1);

    for (const line of lines) {
      const [teacherId, subjectName] = line.split(',');
      const facultyId = teacherIdMap.get(teacherId);
      const subjectId = subjectIdMap.get(subjectName);

      if (facultyId && subjectId) {
        const existingCombo = await TeacherSubjectCombination.findOne({
          faculty: facultyId,
          subject: subjectId,
        });

        if (!existingCombo) {
          await TeacherSubjectCombination.create({
            faculty: facultyId,
            subject: subjectId,
          });
          console.log(`Successfully added: ${teacherId} - ${subjectName}`);
        } else {
          console.log(`Skipping existing combo: ${teacherId} - ${subjectName}`);
        }
      } else {
        if (!facultyId) {
          console.warn(`Teacher with ID "${teacherId}" not found.`);
        }
        if (!subjectId) {
          console.warn(`Subject with name "${subjectName}" not found.`);
        }
      }
    }

    console.log('Finished seeding teacher-subject combinations.');
  } catch (error) {
    console.error('Error seeding teacher-subject combinations:', error);
  } finally {
    mongoose.disconnect();
  }
};

seedCombos();
