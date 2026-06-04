import React from 'react';

const TimetableHoursReport = ({
  classId,
  assignedHours,
  requiredHoursByClassSubject,
  currentClass,
  getSubjectDisplayName,
  buildDisplayRequiredHours
}) => {
  if (!currentClass) return null;

  const classIdKey = String(classId);
  const requiredFromAssignments = requiredHoursByClassSubject.get(classIdKey) || {};
  const requiredHours = buildDisplayRequiredHours(
    currentClass,
    requiredFromAssignments
  );

  const allSubjectIds = new Set([
    ...Object.keys(requiredHours),
    ...Object.keys(assignedHours),
  ]);

  const mergedRows = new Map();
  Array.from(allSubjectIds).forEach((subjectId) => {
    const assigned = Number(assignedHours[subjectId] || 0);
    const requiredValue = requiredHours[subjectId];
    const required =
      requiredValue === undefined || requiredValue === null
        ? "N/A"
        : Number(requiredValue);

    if (assigned === 0 && required === 0) return;
    if (assigned === 0 && required === "N/A") return;

    const name = getSubjectDisplayName(subjectId);
    const existing = mergedRows.get(name);
    if (!existing) {
      mergedRows.set(name, { assigned, required });
      return;
    }

    existing.assigned += assigned;
    if (required !== "N/A") {
      existing.required =
        existing.required === "N/A"
          ? required
          : Number(existing.required) + required;
    }
  });

  const rows = Array.from(mergedRows.entries()).map(([name, values]) => {
    return (
      <div key={name} className="tt-hours-row">
        <span>{name}: {values.assigned} / {values.required}</span>
      </div>
    );
  });

  if (!rows.length) {
    return <div className="tt-hours-row">No subject hours data available.</div>;
  }

  return (
    <div className="tt-hours-report">
      <h4>Subject Hours Report</h4>
      {rows}
    </div>
  );
};

export default TimetableHoursReport;
