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
  teachers: [],
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

const SyncPreviewModal = ({ isOpen, onClose, data, onApply, isApplying }) => {
  if (!isOpen || !data) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '850px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Sync Preview</h2>
          <button type="button" className="secondary-btn" onClick={onClose} style={{ padding: '4px 8px' }}>&times;</button>
        </div>
        
        <div className="sync-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '24px' }}>
          <div style={{ padding: '12px 8px', background: '#f0f7ff', border: '1px solid #cce3ff', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0056b3' }}>{data.totalCreates || 0}</div>
            <div style={{ fontSize: '0.8rem', color: '#555' }}>Create</div>
          </div>
          <div style={{ padding: '12px 8px', background: '#f0fff4', border: '1px solid #c6f6d5', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#2f855a' }}>{data.totalUpdates || 0}</div>
            <div style={{ fontSize: '0.8rem', color: '#555' }}>Update</div>
          </div>
          <div style={{ padding: '12px 8px', background: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4a5568' }}>{data.totalUnchanged || 0}</div>
            <div style={{ fontSize: '0.8rem', color: '#555' }}>Unchanged</div>
          </div>
          <div style={{ padding: '12px 8px', background: '#fffaf0', border: '1px solid #feebc8', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#c05621' }}>{data.conflicts?.length || 0}</div>
            <div style={{ fontSize: '0.8rem', color: '#555' }}>Conflicts</div>
          </div>
          <div style={{ padding: '12px 8px', background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#c53030' }}>{data.totalOrphans || 0}</div>
            <div style={{ fontSize: '0.8rem', color: '#555' }}>Orphans</div>
          </div>
        </div>

        {data.conflicts?.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: '#c05621', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚠️</span> Conflicts & Warnings
            </h4>
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #feebc8', borderRadius: '6px', padding: '12px', background: '#fffaf0' }}>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.85rem', color: '#7b341e' }}>
                {data.conflicts.map((c, idx) => (
                  <li key={idx} style={{ marginBottom: '6px' }}>
                    <strong style={{ textTransform: 'capitalize' }}>
                      {c.type.replace(/_/g, ' ')}:
                    </strong> {c.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ marginBottom: '10px' }}>Processing Summary ({data.summary?.length || 0} classes)</h4>
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '6px' }}>
            <table className="styled-table" style={{ fontSize: '0.85rem', margin: 0 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                <tr>
                  <th>Class</th>
                  <th>Subjects Mapped</th>
                  <th>Potential Allocations</th>
                </tr>
              </thead>
              <tbody>
                {data.summary?.map((s, idx) => (
                  <tr key={idx}>
                    <td>{s.className}</td>
                    <td>{s.classSubjects}</td>
                    <td>{s.potentialAllocations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: '30px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
          <button type="button" className="secondary-btn" onClick={onClose} disabled={isApplying}>Cancel</button>
          <button type="button" className="primary-btn" onClick={onApply} disabled={isApplying}>
            {isApplying ? "Syncing..." : "Apply Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AllocationHistoryModal = ({ isOpen, onClose, allocationId, allocationName }) => {
  const { faculties, subjects, classes } = useContext(DataContext);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen && allocationId) {
      const fetchHistory = async () => {
        setLoading(true);
        setError("");
        try {
          const res = await api.get(`/teaching-allocations/${allocationId}/history`);
          setHistory(res.data);
        } catch (e) {
          setError("Failed to fetch history.");
        } finally {
          setLoading(false);
        }
      };
      fetchHistory();
    }
  }, [isOpen, allocationId]);

  const getName = (id, type) => {
    if (!id) return "None";
    const collection = type === 'faculty' ? faculties : type === 'subject' ? subjects : classes;
    const item = collection.find(i => String(i._id) === String(id));
    return item?.name || "Unknown";
  };

  const renderDiff = (log) => {
    if (log.action === 'CREATE') {
      return <div style={{ fontSize: '0.85rem', color: '#2f855a' }}>Initial creation of allocation.</div>;
    }
    if (log.action === 'DELETE') {
      return <div style={{ fontSize: '0.85rem', color: '#c53030' }}>Allocation was deleted.</div>;
    }

    const before = log.snapshot?.before || {};
    const after = log.snapshot?.after || {};
    const changes = [];

    // Check Teacher
    const bt = String(before.teacher || "");
    const at = String(after.teacher || "");
    if (bt !== at) {
      changes.push({ label: 'Teacher', from: getName(bt, 'faculty'), to: getName(at, 'faculty') });
    }

    // Check Hours
    if (before.hoursPerWeek !== after.hoursPerWeek) {
      changes.push({ label: 'Hours', from: before.hoursPerWeek, to: after.hoursPerWeek });
    }

    // Check Type
    if (before.type !== after.type) {
      changes.push({ label: 'Type', from: before.type, to: after.type });
    }

    // Check combined group
    if (before.combinedClassGroupId !== after.combinedClassGroupId) {
      changes.push({ label: 'Combined Group', from: before.combinedClassGroupId || "None", to: after.combinedClassGroupId || "None" });
    }

    if (changes.length === 0) return <div style={{ fontSize: '0.85rem', color: '#666' }}>No visible changes in primary fields.</div>;

    return (
      <div style={{ marginTop: '8px', padding: '10px', background: '#fff', borderRadius: '4px', border: '1px solid #eee' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '5px', color: '#555' }}>Changes:</div>
        {changes.map((c, i) => (
          <div key={i} style={{ fontSize: '0.85rem', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: '600', minWidth: '100px' }}>{c.label}:</span>
            <span style={{ color: '#c53030', textDecoration: 'line-through' }}>{c.from}</span>
            <span style={{ color: '#666' }}>→</span>
            <span style={{ color: '#2f855a', fontWeight: 'bold' }}>{c.to}</span>
          </div>
        ))}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '700px', width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>History: {allocationName}</h2>
          <button type="button" className="secondary-btn" onClick={onClose} style={{ padding: '4px 8px' }}>&times;</button>
        </div>

        {loading ? (
          <div>Loading history...</div>
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : history.length === 0 ? (
          <p>No history found for this allocation.</p>
        ) : (
          <div className="history-timeline">
            {history.map((log) => (
              <div key={log._id} style={{ marginBottom: '20px', padding: '15px', borderLeft: '3px solid #0056b3', background: '#f8f9fa', borderRadius: '0 4px 4px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold', color: '#0056b3' }}>{log.action}</span>
                  <span style={{ fontSize: '0.85rem', color: '#666' }}>{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', marginBottom: '8px', fontSize: '0.85rem' }}>
                  <div><strong>Source:</strong> {log.source}</div>
                  <div><strong>User:</strong> {log.performedBy?.name || "System"}</div>
                </div>
                {renderDiff(log)}
                {log.message && (
                  <div style={{ fontStyle: 'italic', fontSize: '0.8rem', color: '#888', marginTop: '10px' }}>
                    Note: "{log.message}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '20px', textAlign: 'right' }}>
          <button type="button" className="secondary-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
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

  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncPreview, setSyncPreview] = useState(null);
  const [applyingSync, setApplyingSync] = useState(false);
  const [syncingToMappings, setSyncingToMappings] = useState(false);

  const [historyAllocation, setHistoryAllocation] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

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
      // Labs and Electives (multi-subject) keep teachers together
      return allocationMode === "elective" || allocationMode === "elective_lab" || allocationMode === "lab" || subjectType === "lab";
    });
  useEffect(() => {
    const subjectItems =
      allocationMode === "elective" || allocationMode === "elective_lab"
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
    } else if (allocationMode === "elective" || allocationMode === "elective_lab") {
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

      if (allocationMode === "elective" || allocationMode === "elective_lab") {
        if (electiveRows.length < 2) {
          setError("Add at least two subject-teacher rows for an elective block.");
          return;
        }
        if (allocationMode === "elective_lab") {
          const invalidSubject = electiveRows.some((row) => {
            const subject = subjects.find((item) => String(item._id) === String(row.subject?.value));
            return !row.subject || String(subject?.type || "").toLowerCase() !== "lab";
          });
          if (invalidSubject) {
            setError("Each elective lab option must use a lab subject.");
            return;
          }
          if (electiveRows.some((row) => !Array.isArray(row.teachers) || row.teachers.length === 0)) {
            setError("Each elective lab option must have at least one teacher.");
            return;
          }
        } else if (electiveRows.some((row) => !row.subject || !row.teacher)) {
          setError("Each elective row must have both a subject and a teacher.");
          return;
        }
        const subjectPayload = allocationMode === "elective_lab"
          ? electiveRows.map((row) => ({
              subjectId: row.subject.value,
              teacherIds: row.teachers.map((teacher) => teacher.value),
            }))
          : electiveRows.map((row) => ({
              subjectId: row.subject.value,
              teacherId: row.teacher.value,
            }));
        const teacherIds = subjectPayload.flatMap((row) => row.teacherIds || [row.teacherId]);
        requests.push(api.post("/teaching-allocations", {
          classIds: selectedClasses.map((item) => item.value),
          type: allocationMode === "elective_lab" ? "ELECTIVE_LAB" : "ELECTIVE",
          subjects: subjectPayload,
          subjectId: subjectPayload[0]?.subjectId,
          teacherIds,
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
          // Labs and direct Elective mode keep teachers together
          const keepTeachersTogether = isLab || allocationMode === "lab" || allocationMode === "elective";
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

  const handleCalculate = async (preview = true) => {
    if (preview) {
      setCalculating(true);
    } else {
      setApplyingSync(true);
    }
    setError("");
    try {
      const res = await api.post("/teaching-allocations/calculate", { preview });
      if (preview) {
        setSyncPreview(res.data || null);
        setShowSyncModal(true);
      } else {
        setCalcSummary(res.data || null);
        setShowSyncModal(false);
        setSyncPreview(null);
        await fetchAllocations();
      }
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to calculate combos.");
    } finally {
      setCalculating(false);
      setApplyingSync(false);
    }
  };

  const handleSyncToMappings = async () => {
    if (!window.confirm("This will update your Class-Subject and Teacher-Subject mappings to match your current Teaching Allocations. Continue?")) return;
    
    setSyncToMappings(true);
    setError("");
    try {
      const res = await api.post("/teaching-allocations/sync-to-mappings");
      setCalcSummary({
        ok: true,
        message: res.data.message,
        totalAllocations: 0,
        totalCreates: res.data.totalMappingsCreated,
        totalUpdates: 0,
        totalUnchanged: 0,
        totalOrphans: 0
      });
      await fetchAllocations();
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to sync to mappings.");
    } finally {
      setSyncToMappings(false);
    }
  };

  return (
    <div className="manage-container">
      <h2>Teaching Allocations</h2>
      <p>The central place to define who teaches what. This is the primary source of truth for the timetable generator.</p>
      <div className="actions-bar" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '20px' }}>
        <button
          className="secondary-btn"
          onClick={() => setShowFilters((prev) => !prev)}
          type="button"
        >
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
        <div style={{ marginLeft: 'auto', textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              className="secondary-btn"
              onClick={handleSyncToMappings}
              disabled={syncingToMappings}
              type="button"
              style={{ padding: '8px 16px' }}
            >
              {syncingToMappings ? "Syncing..." : "Sync to Mappings"}
            </button>
            <button
              className="primary-btn"
              onClick={() => handleCalculate(true)}
              disabled={calculating}
              type="button"
              style={{ padding: '8px 16px' }}
            >
              {calculating ? "Processing Preview..." : "Sync from Mappings"}
            </button>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>
            Keep your Mappings and Allocations synchronized in both directions.
          </div>
        </div>
      </div>

      <SyncPreviewModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        data={syncPreview}
        onApply={() => handleCalculate(false)}
        isApplying={applyingSync}
      />

      <AllocationHistoryModal
        isOpen={showHistoryModal}
        onClose={() => {
          setShowHistoryModal(false);
          setHistoryAllocation(null);
        }}
        allocationId={historyAllocation?.id || historyAllocation?._id}
        allocationName={historyAllocation ? `${formatAllocationSubjects(historyAllocation)} (${historyAllocation.class?.name || "Multiple Classes"})` : ""}
      />

      {calcSummary ? (
        <div className="success-message" style={{ marginBottom: 12 }}>
          {calcSummary.message} Result: {calcSummary.totalCreates} created, {calcSummary.totalUpdates} updated, {calcSummary.totalUnchanged} unchanged, {calcSummary.totalOrphans} orphans detected.
        </div>
      ) : null}
      
      <form onSubmit={handleAdd} className="add-form cst-combo-form">
        <h3>Create New Allocation</h3>
        <div className="cst-combo-grid">
          <div className="form-group cst-field">
            <label>Allocation Type</label>
            <select value={allocationMode} onChange={(e) => setAllocationMode(e.target.value)}>
              <option value="normal">Theory (Standard Class)</option>
              <option value="lab">Lab (Block Session)</option>
              <option value="elective">Elective (Option Group)</option>
              <option value="elective_lab">Elective Lab (Option Group)</option>
            </select>
            <small>
              {allocationMode === "normal" && "Standard classroom teaching."}
              {allocationMode === "lab" && "Block sessions with one or more teachers."}
              {allocationMode === "elective" && "Multiple subjects running simultaneously."}
              {allocationMode === "elective_lab" && "Multiple lab subjects running simultaneously as block sessions."}
            </small>
          </div>

          <div className="form-group cst-field">
            <label>Select Classes</label>
            <Select
              options={classOptions}
              value={selectedClasses}
              onChange={(value) => setSelectedClasses(value || [])}
              placeholder="Select Classes"
              isMulti
            />
            {selectedClasses.length > 1 && (
               <small style={{ color: "var(--primary-color)" }}>Combined Class: These classes will attend the session together.</small>
            )}
          </div>

          {allocationMode === "elective" || allocationMode === "elective_lab" ? (
            <div className="form-group cst-field" style={{ gridColumn: "1 / -1" }}>
              <label>{allocationMode === "elective_lab" ? "Elective Lab Options" : "Elective Options"}</label>
              <small>
                {allocationMode === "elective_lab"
                  ? "Each row is one lab subject with one or more teachers running in the same block."
                  : "Each row is one subject-teacher pair that runs in the same block."}
              </small>
              <div className="elective-option-list">
                {electiveRows.map((row, index) => (
                  <div key={row.id} className="elective-option-row">
                    <div className="elective-option-index">Option {index + 1}</div>
                    <div className="elective-option-fields">
                      <div className="elective-option-field">
                        <label>Subject</label>
                        <Select
                          options={allocationMode === "elective_lab"
                            ? subjectOptions.filter((subject) => {
                                const subjectData = subjects.find((item) => String(item._id) === String(subject.value));
                                return String(subjectData?.type || "").toLowerCase() === "lab";
                              })
                            : subjectOptions}
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
                        <label>{allocationMode === "elective_lab" ? "Teachers" : "Teacher"}</label>
                        <Select
                          options={teacherOptions}
                          value={allocationMode === "elective_lab" ? row.teachers || [] : row.teacher}
                          onChange={(value) =>
                            setElectiveRows((prev) =>
                              prev.map((item) => (
                                item.id === row.id
                                  ? allocationMode === "elective_lab"
                                    ? { ...item, teachers: value || [] }
                                    : { ...item, teacher: value || null }
                                  : item
                              ))
                            )
                          }
                          placeholder={allocationMode === "elective_lab" ? "Select one or more teachers" : "Select teacher"}
                          isMulti={allocationMode === "elective_lab"}
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
                <label>Select Subject</label>
                <Select
                  options={subjectOptions}
                  value={selectedSubjects[0] || null}
                  onChange={(value) => setSelectedSubjects(value ? [value] : [])}
                  placeholder="Select Subject"
                />
              </div>

              <div className="form-group cst-field">
                <label>Select Teacher</label>
                <Select
                  options={teacherOptions}
                  value={selectedTeachers[0] || null}
                  onChange={(value) => setSelectedTeachers(value ? [value] : [])}
                  placeholder={allSelectedSubjectsNoTeacher ? "Not required" : "Select Teacher"}
                  isDisabled={allSelectedSubjectsNoTeacher}
                />
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

          {selectedClasses.length > 1 && (
            <div className="form-group cst-field">
              <label>Combination ID</label>
              <input
                type="text"
                className="hours-input"
                placeholder="e.g. CSE-3AB-PHYS"
                value={combinedClassGroupId}
                onChange={(e) => setCombinedClassGroupId(e.target.value)}
              />
              <small>A unique name to group these classes together for this session.</small>
            </div>
          )}

          <div className="cst-actions">
            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting ? "Saving..." : "Add Allocation"}
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
                <td style={{ display: 'flex', gap: '5px' }}>
                  <button 
                    type="button"
                    className="secondary-btn" 
                    onClick={() => {
                      setHistoryAllocation(item);
                      setShowHistoryModal(true);
                    }}
                    style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                  >
                    History
                  </button>
                  <button className="danger-btn" onClick={() => handleDelete(item)} disabled={deleting || calculating || submitting || bulkDeleting} style={{ padding: '4px 8px', fontSize: '0.85rem' }}>
                    {deleting ? "..." : "Delete"}
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
