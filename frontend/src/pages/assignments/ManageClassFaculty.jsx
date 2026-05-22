import React, { useContext, useState } from "react";
import api from "../../api/axios";
import Select from 'react-select';
import DataContext from "../../context/DataContext";

const ManageClassFaculty = () => {
    const { classes, faculties, loading, error, refetchData } = useContext(DataContext);
    const [addClasses, setAddClasses] = useState([]);
    const [addFaculties, setAddFaculties] = useState([]);
    const [filterClass, setFilterClass] = useState(null);
    const [filterFaculty, setFilterFaculty] = useState(null);
    const [savingBulk, setSavingBulk] = useState(false);
    const [bulkMessage, setBulkMessage] = useState("");
    const [bulkError, setBulkError] = useState("");
    const [mutationMessage, setMutationMessage] = useState("");
    const [selectedAssignmentKeys, setSelectedAssignmentKeys] = useState([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (addClasses.length === 0 || !addFaculties || addFaculties.length === 0) {
            return;
        }
        setSavingBulk(true);
        setBulkMessage("");
        setBulkError("");
        try {
            const addPromises = [];
            addClasses.forEach(classItem => {
                addFaculties.forEach(faculty => {
                    addPromises.push(
                        api.post(`/classes/${classItem.value}/faculties`, { facultyId: faculty.value })
                    );
                });
            });
            await Promise.all(addPromises);
            setAddClasses([]);
            setAddFaculties([]);
            refetchData(['classes']);
            setBulkMessage(`Assignments saved. Added ${addPromises.length} class-faculty link(s).`);
        } catch (err) {
            setBulkError(err?.response?.data?.error || err?.message || "Failed to save class-faculty assignments.");
        } finally {
            setSavingBulk(false);
        }
    };

    const handleDelete = async (classId, facultyId) => {
        if (!window.confirm("Are you sure you want to delete this assignment?")) return;
        setMutationMessage("Deleting class-faculty assignment. Please wait...");
        try {
            await api.delete(`/classes/${classId}/faculties/${facultyId}`);
            setSelectedAssignmentKeys((prev) => prev.filter((key) => key !== `${classId}__${facultyId}`));
            refetchData(['classes']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
        }
    };

    const handleBulkDelete = async () => {
        if (selectedAssignmentKeys.length === 0) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedAssignmentKeys.length} selected assignment(s)?`)) return;
        setBulkDeleting(true);
        setMutationMessage("Deleting selected class-faculty assignments. Please wait...");
        try {
            await Promise.allSettled(
                selectedAssignmentKeys.map((key) => {
                    const [classId, facultyId] = key.split("__");
                    return api.delete(`/classes/${classId}/faculties/${facultyId}`);
                })
            );
            setSelectedAssignmentKeys([]);
            refetchData(['classes']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
            setBulkDeleting(false);
        }
    };

    const classOptions = classes.map(c => ({ value: c._id, label: c.name }));
    const facultyOptions = faculties.map(f => ({ value: f._id, label: f.name }));

    const assignments = classes.flatMap(c => (c.faculties || []).map(f => ({ class: c, faculty: f })));

    const filteredAssignments = assignments.filter(assignment => {
        const classMatch = !filterClass || (assignment.class?._id === filterClass.value);
        const facultyMatch = !filterFaculty || (assignment.faculty?._id === filterFaculty.value);
        return classMatch && facultyMatch;
    });
    const filteredAssignmentKeys = filteredAssignments.map((assignment) => `${assignment.class?._id}__${assignment.faculty?._id}`);
    const allVisibleAssignmentsSelected =
        filteredAssignmentKeys.length > 0 && filteredAssignmentKeys.every((key) => selectedAssignmentKeys.includes(key));
    const someVisibleAssignmentsSelected =
        filteredAssignmentKeys.some((key) => selectedAssignmentKeys.includes(key));

    return (
        <div className="manage-container">
            <h2>Manage Class-Faculty Assignments</h2>
            <div className="success-message" style={{ marginBottom: 20, backgroundColor: '#e7f3ff', color: '#004085', border: '1px solid #b8daff' }}>
                <strong>MAPPING MODE:</strong> Use this page to define bulk mappings. After saving, go to 
                <a href="/teaching-allocations" style={{ marginLeft: 5, fontWeight: 'bold' }}>Manage Allocations</a> 
                and click <strong>"Sync from Mappings"</strong> to automatically generate teaching assignments.
            </div>

            <form onSubmit={handleAdd} className="add-form">
                <h3>Add New Assignment</h3>
                <Select
                    options={classOptions}
                    value={addClasses}
                    onChange={setAddClasses}
                    placeholder="Select Classes"
                    isMulti
                />
                <Select
                    options={facultyOptions}
                    value={addFaculties}
                    onChange={setAddFaculties}
                    placeholder="Select Faculties"
                    isMulti
                />
                <button type="submit" className="primary-btn" disabled={savingBulk}>
                    {savingBulk ? "Saving..." : "Add"}
                </button>
                {savingBulk ? <div className="success-message">Saving class-faculty assignments. Please wait...</div> : null}
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
                    options={facultyOptions}
                    value={filterFaculty}
                    onChange={setFilterFaculty}
                    placeholder="Filter by Faculty"
                    isClearable
                />
            </div>

            {selectedAssignmentKeys.length > 0 ? (
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
                                    ? Array.from(new Set([...selectedAssignmentKeys, ...filteredAssignmentKeys]))
                                    : selectedAssignmentKeys.filter((key) => !filteredAssignmentKeys.includes(key));
                                setSelectedAssignmentKeys(nextSelected);
                            }}
                        />
                        Select all visible
                    </label>
                    <span className="bulk-selection-count">{selectedAssignmentKeys.length} selected</span>
                    <button type="button" className="danger-btn" onClick={handleBulkDelete} disabled={bulkDeleting || Boolean(mutationMessage)}>
                        Delete selected
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => setSelectedAssignmentKeys([])} disabled={bulkDeleting || Boolean(mutationMessage)}>
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
                                    checked={allVisibleAssignmentsSelected}
                                    ref={(input) => {
                                        if (input) input.indeterminate = !allVisibleAssignmentsSelected && someVisibleAssignmentsSelected;
                                    }}
                                    onChange={(e) => setSelectedAssignmentKeys(e.target.checked ? filteredAssignmentKeys : [])}
                                />
                            </th>
                            <th>Class</th>
                            <th>Faculty</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAssignments.map(({ class: c, faculty: f }) => (
                            <tr key={`${c._id}-${f._id}`} className={selectedAssignmentKeys.includes(`${c._id}__${f._id}`) ? "row-selected" : ""}>
                                <td className="selection-cell">
                                    <input
                                        type="checkbox"
                                        checked={selectedAssignmentKeys.includes(`${c._id}__${f._id}`)}
                                        onChange={(e) => {
                                            setSelectedAssignmentKeys((prev) =>
                                                e.target.checked
                                                    ? Array.from(new Set([...prev, `${c._id}__${f._id}`]))
                                                    : prev.filter((key) => key !== `${c._id}__${f._id}`)
                                            );
                                        }}
                                    />
                                </td>
                                <td>{c.name}</td>
                                <td>{f.name}</td>
                                <td>
                                    <button onClick={() => handleDelete(c._id, f._id)} className="danger-btn" disabled={Boolean(mutationMessage) || bulkDeleting}>
                                        {mutationMessage ? "Working..." : "Delete"}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default ManageClassFaculty;
