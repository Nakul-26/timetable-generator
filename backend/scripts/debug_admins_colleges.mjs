#!/usr/bin/env node
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load backend/.env if present (simple loader)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.indexOf('=') === -1) continue;
    const [k, ...rest] = l.split('=');
    const key = k.trim();
    const value = rest.join('=').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

const MONGO = process.env.MONGO_URI || process.env.MONGOURL || 'mongodb://localhost:27017/placementDB';

import Admin from '../models/Admin.js';
import College from '../models/College.js';

async function main() {
  const dbName = process.env.MONGO_DB_NAME || process.env.MONGO_DB || 'placementDB';
  console.log('[debug_admins_colleges] connecting to', MONGO, 'dbName=', dbName);
  await mongoose.connect(MONGO, { dbName });

  try {
    const colleges = await College.find({}).lean();
    console.log('[debug_admins_colleges] colleges count:', colleges.length);
    for (const c of colleges) {
      console.log('  college:', {
        _id: String(c._id),
        collegeId: c.collegeId,
        name: c.name,
        createdBy: c.createdBy ? String(c.createdBy) : null,
      });
    }

    const admins = await Admin.find({}).lean();
    console.log('[debug_admins_colleges] admins count:', admins.length);
    for (const a of admins) {
      console.log('  admin:', {
        _id: String(a._id),
        email: a.email,
        role: a.role,
        collegeId: a.collegeId === undefined ? null : a.collegeId,
      });
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[debug_admins_colleges] error', err);
  process.exit(1);
});
