import React, { useContext, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import api from "../../api/axios";
import DataContext from "../../context/DataContext";

const resolveSelectedHours = (selectedSubjectItems, subjects) => {
  if (!selectedSubjectItems.length) return "";
  const values = selectedSubjectItems
    .map((item) => {
      const subject = subjects.find((s) => String(s._id) === String(item.value));
      const parsed = Number(subject?.classesPerWeek);
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
    });
  if (values.some((value) => value === null)) return "";
  const uniqueValues = [...new Set(values)];
  return uniqueValues.length === 1 ? String(uniqueValues[0]) : "";
};
const createElectiveRow = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  subject: null,
  teacher: null,
});
const getAllocationSubjectIds = (item) => {
  if (Array.isArray(item?.subjects) && item.subjects.length > 0) {
    return [...new Set(item.subjects
      .map((pair) => String(pair?.subject?._id || pair?.subject || pair?.subjectId || ""))
      .filter(Boolean))];
  }
  return item?.subject?._id ? [String(item.subject._id)] : item?.subject ? [String(item.subject)] : [];
};
const getAllocationTeacherIds = (item) => {
  if (Array.isArray(item?.subjects) && item.subjects.length > 0) {
    const ids = item.subjects
      .map((pair) => String(pair?.teacher?._id || pair?.teacher || pair?.teacherId || ""))
      .filter(Boolean);
    return [...new Set(ids)];
  }
  if (Array.isArray(item?.teachers) && item.teachers.length > 0) {
    return item.teachers.map((teacher) => String(teacher?._id || teacher || "")).filter(Boolean);
  }
  return item?.teacher?._id ? [String(item.teacher._id)] : item?.teacher ? [String(item.teacher)] : [];
};
const formatAllocationSubjects = (item) => {
  if (Array.isArray(item?.subjects) && item.subjects.length > 0) {
    return [...new Set(item.subjects
      .map((pair) => pair?.subject?.name || "Unknown Subject")
      .filter(Boolean))]
      .join(" + ");
  }
  return item?.subject?.name || "Unknown Subject";
};
const formatAllocationTeachers = (item) => {
  if (Array.isArray(item?.subjects) && item.subjects.length > 0) {
    return [...new Set(item.subjects
      .map((pair) => pair?.teacher?.name || "No Teacher")
      .filter(Boolean))]
      .join(" + ");
  }
  if (Array.isArray(item?.teachers) && item.teachers.length > 0) {
    return item.teachers
      .map((teacher) => teacher?.name)
      .filter(Boolean)
      .join(" + ");
  }
  return item?.teacher?.name || "No Teacher";
};

const ManageTeachingAllocations = () => {
  const { classes, subjects, faculties } = useContext(DataContext);

  const [selectedClasses, setSelectedClasses] = useState([]);
  const [selectedSubjects, setSelectedSubjects] = useState([]);
  const [selectedTeachers, setSelectedTeachers] = useState([]);
  const [selectedLabSubject, setSelectedLabSubject] = useState(null);
  const [selectedLabTeachers, setSelectedLabTeachers] = useState([]);
  const [allocationMode, setAllocationMode] = useState("normal");
  const [electiveRows, setElectiveRows] = useState([createElectiveRow()]);
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [combinedClassGroupId, setCombinedClassGroupId] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedAllocationIds, setSelectedAllocationIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState("");
  const [calcSummary, setCalcSummary] = useState(null);

  const [filterClassId, setFilterClassId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const allSelectedSubjectsNoTeacher =
    selectedSubjects.length > 0 &&
    selectedSubjects.every((subjectOption) => {
      const subject = subjects.find((s) => String(s._id) === String(subjectOption.value));
      return String(subject?.type || "").toLowerCase() === "no_teacher";
    });
  const anySelectedSubjectsGroupedTeachers =
    selectedSubjects.length > 0 &&
    selectedSubjects.some((subjectOption) => {
      const subject = subjects.find((s) => String(s._id) === String(subjectOption.value));
      const subjectType = String(subject?.type || "").toLowerCase();
      return Boolean(subject?.isElective) || subjectType === "lab";
    });

  useEffect(() => {
    const subjectItems =
      allocationMode === "elective"
        ? electiveRows.map((row) => row.subject).filter(Boolean)
        : allocationMode === "lab"
          ? selectedLabSubject
            ? [selectedLabSubject]
            : []
          : selectedSubjects;
    setHoursPerWeek(resolveSelectedHours(subjectItems, subjects));
  }, [allocationMode, electiveRows, selectedLabSubject, selectedSubjects, subjects]);

  useEffect(() => {
    if (allocationMode === "normal") {
      setSelectedLabSubject(null);
      setSelectedLabTeachers([]);
      setElectiveRows([createElectiveRow()]);
    } else if (allocationMode === "lab") {
      setSelectedSubjects([]);
      setSelectedTeachers([]);
      setElectiveRows([createElectiveRow()]);
    } else if (allocationMode === "elective") {
      setSelectedSubjects([]);
      setSelectedTeachers([]);
      setSelectedLabSubject(null);
      setSelectedLabTeachers([]);
    }
  }, [allocationMode]);

  const fetchAllocations = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/teaching-allocations");
      setAllocations(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError("Failed to fetch teaching allocations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllocations();
  }, []);

  const filteredAllocations = useMemo(() => {
    return allocations.filter((item) => {
      const classMatch =
        !filterClassId ||
        String(item?.class?._id) === String(filterClassId) ||
        (item?.classes || []).some((cls) => String(cls?._id) === String(filterClassId));
      const subjectIds = getAllocationSubjectIds(item);
      const teacherIds = getAllocationTeacherIds(item);
      const subjectMatch = !filterSubjectId || subjectIds.includes(String(filterSubjectId));
      const teacherMatch =
        !filterTeacherId ||
        teacherIds.includes(String(filterTeacherId)) ||
        (!teacherIds.length && filterTeacherId === "__none__");
      return classMatch && subjectMatch && teacherMatch;
    });
  }, [allocations, filterClassId, filterSubjectId, filterTeacherId]);
  const filteredAllocationIds = filteredAllocations.map((item) => String(item?.id || item?._id || ""));
  const allVisibleAllocationsSelected =
    filteredAllocationIds.length > 0 && filteredAllocationIds.every((id) => selectedAllocationIds.includes(id));
  const someVisibleAllocationsSelected =
    filteredAllocationIds.some((id) => selectedAllocationIds.includes(id));

  const classOptions = useMemo(
    () =>
      classes.map((c) => ({
        value: c._id,
        label: `${c.name} (Sem ${c.sem}, ${c.section})`,
      })),
    [classes]
  );

  const subjectOptions = useMemo(
    () =>
      subjects.map((s) => ({
        value: s._id,
        label: `${s.name} (${s.type || "theory"})`,
      })),
    [subjects]
  );

  const teacherOptions = useMemo(
    () =>
      faculties.map((f) => ({
        value: f._id,
        label: f.name,
      })),
    [faculties]
  );

  const handleAdd = async (e) => {
    e.preventDefault();
    if (selectedClasses.length === 0) {
      setError("Please select at least one class.");
      return;
    }
    if (selectedClasses.length > 1 && !combinedClassGroupId.trim()) {
      setError("Combined Class Group ID is required when multiple classes are selected.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const requests = [];

      if (allocationMode === "elective") {
        if (electiveRows.length < 2) {
          setError("Add at least two subject-teacher rows for an elective block.");
          return;
        }
        if (electiveRows.some((row) => !row.subject || !row.teacher)) {
          setError("Each elective row must have both a subject and a teacher.");
          return;
        }
        const subjectPayload = electiveRows.map((row) => ({
          subjectId: row.subject.value,
          teacherId: row.teacher.value,
        }));
        requests.push(api.post("/teaching-allocations", {
          classIds: selectedClasses.map((item) => item.value),
          type: "ELECTIVE",
          subjects: subjectPayload,
          subjectId: subjectPayload[0]?.subjectId,
          teacherIds: subjectPayload.map((row) => row.teacherId),
          hoursPerWeek: hoursPerWeek === "" ? undefined : Number(hoursPerWeek),
          combinedClassGroupId: selectedClasses.length > 1 ? combinedClassGroupId : null,
        }));
      } else if (allocationMode === "lab") {
        if (!selectedLabSubject) {
          setError("Please select a lab subject.");
          return;
        }
        if (String(subjects.find((s) => String(s._id) === String(selectedLabSubject.value))?.type || "").toLowerCase() !== "lab") {
          setError("Lab mode requires a lab subject.");
          return;
        }
        if (selectedLabTeachers.length === 0) {
          setError("Please select at least one teacher for the lab block.");
          return;
        }
        requests.push(api.post("/teaching-allocations", {
          classIds: selectedClasses.map((item) => item.value),
          type: "LAB",
          subjectId: selectedLabSubject.value,
          teacherIds: selectedLabTeachers.map((teacher) => teacher.value),
          hoursPerWeek: hoursPerWeek === "" ? undefined : Number(hoursPerWeek),
          combinedClassGroupId: selectedClasses.length > 1 ? combinedClassGroupId : null,
        }));
      } else {
        if (
          selectedSubjects.length === 0 ||
          (!allSelectedSubjectsNoTeacher && selectedTeachers.length === 0)
        ) {
          setError("Please select at least one subject. Teachers are optional only for no-teacher subjects.");
          return;
        }
        if (!allSelectedSubjectsNoTeacher && selectedSubjects.some((subjectOption) => {
          const subject = subjects.find((s) => String(s._id) === String(subjectOption.value));
          return String(subject?.type || "").toLowerCase() === "no_teacher";
        })) {
          setError("Add no-teacher subjects separately from teacher-assigned subjects.");
          return;
        }

        for (const subject of selectedSubjects) {
          const subjectData = subjects.find((s) => String(s._id) === String(subject.value));
          const subjectType = String(subjectData?.type || "").toLowerCase();
          const isNoTeacher = subjectType === "no_teacher";
          const isLab = subjectType === "lab";
          const isElective = Boolean(subjectData?.isElective);
          const keepTeachersTogether = isLab || isElective;
          const teacherGroups = isNoTeacher
            ? [[]]
            : keepTeachersTogether
              ? [selectedTeachers]
              : selectedTeachers.map((teacher) => [teacher]);
          for (const teacherGroup of teacherGroups) {
            requests.push(
              api.post("/teaching-allocations", {
                classIds: selectedClasses.map((item) => item.value),
                subjectId: subject.value,
                teacherIds: teacherGroup.map((teacher) => teacher.value),
                hoursPerWeek: hoursPerWeek === "" ? undefined : Number(hoursPerWeek),
                combinedClassGroupId: selectedClasses.length > 1 ? combinedClassGroupId : null,
              })
            );
          }
        }
      }

      const results = await Promise.allSettled(requests);
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        setError(`${failedCount} combo(s) failed to save. Others were saved.`);
      }

      setSelectedClasses([]);
      setSelectedSubjects([]);
      setSelectedTeachers([]);
      setSelectedLabSubject(null);
      setSelectedLabTeachers([]);
      setAllocationMode("normal");
      setElectiveRows([createElectiveRow()]);
      setHoursPerWeek("");
      setCombinedClassGroupId("");
      await fetchAllocations();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to save teaching allocation.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    const allocationId = String(item?.id || item?._id || "");
    if (!allocationId) return;
    if (!window.confirm("Delete this class-subject-teacher allocation?")) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete("/teaching-allocations", {
        data: {
          allocationId,
        },
      });
      setSelectedAllocationIds((prev) => prev.filter((id) => id !== allocationId));
      await fetchAllocations();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to delete allocation.");
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedAllocationIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedAllocationIds.length} selected allocation(s)?`)) return;
    setBulkDeleting(true);
    setError("");
    try {
      await Promise.allSettled(
        selectedAllocationIds.map((allocationId) =>
          api.delete("/teaching-allocations", {
            data: { allocationId },
          })
        )
      );
      setSelectedAllocationIds([]);
      await fetchAllocations();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to delete selected allocations.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleCalculate = async () => {
    setCalculating(true);
    setError("");
    try {
      const res = await api.post("/teaching-allocations/calculate");
      setCalcSummary(res.data || null);
      await fetchAllocations();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to calculate combos.");
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="manage-container">
      <h2>Manage Class - Subject - Teacher Combos</h2>
      <p>Direct entry for Class + Subject + Teacher + Hours. This updates normalized mappings behind the scenes.</p>
      <div className="actions-bar">
        <button className="secondary-btn" onClick={handleCalculate} disabled={calculating}>
          {calculating ? "Calculating..." : "Calculate Combos From Existing Mappings"}
        </button>
        <button
          className="secondary-btn"
          onClick={() => setShowFilters((prev) => !prev)}
          type="button"
        >
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
      </div>

      {calcSummary ? (
        <div className="success-message" style={{ marginBottom: 12 }}>
          {calcSummary.message} Total generated combos: {calcSummary.totalGeneratedCombos}.
        </div>
      ) : null}
      {calculating ? (
        <div className="success-message" style={{ marginBottom: 12 }}>
          Calculating combinations from existing mappings. Please wait...
        </div>
      ) : null}
      {submitting ? (
        <div className="success-message" style={{ marginBottom: 12 }}>
          Saving class-subject-teacher combinations. Please wait...
        </div>
      ) : null}
      {deleting ? (
        <div className="loading-message" style={{ marginBottom: 12 }}>
          Deleting allocation. Please wait...
        </div>
      ) : null}

      <form onSubmit={handleAdd} className="add-form cst-combo-form">
        <h3>Add Class - Subject - Teacher Combo</h3>
        <div className="cst-combo-grid">
          <div className="form-group cst-field">
            <label>Select Classes</label>
            <Select
              options={classOptions}
              value={selectedClasses}
              onChange={(value) => setSelectedClasses(value || [])}
              placeholder="Select Classes"
              isMulti
            />
          </div>

          <div className="form-group cst-field">
            <label>Allocation Mode</label>
            <select value={allocationMode} onChange={(e) => setAllocationMode(e.target.value)}>
              <option value="normal">Normal Subject Combo</option>
              <option value="lab">Lab Block</option>
              <option value="elective">Elective Block</option>
            </select>
          </div>

          {allocationMode === "elective" ? (
            <div className="form-group cst-field" style={{ gridColumn: "1 / -1" }}>
              <label>Elective Options</label>
              <small>Each row is one subject-teacher pair that runs in the same block.</small>
              <div className="elective-option-list">
                {electiveRows.map((row, index) => (
                  <div key={row.id} className="elective-option-row">
                    <div className="elective-option-index">Option {index + 1}</div>
                    <div className="elective-option-fields">
                      <div className="elective-option-field">
                        <label>Subject</label>
                        <Select
                          options={subjectOptions}
                          value={row.subject}
                          onChange={(value) =>
                            setElectiveRows((prev) =>
                              prev.map((item) => (item.id === row.id ? { ...item, subject: value || null } : item))
                            )
                          }
                          placeholder="Select subject"
                        />
                      </div>
                      <div className="elective-option-field">
                        <label>Teacher</label>
                        <Select
                          options={teacherOptions}
                          value={row.teacher}
                          onChange={(value) =>
                            setElectiveRows((prev) =>
                              prev.map((item) => (item.id === row.id ? { ...item, teacher: value || null } : item))
                            )
                          }
                          placeholder="Select teacher"
                        />
                      </div>
                    </div>
                    <div className="elective-option-actions">
                      <button
                        type="button"
                        className="danger-btn"
                        onClick={() => setElectiveRows((prev) => prev.length > 1 ? prev.filter((item) => item.id !== row.id) : prev)}
                        disabled={electiveRows.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="elective-option-add-row">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setElectiveRows((prev) => [...prev, createElectiveRow()])}
                >
                  + Add Option
                </button>
              </div>
            </div>
          ) : allocationMode === "lab" ? (
            <>
              <div className="form-group cst-field">
                <label>Select Lab Subject</label>
                <Select
                  options={subjectOptions.filter((subject) => {
                    const subjectData = subjects.find((item) => String(item._id) === String(subject.value));
                    return String(subjectData?.type || "").toLowerCase() === "lab";
                  })}
                  value={selectedLabSubject}
                  onChange={(value) => setSelectedLabSubject(value || null)}
                  placeholder="Select lab subject"
                />
              </div>

              <div className="form-group cst-field">
                <label>Select Lab Teachers</label>
                <Select
                  options={teacherOptions}
                  value={selectedLabTeachers}
                  onChange={(value) => setSelectedLabTeachers(value || [])}
                  placeholder="Select one or more teachers"
                  isMulti
                />
                <small>Lab subjects can be taught by one or more teachers in the same block.</small>
              </div>
            </>
          ) : (
            <>
              <div className="form-group cst-field">
                <label>Select Subjects</label>
                <Select
                  options={subjectOptions}
                  value={selectedSubjects}
                  onChange={(value) => setSelectedSubjects(value || [])}
                  placeholder="Select Subjects"
                  isMulti
                />
              </div>

              <div className="form-group cst-field">
                <label>Select Teachers</label>
                <Select
                  options={teacherOptions}
                  value={selectedTeachers}
                  onChange={(value) => setSelectedTeachers(value || [])}
                  placeholder={allSelectedSubjectsNoTeacher ? "Not required for no-teacher subjects" : "Select Teachers"}
                  isMulti
                  isDisabled={allSelectedSubjectsNoTeacher}
                />
                {!allSelectedSubjectsNoTeacher && anySelectedSubjectsGroupedTeachers ? (
                  <small>For lab and elective subjects, selected teachers are saved as one combo.</small>
                ) : null}
              </div>
            </>
          )}

          <div className="form-group cst-field cst-hours-field">
            <label>Hours per week</label>
            <input
              type="number"
              min="1"
              className="hours-input"
              placeholder="Hours per week"
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(e.target.value)}
            />
          </div>

          <div className="form-group cst-field">
            <label>Combined Class Group ID</label>
            <input
              type="text"
              className="hours-input"
              placeholder="Required when multiple classes are selected"
              value={combinedClassGroupId}
              onChange={(e) => setCombinedClassGroupId(e.target.value)}
            />
          </div>

          <div className="cst-actions">
            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting ? "Saving..." : "Add Combo"}
            </button>
          </div>
        </div>
      </form>

      {showFilters ? (
        <div className="add-form cst-filter-form">
          <h3>Filter Class - Subject - Teacher Combos</h3>
          <div className="cst-filter-grid">
            <div className="form-group cst-field">
              <label>Class</label>
              <select value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)}>
                <option value="">All Classes</option>
                {classes.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group cst-field">
              <label>Subject</label>
              <select value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)}>
                <option value="">All Subjects</option>
                {subjects.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group cst-field">
              <label>Teacher</label>
              <select value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)}>
                <option value="">All Teachers</option>
                <option value="__none__">No Teacher</option>
                {faculties.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="cst-actions">
              <button
                type="button"
                className="reset-btn"
                onClick={() => {
                  setFilterClassId("");
                  setFilterSubjectId("");
                  setFilterTeacherId("");
                }}
              >
                Reset Filters
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="error-message">{error}</div> : null}

      {selectedAllocationIds.length > 0 ? (
        <div className="bulk-actions-bar">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              checked={allVisibleAllocationsSelected}
              ref={(input) => {
                if (input) input.indeterminate = !allVisibleAllocationsSelected && someVisibleAllocationsSelected;
              }}
              onChange={(e) => {
                const nextSelected = e.target.checked
                  ? Array.from(new Set([...selectedAllocationIds, ...filteredAllocationIds]))
                  : selectedAllocationIds.filter((id) => !filteredAllocationIds.includes(id));
                setSelectedAllocationIds(nextSelected);
              }}
            />
            Select all visible
          </label>
          <span className="bulk-selection-count">{selectedAllocationIds.length} selected</span>
          <button type="button" className="danger-btn" onClick={handleBulkDelete} disabled={bulkDeleting || deleting || calculating || submitting}>
            Delete selected
          </button>
          <button type="button" className="secondary-btn" onClick={() => setSelectedAllocationIds([])} disabled={bulkDeleting || deleting || calculating || submitting}>
            Clear selection
          </button>
        </div>
      ) : null}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="styled-table">
          <thead>
            <tr>
              <th className="selection-column">
                <input
                  type="checkbox"
                  checked={allVisibleAllocationsSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = !allVisibleAllocationsSelected && someVisibleAllocationsSelected;
                  }}
                  onChange={(e) => setSelectedAllocationIds(e.target.checked ? filteredAllocationIds : [])}
                />
              </th>
              <th>Class</th>
              <th>Subject</th>
              <th>Teacher</th>
              <th>Hours/Week</th>
              <th>Combined Group</th>
              <th>Type</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAllocations.map((item) => (
              <tr key={item.id} className={selectedAllocationIds.includes(String(item?.id || item?._id || "")) ? "row-selected" : ""}>
                <td className="selection-cell">
                  <input
                    type="checkbox"
                    checked={selectedAllocationIds.includes(String(item?.id || item?._id || ""))}
                    onChange={(e) => {
                      const allocationId = String(item?.id || item?._id || "");
                      setSelectedAllocationIds((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, allocationId]))
                          : prev.filter((id) => id !== allocationId)
                      );
                    }}
                  />
                </td>
                <td>
                  {item?.isCombined
                    ? (item?.classes || []).map((cls) => cls?.name).filter(Boolean).join(" + ")
                    : item?.class?.name}
                </td>
                <td>{formatAllocationSubjects(item)}</td>
                <td>{formatAllocationTeachers(item)}</td>
                <td>{item?.hoursPerWeek ?? 0}</td>
                <td>{item?.combinedClassGroupId || "—"}</td>
                <td>{item?.type || (item?.isElectiveBlock ? "ELECTIVE" : item?.subject?.type === "no_teacher" ? "No Teacher" : item?.isLab ? "Lab" : "Theory")}</td>
                <td>{item?.status || "active"}</td>
                <td>
                  <button className="danger-btn" onClick={() => handleDelete(item)} disabled={deleting || calculating || submitting || bulkDeleting}>
                    {deleting ? "Working..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {filteredAllocations.length === 0 ? (
              <tr>
                <td colSpan="9">No allocations found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default ManageTeachingAllocations;
