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

const ManageTeachingAllocations = () => {
  const { classes, subjects, faculties } = useContext(DataContext);

  const [selectedClasses, setSelectedClasses] = useState([]);
  const [selectedSubjects, setSelectedSubjects] = useState([]);
  const [selectedTeachers, setSelectedTeachers] = useState([]);
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [combinedClassGroupId, setCombinedClassGroupId] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
  const getSubjectType = (subjectId) => {
    const subject = subjects.find((s) => String(s._id) === String(subjectId));
    return String(subject?.type || "").toLowerCase();
  };

  useEffect(() => {
    setHoursPerWeek(resolveSelectedHours(selectedSubjects, subjects));
  }, [selectedSubjects, subjects]);

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
      const subjectMatch = !filterSubjectId || String(item?.subject?._id) === String(filterSubjectId);
      const teacherMatch =
        !filterTeacherId ||
        String(item?.teacher?._id) === String(filterTeacherId) ||
        (item?.teachers || []).some((teacher) => String(teacher?._id) === String(filterTeacherId)) ||
        (!item?.teacher && filterTeacherId === "__none__");
      return classMatch && subjectMatch && teacherMatch;
    });
  }, [allocations, filterClassId, filterSubjectId, filterTeacherId]);

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
    if (
      selectedClasses.length === 0 ||
      selectedSubjects.length === 0 ||
      (!allSelectedSubjectsNoTeacher && selectedTeachers.length === 0)
    ) {
      setError("Please select at least one class and subject. Teachers are optional only for no-teacher subjects.");
      return;
    }
    if (!allSelectedSubjectsNoTeacher && selectedSubjects.some((subjectOption) => {
      const subject = subjects.find((s) => String(s._id) === String(subjectOption.value));
      return String(subject?.type || "").toLowerCase() === "no_teacher";
    })) {
      setError("Add no-teacher subjects separately from teacher-assigned subjects.");
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
      for (const subject of selectedSubjects) {
        const subjectData = subjects.find((s) => String(s._id) === String(subject.value));
        const subjectType = String(subjectData?.type || "").toLowerCase();
        const isNoTeacher = subjectType === "no_teacher";
        const isLab = subjectType === "lab";
        const teacherGroups = isNoTeacher
          ? [[]]
          : isLab
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

      const results = await Promise.allSettled(requests);
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        setError(`${failedCount} combo(s) failed to save. Others were saved.`);
      }

      setSelectedClasses([]);
      setSelectedSubjects([]);
      setSelectedTeachers([]);
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
    if (!window.confirm("Delete this class-subject-teacher allocation?")) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete("/teaching-allocations", {
        data: {
          allocationId: item.id,
        },
      });
      await fetchAllocations();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to delete allocation.");
    } finally {
      setDeleting(false);
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
            {!allSelectedSubjectsNoTeacher && selectedSubjects.some((subjectOption) => getSubjectType(subjectOption.value) === "lab") ? (
              <small>For lab subjects, selected teachers are saved as one co-teaching combo.</small>
            ) : null}
          </div>

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

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="styled-table">
          <thead>
            <tr>
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
              <tr key={item.id}>
                <td>
                  {item?.isCombined
                    ? (item?.classes || []).map((cls) => cls?.name).filter(Boolean).join(" + ")
                    : item?.class?.name}
                </td>
                <td>{item?.subject?.name}</td>
                <td>
                  {(item?.teachers || []).length > 0
                    ? item.teachers.map((teacher) => teacher?.name).filter(Boolean).join(" + ")
                    : item?.teacher?.name || "No Teacher"}
                </td>
                <td>{item?.hoursPerWeek ?? 0}</td>
                <td>{item?.combinedClassGroupId || "—"}</td>
                <td>{item?.subject?.type === "no_teacher" ? "No Teacher" : item?.isLab ? "Lab" : "Theory"}</td>
                <td>{item?.status || "active"}</td>
                <td>
                  <button className="danger-btn" onClick={() => handleDelete(item)} disabled={deleting || calculating || submitting}>
                    {deleting ? "Working..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {filteredAllocations.length === 0 ? (
              <tr>
                <td colSpan="8">No allocations found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default ManageTeachingAllocations;
