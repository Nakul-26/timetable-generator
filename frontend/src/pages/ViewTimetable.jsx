import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/axios';
import { getComboSubjectDisplayName } from './subjectDisplay';

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hours = ["1", "2", "3", "4", "5", "6", "7", "8"];

const ViewTimetable = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [timetable, setTimetable] = useState(null);
    const [classes, setClasses] = useState([]);
    const [combos, setCombos] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [faculties, setFaculties] = useState([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedClass, setSelectedClass] = useState('');
    const [selectedFaculty, setSelectedFaculty] = useState('');
    const [selectedSubject, setSelectedSubject] = useState('');
    const [activeExport, setActiveExport] = useState('');

    const [classMap, setClassMap] = useState({});
    const [comboMap, setComboMap] = useState({});
    const [subjectMap, setSubjectMap] = useState({});
    const [facultyMap, setFacultyMap] = useState({});
    useEffect(() => {
        const fetchData = async () => {
            try {
                setIsLoading(true);
                const [ttRes, classesRes, combosRes, subjectsRes, facultiesRes] = await Promise.all([
                    api.get(`/timetable/${id}`),
                    api.get('/classes'),
                    api.get('/teacher-subject-combos'),
                    api.get('/subjects'),
                    api.get('/faculties')
                ]);

                setTimetable(ttRes.data);
                setClasses(classesRes.data);
                setCombos([...(combosRes.data || []), ...(ttRes.data?.combos || [])]);
                setSubjects([...(ttRes.data?.subjects || []), ...(subjectsRes.data || [])]);
                setFaculties([...(ttRes.data?.faculties || []), ...(facultiesRes.data || [])]);
                
                setError(null);
            } catch (err) {
                setError(err.response?.data?.error || 'Failed to fetch data. Please try again later.');
                console.error('Error fetching data:', err);
            } finally {
                setIsLoading(false);
            }
        };

        if (id) {
            fetchData();
        }
    }, [id]);

    useEffect(() => {
        if (classes.length) {
            const newClassMap = classes.reduce((acc, c) => ({ ...acc, [String(c._id)]: c.name }), {});
            setClassMap(newClassMap);
        }
    }, [classes]);

    useEffect(() => {
        if (subjects.length) {
            const next = subjects.reduce((acc, s) => {
                acc[String(s._id)] = s.name;
                return acc;
            }, {});
            setSubjectMap(next);
        } else {
            setSubjectMap({});
        }
    }, [subjects]);

    useEffect(() => {
        if (faculties.length) {
            const next = faculties.reduce((acc, f) => {
                acc[String(f._id)] = f.name;
                return acc;
            }, {});
            setFacultyMap(next);
        } else {
            setFacultyMap({});
        }
    }, [faculties]);

    useEffect(() => {
        if (combos.length) {
            const subjectLookup = new Map(Object.entries(subjectMap));
            const newComboMap = combos.reduce((acc, combo) => {
                const subjectId = combo?.subject?._id || combo?.subject || combo?.subject_id;
                const subjectName = getComboSubjectDisplayName(combo, subjectLookup, 'N/A');

                let facultyName = 'N/A';
                if (combo?.faculty?.name) {
                    facultyName = combo.faculty.name;
                } else if (combo?.faculty) {
                    facultyName = facultyMap[String(combo.faculty)] || 'N/A';
                } else if (Array.isArray(combo?.faculty_ids) && combo.faculty_ids.length > 0) {
                    facultyName = combo.faculty_ids
                        .map((fid) => facultyMap[String(fid)] || `Faculty ${String(fid).slice(-4)}`)
                        .join(', ');
                } else if (combo?.faculty_id) {
                    facultyName = facultyMap[String(combo.faculty_id)] || `Faculty ${String(combo.faculty_id).slice(-4)}`;
                }
                const subjectType = String(subjects.find((s) => String(s._id) === String(subjectId))?.type || '').toLowerCase();
                if (facultyName === 'N/A' && subjectType === 'no_teacher') {
                    facultyName = 'No Teacher';
                }

                acc[String(combo._id)] = {
                    subject: subjectName,
                    faculty: facultyName,
                    subjectId: subjectId ? String(subjectId) : '',
                    facultyIds: Array.isArray(combo?.faculty_ids)
                        ? combo.faculty_ids.map((fid) => String(fid))
                        : combo?.faculty_id
                            ? [String(combo.faculty_id)]
                            : combo?.faculty
                                ? [String(combo.faculty?._id || combo.faculty)]
                                : []
                };
                return acc;
            }, {});
            setComboMap(newComboMap);
        } else {
            setComboMap({});
        }
    }, [combos, subjectMap, facultyMap]);

    const getCellData = (classId, dayIndex, hourIndex) => {
        const rawSlot = timetable.class_timetables[classId]?.[dayIndex]?.[hourIndex];
        const comboId = Array.isArray(rawSlot) ? rawSlot[0] : rawSlot;
        if (!comboId || comboId === -1 || comboId === "BREAK") return null;

        if (comboMap[String(comboId)]) {
            return comboMap[String(comboId)];
        }

        const embeddedCombo = Array.isArray(timetable?.combos)
            ? timetable.combos.find((c) => String(c._id) === String(comboId))
            : null;

        if (!embeddedCombo) return null;

        const subjectId = String(embeddedCombo?.subject_id || embeddedCombo?.subject || '');

        const subjectName = getComboSubjectDisplayName(
            embeddedCombo,
            new Map(Object.entries(subjectMap)),
            embeddedCombo?.subject_id ? `Subject ${String(embeddedCombo.subject_id).slice(-4)}` : 'N/A'
        );

        let facultyName = 'N/A';
        let facultyIds = [];
        if (embeddedCombo?.faculty?.name) {
            facultyName = embeddedCombo.faculty.name;
            facultyIds = [String(embeddedCombo.faculty?._id || embeddedCombo.faculty)];
        } else if (embeddedCombo?.faculty) {
            facultyName = facultyMap[String(embeddedCombo.faculty)] || 'N/A';
            facultyIds = [String(embeddedCombo.faculty)];
        } else if (Array.isArray(embeddedCombo?.faculty_ids) && embeddedCombo.faculty_ids.length > 0) {
            facultyName = embeddedCombo.faculty_ids
                .map((fid) => facultyMap[String(fid)] || `Faculty ${String(fid).slice(-4)}`)
                .join(', ');
            facultyIds = embeddedCombo.faculty_ids.map((fid) => String(fid));
        } else if (embeddedCombo?.faculty_id) {
            facultyName = facultyMap[String(embeddedCombo.faculty_id)] || `Faculty ${String(embeddedCombo.faculty_id).slice(-4)}`;
            facultyIds = [String(embeddedCombo.faculty_id)];
        }
        const subjectType = String(subjects.find((s) => String(s._id) === subjectId)?.type || '').toLowerCase();
        if (facultyName === 'N/A' && subjectType === 'no_teacher') {
            facultyName = 'No Teacher';
        }

        return {
            subject: subjectName,
            faculty: facultyName,
            subjectId,
            facultyIds
        };
    };

    const isCellMatching = (cellData) => {
        const hasFilter = selectedFaculty || selectedSubject;
        if (!hasFilter) return true;
        if (!cellData) return false;

        const subjectMatch = !selectedSubject || String(cellData.subjectId) === String(selectedSubject);
        const facultyMatch = !selectedFaculty || (cellData.facultyIds || []).includes(String(selectedFaculty));
        return subjectMatch && facultyMatch;
    };

    const resetFilters = () => {
        setSelectedClass('');
        setSelectedFaculty('');
        setSelectedSubject('');
    };

    const escapeHtml = (value) =>
        String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const readFilenameFromDisposition = (headerValue, fallbackName) => {
        const raw = String(headerValue || '');
        const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
            return decodeURIComponent(utf8Match[1]);
        }

        const simpleMatch = raw.match(/filename="?([^"]+)"?/i);
        return simpleMatch?.[1] || fallbackName;
    };

    const triggerBlobDownload = (blob, filename) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    };

    if (isLoading) {
        return <div>Loading timetable...</div>;
    }

    if (error) {
        return <div style={{ color: 'red' }}>{error}</div>;
    }

    if (!timetable) {
        return <div>Timetable not found.</div>;
    }

    const classIds = Object.keys(timetable.class_timetables);
    const filteredClassIds = selectedClass
        ? classIds.filter((classId) => String(classId) === String(selectedClass))
        : classIds;

    const buildClassPdfHtml = () => {
        const classSections = classIds.map((classId) => {
            const rows = hours.map((hour, hourIndex) => {
                const cells = days.map((_, dayIndex) => {
                    const cellData = getCellData(classId, dayIndex, hourIndex);

                    if (!cellData) {
                        const rawSlot = timetable.class_timetables[classId]?.[dayIndex]?.[hourIndex];
                        return `<td>${rawSlot === "BREAK" ? '<div class="break">BREAK</div>' : '--'}</td>`;
                    }

                    return `<td><div class="subject">${escapeHtml(cellData.subject)}</div><div class="faculty">${escapeHtml(cellData.faculty)}</div></td>`;
                }).join("");

                return `<tr><td class="day">P${hourIndex + 1}</td>${cells}</tr>`;
            }).join("");

            return `<div class="class-block"><h3>${escapeHtml(classMap[String(classId)] || "Unknown Class")}</h3><table><thead><tr><th>Period</th>${days.map((day) => `<th>${escapeHtml(day)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
        }).join("");

        return `<div class="pdf-root"><h1>Class Timetable Export</h1><div class="meta">Generated on: ${escapeHtml(new Date().toLocaleString())}</div>${classSections}</div>`;
    };

    const buildTeacherPdfHtml = () => {
        const teacherMap = {};

        classIds.forEach((classId) => {
            days.forEach((_, dayIndex) => {
                hours.forEach((_, hourIndex) => {
                    const cellData = getCellData(classId, dayIndex, hourIndex);
                    if (!cellData?.facultyIds?.length) return;

                    cellData.facultyIds.forEach((facultyId) => {
                        if (!teacherMap[facultyId]) {
                            teacherMap[facultyId] = Array.from({ length: days.length }, () =>
                                Array.from({ length: hours.length }, () => [])
                            );
                        }

                        const cellEntries = teacherMap[facultyId][dayIndex][hourIndex];
                        const alreadyExists = cellEntries.some(
                            (entry) =>
                                entry.subject === cellData.subject &&
                                entry.className === (classMap[String(classId)] || classId)
                        );

                        if (!alreadyExists) {
                            cellEntries.push({
                                subject: cellData.subject,
                                className: classMap[String(classId)] || classId,
                            });
                        }
                    });
                });
            });
        });

        const teacherSections = Object.keys(teacherMap)
            .sort((left, right) => (facultyMap[left] || left).localeCompare(facultyMap[right] || right))
            .map((teacherId) => {
                const rows = hours.map((hour, hourIndex) => {
                    const cells = days.map((_, dayIndex) => {
                        const entries = teacherMap[teacherId][dayIndex][hourIndex];
                        if (!entries.length) return '<td>--</td>';

                        return `<td>${entries
                            .map(
                                (entry) =>
                                    `<div class="entry"><div class="subject">${escapeHtml(entry.subject)}</div><div class="faculty">${escapeHtml(entry.className)}</div></div>`
                            )
                            .join('')}</td>`;
                    }).join("");

                    return `<tr><td class="day">P${hourIndex + 1}</td>${cells}</tr>`;
                }).join("");

                return `<div class="class-block"><h3>${escapeHtml(facultyMap[teacherId] || teacherId)}</h3><table><thead><tr><th>Period</th>${days.map((day) => `<th>${escapeHtml(day)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
            }).join("");

        return `<div class="pdf-root"><h1>Teacher Timetable Export</h1><div class="meta">Generated on: ${escapeHtml(new Date().toLocaleString())}</div>${teacherSections || '<p>No teacher timetable data available.</p>'}</div>`;
    };

    const buildFullCollegePdfHtml = () => {
        const rows = classIds.map((classId) =>
            hours.map((hour, hourIndex) => {
                const cells = days.map((_, dayIndex) => {
                    const cellData = getCellData(classId, dayIndex, hourIndex);
                    if (!cellData) {
                        const rawSlot = timetable.class_timetables[classId]?.[dayIndex]?.[hourIndex];
                        return `<td>${rawSlot === "BREAK" ? '<div class="break">BREAK</div>' : '--'}</td>`;
                    }
                    return `<td><div class="subject">${escapeHtml(cellData.subject)}</div><div class="faculty">${escapeHtml(cellData.faculty)}</div></td>`;
                }).join("");

                return `<tr><td>${escapeHtml(classMap[String(classId)] || classId)}</td><td>P${hourIndex + 1}</td>${cells}</tr>`;
            }).join("")
        ).join("");

        return `<div class="pdf-root"><h1>Full College Timetable Export</h1><div class="meta">Generated on: ${escapeHtml(new Date().toLocaleString())}</div><table><thead><tr><th>Class</th><th>Period</th>${days.map((day) => `<th>${escapeHtml(day)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
    };

    const downloadPdfFromHtml = (html, title) => {
        const popup = window.open("", "_blank", "noopener,noreferrer");
        if (!popup) {
            alert("Unable to open download window. Please allow popups for this site.");
            return;
        }

        popup.document.open();
        popup.document.write(`
          <!doctype html>
          <html>
            <head>
              <meta charset="UTF-8" />
              <title>${escapeHtml(title)}</title>
              <style>
                @page { size: A4 landscape; margin: 10mm; }
                body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #111; }
                .pdf-root h1 { margin: 0 0 10px 0; }
                .pdf-root .meta { margin: 0 0 8px 0; font-size: 13px; color: #444; }
                .pdf-root .class-block { margin-top: 18px; page-break-inside: avoid; }
                .pdf-root .class-block h3 { margin: 0 0 8px 0; font-size: 16px; }
                .pdf-root table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                .pdf-root th, .pdf-root td { border: 1px solid #d0d0d0; padding: 6px; font-size: 10px; vertical-align: top; word-wrap: break-word; }
                .pdf-root th { background: #f2f2f2; color: #333; }
                .pdf-root .day { font-weight: 700; width: 95px; }
                .pdf-root .subject { font-weight: 700; }
                .pdf-root .faculty { margin-top: 3px; color: #333; }
                .pdf-root .entry + .entry { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #d0d0d0; }
                .pdf-root .break { font-weight: 700; color: #8a4b00; }
              </style>
            </head>
            <body>${html}</body>
          </html>
        `);
        popup.document.close();
        popup.focus();
        popup.print();
    };

    const handlePdfExport = (mode) => {
        if (!classIds.length) return;

        if (mode === 'class') {
            downloadPdfFromHtml(buildClassPdfHtml(), "Class Timetable PDF");
            return;
        }
        if (mode === 'teacher') {
            downloadPdfFromHtml(buildTeacherPdfHtml(), "Teacher Timetable PDF");
            return;
        }

        downloadPdfFromHtml(buildFullCollegePdfHtml(), "Full College Timetable PDF");
    };

    const handleExcelExport = async (mode) => {
        try {
            setActiveExport(mode);
            const response = await api.get(`/timetable/${id}/export/excel`, {
                params: { 
                    mode,
                    classId: selectedClass || undefined,
                    facultyId: selectedFaculty || undefined,
                    subjectId: selectedSubject || undefined,
                },
                responseType: 'blob',
            });

            const filename = readFilenameFromDisposition(
                response.headers?.['content-disposition'],
                `timetable_${mode}.xlsx`
            );

            triggerBlobDownload(response.data, filename);
        } catch (err) {
            console.error('Excel export failed:', err);
            alert('Failed to export Excel file.');
        } finally {
            setActiveExport('');
        }
    };

    const canEditTimetable =
        timetable?.source === 'generator' || timetable?.status === 'generated';

    return (
        <div className="manage-container">
            <h2>{timetable.name}</h2>
            <p><strong>Saved At:</strong> {new Date(timetable.createdAt).toLocaleString()}</p>
            <p>
                <strong>Status:</strong> {timetable.status || 'draft'}
                {timetable.edit_version ? ` | Version ${timetable.edit_version}` : ''}
            </p>

            <div className="actions-bar">
                {canEditTimetable && (
                    <button
                        className="primary-btn"
                        onClick={() => navigate(`/manual-timetable?sourceTimetableId=${id}`)}
                    >
                        Edit Timetable
                    </button>
                )}
                <button className="secondary-btn" onClick={() => handleExcelExport('class')} disabled={activeExport === 'class'}>
                    {activeExport === 'class' ? 'Exporting Class Excel...' : 'Excel: Class'}
                </button>
                <button className="secondary-btn" onClick={() => handleExcelExport('teacher')} disabled={activeExport === 'teacher'}>
                    {activeExport === 'teacher' ? 'Exporting Teacher Excel...' : 'Excel: Teacher'}
                </button>
                <button className="secondary-btn" onClick={() => handleExcelExport('full')} disabled={activeExport === 'full'}>
                    {activeExport === 'full' ? 'Exporting Full Excel...' : 'Excel: Full College'}
                </button>
                <button className="secondary-btn" onClick={() => handlePdfExport('class')}>
                    PDF: Class
                </button>
                <button className="secondary-btn" onClick={() => handlePdfExport('teacher')}>
                    PDF: Teacher
                </button>
                <button className="secondary-btn" onClick={() => handlePdfExport('full')}>
                    PDF: Full College
                </button>
            </div>

            <div className="filters-container">
                <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                    <option value="">All Classes</option>
                    {classIds.map((classId) => (
                        <option key={classId} value={classId}>
                            {classMap[String(classId)] || classId}
                        </option>
                    ))}
                </select>

                <select value={selectedFaculty} onChange={(e) => setSelectedFaculty(e.target.value)}>
                    <option value="">All Faculties</option>
                    {faculties.map((f) => (
                        <option key={f._id} value={f._id}>
                            {f.name}
                        </option>
                    ))}
                </select>

                <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
                    <option value="">All Subjects</option>
                    {subjects.map((s) => (
                        <option key={s._id} value={s._id}>
                            {s.name}
                        </option>
                    ))}
                </select>

                <button onClick={resetFilters} className="secondary-btn">
                    Reset
                </button>
            </div>

            {filteredClassIds.length === 0 && <p>No classes match the selected filters.</p>}

            {filteredClassIds.map(classId => (
                <div key={classId} style={{ marginBottom: '40px' }}>
                    <h3>{classMap[String(classId)] || 'Unknown Class'}</h3>
                    <table className="styled-table">
                        <thead>
                            <tr>
                                <th>Day</th>
                                {hours.map(hour => <th key={hour}>Hour {hour}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {days.map((day, dayIndex) => (
                                <tr key={day}>
                                    <td>{day}</td>
                                    {hours.map((hour, hourIndex) => {
                                        const cellData = getCellData(classId, dayIndex, hourIndex);
                                        const matches = isCellMatching(cellData);
                                        return (
                                            <td key={hourIndex} style={{ opacity: matches ? 1 : 0.3 }}>
                                                {cellData ? (
                                                    <div>
                                                        <div><strong>{cellData.subject}</strong></div>
                                                        <div><em>{cellData.faculty}</em></div>
                                                    </div>
                                                ) : '--'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </div>
    );
};

export default ViewTimetable;
