import React from 'react';
import TimetableHoursReport from './TimetableHoursReport';

const ClassTimetable = ({
  classId,
  slots,
  getClassName,
  HOURS_PER_DAY,
  isCellMatching,
  comboById,
  subjectById,
  facultyById,
  getSubjectDisplayName,
  calculateAssignedHours,
  classById,
  requiredHoursByClassSubject,
  buildDisplayRequiredHours
}) => {
  const assignedHours = calculateAssignedHours(slots);
  const currentClass = classById.get(classId);

  return (
    <div key={classId} className="tt-class-block">
      <h3>{getClassName(classId)}</h3>
      <div className="table-responsive">
        <table className="styled-table">
          <thead>
            <tr>
              <th>Day / Period</th>
              {Array.from({ length: HOURS_PER_DAY }).map((_, p) => (
                <th key={p}>P{p + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((row, d) => (
              <tr key={d}>
                <td>Day {d + 1}</td>
                {row.map((slot, h) => {
                  const cellMatches = isCellMatching(slot);
                  const cellClassName = cellMatches ? "" : "tt-cell-dim";

                  if (!slot || slot === -1 || slot === "BREAK") {
                    return <td key={h} className={cellClassName}>-</td>;
                  }

                  const combo = comboById.get(String(slot));
                  if (!combo) {
                    return <td key={h} className={cellClassName}>?</td>;
                  }

                  const subject = subjectById.get(String(combo.subject_id));
                  const subjectName = getSubjectDisplayName(combo.subject_id);

                  let facultyNames = [];
                  if (combo.faculty_ids) {
                    facultyNames = (combo.faculty_ids || []).map(tid => {
                      const faculty = facultyById.get(String(tid));
                      return faculty ? faculty.name : "N/A";
                    });
                  } else if (combo.faculty_id) {
                    const faculty = facultyById.get(String(combo.faculty_id));
                    if (faculty) {
                      facultyNames.push(faculty.name);
                    } else {
                      facultyNames.push("N/A");
                    }
                  }
                  if (facultyNames.length === 0 && String(subject?.type || "").toLowerCase() === "no_teacher") {
                    facultyNames.push("No Teacher");
                  }

                  const combinedClassIds = Array.isArray(combo.class_ids)
                    ? combo.class_ids.map(String)
                    : [];
                  const combinedLabel = combinedClassIds.length > 1
                    ? combinedClassIds.map((id) => getClassName(id)).join(" + ")
                    : "";

                  return (
                    <td key={h} className={cellClassName}>
                      <div>
                        <b>{subjectName}</b>
                      </div>
                      {facultyNames.map((name, i) => <div key={i}>{name}</div>)}
                      {combinedLabel ? <div>Combined: {combinedLabel}</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TimetableHoursReport
        classId={classId}
        assignedHours={assignedHours}
        requiredHoursByClassSubject={requiredHoursByClassSubject}
        currentClass={currentClass}
        getSubjectDisplayName={getSubjectDisplayName}
        buildDisplayRequiredHours={buildDisplayRequiredHours}
      />
    </div>
  );
};

export default ClassTimetable;
