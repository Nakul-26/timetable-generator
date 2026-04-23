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
            refetchData(['classes']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
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

    return (
        <div className="manage-container">
            <h2>Manage Class-Faculty Assignments</h2>

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

            {loading ? (
                <div>Loading...</div>
            ) : (
                <table className="styled-table">
                    <thead>
                        <tr>
                            <th>Class</th>
                            <th>Faculty</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAssignments.map(({ class: c, faculty: f }) => (
                            <tr key={`${c._id}-${f._id}`}>
                                <td>{c.name}</td>
                                <td>{f.name}</td>
                                <td>
                                    <button onClick={() => handleDelete(c._id, f._id)} className="danger-btn" disabled={Boolean(mutationMessage)}>
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
