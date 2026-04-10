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

export function getComboSubjectDisplayName(combo, subjectById, fallback = "Unknown Subject") {
  if (!combo) {
    return fallback;
  }

  const subjectId = String(combo?.subject?._id || combo?.subject_id || combo?.subject || "");
  return (
    getSubjectDisplayName(combo, "") ||
    getSubjectDisplayName(subjectById?.get?.(subjectId), "") ||
    fallback
  );
}
