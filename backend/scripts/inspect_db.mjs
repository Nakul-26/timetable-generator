#!/usr/bin/env node
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

  const dbName = process.env.MONGO_DB_NAME || process.env.MONGO_DB || 'placementDB';
  console.log('[inspect_db] connecting to', MONGO, 'dbName=', dbName);
  await mongoose.connect(MONGO, { dbName });

const db = mongoose.connection.db;

const collections = await db.listCollections().toArray();
console.log('[inspect_db] collections:', collections.map(c => c.name).join(', '));

const check = async (name, sampleQuery = {}) => {
  try {
    const col = db.collection(name);
    const count = await col.countDocuments();
    const sample = await col.find(sampleQuery).limit(5).toArray();
    console.log(`\n[${name}] count: ${count}`);
    if (sample.length) console.log(sample.slice(0,3));
    else console.log('[no sample docs]');
  } catch (e) {
    console.error('[inspect_db] error reading', name, e.message);
  }
};

await check('admins');
await check('faculties');
await check('classes');
await check('colleges');
await check('timetableresults');

await mongoose.disconnect();
console.log('[inspect_db] done');
