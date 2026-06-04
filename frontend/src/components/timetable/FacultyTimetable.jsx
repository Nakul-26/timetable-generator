import React from 'react';

const FacultyTimetable = ({
  facultyId,
  slots,
  getFacultyName,
  HOURS_PER_DAY,
  isFacultyCellMatching,
  selectedClass,
  selectedSubject,
  getFacultySlotDisplay
}) => {
  return (
    <div key={facultyId} className="tt-class-block">
      <h3>{getFacultyName(facultyId)}</h3>
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
                  const cellMatches = isFacultyCellMatching(slot);
                  const hasFilter = selectedClass || selectedSubject;
                  const cellClassName = !hasFilter || cellMatches ? "" : "tt-cell-dim";

                  if (!slot || slot === -1 || slot === "BREAK") {
                    return <td key={h} className={cellClassName}>-</td>;
                  }

                  const { subjectName, classNames } = getFacultySlotDisplay(slot);

                  return (
                    <td key={h} className={cellClassName}>
                      <div>
                        <b>{subjectName}</b>
                      </div>
                      {classNames.map((name, i) => <div key={i}>{name}</div>)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FacultyTimetable;
