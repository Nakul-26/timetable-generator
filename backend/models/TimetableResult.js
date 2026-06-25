import mongoose from "mongoose";
const { Schema } = mongoose;
import TeachingAllocation from './TeachingAllocation.js';
import { normalizeCombo } from '../utils/comboNormalizer.js';

const ResultSchema = new Schema(
  {
    collegeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true },

    source: {
      type: String,
      enum: ['generator', 'manual', 'assignments'],
      default: 'manual'
    },

    status: {
      type: String,
      enum: ['generated', 'draft', 'edited', 'approved', 'locked', 'session_buffer'],
      default: 'draft',
    },

    generated_from_id: {
      type: Schema.Types.ObjectId,
      ref: 'TimetableResult',
      default: null,
    },

    parent_timetable_id: {
      type: Schema.Types.ObjectId,
      ref: 'TimetableResult',
      default: null,
    },

    edit_version: {
      type: Number,
      default: 1,
    },

    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },

    // Assignment-only results:
    // { [classId]: [teacherSubjectComboId, ...] }
    assignments_only: { type: Object, default: null },

    // Generator / manual outputs
    class_timetables: Object,
    faculty_timetables: Object,
    faculty_daily_hours: Object,
    teacher_timetables: Object,
    subject_hours_assigned: Object,
    slot_sources: Object,
    locked_slots: Object,

    // Metadata
    config: Object,        // { days, hours, fixedSlots, ... }
    version: Number,
    score: Number,
    objective_value: Number,
    generation_batch_id: String,
    source_generation_job_id: {
      type: String,
      default: null,
      index: true,
    },
    selected_option_id: String,
    generation_options: Object,

    subjects: Object,
    faculties: Object,
    combos: Object,
    allocations_report: Object,

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true }, // Ensure virtuals are included in toJSON
    toObject: { virtuals: true } // Ensure virtuals are included in toObject
  }
);

// TTL index for automatic deletion. Documents with a non-null expiresAt
// will be deleted when the current date passes expiresAt.
ResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Indexes for fast queries
ResultSchema.index({ collegeId: 1, createdAt: -1 });
ResultSchema.index({ collegeId: 1, source: 1, createdAt: -1 });
ResultSchema.index(
  { collegeId: 1, source_generation_job_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source_generation_job_id: { $type: "string" },
    },
  }
);

/**
 * Populate assignments_only for TimetableResult documents with source='assignments'.
 * Reads from TeachingAllocation — the canonical assignment source.
 *
 * Produces doc.populated_assignments: { [classId]: AssignmentDisplayObject[] }
 */
async function populateAssignments(docs, collegeId) {
  if (!Array.isArray(docs)) docs = [docs];

  const targetDocs = docs.filter(doc => doc && doc.source === 'assignments' && doc.assignments_only);
  if (!targetDocs.length) return;

  // Collect all unique assignment IDs across all docs
  const allIds = new Set();
  for (const doc of targetDocs) {
    for (const ids of Object.values(doc.assignments_only)) {
      if (Array.isArray(ids)) {
        ids.forEach(id => {
          if (mongoose.Types.ObjectId.isValid(String(id))) allIds.add(String(id));
        });
      }
    }
  }

  if (!allIds.size) {
    targetDocs.forEach(doc => { doc.populated_assignments = {}; });
    return;
  }

  // Single batch fetch from TeachingAllocation (canonical source)
  const allocations = await TeachingAllocation.find({
    _id: { $in: [...allIds] },
    ...(collegeId ? { collegeId } : {}),
  }).lean();

  const allocationMap = new Map(allocations.map(a => [String(a._id), a]));

  for (const doc of targetDocs) {
    const populated = {};
    for (const [classId, ids] of Object.entries(doc.assignments_only)) {
      populated[classId] = (Array.isArray(ids) ? ids : [])
        .map(id => allocationMap.get(String(id)))
        .filter(Boolean)
        .map(a => ({
          _id: String(a._id),
          assignmentId: String(a._id),
          teacher: {
            _id: String(a.teacher || a.teachers?.[0] || ''),
            name: null,  // resolved by caller via buildAssignmentLookup if needed
          },
          subject: {
            _id: String(a.subject || ''),
            name: null,
          },
          teacherIds: [
            ...(Array.isArray(a.teachers) ? a.teachers.map(String) : []),
            ...(a.teacher ? [String(a.teacher)] : []),
          ].filter((v, i, arr) => arr.indexOf(v) === i),
          subjectId: String(a.subject || ''),
          classIds: Array.isArray(a.classIds) ? a.classIds.map(String) : [],
          hoursPerWeek: a.hoursPerWeek,
          mode: String(a.type || 'NORMAL').toUpperCase(),
        }));
    }
    doc.populated_assignments = populated;
  }
}

/**
 * Explicitly populate assignment combos on an array (or single) TimetableResult
 * for the 'assignments' source type.
 *
 * Routes MUST call this manually when they need populated data.
 * This replaces the removed post-find/findOne hooks which caused dual-population bugs.
 *
 * @param {object | object[]} docsOrDoc
 * @param {string} [collegeId]
 * @returns {Promise<void>}
 */
export async function populateTimetableAssignments(docsOrDoc, collegeId) {
  const docs = Array.isArray(docsOrDoc) ? docsOrDoc : (docsOrDoc ? [docsOrDoc] : []);
  if (docs.length === 0) return;

  const needsPopulation = docs.some(
    (doc) => doc && doc.source === 'assignments' && doc.assignments_only
  );
  if (!needsPopulation) return;

  await populateAssignments(docs, collegeId);
}

export default mongoose.model('TimetableResult', ResultSchema);
