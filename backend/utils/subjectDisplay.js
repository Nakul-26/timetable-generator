export function buildSubjectMap(subjects = []) {
  return new Map(
    (Array.isArray(subjects) ? subjects : []).map((subject) => [String(subject?._id), subject])
  );
}

export function collectSubjectIdsFromEncodedSubjectId(subjectId) {
  const rawValue = String(subjectId || "");
  if (!rawValue.startsWith("VIRTUAL_ELECTIVE_")) {
    return [];
  }

  const parts = rawValue.split("_").slice(2).filter(Boolean);
  const [, ...rest] = parts;
  const markerIndex = rest.indexOf("PLACEHOLDER");
  const candidateIds = markerIndex !== -1
    ? [rest[markerIndex + 1], ...rest.slice(markerIndex + 2)]
    : rest;

  return candidateIds.filter((value) => /^[0-9a-fA-F]{24}$/.test(String(value || "")));
}

export function getSubjectDisplayName(subject, fallback = "Unknown Subject") {
  if (!subject) {
    return fallback;
  }

  if (typeof subject === "string") {
    return subject || fallback;
  }

  return (
    subject.name ||
    subject.subject?.name ||
    subject.subject_name ||
    subject.subjectName ||
    fallback
  );
}

export function getComboSubjectDisplayName(combo, subjectMap, fallback = "Unknown Subject") {
  if (!combo) {
    return fallback;
  }

  const subjectId = String(combo?.subject?._id || combo?.subject_id || combo?.subject || "");
  return (
    getSubjectDisplayName(combo, "") ||
    resolveVirtualSubjectDisplayName(subjectId, subjectMap) ||
    getSubjectDisplayName(subjectMap?.get(subjectId), "") ||
    (subjectId ? `Subject ${subjectId.slice(-4)}` : fallback)
  );
}

function resolveVirtualSubjectDisplayName(subjectId, subjectMap) {
  const rawValue = String(subjectId || "");
  if (!rawValue.startsWith("VIRTUAL_ELECTIVE_")) {
    return null;
  }

  const parts = rawValue.split("_").slice(2).filter(Boolean);
  if (parts.length < 2) {
    return "Elective";
  }

  const [, ...rest] = parts;
  const markerIndex = rest.indexOf("PLACEHOLDER");
  const placeholderSubjectId = markerIndex !== -1 ? rest[markerIndex + 1] : null;
  const requiredSubjectIds = markerIndex !== -1 ? rest.slice(markerIndex + 2) : rest;
  const placeholderName = getSubjectDisplayName(subjectMap?.get(String(placeholderSubjectId)), "");
  const subjectNames = requiredSubjectIds
    .map((id) => getSubjectDisplayName(subjectMap?.get(String(id)), ""))
    .filter(Boolean);

  if (placeholderName && subjectNames.length) {
    return `${placeholderName} (${subjectNames.join(" + ")})`;
  }
  if (placeholderName) {
    return placeholderName;
  }
  if (subjectNames.length) {
    return `Elective (${subjectNames.join(" + ")})`;
  }
  return "Elective";
}
