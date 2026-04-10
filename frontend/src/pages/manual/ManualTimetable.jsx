import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import api from '../../api/axios';
import { loadConstraintConfig } from '../constraintConfig';
import { getComboSubjectDisplayName } from '../subjectDisplay';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hours = ['1', '2', '3', '4', '5', '6', '7', '8'];

const cellId = (classId, day, hour) => `${classId}-${day}-${hour}`;
const parseCellId = (value) => {
  if (!value) return null;
  const [classId, day, hour] = String(value).split('-');
  if (!classId) return null;
  return { classId, day: Number(day), hour: Number(hour), cellId: String(value) };
};
const transformStyle = (transform) => transform
  ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
  : undefined;

function SlotCard({ id, disabledDrag, className, hourLabel, comboIds, comboIdToDetails, isLocked, onClick, children }) {
  const { setNodeRef: setDropRef } = useDroppable({ id });
  const { setNodeRef: setDragRef, attributes, listeners, transform, isDragging } = useDraggable({ id, disabled: disabledDrag });
  const setRefs = (node) => {
    setDropRef(node);
    setDragRef(node);
  };

  return (
    <div ref={setRefs} className={`${className} ${isDragging ? 'is-dragging' : ''}`} style={transformStyle(transform)}>
      <button type="button" className="manual-slot-summary-btn" onClick={onClick} {...(disabledDrag ? {} : listeners)} {...(disabledDrag ? {} : attributes)}>
        <div className="manual-slot-topline">
          <span className="manual-slot-hour">H{hourLabel}</span>
          <div className="manual-slot-badge-row">
            {disabledDrag && comboIds?.length > 1 && <span className="manual-slot-badge is-muted">Multi</span>}
            {isLocked && <span className="manual-slot-badge">Locked</span>}
          </div>
        </div>
        <div className="manual-slot-content">
          {comboIds?.length ? comboIds.map((comboId) => (
            <div key={comboId} className="manual-slot-entry">
              <strong>{comboIdToDetails[comboId]?.subject || 'Loading...'}</strong>
              <span>{comboIdToDetails[comboId]?.faculty || ''}</span>
            </div>
          )) : <div className="manual-slot-empty">Empty slot</div>}
        </div>
      </button>
      {children}
    </div>
  );
}

const ManualTimetable = () => {
  const [searchParams] = useSearchParams();
  const sourceTimetableId = searchParams.get('sourceTimetableId');
  const constraintConfig = useMemo(() => loadConstraintConfig(), []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const hoverRef = useRef('');

  const [classes, setClasses] = useState([]);
  const [subjectIdToDetails, setSubjectIdToDetails] = useState({});
  const [facultyIdToName, setFacultyIdToName] = useState({});
  const [requiredHoursByClassSubject, setRequiredHoursByClassSubject] = useState({});
  const [classTimetable, setClassTimetable] = useState({});
  const [teacherTimetable, setTeacherTimetable] = useState({});
  const [subjectHoursAssigned, setSubjectHoursAssigned] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isAutoFilling, setIsAutoFilling] = useState({});
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [timetableId, setTimetableId] = useState(null);
  const [savedTimetableId, setSavedTimetableId] = useState(null);
  const [comboIdToDetails, setComboIdToDetails] = useState({});
  const [slotSources, setSlotSources] = useState({});
  const [lockedSlots, setLockedSlots] = useState({});
  const [sourceTimetableMeta, setSourceTimetableMeta] = useState(null);
  const [editableTimetableName, setEditableTimetableName] = useState('');
  const [activeCellKey, setActiveCellKey] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [validOptions, setValidOptions] = useState({});
  const [dragState, setDragState] = useState(null);
  const [hoverValidation, setHoverValidation] = useState(null);
  const [moveFeedback, setMoveFeedback] = useState(null);

  const isEditingGeneratedTimetable = Boolean(sourceTimetableId) && (sourceTimetableMeta?.source === 'generator' || sourceTimetableMeta?.status === 'generated');

  const applyServerState = (payload) => {
    setClassTimetable(payload.classTimetable || {});
    setTeacherTimetable(payload.teacherTimetable || {});
    setSubjectHoursAssigned(payload.subjectHoursAssigned || {});
    setSlotSources(payload.slotSources || {});
    setLockedSlots(payload.lockedSlots || {});
  };

  const resolveComboDisplay = (combo) => {
    const subjectId = String(combo?.subject?._id || combo?.subject || combo?.subject_id || '');
    const facultyIds = Array.isArray(combo?.faculty_ids)
      ? combo.faculty_ids.map((id) => String(id))
      : combo?.faculty_id
        ? [String(combo.faculty_id)]
        : combo?.faculty
          ? [String(combo.faculty?._id || combo.faculty)]
          : [];
    return {
      subject: getComboSubjectDisplayName(
        combo,
        new Map(Object.entries(subjectIdToDetails)),
        subjectId ? `Subject ${subjectId.slice(-4)}` : 'Unknown Subject'
      ),
      faculty: combo?.faculty?.name || combo?.faculty_name || facultyIds.map((facultyId) => facultyIdToName[facultyId] || `Faculty ${facultyId.slice(-4)}`).join(', ') || (String(combo?.subject?.type || combo?.subject_type || combo?.type || '').toLowerCase() === 'no_teacher' ? 'No Teacher' : 'Unknown Teacher'),
    };
  };

  const getSlot = (classId, day, hour) => ({
    comboIds: classTimetable[classId]?.[day]?.[hour] || [],
    slotSource: slotSources[classId]?.[day]?.[hour] || null,
    isLocked: !!lockedSlots[classId]?.[day]?.[hour],
  });

  const getClassSummaryRows = (classObj) => {
    const classId = String(classObj._id);
    const requiredHours = requiredHoursByClassSubject[classId] || classObj.subject_hours || {};
    const assignedHours = subjectHoursAssigned[classId] || {};
    return Array.from(new Set([...Object.keys(requiredHours), ...Object.keys(assignedHours)])).map((subjectId) => ({
      subjectId,
      name: subjectIdToDetails[subjectId]?.name || 'Unknown Subject',
      assignedHours: assignedHours[subjectId] || 0,
      requiredHours: requiredHours[subjectId],
    }));
  };

  const inspectorCell = (() => {
    const target = dragState?.from || selectedCell || parseCellId(activeCellKey);
    if (!target) return null;
    const slot = getSlot(target.classId, target.day, target.hour);
    const className = classes.find((item) => String(item._id) === String(target.classId))?.name || 'Unknown Class';
    return {
      ...target,
      className,
      ...slot,
      warnings: hoverValidation?.to?.cellId === target.cellId ? hoverValidation.softWarnings || [] : [],
      hardViolations: hoverValidation?.to?.cellId === target.cellId ? hoverValidation.hardViolations || [] : [],
    };
  })();

  useEffect(() => {
    const fetchAndInitialize = async () => {
      try {
        setIsLoading(true);
        const [classesRes, facultiesRes, subjectsRes, combosRes, classSubjectRes, sourceRes] = await Promise.all([
          api.get('/classes'),
          api.get('/faculties'),
          api.get('/subjects'),
          api.get('/teacher-subject-combos'),
          api.get('/class-subjects'),
          sourceTimetableId ? api.get(`/timetable/${sourceTimetableId}`) : Promise.resolve({ data: null }),
        ]);

        const fetchedClasses = classesRes.data || [];
        const fetchedFaculties = facultiesRes.data || [];
        const fetchedSubjects = subjectsRes.data || [];
        const fetchedCombos = combosRes.data || [];
        const fetchedClassSubjects = classSubjectRes.data || [];

        setClasses(fetchedClasses);
        setFacultyIdToName(fetchedFaculties.reduce((acc, faculty) => {
          acc[String(faculty._id)] = faculty.name;
          return acc;
        }, {}));
        setSubjectIdToDetails(fetchedSubjects.reduce((acc, subject) => {
          acc[String(subject._id)] = subject;
          return acc;
        }, {}));
        setRequiredHoursByClassSubject(fetchedClassSubjects.reduce((acc, item) => {
          const classId = String(item?.class?._id || item?.class || '');
          const subjectId = String(item?.subject?._id || item?.subject || '');
          if (!classId || !subjectId) return acc;
          if (!acc[classId]) acc[classId] = {};
          acc[classId][subjectId] = Number(item?.hoursPerWeek || 0);
          return acc;
        }, {}));

        const comboDetails = {};
        fetchedCombos.forEach((combo) => { comboDetails[String(combo._id)] = resolveComboDisplay(combo); });
        if (Array.isArray(sourceRes.data?.combos)) {
          sourceRes.data.combos.forEach((combo) => { comboDetails[String(combo._id)] = resolveComboDisplay(combo); });
        }
        setComboIdToDetails(comboDetails);

        const currentTimetableId = `manual-${Date.now()}`;
        const electiveGroups = JSON.parse(localStorage.getItem('classElectiveGroups')) || [];
        setTimetableId(currentTimetableId);
        setSourceTimetableMeta(sourceRes.data || null);
        setEditableTimetableName(sourceRes.data?.name || '');

        const initResponse = await api.post('/manual/initialize', {
          timetableId: currentTimetableId,
          classes: fetchedClasses,
          faculties: fetchedFaculties,
          subjects: fetchedSubjects,
          electiveGroups,
          config: { days: days.length, hours: hours.length },
          constraintConfig,
          sourceTimetableId,
        });
        if (!initResponse.data.ok) throw new Error('Failed to initialize timetable state.');

        if (sourceTimetableId) {
          const loadResponse = await api.post('/manual/load', { timetableId: currentTimetableId, savedTimetableId: sourceTimetableId });
          if (!loadResponse.data.ok) throw new Error(loadResponse.data.error || 'Failed to load source timetable.');
          applyServerState(loadResponse.data);
          setSavedTimetableId(sourceRes.data?.source === 'manual' && sourceRes.data?.status !== 'generated' ? sourceTimetableId : null);
        } else {
          applyServerState(initResponse.data);
        }
      } catch (error) {
        console.error('Error during initial setup:', error);
        alert('There was an error setting up the timetable. Please refresh the page.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchAndInitialize();
  }, [constraintConfig, sourceTimetableId]);

  const handleGetOptions = async (classId, day, hour) => {
    if (!timetableId) return;
    try {
      const response = await api.post('/manual/valid-options', { timetableId, classId, day, hour });
      const options = response.data.validOptions || [];
      setValidOptions((prev) => ({ ...prev, [cellId(classId, day, hour)]: options }));
      const newDetails = {};
      options.forEach((option) => {
        newDetails[option.comboId] = {
          subject: option.subject || (option.subjectId ? subjectIdToDetails[String(option.subjectId)]?.name : null) || 'Unknown Subject',
          faculty: option.faculty || (Array.isArray(option.facultyIds) ? option.facultyIds.map((facultyId) => facultyIdToName[String(facultyId)] || `Faculty ${String(facultyId).slice(-4)}`).join(', ') : 'Unknown Teacher'),
          warnings: Array.isArray(option.warnings) ? option.warnings : [],
        };
      });
      setComboIdToDetails((prev) => ({ ...prev, ...newDetails }));
    } catch (error) {
      console.error('Error fetching valid options:', error);
      alert(`Error fetching options: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleToggleCellEditor = (classId, day, hour) => {
    const key = cellId(classId, day, hour);
    const nextOpen = activeCellKey !== key;
    setActiveCellKey(nextOpen ? key : null);
    setSelectedCell(parseCellId(key));
    if (nextOpen) handleGetOptions(classId, day, hour);
  };

  const handleClearSlot = async (classId, day, hour) => {
    if (!timetableId) return;
    try {
      const response = await api.post('/manual/clear-slot', { timetableId, classId, day, hour });
      if (response.data.ok) {
        applyServerState(response.data);
        setMoveFeedback(null);
      } else {
        alert(`Error clearing slot: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error clearing slot:', error);
      alert('An unexpected error occurred while clearing the slot.');
    }
  };

  const handlePlaceCombo = async (classId, day, hour, comboIdValue) => {
    if (!timetableId) return;
    try {
      const response = await api.post('/manual/place', { timetableId, classId, day, hour, comboId: comboIdValue });
      if (response.data.ok) {
        applyServerState(response.data);
        setMoveFeedback(null);
      } else {
        alert(`Error: ${response.data.error || 'The requested placement is invalid.'}`);
        handleGetOptions(classId, day, hour);
      }
    } catch (error) {
      console.error('Error placing combo:', error);
      alert(`An unexpected error occurred while placing the combo: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleAutoFill = async (classId) => {
    if (!timetableId) return;
    setIsAutoFilling((prev) => ({ ...prev, [classId]: true }));
    try {
      const response = await api.post('/manual/auto-fill', { timetableId, classId });
      if (response.data.ok) {
        if (response.data.comboIdToDetails) setComboIdToDetails((prev) => ({ ...prev, ...response.data.comboIdToDetails }));
        applyServerState(response.data);
      } else {
        alert(`Auto-fill failed: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error during auto-fill:', error);
      alert(`An unexpected error occurred during auto-fill: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsAutoFilling((prev) => ({ ...prev, [classId]: false }));
    }
  };

  const handleClearAll = async () => {
    if (!timetableId) return;
    if (!window.confirm('Are you sure you want to clear the entire timetable? This action cannot be undone.')) return;
    try {
      const response = await api.post('/manual/clear-all', { timetableId, config: { days: days.length, hours: hours.length } });
      if (response.data.ok) {
        applyServerState(response.data);
        setMoveFeedback(null);
      } else {
        alert(`Failed to clear timetable: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error clearing timetable:', error);
      alert(`An unexpected error occurred while clearing the timetable: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleDeleteTimetable = async () => {
    if (!timetableId) return;
    if (!window.confirm(`Are you sure you want to delete this timetable (ID: ${timetableId})? This action cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      const response = await api.post('/manual/delete', { timetableId });
      if (response.data.ok) {
        setClassTimetable({});
        setTeacherTimetable({});
        setSubjectHoursAssigned({});
        setTimetableId(null);
        setValidOptions({});
        setIsAutoFilling({});
      } else {
        alert(`Failed to delete timetable: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error deleting timetable:', error);
      alert(`An unexpected error occurred while deleting the timetable: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async (isSaveAs = false) => {
    if (!timetableId) return;
    const suggestedName = sourceTimetableMeta?.name ? `${sourceTimetableMeta.name} (Edited)` : 'Edited Timetable';
    const name = isEditingGeneratedTimetable ? (editableTimetableName || suggestedName).trim() : window.prompt('Enter a name for this timetable:', suggestedName)?.trim();
    if (!name) return;
    setIsSaving(true);
    try {
      const response = await api.post('/manual/save', { timetableId, name, savedTimetableId: isSaveAs ? null : savedTimetableId });
      if (response.data.ok) {
        alert(response.data.message);
        if (response.data.id) setSavedTimetableId(response.data.id);
      } else {
        alert(`Failed to save timetable: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Error saving timetable:', error);
      alert(`An unexpected error occurred while saving: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async () => {
    try {
      const response = await api.get('/manual/processed-assignments');
      const savedTimetables = (response.data.savedTimetables || []).filter((item) => item.source === 'manual');
      if (!savedTimetables.length) {
        alert('No saved timetables found.');
        return;
      }
      const selection = window.prompt('Select a timetable to load:\n\n' + savedTimetables.map((item, index) => `${index + 1}. ${item.name}`).join('\n'));
      const selectedIndex = Number.parseInt(selection, 10) - 1;
      if (Number.isNaN(selectedIndex) || !savedTimetables[selectedIndex]) return;
      const selectedTimetable = savedTimetables[selectedIndex];
      const newComboIdToDetails = {};
      for (const classId in selectedTimetable.class_timetables) {
        for (const day in selectedTimetable.class_timetables[classId]) {
          for (const hour in selectedTimetable.class_timetables[classId][day]) {
            (selectedTimetable.class_timetables[classId][day][hour] || []).forEach((combo) => {
              if (combo?._id) newComboIdToDetails[String(combo._id)] = { subject: combo.subject?.name || 'Unknown Subject', faculty: combo.faculty?.name || 'Unknown Teacher' };
            });
          }
        }
      }
      const loadResponse = await api.post('/manual/load', { timetableId, savedTimetableId: selectedTimetable._id });
      if (loadResponse.data.ok) {
        setComboIdToDetails((prev) => ({ ...prev, ...newComboIdToDetails }));
        applyServerState(loadResponse.data);
        setSavedTimetableId(selectedTimetable._id);
        setMoveFeedback(null);
        alert(`Timetable "${selectedTimetable.name}" loaded successfully.`);
      } else {
        alert(`Failed to load timetable: ${loadResponse.data.error}`);
      }
    } catch (error) {
      console.error('Error loading timetables:', error);
      alert('Failed to fetch saved timetables.');
    }
  };

  const handleToggleLock = async (classId, day, hour) => {
    if (!timetableId) return;
    try {
      const response = await api.post('/manual/toggle-lock', { timetableId, classId, day, hour });
      if (response.data.ok) setLockedSlots(response.data.lockedSlots || {});
      else alert(`Failed to toggle lock: ${response.data.error}`);
    } catch (error) {
      console.error('Error toggling slot lock:', error);
      alert(`An unexpected error occurred while toggling the lock: ${error.response?.data?.error || error.message}`);
    }
  };

  const resetDragPreview = () => {
    setDragState(null);
    setHoverValidation(null);
    hoverRef.current = '';
  };

  const handleDragStart = ({ active }) => {
    const from = parseCellId(active?.id);
    if (!from) return;
    const slot = getSlot(from.classId, from.day, from.hour);
    if (slot.isLocked || slot.comboIds.length !== 1) return;
    setDragState({ from });
    setSelectedCell(from);
    setActiveCellKey(null);
    setMoveFeedback(null);
  };

  const handleDragOver = async ({ active, over }) => {
    const from = parseCellId(active?.id);
    const to = parseCellId(over?.id);
    if (!from || !to) {
      setHoverValidation(null);
      hoverRef.current = '';
      return;
    }
    const requestKey = `${from.cellId}->${to.cellId}`;
    if (hoverRef.current === requestKey) return;
    hoverRef.current = requestKey;
    try {
      const response = await api.post('/manual/validate-move', { timetableId, from, to });
      if (hoverRef.current !== requestKey) return;
      setHoverValidation({ from, to, ...response.data });
    } catch (error) {
      if (hoverRef.current !== requestKey) return;
      setHoverValidation({ from, to, allowed: false, hardViolations: [error.response?.data?.error || error.message], softWarnings: [] });
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    const from = parseCellId(active?.id);
    const to = parseCellId(over?.id);
    if (!from || !to) {
      resetDragPreview();
      return;
    }
    try {
      const response = await api.post('/manual/move', { timetableId, from, to });
      if (response.data.ok) {
        applyServerState(response.data);
        setSelectedCell(to);
        setMoveFeedback({ operation: response.data.operation, softWarnings: response.data.softWarnings || [], hardViolations: [] });
      } else {
        setMoveFeedback({ operation: response.data.operation || 'move', softWarnings: [], hardViolations: response.data.hardViolations || [response.data.error || 'Move blocked.'] });
      }
    } catch (error) {
      const payload = error.response?.data || {};
      setMoveFeedback({ operation: payload.operation || 'move', softWarnings: [], hardViolations: payload.hardViolations || [payload.error || error.message] });
    } finally {
      resetDragPreview();
    }
  };

  if (isLoading || timetableId === null || isDeleting) return <div>Loading...</div>;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={resetDragPreview}>
      <div className="manage-container manual-page">
        <div className="manual-header">
          <h1>{isEditingGeneratedTimetable ? 'Edit Generated Timetable' : 'Manual Timetable Generator'}</h1>
          {sourceTimetableMeta && (isEditingGeneratedTimetable ? (
            <div className="manual-edit-meta">
              <label className="manual-edit-name">
                <span>Timetable Name</span>
                <input type="text" value={editableTimetableName} onChange={(event) => setEditableTimetableName(event.target.value)} placeholder="Enter timetable name" disabled={isSaving || isDeleting} />
              </label>
              <p>Editing generated timetable{sourceTimetableMeta.status ? ` | ${sourceTimetableMeta.status}` : ''}</p>
            </div>
          ) : (
            <p>Editing generated timetable: <strong>{sourceTimetableMeta.name}</strong>{sourceTimetableMeta.status ? ` | ${sourceTimetableMeta.status}` : ''}</p>
          ))}
          <div className="manual-header-actions">
            <button onClick={() => handleSave()} className="manual-action-btn manual-action-save" disabled={isSaving || isDeleting}>{isSaving ? 'Saving...' : 'Save Timetable'}</button>
            {!isEditingGeneratedTimetable && <>
              <button onClick={handleLoad} className="manual-action-btn manual-action-load" disabled={isSaving || isDeleting}>Load Timetable</button>
              <button onClick={() => handleSave(true)} className="manual-action-btn manual-action-save-as" disabled={isSaving || isDeleting}>Save As...</button>
              <button onClick={handleClearAll} className="manual-action-btn manual-action-clear" disabled={isSaving || isDeleting}>Clear All Timetables</button>
              <button onClick={handleDeleteTimetable} className="manual-action-btn manual-action-delete" disabled={isSaving || isDeleting}>{isDeleting ? 'Deleting...' : 'Delete Timetable'}</button>
            </>}
          </div>
        </div>

        {moveFeedback && (
          <div className={`manual-feedback ${moveFeedback.hardViolations?.length ? 'is-error' : 'is-warning'}`}>
            <strong>{moveFeedback.hardViolations?.length ? 'Move blocked' : 'Move applied'}</strong>
            {(moveFeedback.hardViolations?.length ? moveFeedback.hardViolations : moveFeedback.softWarnings || []).map((item) => <div key={item}>{item}</div>)}
          </div>
        )}

        <div className="manual-workspace">
          <div className="manual-main">
            {classes.map((classObj) => (
              <div key={classObj._id} className="manual-class-block">
                <div className="manual-class-header">
                  <h2>Timetable for {classObj.name}</h2>
                  <button onClick={() => handleAutoFill(classObj._id)} className="manual-autofill-btn" disabled={isAutoFilling[classObj._id] || isDeleting || isSaving}>{isAutoFilling[classObj._id] ? 'Filling...' : 'Auto-Fill'}</button>
                </div>
                <div className="table-responsive">
                  <table className="styled-table manual-table">
                    <thead>
                      <tr><th>Day</th>{hours.map((hourLabel) => <th key={hourLabel}>Hour {hourLabel}</th>)}</tr>
                    </thead>
                    <tbody>
                      {days.map((dayLabel, dayIndex) => (
                        <tr key={dayLabel}>
                          <td>{dayLabel}</td>
                          {hours.map((hourLabel, hourIndex) => {
                            const id = cellId(classObj._id, dayIndex, hourIndex);
                            const slot = getSlot(classObj._id, dayIndex, hourIndex);
                            const options = validOptions[id];
                            const dragDisabled = slot.isLocked || slot.comboIds.length !== 1;
                            const isActive = activeCellKey === id;
                            const isDragSource = dragState?.from?.cellId === id;
                            const isValidationTarget = hoverValidation?.to?.cellId === id;
                            const slotClass = [
                              'manual-slot',
                              slot.isLocked ? 'is-locked' : '',
                              slot.slotSource === 'manual' ? 'is-manual' : '',
                              slot.comboIds.length ? 'has-value' : 'is-empty',
                              isActive ? 'is-active' : '',
                              isDragSource ? 'is-drag-source' : '',
                              isValidationTarget && hoverValidation?.allowed ? (hoverValidation?.softWarnings?.length ? 'drop-soft' : 'drop-valid') : '',
                              isValidationTarget && hoverValidation && !hoverValidation.allowed ? 'drop-blocked' : '',
                            ].filter(Boolean).join(' ');

                            return (
                              <td key={hourIndex} className="manual-slot-cell">
                                <SlotCard id={id} className={slotClass} disabledDrag={dragDisabled} hourLabel={hourLabel} comboIds={slot.comboIds} comboIdToDetails={comboIdToDetails} isLocked={slot.isLocked} onClick={() => handleToggleCellEditor(classObj._id, dayIndex, hourIndex)}>
                                  {isValidationTarget && hoverValidation && <div className={`manual-drop-state ${hoverValidation.allowed ? (hoverValidation.softWarnings?.length ? 'is-soft' : 'is-valid') : 'is-blocked'}`}>{!hoverValidation.allowed ? 'Blocked' : hoverValidation.softWarnings?.length ? 'Warning' : hoverValidation.operation === 'swap' ? 'Swap' : 'Move'}</div>}
                                  {isActive && (
                                    <div className="manual-slot-editor">
                                      <div className="manual-slot-editor-actions">
                                        <button type="button" onClick={() => handleToggleLock(classObj._id, dayIndex, hourIndex)} className={`manual-slot-icon-btn ${slot.isLocked ? 'is-locked' : ''}`}>{slot.isLocked ? 'Unlock' : 'Lock'}</button>
                                        <button type="button" onClick={() => handleClearSlot(classObj._id, dayIndex, hourIndex)} disabled={slot.isLocked || !slot.comboIds.length} className="manual-slot-icon-btn is-danger">Clear</button>
                                      </div>
                                      <select onChange={(event) => { if (event.target.value) { handlePlaceCombo(classObj._id, dayIndex, hourIndex, event.target.value); setActiveCellKey(null); } }} disabled={slot.isLocked} className="manual-slot-select" defaultValue="">
                                        <option value="">Select subject</option>
                                        {options !== undefined && !options.length && <option value="">No options available</option>}
                                        {options?.map((option) => <option key={option.comboId} value={option.comboId}>{option.subject} - {option.faculty}{option.warnings?.length ? ` (${option.warnings[0]})` : ''}</option>)}
                                      </select>
                                      {options !== undefined && options?.length > 0 && <div className="manual-slot-option-warnings">{options.slice(0, 3).some((option) => option.warnings?.length) ? 'Some options include soft warnings or teacher preference warnings.' : ''}</div>}
                                    </div>
                                  )}
                                </SlotCard>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="manual-summary">
                  <h3>Subject Allocation Summary</h3>
                  <div className="table-responsive">
                    <table className="styled-table manual-summary-table">
                      <thead><tr><th>Subject</th><th>Assigned Hours</th><th>Required Hours</th></tr></thead>
                      <tbody>
                        {getClassSummaryRows(classObj).length ? getClassSummaryRows(classObj).map(({ subjectId, name, assignedHours, requiredHours }) => (
                          <tr key={subjectId}><td>{name}</td><td>{assignedHours}</td><td>{requiredHours ?? '-'}</td></tr>
                        )) : <tr><td colSpan="3" className="manual-summary-empty">No subject requirement data is available for this class yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <aside className="manual-sidepanel">
            <div className="manual-sidepanel-card">
              <h3>Selected Slot</h3>
              {inspectorCell ? <>
                <p><strong>Class:</strong> {inspectorCell.className}</p>
                <p><strong>Day:</strong> {days[inspectorCell.day] || `Day ${inspectorCell.day + 1}`}</p>
                <p><strong>Hour:</strong> {hours[inspectorCell.hour] || inspectorCell.hour + 1}</p>
                <p><strong>Source:</strong> {inspectorCell.slotSource || 'empty'}</p>
                <p><strong>Status:</strong> {inspectorCell.isLocked ? 'Locked' : 'Editable'}</p>
                <div className="manual-sidepanel-section">
                  <strong>Entries</strong>
                  {inspectorCell.comboIds.length ? inspectorCell.comboIds.map((comboId) => <div key={comboId} className="manual-sidepanel-entry"><span>{comboIdToDetails[comboId]?.subject || 'Unknown Subject'}</span><small>{comboIdToDetails[comboId]?.faculty || 'Unknown Teacher'}</small></div>) : <div className="manual-sidepanel-empty">Empty slot</div>}
                </div>
                <div className="manual-sidepanel-section">
                  <strong>Warnings</strong>
                  {inspectorCell.hardViolations?.length ? inspectorCell.hardViolations.map((item) => <div key={item} className="manual-sidepanel-warning is-hard">{item}</div>) : inspectorCell.warnings?.length ? inspectorCell.warnings.map((item) => <div key={item} className="manual-sidepanel-warning">{item}</div>) : <div className="manual-sidepanel-empty">No current warnings</div>}
                </div>
              </> : <div className="manual-sidepanel-empty">Click a slot to edit it, or drag a lesson to preview move and swap validation.</div>}
            </div>
          </aside>
        </div>
      </div>
    </DndContext>
  );
};

export default ManualTimetable;
