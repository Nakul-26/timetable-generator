import mongoose from 'mongoose';

const ElectiveSubjectSettingSchema = new mongoose.Schema({
    collegeId: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    class: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        required: true
    },
    subject: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject',
        required: true
    },
    teacherCategoryRequirements: {
        type: Map,
        of: Number,
        required: true
    }
});

// Ensure a unique setting for each class-subject pair
ElectiveSubjectSettingSchema.index({ collegeId: 1, class: 1, subject: 1 }, { unique: true });

export default mongoose.model('ElectiveSubjectSetting', ElectiveSubjectSettingSchema);
