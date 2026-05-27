import React, { useContext, useEffect, useState } from "react";
import api from "../../api/axios";
import Select from 'react-select';
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

const ManageClassSubject = () => {
    const { assignments, classes, subjects, loading, error, refetchData } = useContext(DataContext);
    const [addClasses, setAddClasses] = useState([]);
    const [addSubjects, setAddSubjects] = useState([]);
    const [addHours, setAddHours] = useState("");
    const [filterClass, setFilterClass] = useState(null);
    const [filterSubject, setFilterSubject] = useState(null);
    const [savingBulk, setSavingBulk] = useState(false);
    const [bulkMessage, setBulkMessage] = useState("");
    const [bulkError, setBulkError] = useState("");
    const [mutationMessage, setMutationMessage] = useState("");
    const [selectedAssignmentIds, setSelectedAssignmentIds] = useState([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);

    useEffect(() => {
        const defaultHours = resolveSelectedHours(addSubjects, subjects);
        setAddHours(defaultHours);
    }, [addSubjects, subjects]);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (addClasses.length === 0 || addSubjects.length === 0) {
            return;
        }
        setSavingBulk(true);
        setBulkMessage("");
        setBulkError("");
        try {
            const promises = [];
            addClasses.forEach(classItem => {
                addSubjects.forEach(subject => {
                    promises.push(
                        api.post('/class-subjects', {
                            classId: classItem.value,
                            subjectId: subject.value,
                            hoursPerWeek: addHours === "" ? undefined : Number(addHours)
                        })
                    );
                });
            });
            
            await Promise.all(promises);
            refetchData(['class-subjects']);
            setAddClasses([]);
            setAddSubjects([]);
            setAddHours("");
            setBulkMessage(`Assignments saved. Added ${promises.length} class-subject link(s).`);
        } catch (err) {
            setBulkError(err?.response?.data?.error || err?.message || "Failed to save class-subject assignments.");
        } finally {
            setSavingBulk(false);
        }
    };

    const handleDelete = async (assignmentId) => {
        if (!window.confirm("Are you sure you want to delete this assignment?")) return;
        setMutationMessage("Deleting class-subject assignment. Please wait...");
        try {
            await api.delete(`/class-subjects/${assignmentId}`);
            setSelectedAssignmentIds((prev) => prev.filter((itemId) => itemId !== assignmentId));
            refetchData(['class-subjects']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
        }
    };

    const handleBulkDelete = async () => {
        if (selectedAssignmentIds.length === 0) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedAssignmentIds.length} selected assignment(s)?`)) return;
        setBulkDeleting(true);
        setMutationMessage("Deleting selected class-subject assignments. Please wait...");
        try {
            await Promise.allSettled(selectedAssignmentIds.map((assignmentId) => api.delete(`/class-subjects/${assignmentId}`)));
            setSelectedAssignmentIds([]);
            refetchData(['class-subjects']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
            setBulkDeleting(false);
        }
    };

    const classOptions = classes.map(c => ({ value: c._id, label: c.name }));
    const subjectOptions = subjects.map(s => ({ value: s._id, label: s.name }));

    const filteredAssignments = assignments.filter(assignment => {
        const classMatch = !filterClass || (assignment.class?._id === filterClass.value);
        const subjectMatch = !filterSubject || (assignment.subject?._id === filterSubject.value);
        return classMatch && subjectMatch;
    });
    const filteredAssignmentIds = filteredAssignments.map((assignment) => assignment._id);
    const allVisibleAssignmentsSelected =
        filteredAssignmentIds.length > 0 && filteredAssignmentIds.every((id) => selectedAssignmentIds.includes(id));
    const someVisibleAssignmentsSelected =
        filteredAssignmentIds.some((id) => selectedAssignmentIds.includes(id));

    return (
        <div className="manage-container">
            <h2>Manage Class-Subject Assignments</h2>
            <div className="success-message" style={{ marginBottom: 20, backgroundColor: '#e7f3ff', color: '#004085', border: '1px solid #b8daff' }}>
                <strong>MAPPING MODE:</strong> Use this page to define bulk mappings. After saving, go to 
                <a href="/teaching-allocations" style={{ marginLeft: 5, fontWeight: 'bold' }}>Manage Allocations</a> 
                and click <strong>"Sync from Mappings"</strong> to automatically generate teaching assignments.
            </div>

            <form onSubmit={handleAdd} className="add-form">
                <h3>Add New Assignment</h3>
                <Select
                    options={classOptions}
                    isMulti
                    value={addClasses}
                    onChange={setAddClasses}
                    placeholder="Select Classes"
                />
                <Select
                    options={subjectOptions}
                    isMulti
                    value={addSubjects}
                    onChange={setAddSubjects}
                    placeholder="Select Subjects"
                />
                <input
                    type="number"
                    min="1"
                    className="hours-input"
                    value={addHours}
                    onChange={(e) => setAddHours(e.target.value)}
                    placeholder="Hours per week"
                />
                <button type="submit" className="primary-btn" disabled={savingBulk}>
                    {savingBulk ? "Saving..." : "Add"}
                </button>
                {savingBulk ? <div className="success-message">Saving class-subject assignments. Please wait...</div> : null}
                {mutationMessage ? <div className="loading-message">{mutationMessage}</div> : null}
                {bulkMessage ? <div className="success-message">{bulkMessage}</div> : null}
                {bulkError ? <div className="error-message">{bulkError}</div> : null}
                {error && <div className="error-message">{error}</div>}
            </form>

            <h3>Filter Assignments</h3>
            <div className="filters-container">
                <Select
                    options={classOptions}
                    value={filterClass}
                    onChange={setFilterClass}
                    placeholder="Filter by Class"
                    isClearable
                />
                <Select
                    options={subjectOptions}
                    value={filterSubject}
                    onChange={setFilterSubject}
                    placeholder="Filter by Subject"
                    isClearable
                />
            </div>

            {selectedAssignmentIds.length > 0 ? (
                <div className="bulk-actions-bar">
                    <label className="bulk-select-all">
                        <input
                            type="checkbox"
                            checked={allVisibleAssignmentsSelected}
                            ref={(input) => {
                                if (input) input.indeterminate = !allVisibleAssignmentsSelected && someVisibleAssignmentsSelected;
                            }}
                            onChange={(e) => {
                                const nextSelected = e.target.checked
                                    ? Array.from(new Set([...selectedAssignmentIds, ...filteredAssignmentIds]))
                                    : selectedAssignmentIds.filter((id) => !filteredAssignmentIds.includes(id));
                                setSelectedAssignmentIds(nextSelected);
                            }}
                        />
                        Select all visible
                    </label>
                    <span className="bulk-selection-count">{selectedAssignmentIds.length} selected</span>
                    <button type="button" className="danger-btn" onClick={handleBulkDelete} disabled={bulkDeleting || Boolean(mutationMessage)}>
                        Delete selected
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => setSelectedAssignmentIds([])} disabled={bulkDeleting || Boolean(mutationMessage)}>
                        Clear selection
                    </button>
                </div>
            ) : null}

            {loading ? (
                <div>Loading...</div>
            ) : (
                <div className="table-responsive">
                    <table className="styled-table">
                        <thead>
                            <tr>
                                <th className="selection-column">
                                    <input
                                        type="checkbox"
                                        checked={allVisibleAssignmentsSelected}
                                        ref={(input) => {
                                            if (input) input.indeterminate = !allVisibleAssignmentsSelected && someVisibleAssignmentsSelected;
                                        }}
                                        onChange={(e) => setSelectedAssignmentIds(e.target.checked ? filteredAssignmentIds : [])}
                                    />
                                </th>
                                <th>Class</th>
                                <th>Subject</th>
                                <th>Hours per Week</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAssignments.map((assignment) => (
                                <tr key={assignment._id} className={selectedAssignmentIds.includes(assignment._id) ? "row-selected" : ""}>
                                    <td className="selection-cell">
                                        <input
                                            type="checkbox"
                                            checked={selectedAssignmentIds.includes(assignment._id)}
                                            onChange={(e) => {
                                                setSelectedAssignmentIds((prev) =>
                                                    e.target.checked
                                                        ? Array.from(new Set([...prev, assignment._id]))
                                                        : prev.filter((id) => id !== assignment._id)
                                                );
                                            }}
                                        />
                                    </td>
                                    <td>{assignment.class?.name}</td>
                                    <td>{assignment.subject?.name}</td>
                                    <td>{assignment.hoursPerWeek}</td>
                                    <td className="actions-cell">
                                        <div className="actions-buttons">
                                            <button onClick={() => handleDelete(assignment._id)} className="danger-btn" disabled={Boolean(mutationMessage) || bulkDeleting}>
                                                {mutationMessage ? "..." : "🗑️ Delete"}
                                            </button>
                                        </div>
                                    </td>                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default ManageClassSubject;
