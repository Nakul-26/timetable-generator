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
  console.log('[fix_admin_roles_and_link] connecting to', MONGO, 'dbName=', dbName);
  await mongoose.connect(MONGO, { dbName });

  try {
    // Find admins that have a collegeId but missing role
    const candidates = await Admin.find({
      collegeId: { $exists: true, $ne: null, $ne: '' },
      $or: [ { role: { $exists: false } }, { role: null }, { role: '' } ]
    }).lean();

    console.log('[fix_admin_roles_and_link] candidate admins missing role:', candidates.length);
    for (const a of candidates) {
      console.log('  candidate:', { _id: String(a._id), email: a.email, collegeId: a.collegeId });
    }

    if (apply && candidates.length) {
      for (const a of candidates) {
        await Admin.updateOne({ _id: a._id }, { $set: { role: 'admin' } });
        console.log('[fix_admin_roles_and_link] set role=admin for', a.email);
      }
    }

    // Link colleges missing createdBy to an admin
    const colleges = await College.find({}).lean();
    const toLink = [];
    for (const c of colleges) {
      if (c.createdBy) continue;
      const admin = await Admin.findOne({ collegeId: c.collegeId, role: 'admin' }).lean();
      if (!admin) {
        console.log('[fix_admin_roles_and_link] no admin (role=admin) for college', c.collegeId);
        continue;
      }
      toLink.push({ collegeId: c.collegeId, collegeDbId: c._id, adminId: admin._id, adminEmail: admin.email });
    }

    console.log('[fix_admin_roles_and_link] colleges to link count:', toLink.length);
    for (const t of toLink) {
      console.log('  would link:', { collegeId: t.collegeId, adminId: String(t.adminId), adminEmail: t.adminEmail });
    }

    if (apply && toLink.length) {
      for (const t of toLink) {
        await College.updateOne({ _id: t.collegeDbId }, { $set: { createdBy: t.adminId } });
        console.log('[fix_admin_roles_and_link] linked', t.collegeId, '->', String(t.adminId));
      }
    }

    if (!apply) console.log('[fix_admin_roles_and_link] dry-run complete. Re-run with --apply to perform updates.');
    else console.log('[fix_admin_roles_and_link] apply complete.');

  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[fix_admin_roles_and_link] error', err);
  process.exit(1);
});
