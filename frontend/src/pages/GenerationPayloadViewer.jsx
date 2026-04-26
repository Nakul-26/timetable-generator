import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";

const asArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  if (value === null || value === undefined || value === "") return [];
  return [value];
};

const asIdList = (value) =>
  asArray(value)
    .map((item) => {
      if (item && typeof item === "object") {
        return String(
          item._id ||
            item.id ||
            item.value ||
            item.subject_id ||
            item.subjectId ||
            item.teacher_id ||
            item.teacherId ||
            item.class_id ||
            item.classId ||
            ""
        ).trim();
      }
      return String(item).trim();
    })
    .filter(Boolean);

const getEntryId = (entry) => String(entry?._id || entry?.id || entry?.value || "").trim();

const summarizePayload = (payload) => {
  const classes = Array.isArray(payload?.classes) ? payload.classes : [];
  const combos = Array.isArray(payload?.combos) ? payload.combos : [];
  const subjects = Array.isArray(payload?.subjects) ? payload.subjects : [];
  const faculties = Array.isArray(payload?.faculties) ? payload.faculties : [];
  return {
    classes: classes.length,
    combos: combos.length,
    subjects: subjects.length,
    faculties: faculties.length,
    skippedClasses: Array.isArray(payload?.skippedClasses) ? payload.skippedClasses.length : 0,
    fixedSlots: Array.isArray(payload?.fixedSlots) ? payload.fixedSlots.length : 0,
  };
};

const getSubjectLabel = (subjectId, subjectById) => {
  const subject = subjectById.get(String(subjectId));
  if (subject?.name) return subject.name;
  if (subject?.title) return subject.title;
  return String(subjectId || "").trim() || "Unknown subject";
};

const getFacultyLabel = (facultyId, facultyById) => {
  const faculty = facultyById.get(String(facultyId));
  if (!faculty) return String(facultyId || "").trim() || "Unknown teacher";
  return faculty.name || faculty.full_name || faculty.displayName || faculty.username || faculty.email || String(facultyId);
};

const getComboSubjectId = (combo) => {
  if (!combo) return "";
  if (combo.subject_id || combo.subjectId) return String(combo.subject_id || combo.subjectId);
  if (combo.subject && typeof combo.subject === "object") {
    return String(combo.subject._id || combo.subject.id || combo.subject.subject_id || combo.subject.subjectId || "");
  }
  if (typeof combo.subject === "string" || typeof combo.subject === "number") return String(combo.subject);
  return "";
};

const getComboSubjectLabel = (combo, subjectById) => {
  if (!combo) return "Unknown subject";
  if (combo.subject && typeof combo.subject === "object") {
    return combo.subject.name || combo.subject.title || combo.subject.code || String(combo.subject._id || combo.subject.id || "Unknown subject");
  }
  const subjectId = getComboSubjectId(combo);
  if (subjectId) return getSubjectLabel(subjectId, subjectById);
  return combo.subject_name || combo.subjectName || combo.name || "Unknown subject";
};

const getComboType = (combo) => String(combo?.type || combo?.combo_type || combo?.block_type || "NORMAL").toUpperCase();

const getComboClassIds = (combo) => {
  const ids =
    combo?.class_ids ??
    combo?.classIds ??
    combo?.class_id ??
    combo?.classId ??
    combo?.class ??
    combo?.classes ??
    combo?.class_list ??
    [];
  return asIdList(ids);
};

const getComboTeacherIds = (combo) => {
  const ids =
    combo?.faculty_ids ??
    combo?.facultyIds ??
    combo?.teacher_ids ??
    combo?.teacherIds ??
    combo?.teacher_id ??
    combo?.teacherId ??
    combo?.teachers ??
    combo?.faculty ??
    combo?.teacher ??
    [];
  return asIdList(ids);
};

const getComboHours = (combo) => combo?.hours_per_week ?? combo?.hoursPerWeek ?? combo?.hours ?? combo?.duration ?? "N/A";

const normalizeSubjectHours = (subjectHours, subjectById) => {
  if (!subjectHours || typeof subjectHours !== "object") return [];
  return Object.entries(subjectHours).map(([subjectKey, value]) => {
    const label = getSubjectLabel(subjectKey, subjectById);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const required =
        value.required_hours ??
        value.required ??
        value.hours ??
        value.target ??
        value.total ??
        value.total_hours ??
        value.count ??
        value.weekly_hours;
      const assigned =
        value.assigned_hours ??
        value.assigned ??
        value.completed_hours ??
        value.completed ??
        value.actual ??
        value.used ??
        value.scheduled ??
        value.allocated;
      return {
        key: subjectKey,
        label,
        required,
        assigned,
        raw: value,
      };
    }
    return {
      key: subjectKey,
      label,
      required: typeof value === "number" || typeof value === "string" ? value : null,
      assigned: null,
      raw: value,
    };
  });
};

const formatHourLabel = (entry) => {
  if (entry.assigned !== null && entry.assigned !== undefined && entry.required !== null && entry.required !== undefined) {
    return `${entry.assigned} / ${entry.required}`;
  }
  if (entry.required !== null && entry.required !== undefined) return String(entry.required);
  if (entry.raw !== null && entry.raw !== undefined) return JSON.stringify(entry.raw);
  return "N/A";
};

const GenerationPayloadViewer = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [taskIdInput, setTaskIdInput] = useState(searchParams.get("taskId") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payloadData, setPayloadData] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const taskId = searchParams.get("taskId") || "";

  const loadPayload = async (mode = "latest", targetTaskId = "") => {
    setLoading(true);
    setError("");
    try {
      const endpoint =
        mode === "task" && targetTaskId
          ? `/generation-payload/${targetTaskId}`
          : "/generation-payload/latest";
      const res = await api.get(endpoint);
      setPayloadData(res.data || null);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Failed to load generation payload.");
      setPayloadData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayload(taskId ? "task" : "latest", taskId);
  }, [taskId]);

  const payload = payloadData?.payload || {};
  const summary = useMemo(() => summarizePayload(payload), [payload]);
  const prettyPayload = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const classes = Array.isArray(payload?.classes) ? payload.classes : [];
  const combos = Array.isArray(payload?.combos) ? payload.combos : [];
  const subjects = Array.isArray(payload?.subjects) ? payload.subjects : [];
  const faculties = Array.isArray(payload?.faculties) ? payload.faculties : [];

  const subjectById = useMemo(() => new Map(subjects.map((subject) => [String(subject?._id || subject?.id || ""), subject])), [subjects]);
  const facultyById = useMemo(() => new Map(faculties.map((faculty) => [String(faculty?._id || faculty?.id || ""), faculty])), [faculties]);
  const classById = useMemo(() => new Map(classes.map((klass) => [getEntryId(klass), klass])), [classes]);
  const comboById = useMemo(() => new Map(combos.map((combo) => [String(combo?._id || combo?.id || combo?.combo_id || ""), combo])), [combos]);

  useEffect(() => {
    if (classes.length === 0) {
      setSelectedClassId("");
      return;
    }

    const selectedStillExists = selectedClassId && classById.has(selectedClassId);
    if (!selectedStillExists) {
      setSelectedClassId(getEntryId(classes[0]));
    }
  }, [classes, classById, selectedClassId]);

  const selectedClass = selectedClassId ? classById.get(selectedClassId) || null : classes[0] || null;
  const selectedClassHours = useMemo(
    () => normalizeSubjectHours(selectedClass?.subject_hours || selectedClass?.subjectHours || {}, subjectById),
    [selectedClass, subjectById]
  );

  const selectedClassAttachedCombos = useMemo(() => {
    if (!selectedClass) return [];

    const attachedIds = asIdList(
      selectedClass.assigned_teacher_subject_combos ||
        selectedClass.teacher_subject_combos ||
        selectedClass.combo_ids ||
        selectedClass.combos ||
        selectedClass.teacherSubjectCombos
    );

    if (attachedIds.length > 0) {
      const resolved = attachedIds.map((id) => comboById.get(String(id)) || combos.find((combo) => String(combo?._id || combo?.id || combo?.combo_id || "") === String(id))).filter(Boolean);
      if (resolved.length > 0) return resolved;
    }

    const classId = getEntryId(selectedClass);
    return combos.filter((combo) => getComboClassIds(combo).includes(classId));
  }, [selectedClass, combos, comboById]);

  const selectedClassInfo = useMemo(() => {
    if (!selectedClass) return null;
    return {
      id: getEntryId(selectedClass),
      name: selectedClass.name || selectedClass.class_name || selectedClass.title || getEntryId(selectedClass) || "Unnamed class",
      days: selectedClass.days_per_week ?? selectedClass.daysPerWeek ?? selectedClass.no_of_days ?? "N/A",
      totalHours:
        selectedClass.total_hours ??
        selectedClass.totalHours ??
        selectedClass.required_hours ??
        selectedClass.requiredHours ??
        "N/A",
      comboCount: selectedClassAttachedCombos.length,
      subjectHourCount: selectedClassHours.length,
    };
  }, [selectedClass, selectedClassAttachedCombos.length, selectedClassHours.length]);

  const handleLoadTask = (event) => {
    event.preventDefault();
    const nextTaskId = String(taskIdInput || "").trim();
    if (!nextTaskId) {
      setSearchParams({});
      return;
    }
    setSearchParams({ taskId: nextTaskId });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prettyPayload);
      setCopyStatus("Copied payload JSON.");
      window.setTimeout(() => setCopyStatus(""), 1500);
    } catch {
      setCopyStatus("Copy failed.");
      window.setTimeout(() => setCopyStatus(""), 1500);
    }
  };

  return (
    <div className="manage-container generation-payload-viewer">
      <h2>Generation Payload Viewer</h2>
      <p className="payload-viewer-note">
        Use this page to check what the generator will actually receive. Start by selecting a class, then look at its required hours and attached combos.
      </p>

      <div className="payload-explainer">
        <div className="payload-explainer-card">
          <strong>1. Pick a class</strong>
          <span>If a class has zero combos here, the generator will skip it.</span>
        </div>
        <div className="payload-explainer-card">
          <strong>2. Check required hours</strong>
          <span>This shows what the class still needs to be scheduled.</span>
        </div>
        <div className="payload-explainer-card">
          <strong>3. Check attached combos</strong>
          <span>This is the exact combo list the solver can place for that class.</span>
        </div>
      </div>

      <form className="payload-toolbar" onSubmit={handleLoadTask}>
        <input
          type="text"
          value={taskIdInput}
          onChange={(e) => setTaskIdInput(e.target.value)}
          placeholder="Enter task id or leave empty for latest"
        />
        <button type="submit" className="primary-btn">
          Load
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => {
            setTaskIdInput("");
            setSearchParams({});
          }}
        >
          Load Latest
        </button>
        <button type="button" className="secondary-btn" onClick={handleCopy} disabled={!prettyPayload || loading}>
          Copy JSON
        </button>
      </form>

      {loading ? <div className="loading-message">Loading payload...</div> : null}
      {error ? <div className="error-message">{error}</div> : null}
      {copyStatus ? <div className="success-message">{copyStatus}</div> : null}

      {payloadData ? (
        <>
          <div className="payload-summary-grid">
            <div className="payload-summary-card">
              <span className="payload-summary-label">Task</span>
              <strong>{payloadData.taskId}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Status</span>
              <strong>{payloadData.status || "unknown"}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Phase</span>
              <strong>{payloadData.phase || "unknown"}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Classes</span>
              <strong>{summary.classes}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Combos</span>
              <strong>{summary.combos}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Subjects</span>
              <strong>{summary.subjects}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Faculties</span>
              <strong>{summary.faculties}</strong>
            </div>
            <div className="payload-summary-card">
              <span className="payload-summary-label">Fixed Slots</span>
              <strong>{summary.fixedSlots}</strong>
            </div>
          </div>

          <div className="payload-section">
            <h3>Classes in the payload</h3>
            {classes.length === 0 ? (
              <p>No classes in payload.</p>
            ) : (
              <div className="payload-class-grid">
                {classes.map((klass) => {
                  const classId = getEntryId(klass);
                  const comboCount = asArray(klass.assigned_teacher_subject_combos).length;
                  const isSelected = classId === selectedClassId;
                  return (
                    <button
                      key={classId || klass.name}
                      type="button"
                      className={`payload-class-card${isSelected ? " is-selected" : ""}`}
                      onClick={() => setSelectedClassId(classId)}
                    >
                      <strong>{klass.name || klass.class_name || classId || "Unnamed class"}</strong>
                      <span>{comboCount} combo(s)</span>
                      <small>{classId || "No class id"}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="payload-section">
            <h3>Selected class details</h3>
            {!selectedClassInfo ? (
              <p>Select a class to inspect it.</p>
            ) : (
              <div className="payload-selected-panel">
                <div className="payload-selected-header">
                  <div>
                    <h4>{selectedClassInfo.name}</h4>
                    <p>{selectedClassInfo.id}</p>
                  </div>
                  <div className="payload-selected-stats">
                    <span>Days: {selectedClassInfo.days}</span>
                    <span>Total hours: {selectedClassInfo.totalHours}</span>
                    <span>Combos: {selectedClassInfo.comboCount}</span>
                  </div>
                </div>

                <div className="payload-subsection">
                  <h5>Required subject hours</h5>
                  {selectedClassHours.length === 0 ? (
                    <p className="payload-muted">No subject hours are stored for this class.</p>
                  ) : (
                    <div className="payload-hour-list">
                      {selectedClassHours.map((entry) => (
                        <div key={entry.key} className="payload-hour-row">
                          <strong>{entry.label}</strong>
                          <span>{formatHourLabel(entry)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="payload-subsection">
                  <h5>Combos attached to this class</h5>
                  {selectedClassAttachedCombos.length === 0 ? (
                    <p className="payload-muted">No combos were attached to this class in the payload.</p>
                  ) : (
                    <div className="payload-combo-list">
                      {selectedClassAttachedCombos.map((combo) => {
                        const comboId = String(combo?._id || combo?.id || combo?.combo_id || combo?.name || "");
                        const comboType = getComboType(combo);
                        const subjectLabel = getComboSubjectLabel(combo, subjectById);
                        const classIds = getComboClassIds(combo);
                        const teacherIds = getComboTeacherIds(combo);
                        const nestedSubjects = asArray(combo?.subjects);
                        return (
                          <div key={comboId || `${subjectLabel}-${classIds.join("-")}`} className="payload-combo-card">
                            <div className="payload-combo-header">
                              <strong>{combo.combo_name || combo.name || subjectLabel}</strong>
                              <span>{comboType}</span>
                            </div>
                            <div className="payload-combo-meta">
                              <span>Subject: {subjectLabel}</span>
                              <span>Hours: {getComboHours(combo)}</span>
                            </div>
                            <div className="payload-chip-row">
                              {classIds.length > 0 ? (
                                classIds.map((id) => (
                                  <span key={id} className="payload-chip">
                                    Class: {classById.get(id)?.name || id}
                                  </span>
                                ))
                              ) : (
                                <span className="payload-chip payload-chip-muted">No class ids</span>
                              )}
                              {teacherIds.length > 0 ? (
                                teacherIds.map((id) => (
                                  <span key={id} className="payload-chip">
                                    Teacher: {getFacultyLabel(id, facultyById)}
                                  </span>
                                ))
                              ) : (
                                <span className="payload-chip payload-chip-muted">No teacher ids</span>
                              )}
                            </div>
                            {nestedSubjects.length > 0 ? (
                              <div className="payload-nested-list">
                                {nestedSubjects.map((option, index) => {
                                  const optionSubjectId = String(option?.subject_id || option?.subjectId || option?.subject?._id || option?.subject?.id || "");
                                  const optionTeacherIds = asIdList(option?.teacher_ids || option?.teacherIds || option?.teacher_id || option?.teacherId || option?.teachers || []);
                                  return (
                                    <div key={`${comboId || subjectLabel}-${index}`} className="payload-nested-item">
                                      <strong>{getComboSubjectLabel(option, subjectById)}</strong>
                                      <span>
                                        {optionTeacherIds.length > 0
                                          ? optionTeacherIds.map((id) => getFacultyLabel(id, facultyById)).join(", ")
                                          : option.teacher_name || option.teacherName || option.teacher || "No teacher"}
                                      </span>
                                      {optionSubjectId ? <small>Subject id: {optionSubjectId}</small> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <details className="payload-raw-details">
            <summary>Raw JSON payload</summary>
            <pre className="payload-json">{prettyPayload}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
};

export default GenerationPayloadViewer;
