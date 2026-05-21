const toId = (value) => String(value || "").trim();

const uniqueSorted = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map(toId).filter(Boolean))].sort();

const splitCompositeIds = (value) =>
  toId(value)
    .split("+")
    .map(toId)
    .filter(Boolean);

const normalizePair = (pair) => {
  const subjectId = toId(pair?.subjectId || pair?.subject?._id || pair?.subject);
  const teacherId = toId(pair?.teacherId || pair?.teacher?._id || pair?.teacher);
  return subjectId ? `${subjectId}>${teacherId || "NONE"}` : null;
};

export function buildTeachingAllocationKey({
  collegeId,
  type,
  classIds,
  subjectId,
  teacherIds,
  subjects,
  combinedClassGroupId,
  electiveGroupId,
}) {
  const normalizedType = toId(type || "NORMAL").toUpperCase();
  const normalizedClassIds = uniqueSorted(classIds);
  const normalizedTeacherIds = uniqueSorted(teacherIds);
  const normalizedSubjectId = toId(subjectId || "");
  const normalizedCombinedGroupId = toId(combinedClassGroupId || "NONE");
  const normalizedElectiveGroupId = toId(electiveGroupId || "NONE");
  const normalizedPairs = uniqueSorted((subjects || []).map(normalizePair).filter(Boolean));
  const subjectIds = uniqueSorted([
    ...splitCompositeIds(normalizedSubjectId),
    ...normalizedPairs.map((pair) => pair.split(">")[0]),
  ]);

  return [
    toId(collegeId),
    normalizedType,
    `classes=${normalizedClassIds.join("+")}`,
    `subject=${normalizedSubjectId || "NONE"}`,
    `subjects=${subjectIds.join("+") || "NONE"}`,
    `teachers=${normalizedTeacherIds.join("+") || "NONE"}`,
    `pairs=${normalizedPairs.join("+") || "NONE"}`,
    `electiveGroup=${normalizedElectiveGroupId}`,
    `combinedGroup=${normalizedCombinedGroupId}`,
  ].join("|");
}
