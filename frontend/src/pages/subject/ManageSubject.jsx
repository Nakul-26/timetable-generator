import React, { useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "../../api/axios";
import DataContext from "../../context/DataContext";
import * as XLSX from "xlsx";

function ManageSubject() {
  const { subjects, assignments, combos, loading, error, refetchData } = useContext(DataContext);
  const [editId, setEditId] = useState(null);
  const [excelMessage, setExcelMessage] = useState("");
  const [excelError, setExcelError] = useState("");
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [mutationMessage, setMutationMessage] = useState("");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileInputRef = useRef(null);

  // Edit states
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editSem, setEditSem] = useState("");
  const [editType, setEditType] = useState("");
  const [editClassesPerWeek, setEditClassesPerWeek] = useState("");

  // 🔍 Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [filterCode, setFilterCode] = useState("");
  const [filterSem, setFilterSem] = useState("");

  const navigate = useNavigate();

  const clearExcelStatus = () => {
    setExcelMessage("");
    setExcelError("");
  };

  const getCellValue = (row, keys) => {
    for (const key of keys) {
      const raw = row[key];
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        return String(raw).trim();
      }
    }
    return "";
  };

  const parseOptionalPositiveNumber = (value) => {
    if (value === "") return undefined;
    if (value === undefined || value === null) return undefined;
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 1 ? parsedValue : null;
  };

  const handleDownloadTemplate = () => {
    clearExcelStatus();
    const rows = [
      ["name", "id", "sem", "type", "classesPerWeek"],
      ["", "", "", "theory", ""]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Subjects");
    XLSX.writeFile(workbook, "subjects_template.xlsx");
    setExcelMessage("Template downloaded.");
  };

  const handleExportSubjects = () => {
    clearExcelStatus();
    const rows = subjects.map((subject) => {
      const assignedClassNames = assignments
        .filter((a) => a.subject?._id === subject._id)
        .map((a) => a.class?.name)
        .filter(Boolean)
        .join(", ");
      const assignedFacultyNames = combos
        .filter((c) => c.subject?._id === subject._id)
        .map((c) => c.faculty?.name)
        .filter(Boolean)
        .join(", ");

      return {
        name: subject.name || "",
        id: subject.id || "",
        sem: subject.sem || "",
        type: subject.type || "theory",
        classesPerWeek: subject.classesPerWeek ?? "",
        assignedClasses: assignedClassNames,
        assignedFaculties: assignedFacultyNames
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Subjects");
    XLSX.writeFile(workbook, "subjects_export.xlsx");
    setExcelMessage("Subjects exported.");
  };

  const triggerExcelUpload = () => {
    clearExcelStatus();
    fileInputRef.current?.click();
  };

  const handleExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    clearExcelStatus();
    setUploadingExcel(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames?.[0];
      if (!firstSheet) {
        throw new Error("No sheet found in the uploaded file.");
      }

      const sheet = workbook.Sheets[firstSheet];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        throw new Error("The uploaded sheet is empty.");
      }

      const normalizedRows = rawRows.map((row) => {
        const name = getCellValue(row, ["name", "Name", "subjectName", "Subject Name"]);
        const id = getCellValue(row, ["id", "ID", "code", "Code", "subjectCode", "Subject Code"]);
        const sem = getCellValue(row, ["sem", "Sem", "semester", "Semester", "class", "Class"]);
        const typeRaw = getCellValue(row, ["type", "Type"]) || "theory";
        const normalizedType = typeRaw.toLowerCase();
        const type = ["lab", "no_teacher"].includes(normalizedType) ? normalizedType : "theory";
        const classesPerWeekRaw = getCellValue(row, ["classesPerWeek", "classes_per_week", "Classes per Week", "hoursPerWeek", "weeklyClasses"]);
        const parsedClassesPerWeek = parseOptionalPositiveNumber(classesPerWeekRaw);

        if (parsedClassesPerWeek === null) {
          throw new Error(`Invalid classesPerWeek value for subject "${name || id}".`);
        }

        return {
          name,
          id,
          sem,
          type,
          classesPerWeek: parsedClassesPerWeek,
        };
      });

      const validRows = normalizedRows.filter((row) => row.name && row.id && row.sem);
      if (validRows.length === 0) {
        throw new Error("No valid rows found. Required columns: name, id, sem.");
      }

      const duplicateIds = new Set();
      const seenIds = new Set();
      validRows.forEach((row) => {
        const key = row.id.toLowerCase();
        if (seenIds.has(key)) duplicateIds.add(row.id);
        seenIds.add(key);
      });
      if (duplicateIds.size > 0) {
        throw new Error(`Duplicate subject IDs in file: ${Array.from(duplicateIds).join(", ")}`);
      }

      const existingByCode = new Map(
        subjects
          .filter((s) => s?.id)
          .map((s) => [String(s.id).toLowerCase(), s])
      );

      let createdCount = 0;
      let updatedCount = 0;
      for (const row of validRows) {
        const existing = existingByCode.get(row.id.toLowerCase());
        if (existing) {
          await axios.put(`/subjects/${existing._id}`, {
            name: row.name,
            sem: row.sem,
            type: row.type,
            classesPerWeek: row.classesPerWeek,
          });
          updatedCount += 1;
        } else {
          await axios.post("/subjects", {
            name: row.name,
            id: row.id,
            sem: row.sem,
            type: row.type,
            classesPerWeek: row.classesPerWeek,
          });
          createdCount += 1;
        }
      }

      refetchData(["subjects"]);
      setExcelMessage(`Upload complete. Created: ${createdCount}, Updated: ${updatedCount}.`);
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to upload subjects from Excel.";
      setExcelError(message);
    } finally {
      setUploadingExcel(false);
      if (event.target) event.target.value = "";
    }
  };

  const handleAddSubject = () => {
    navigate("/subject/add");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this subject?")) return;
    setMutationMessage("Deleting subject. Please wait...");
    try {
      await axios.delete(`/subjects/${id}`);
      setSelectedSubjectIds((prev) => prev.filter((itemId) => itemId !== id));
      refetchData(['subjects']);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSubjectIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedSubjectIds.length} selected subject(s)?`)) return;
    setBulkDeleting(true);
    setMutationMessage("Deleting selected subjects. Please wait...");
    try {
      await Promise.allSettled(selectedSubjectIds.map((id) => axios.delete(`/subjects/${id}`)));
      setSelectedSubjectIds([]);
      refetchData(['subjects']);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
      setBulkDeleting(false);
    }
  };

  const handleEdit = (subject) => {
    setEditId(subject._id);
    setEditName(subject.name);
    setEditCode(subject.id);
    setEditSem(subject.sem);
    setEditType(subject.type);
    setEditClassesPerWeek(subject.classesPerWeek ?? "");
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    const classesPerWeekValue =
      editClassesPerWeek === ""
        ? null
        : parseOptionalPositiveNumber(editClassesPerWeek);
    if (classesPerWeekValue === null && editClassesPerWeek !== "") {
      setMutationMessage("");
      setExcelError("");
      setExcelMessage("");
      alert("Classes per week must be a positive number.");
      return;
    }
    setMutationMessage("Saving subject changes. Please wait...");
    try {
      const updatedSubject = {
        name: editName,
        id: editCode,
        sem: editSem,
        type: editType,
        classesPerWeek: classesPerWeekValue,
      };
      await axios.put(`/subjects/${editId}`, updatedSubject);
      setEditId(null);
      setEditName("");
      setEditCode("");
      setEditSem("");
      setEditType("theory");
      setEditClassesPerWeek("");
      refetchData();
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
    }
  };

  // 🔎 Filtered data
  const filteredSubjects = subjects.filter((s) => {
    return (
      (!filterName || (s.name && s.name.toLowerCase().includes(filterName.toLowerCase()))) &&
      (!filterCode || (s.id && s.id.toLowerCase().includes(filterCode.toLowerCase()))) &&
      (!filterSem || (s.sem && String(s.sem) === filterSem))
    );
  });
  const filteredSubjectIds = filteredSubjects.map((subject) => subject._id);
  const allVisibleSubjectsSelected =
    filteredSubjectIds.length > 0 && filteredSubjectIds.every((id) => selectedSubjectIds.includes(id));
  const someVisibleSubjectsSelected =
    filteredSubjectIds.some((id) => selectedSubjectIds.includes(id));

  return (
    <div className="manage-container">
      <h2>Manage Subjects</h2>
      <div className="actions-bar">
        <button onClick={handleAddSubject}>Add Subject</button>
        <button onClick={handleDownloadTemplate} className="secondary-btn">Download Excel Template</button>
        <button onClick={triggerExcelUpload} className="secondary-btn" disabled={uploadingExcel}>
          {uploadingExcel ? "Uploading..." : "Upload Filled Excel"}
        </button>
        <button onClick={handleExportSubjects} className="secondary-btn">Export Subjects Excel</button>
        <button onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? "Hide Search" : "Show Search"}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleExcelUpload}
      />

      {uploadingExcel ? <div className="success-message">Uploading subjects from Excel. Please wait...</div> : null}
      {mutationMessage ? <div className="loading-message">{mutationMessage}</div> : null}
      {excelMessage ? <div className="success-message">{excelMessage}</div> : null}
      {excelError ? <div className="error-message">{excelError}</div> : null}

      {/* 🔽 Filters */}
      {showFilters && (
        <div className="filters-container">
          <input
            type="text"
            placeholder="Search by Name"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Search by Code"
            value={filterCode}
            onChange={(e) => setFilterCode(e.target.value)}
          />
          <select
            value={filterSem}
            onChange={(e) => setFilterSem(e.target.value)}
          >
            <option value="">All Semester/Class</option>
            {[...new Set(subjects.map((s) => s.sem))].map((sem) => (
              <option key={sem} value={sem}>
                Semester/Class {sem}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedSubjectIds.length > 0 ? (
        <div className="bulk-actions-bar">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              checked={allVisibleSubjectsSelected}
              ref={(input) => {
                if (input) input.indeterminate = !allVisibleSubjectsSelected && someVisibleSubjectsSelected;
              }}
              onChange={(e) => {
                const nextSelected = e.target.checked
                  ? Array.from(new Set([...selectedSubjectIds, ...filteredSubjectIds]))
                  : selectedSubjectIds.filter((id) => !filteredSubjectIds.includes(id));
                setSelectedSubjectIds(nextSelected);
              }}
            />
            Select all visible
          </label>
          <span className="bulk-selection-count">{selectedSubjectIds.length} selected</span>
          <button type="button" className="danger-btn" onClick={handleBulkDelete} disabled={bulkDeleting || Boolean(mutationMessage)}>
            Delete selected
          </button>
          <button type="button" className="secondary-btn" onClick={() => setSelectedSubjectIds([])} disabled={bulkDeleting || Boolean(mutationMessage)}>
            Clear selection
          </button>
        </div>
      ) : null}

      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : (
        <div className="table-responsive">
          <table className="styled-table">
          <thead>
            <tr>
              <th className="selection-column">
                <input
                  type="checkbox"
                  checked={allVisibleSubjectsSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = !allVisibleSubjectsSelected && someVisibleSubjectsSelected;
                  }}
                  onChange={(e) => setSelectedSubjectIds(e.target.checked ? filteredSubjectIds : [])}
                />
              </th>
              <th>Name</th>
              <th>Code</th>
              <th>Semester/Class</th>
              <th>Subject Type</th>
              <th>Classes/Week</th>
              <th>Assigned Classes</th>
              <th>Assigned Faculties</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.isArray(filteredSubjects) &&
              filteredSubjects.map((subject) => (
                <tr key={subject._id} className={selectedSubjectIds.includes(subject._id) ? "row-selected" : ""}>
                  <td className="selection-cell">
                    <input
                      type="checkbox"
                      checked={selectedSubjectIds.includes(subject._id)}
                      onChange={(e) => {
                        setSelectedSubjectIds((prev) =>
                          e.target.checked
                            ? Array.from(new Set([...prev, subject._id]))
                            : prev.filter((id) => id !== subject._id)
                        );
                      }}
                    />
                  </td>
                  <td style={{ width: '10%' }}>
                    {editId === subject._id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    ) : (
                      subject.name
                    )}
                  </td>
                  <td style={{ width: '10%' }}>
                    {editId === subject._id ? (
                      <input
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                      />
                    ) : (
                      subject.id
                    )}
                  </td>
                  <td>
                    {editId === subject._id ? (
                      <input
                        type="text"
                        value={editSem}
                        onChange={(e) => setEditSem(e.target.value)}
                      />
                    ) : (
                      subject.sem
                    )}
                  </td>
                  <td>
                    {editId === subject._id ? (
                      <select
                        value={editType}
                        onChange={(e) => setEditType(e.target.value)}
                        required
                      >
                        <option value="theory">Theory</option>
                        <option value="lab">Lab</option>
                        <option value="no_teacher">Not Single Teacher</option>
                      </select>
                    ) : (
                      subject.type
                    )}
                  </td>
                  <td>
                    {editId === subject._id ? (
                      <input
                        type="number"
                        min="1"
                        value={editClassesPerWeek}
                        onChange={(e) => setEditClassesPerWeek(e.target.value)}
                        placeholder="Optional"
                      />
                    ) : (
                      subject.classesPerWeek ?? "—"
                    )}
                  </td>
                  <td>
                    {assignments
                      .filter(a => a.subject?._id === subject._id)
                      .map(a => (
                        <div key={a._id}>{a.class?.name}</div>
                      ))}
                  </td>
                  <td>
                    {combos
                        .filter(c => c.subject?._id === subject._id)
                        .map(c => (
                            <div key={c._id}>{c.faculty?.name}</div>
                        ))}
                  </td>
                  <td className="actions-cell">
                    {editId === subject._id ? (
                      <div className="actions-buttons">
                        <button onClick={handleUpdate} className="primary-btn" disabled={Boolean(mutationMessage)}>
                          {mutationMessage ? "..." : "💾 Save"}
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="secondary-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          ❌ Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="actions-buttons">
                        <button
                          onClick={() => handleEdit(subject)}
                          className="primary-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDelete(subject._id)}
                          className="danger-btn"
                          disabled={Boolean(mutationMessage) || bulkDeleting}
                        >
                          {mutationMessage ? "..." : "🗑️ Delete"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

export default ManageSubject;
