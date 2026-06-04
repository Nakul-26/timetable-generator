import React from 'react';

const TimetableFilters = ({
  showFilters,
  selectedClass,
  setSelectedClass,
  selectedFaculty,
  setSelectedFaculty,
  selectedSubject,
  setSelectedSubject,
  classes,
  faculties,
  subjects,
  getClassName,
  getFacultyName,
  resetFilters
}) => {
  if (!showFilters) return null;

  return (
    <div className="filters-container">
      <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
        <option value="">All Classes</option>
        {classes.map((cls) => (
          <option key={cls._id} value={cls._id}>
            {getClassName(cls._id)}
          </option>
        ))}
      </select>

      <select value={selectedFaculty} onChange={(e) => setSelectedFaculty(e.target.value)}>
        <option value="">All Faculties</option>
        {faculties.map((fac) => (
          <option key={fac._id} value={fac._id}>
            {getFacultyName(fac._id)}
          </option>
        ))}
      </select>

      <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
        <option value="">All Subjects</option>
        {subjects.map((sub) => (
          <option key={sub._id} value={sub._id}>
            {sub.name}
          </option>
        ))}
      </select>

      <button onClick={resetFilters} className="secondary-btn">
        Reset
      </button>
    </div>
  );
};

export default TimetableFilters;
