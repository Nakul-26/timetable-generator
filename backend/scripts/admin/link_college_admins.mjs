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

import Admin from '../../models/Admin.js';
import College from '../../models/College.js';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  const dbName = process.env.MONGO_DB_NAME || process.env.MONGO_DB || 'placementDB';
  console.log('[link_college_admins] connecting to', MONGO, 'dbName=', dbName);
  await mongoose.connect(MONGO, { dbName });

  try {
    const colleges = await College.find({}).lean();
    if (!colleges.length) {
      console.log('[link_college_admins] no colleges found');
      return;
    }

    let toLink = [];
    for (const c of colleges) {
      // find admin for this college (role admin)
      const admin = await Admin.findOne({ collegeId: c.collegeId, role: 'admin' }).lean();
      if (!admin) {
        console.log('[link_college_admins] no admin found for', c.collegeId);
        continue;
      }
      if (c.createdBy && String(c.createdBy) === String(admin._id)) {
        console.log('[link_college_admins] already linked for', c.collegeId);
        continue;
      }
      toLink.push({ collegeId: c.collegeId, collegeDbId: c._id, adminId: admin._id });
    }

    console.log('[link_college_admins] to link count:', toLink.length);
    if (toLink.length === 0) return;

    if (!apply) {
      for (const t of toLink) {
        console.log('[link_college_admins] would link', t.collegeId, '->', t.adminId);
      }
      console.log('[link_college_admins] dry-run complete. Re-run with --apply to perform updates.');
      return;
    }

    const updated = [];
    for (const t of toLink) {
      await College.updateOne({ _id: t.collegeDbId }, { $set: { createdBy: t.adminId } });
      updated.push(t.collegeId);
      console.log('[link_college_admins] linked', t.collegeId, '->', t.adminId);
    }

    console.log('[link_college_admins] summary:');
    console.log('  linked count:', updated.length);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[link_college_admins] error', err);
  process.exit(1);
});
