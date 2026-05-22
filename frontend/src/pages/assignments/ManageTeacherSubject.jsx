import React, { useContext, useState } from "react";
import API from "../../api/axios";
import DataContext from "../../context/DataContext";
import Select from 'react-select';

const ManageTeacherSubject = () => {
    const { combos, faculties, subjects, loading, error, refetchData } = useContext(DataContext);
    const [selectedTeachers, setSelectedTeachers] = useState([]);
    const [selectedSubject, setSelectedSubject] = useState(null);
    const [selectedComboIds, setSelectedComboIds] = useState([]);

    // State for filtering and search
    const [filterFaculty, setFilterFaculty] = useState(null);
    const [filterSubject, setFilterSubject] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [savingBulk, setSavingBulk] = useState(false);
    const [bulkMessage, setBulkMessage] = useState("");
    const [bulkError, setBulkError] = useState("");
    const [mutationMessage, setMutationMessage] = useState("");
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this combination?")) return;
        setMutationMessage("Deleting teacher-subject combination. Please wait...");
        try {
            await API.delete(`/teacher-subject-combos/${id}`);
            setSelectedComboIds((prev) => prev.filter((itemId) => itemId !== id));
            refetchData(['teacher-subject-combos']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
        }
    };

    const handleBulkDelete = async () => {
        if (selectedComboIds.length === 0) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedComboIds.length} selected combination(s)?`)) return;
        setBulkDeleting(true);
        setMutationMessage("Deleting selected teacher-subject combinations. Please wait...");
        try {
            await Promise.allSettled(selectedComboIds.map((id) => API.delete(`/teacher-subject-combos/${id}`)));
            setSelectedComboIds([]);
            refetchData(['teacher-subject-combos']);
        } catch (err) {
            console.log(`Error: ${err.message}`);
        } finally {
            setMutationMessage("");
            setBulkDeleting(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedSubject || !selectedTeachers || selectedTeachers.length === 0) {
            return;
        }
        setSavingBulk(true);
        setBulkMessage("");
        setBulkError("");
        try {
            const newCombos = selectedTeachers.map(teacher => ({
                faculty: teacher.value,
                subject: selectedSubject.value,
            }));

            const promises = newCombos.map(combo => API.post('/teacher-subject-combos', combo));

            await Promise.all(promises);

            refetchData(['teacher-subject-combos']);
            setSelectedTeachers([]);
            setSelectedSubject(null);
            setBulkMessage(`Combinations saved. Added ${promises.length} teacher-subject combo(s).`);
        } catch (err) {
            setBulkError(err?.response?.data?.error || err?.message || "Failed to save teacher-subject combinations.");
        } finally {
            setSavingBulk(false);
        }
    };

    const teacherOptions = faculties.map(t => ({ value: t._id, label: t.name }));
    const subjectOptions = subjects.map(s => ({ value: s._id, label: s.name }));

    const filteredCombos = combos.filter(combo => {
        const facultyMatch = filterFaculty ? combo.faculty?._id === filterFaculty.value : true;
        const subjectMatch = filterSubject ? combo.subject?._id === filterSubject.value : true;
        const searchMatch = searchTerm ?
            (combo.faculty?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             combo.subject?.name?.toLowerCase().includes(searchTerm.toLowerCase()))
            : true;
        return facultyMatch && subjectMatch && searchMatch;
    });
    const filteredComboIds = filteredCombos.map((combo) => combo._id);
    const allVisibleCombosSelected =
        filteredComboIds.length > 0 && filteredComboIds.every((id) => selectedComboIds.includes(id));
    const someVisibleCombosSelected =
        filteredComboIds.some((id) => selectedComboIds.includes(id));

    return (
        <div className="manage-container">
            <h2>Manage Teacher-Subject Combinations</h2>
            <div className="success-message" style={{ marginBottom: 20, backgroundColor: '#e7f3ff', color: '#004085', border: '1px solid #b8daff' }}>
                <strong>MAPPING MODE:</strong> Use this page to define bulk mappings. After saving, go to 
                <a href="/teaching-allocations" style={{ marginLeft: 5, fontWeight: 'bold' }}>Manage Allocations</a> 
                and click <strong>"Sync from Mappings"</strong> to automatically generate teaching assignments.
            </div>

            <form onSubmit={handleSubmit} className="add-form">
                <h3>Add New Combination</h3>
                {error && <div className="error-message">{error}</div>}
                <Select
                    options={teacherOptions}
                    value={selectedTeachers}
                    onChange={setSelectedTeachers}
                    placeholder="Select Teachers"
                    isMulti
                />
                <Select
                    options={subjectOptions}
                    value={selectedSubject}
                    onChange={setSelectedSubject}
                    placeholder="Select Subject"
                />
                <button type="submit" className="primary-btn" disabled={savingBulk}>
                    {savingBulk ? "Saving..." : "Add Combination"}
                </button>
                {savingBulk ? <div className="success-message">Saving teacher-subject combinations. Please wait...</div> : null}
                {mutationMessage ? <div className="loading-message">{mutationMessage}</div> : null}
                {bulkMessage ? <div className="success-message">{bulkMessage}</div> : null}
                {bulkError ? <div className="error-message">{bulkError}</div> : null}
            </form>

            <h3>Filter Combinations</h3>
            <div className="filters-container">
                <input
                    type="text"
                    placeholder="Search by teacher or subject..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="search-input"
                />
                <Select
                    options={teacherOptions}
                    value={filterFaculty}
                    onChange={setFilterFaculty}
                    placeholder="Filter by Teacher"
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

            {selectedComboIds.length > 0 ? (
                <div className="bulk-actions-bar">
                    <label className="bulk-select-all">
                        <input
                            type="checkbox"
                            checked={allVisibleCombosSelected}
                            ref={(input) => {
                                if (input) input.indeterminate = !allVisibleCombosSelected && someVisibleCombosSelected;
                            }}
                            onChange={(e) => {
                                const nextSelected = e.target.checked
                                    ? Array.from(new Set([...selectedComboIds, ...filteredComboIds]))
                                    : selectedComboIds.filter((id) => !filteredComboIds.includes(id));
                                setSelectedComboIds(nextSelected);
                            }}
                        />
                        Select all visible
                    </label>
                    <span className="bulk-selection-count">{selectedComboIds.length} selected</span>
                    <button type="button" className="danger-btn" onClick={handleBulkDelete} disabled={bulkDeleting || Boolean(mutationMessage)}>
                        Delete selected
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => setSelectedComboIds([])} disabled={bulkDeleting || Boolean(mutationMessage)}>
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
                                    checked={allVisibleCombosSelected}
                                    ref={(input) => {
                                        if (input) input.indeterminate = !allVisibleCombosSelected && someVisibleCombosSelected;
                                    }}
                                    onChange={(e) => setSelectedComboIds(e.target.checked ? filteredComboIds : [])}
                                />
                            </th>
                            <th>Teacher</th>
                            <th>Subject</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredCombos.map((combo) => (
                            <tr key={combo._id} className={selectedComboIds.includes(combo._id) ? "row-selected" : ""}>
                                <td className="selection-cell">
                                    <input
                                        type="checkbox"
                                        checked={selectedComboIds.includes(combo._id)}
                                        onChange={(e) => {
                                            setSelectedComboIds((prev) =>
                                                e.target.checked
                                                    ? Array.from(new Set([...prev, combo._id]))
                                                    : prev.filter((id) => id !== combo._id)
                                            );
                                        }}
                                    />
                                </td>
                                <td>{combo.faculty?.name}</td>
                                <td>{combo.subject?.name}</td>
                                <td>
                                    <button onClick={() => handleDelete(combo._id)} className="danger-btn" disabled={Boolean(mutationMessage) || bulkDeleting}>
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

export default ManageTeacherSubject;
