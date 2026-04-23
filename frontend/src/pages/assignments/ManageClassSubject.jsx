import React, { useContext, useState } from "react";
import api from "../../api/axios";
import Select from 'react-select';
import DataContext from "../../context/DataContext";

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

    const handleAdd = async (e) => {
        e.preventDefault();
        if (addClasses.length === 0 || addSubjects.length === 0 || !addHours) {
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
                            hoursPerWeek: addHours
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
            refetchData(['class-subjects']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
        }
    };

    const classOptions = classes.map(c => ({ value: c._id, label: c.name }));
    const subjectOptions = subjects.map(s => ({ value: s._id, label: s.name }));

    const filteredAssignments = assignments.filter(assignment => {
        const classMatch = !filterClass || (assignment.class?._id === filterClass.value);
        const subjectMatch = !filterSubject || (assignment.subject?._id === filterSubject.value);
        return classMatch && subjectMatch;
    });

    return (
        <div className="manage-container">
            <h2>Manage Class-Subject Assignments</h2>

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

            {loading ? (
                <div>Loading...</div>
            ) : (
                <table className="styled-table">
                    <thead>
                        <tr>
                            <th>Class</th>
                            <th>Subject</th>
                            <th>Hours per Week</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAssignments.map((assignment) => (
                            <tr key={assignment._id}>
                                <td>{assignment.class?.name}</td>
                                <td>{assignment.subject?.name}</td>
                                <td>{assignment.hoursPerWeek}</td>
                                <td>
                                    <button onClick={() => handleDelete(assignment._id)} className="danger-btn" disabled={Boolean(mutationMessage)}>
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

export default ManageClassSubject;
