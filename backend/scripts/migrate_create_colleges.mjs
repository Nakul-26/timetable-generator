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
import Faculty from '../models/Faculty.js';
import ClassModel from '../models/Class.js';
import College from '../models/College.js';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  const dbName = process.env.MONGO_DB_NAME || process.env.MONGO_DB || 'placementDB';
  console.log('[migrate_create_colleges] connecting to', MONGO, 'dbName=', dbName);
  await mongoose.connect(MONGO, { dbName });

  try {
    const adminIds = (await Admin.distinct('collegeId')).filter(Boolean);
    const facultyIds = (await Faculty.distinct('collegeId')).filter(Boolean);
    const classIds = (await ClassModel.distinct('collegeId')).filter(Boolean);

    const all = new Set();
    for (const id of [...adminIds, ...facultyIds, ...classIds]) {
      if (id === null || id === undefined) continue;
      const v = String(id).trim();
      if (v) all.add(v.toLowerCase());
    }

    const ids = [...all];
    console.log('[migrate_create_colleges] found distinct college ids:', ids.length);
    if (ids.length === 0) {
      console.log('[migrate_create_colleges] no tenant ids found - nothing to do');
      return;
    }

    const created = [];
    for (const cid of ids) {
      const existing = await College.findOne({ collegeId: cid }).lean();
      if (existing) continue;
      console.log('[migrate_create_colleges] missing College for', cid);
      if (apply) {
        const doc = {
          name: cid,
          code: (cid || '').toUpperCase().slice(0, 20),
          collegeId: cid,
          createdBy: null,
        };
        const inserted = await College.create(doc);
        created.push(inserted.collegeId || inserted._id);
        console.log('[migrate_create_colleges] created College', inserted.collegeId || inserted._id);
      }
    }

    console.log('[migrate_create_colleges] summary:');
    console.log('  tenant ids discovered:', ids.length);
    console.log('  colleges created (apply=' + apply + '):', created.length);
    if (!apply) console.log('  (dry-run) re-run with --apply to create missing colleges');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[migrate_create_colleges] error', err);
  process.exit(1);
});
