import mongoose from "mongoose";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const { Schema } = mongoose;

const AdminSchema = new Schema({
  collegeId: {
    type: String,
    required: true,
    trim: true,
    default: "default",
    index: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  role: {
    type: String,
    default: "admin",
    immutable: true,
  },
  password: { type: String, required: true, minlength: 8 },
}, { timestamps: true });

// if (!process.env.JWT_SECRET) {
//   throw new Error("JWT_SECRET not defined");
// }

// Hash password before saving
AdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
AdminSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to generate auth token
AdminSchema.methods.generateAuthToken = function () {
  return jwt.sign({ id: this._id, role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
};

export default mongoose.model('Admin', AdminSchema);
