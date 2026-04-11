function logCrossTenantAttempt({ label, id, collegeId }) {
  console.warn("[TENANT_REF_VALIDATION] Cross-tenant or missing reference rejected.", {
    entity: label,
    id: String(id || ""),
    collegeId: String(collegeId || ""),
  });
}

export async function validateOwnership(Model, id, collegeId, label) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }

  const doc = await Model.findOne({ _id: normalizedId, collegeId });
  if (!doc) {
    logCrossTenantAttempt({ label, id: normalizedId, collegeId });
    const error = new Error(`${label} does not belong to your college.`);
    error.status = 404;
    throw error;
  }

  return doc;
}

export async function validateOwnershipMany(Model, ids, collegeId, label) {
  const normalizedIds = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (normalizedIds.length === 0) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }

  const docs = await Model.find({ _id: { $in: normalizedIds }, collegeId });
  if (docs.length !== normalizedIds.length) {
    const foundIds = new Set(docs.map((doc) => String(doc._id)));
    const missingId = normalizedIds.find((id) => !foundIds.has(id));
    logCrossTenantAttempt({ label, id: missingId, collegeId });
    const error = new Error(`${label} contains references outside your college.`);
    error.status = 404;
    throw error;
  }

  return docs;
}
