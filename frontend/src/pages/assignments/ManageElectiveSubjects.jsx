import React, { useState, useEffect, useContext, useMemo } from 'react';
import DataContext from '../../context/DataContext';
import api from '../../api/axios';

const ManageElectiveSubjects = () => {
    const { classes, subjects, combos, assignments: classSubjects } = useContext(DataContext);
    
    const [selectedClass, setSelectedClass] = useState('');
    const [subjectsForClass, setSubjectsForClass] = useState([]);
    // New state structure: { subjectId: { required_subject_id: count } }
    const [electiveSettings, setElectiveSettings] = useState({});
    const [saving, setSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");

    // Memoize the count of teachers who can teach each subject (for validation)
    const teacherCountPerSubject = useMemo(() => {
        if (!combos) return {};
        return combos.reduce((acc, combo) => {
            const subjectId = combo.subject?._id;
            if (subjectId) {
                acc[subjectId] = (acc[subjectId] || 0) + 1;
            }
            return acc;
        }, {});
    }, [combos]);

    // The list of "categories" is now the list of all subjects
    const subjectCategories = useMemo(() => subjects, [subjects]);

    useEffect(() => {
        if (selectedClass && classSubjects && subjects) {
            const relatedClassSubjects = classSubjects.filter(cs => cs.class?._id === selectedClass);
            const subjectDetails = relatedClassSubjects.map(cs => ({
                ...cs.subject,
                hoursPerWeek: cs.hoursPerWeek
            })).filter(s => s.isElective); // Only show electives
            setSubjectsForClass(subjectDetails);
        } else {
            setSubjectsForClass([]);
        }
    }, [selectedClass, classSubjects, subjects]);

    useEffect(() => {
        if (selectedClass) {
            const fetchElectiveSettings = async () => {
                try {
                    const response = await api.get(`/elective-settings/${selectedClass}`);
                    const settingsMap = response.data.reduce((acc, setting) => {
                        acc[setting.subjectId] = setting.teacherCategoryRequirements;
                        return acc;
                    }, {});
                    setElectiveSettings(settingsMap);
                } catch (error) {
                    console.error("Error fetching elective settings:", error);
                    setElectiveSettings({});
                }
            };
            fetchElectiveSettings();
        } else {
            setElectiveSettings({});
        }
    }, [selectedClass]);

    const handleRequirementCountChange = (electiveSubjectId, requiredSubjectId, count) => {
        const value = Number(count);
        setElectiveSettings(prev => {
            const newSettings = { ...prev };
            if (!newSettings[electiveSubjectId]) newSettings[electiveSubjectId] = {};
            if (value > 0) {
                newSettings[electiveSubjectId][requiredSubjectId] = value;
            } else {
                delete newSettings[electiveSubjectId][requiredSubjectId];
            }
            return newSettings;
        });
    };

    const handleSave = async () => {
        if (!selectedClass) {
            alert("Please select a class.");
            return;
        }

        let validationError = null;

        const settingsToSave = Object.entries(electiveSettings)
            .map(([subjectId, requirements]) => {
                const totalTeachers = Object.values(requirements).reduce((a, b) => a + b, 0);
                if (totalTeachers === 0) return null;

                for (const [requiredSubId, requiredNum] of Object.entries(requirements)) {
                    const available = teacherCountPerSubject[requiredSubId] || 0;
                    if (requiredNum > available) {
                        const electiveSub = subjects.find(s => s._id === subjectId);
                        const requiredSub = subjects.find(s => s._id === requiredSubId);
                        validationError = `For elective "${electiveSub?.name}", you require ${requiredNum} teachers with expertise in "${requiredSub?.name}", but only ${available} are available.`;
                        return null;
                    }
                }
                
                return { subjectId, teacherCategoryRequirements: requirements };
            })
            .filter(Boolean);
        
        if (validationError) {
            alert(validationError);
            return;
        }

        try {
            setSaving(true);
            setStatusMessage("Saving elective settings. Please wait...");
            await api.post('/elective-settings', {
                classId: selectedClass,
                settings: settingsToSave
            });
            alert('Elective settings saved successfully!');
        } catch (error) {
            console.error('Error saving elective settings:', error);
            alert('Failed to save settings.');
        } finally {
            setSaving(false);
            setStatusMessage("");
        }
    };

    const handleCancel = async () => {
        if (!selectedClass) return;
        try {
            const response = await api.get(`/elective-settings/${selectedClass}`);
            const settingsMap = response.data.reduce((acc, setting) => {
                acc[setting.subjectId] = setting.teacherCategoryRequirements;
                return acc;
            }, {});
            setElectiveSettings(settingsMap);
        } catch (error) {
            console.error("Error resetting elective settings:", error);
            alert("Failed to reset changes.");
        }
    };
    
    return (
        <div className="manage-container">
            <h2>Manage Elective Teacher Requirements</h2>
            <div className="elective-help-box">
                <p><b>How to use this page:</b></p>
                <p>1. Select a class to load its elective subjects.</p>
                <p>2. For each elective, enter how many teachers are needed from each subject expertise. Like for some classes you can have two choices in one elective and in some you can have more then 2 choices.</p>
                <p>3. Keep the total teachers per slot aligned with how you want that elective to run.</p>
                <p>4. Click Save Settings. Use Cancel to discard unsaved edits.</p>
            </div>

            <div className="elective-class-picker">
                <label htmlFor="class-select">Select Class</label>
                <select
                    id="class-select"
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                >
                    <option value="">-- Select a Class --</option>
                    {classes.map((c) => (
                        <option key={c._id} value={c._id}>{c.name}</option>
                    ))}
                </select>
            </div>

            {selectedClass && (
                <div>
                    <h3 className="elective-section-title">
                        Configure Electives for {classes.find((c) => c._id === selectedClass)?.name}
                    </h3>
                    {subjectsForClass.length === 0 ? (
                        <div className="elective-empty-message">
                            There are no elective subjects in this class.
                        </div>
                    ) : (
                        <>
                            <div className="elective-list">
                                {subjectsForClass.map((subject) => {
                                    const currentRequirements = electiveSettings[subject._id] || {};
                                    const totalTeachers = Object.values(currentRequirements).reduce((a, b) => a + b, 0);

                                    return (
                                        <div key={subject._id} className="elective-card">
                                            <div className="elective-card-title">{subject.name}</div>
                                            <div className="elective-card-meta">
                                                <span>Hours per week: {subject.hoursPerWeek}</span>
                                                <span>Total teachers per slot: {totalTeachers}</span>
                                            </div>

                                            <h4 className="elective-grid-title">
                                                Required Teacher Expertise (based on other subjects they can teach):
                                            </h4>
                                            <div className="elective-grid">
                                                {subjectCategories.map((categorySubject) => (
                                                    <div key={categorySubject._id} className="elective-grid-item">
                                                        <label htmlFor={`count-${subject._id}-${categorySubject._id}`}>
                                                            {categorySubject.name}
                                                        </label>
                                                        <input
                                                            type="number"
                                                            id={`count-${subject._id}-${categorySubject._id}`}
                                                            min="0"
                                                            max={teacherCountPerSubject[categorySubject._id] || 0}
                                                            value={currentRequirements[categorySubject._id] || 0}
                                                            onChange={(e) =>
                                                                handleRequirementCountChange(subject._id, categorySubject._id, e.target.value)
                                                            }
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="elective-save-row">
                                <button onClick={handleSave} className="primary-btn" disabled={saving}>
                                    {saving ? "Saving..." : "Save Settings"}
                                </button>
                                <button onClick={handleCancel} className="secondary-btn" disabled={saving}>
                                    Cancel
                                </button>
                            </div>
                            {statusMessage ? <div className="loading-message">{statusMessage}</div> : null}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default ManageElectiveSubjects;
