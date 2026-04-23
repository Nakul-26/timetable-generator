import React, { useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api/axios";
import DataContext from "../../context/DataContext";
import * as XLSX from "xlsx";

const ManageTeacher = () => {
  const { faculties, classes, combos, loading, error, refetchData } = useContext(DataContext);
  const [editId, setEditId] = useState(null);
  const [excelMessage, setExcelMessage] = useState("");
  const [excelError, setExcelError] = useState("");
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [mutationMessage, setMutationMessage] = useState("");
  const fileInputRef = useRef(null);

  // Edit form states
  const [editName, setEditName] = useState("");
  const [editFacultyId, setEditFacultyId] = useState("");

  // 🔍 Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [filterFacultyId, setFilterFacultyId] = useState("");

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

  const buildTemplateWorkbook = () => {
    const rows = [
      ["name", "id"],
      ["", ""]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Teachers");
    return workbook;
  };

  const handleDownloadTemplate = () => {
    clearExcelStatus();
    const workbook = buildTemplateWorkbook();
    XLSX.writeFile(workbook, "teachers_template.xlsx");
    setExcelMessage("Template downloaded.");
  };

  const handleExportTeachers = () => {
    clearExcelStatus();
    const rows = faculties.map((teacher) => {
      const assignedClassNames = classes
        .filter((cls) => cls.faculties?.some((f) => f._id === teacher._id))
        .map((cls) => cls.name)
        .join(", ");
      const assignedSubjectNames = combos
        .filter((combo) => combo.faculty?._id === teacher._id)
        .map((combo) => combo.subject?.name)
        .filter(Boolean)
        .join(", ");

      return {
        name: teacher.name || "",
        id: teacher.id || "",
        assignedClasses: assignedClassNames,
        assignedSubjects: assignedSubjectNames
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Teachers");
    XLSX.writeFile(workbook, "teachers_export.xlsx");
    setExcelMessage("Teachers exported.");
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
        const name = getCellValue(row, ["name", "Name", "teacherName", "Teacher Name"]);
        const id = getCellValue(row, ["id", "ID", "facultyId", "Faculty ID", "teacherId", "Teacher ID"]);
        return { name, id };
      });

      const validRows = normalizedRows.filter((row) => row.name && row.id);
      if (validRows.length === 0) {
        throw new Error("No valid rows found. Required columns: name and id.");
      }

      const duplicateIds = new Set();
      const seenIds = new Set();
      validRows.forEach((row) => {
        const key = row.id.toLowerCase();
        if (seenIds.has(key)) duplicateIds.add(row.id);
        seenIds.add(key);
      });
      if (duplicateIds.size > 0) {
        throw new Error(`Duplicate teacher IDs in file: ${Array.from(duplicateIds).join(", ")}`);
      }

      const existingById = new Map(
        faculties
          .filter((f) => f?.id)
          .map((f) => [String(f.id).toLowerCase(), f])
      );

      let createdCount = 0;
      let updatedCount = 0;

      for (const row of validRows) {
        const existing = existingById.get(row.id.toLowerCase());
        if (existing) {
          await API.put(`/faculties/${existing._id}`, { name: row.name, id: row.id });
          updatedCount += 1;
        } else {
          await API.post("/faculties", { name: row.name, id: row.id });
          createdCount += 1;
        }
      }

      refetchData(["faculties"]);
      setExcelMessage(`Upload complete. Created: ${createdCount}, Updated: ${updatedCount}.`);
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to upload teachers from Excel.";
      setExcelError(message);
    } finally {
      setUploadingExcel(false);
      if (event.target) event.target.value = "";
    }
  };

  const handleAddTeacher = () => {
    navigate("/teacher/add");
  };

  const handleEditAvailability = () => {
    navigate("/teacher-availability");
  };

  const handleEditPreferences = () => {
    navigate("/teacher-preferences");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this teacher?")) return;
    setMutationMessage("Deleting teacher. Please wait...");
    try {
      await API.delete(`/faculties/${id}`);
      refetchData(['faculties']);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
    }
  };

  const handleEdit = (teacher) => {
    setEditId(teacher._id);
    setEditName(teacher.name);
    setEditFacultyId(teacher.id);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setMutationMessage("Saving teacher changes. Please wait...");
    try {
      const updatedTeacher = { name: editName, id: editFacultyId };
      await API.put(`/faculties/${editId}`, updatedTeacher);

      setEditId(null);
      setEditName("");
      setEditFacultyId("");
      refetchData(['faculties']);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
    }
  };

  // 🔎 Apply filters
  const filteredTeachers = faculties.filter((t) => {
    return (
      (!filterName || (t.name && t.name.toLowerCase().includes(filterName.toLowerCase()))) &&
      (!filterFacultyId ||
        (t.id && t.id.toLowerCase().includes(filterFacultyId.toLowerCase())))
    );
  });

  const resetFilters = () => {
    setFilterName("");
    setFilterFacultyId("");
  };

  return (
    <div className="manage-container">
      <h2>Manage Teachers</h2>
      <div className="actions-bar">
        <button onClick={handleAddTeacher}>Add Teacher</button>
        <button onClick={handleEditAvailability} className="secondary-btn">Edit Availability</button>
        <button onClick={handleEditPreferences} className="secondary-btn">Edit Preferences</button>
        <button onClick={handleDownloadTemplate} className="secondary-btn">Download Excel Template</button>
        <button onClick={triggerExcelUpload} className="secondary-btn" disabled={uploadingExcel}>
          {uploadingExcel ? "Uploading..." : "Upload Filled Excel"}
        </button>
        <button onClick={handleExportTeachers} className="secondary-btn">Export Teachers Excel</button>
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

      {uploadingExcel ? <div className="success-message">Uploading teachers from Excel. Please wait...</div> : null}
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
            placeholder="Search by Faculty ID"
            value={filterFacultyId}
            onChange={(e) => setFilterFacultyId(e.target.value)}
          />
          <button onClick={resetFilters} className="secondary-btn">
            Reset
          </button>
        </div>
      )}

      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : (
        <table className="styled-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Faculty ID</th>
              <th>Assigned Classes</th>
              <th>Assigned Subjects</th>
              <th>Blocked Slots</th>
              <th>Preferences</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.isArray(filteredTeachers) &&
              filteredTeachers.map((teacher) => (
                <tr key={teacher._id}>
                  <td>
                    {editId === teacher._id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    ) : (
                      teacher.name
                    )}
                  </td>
                  <td>
                    {editId === teacher._id ? (
                      <input
                        type="text"
                        value={editFacultyId}
                        onChange={(e) => setEditFacultyId(e.target.value)}
                      />
                    ) : (
                      teacher.id
                    )}
                  </td>
                  <td>
                    {classes
                        .filter(cls => cls.faculties?.some(f => f._id === teacher._id))
                        .map(cls => (
                            <div key={cls._id}><strong>{cls.name}</strong></div>
                        ))}
                  </td>
                  <td>
                    {combos
                        .filter(c => c.faculty?._id === teacher._id)
                        .map(c => (
                            <div key={c._id}>{c.subject?.name}</div>
                        ))}
                  </td>
                  <td>{Array.isArray(teacher.unavailableSlots) ? teacher.unavailableSlots.length : 0}</td>
                  <td>
                    {teacher.preferences?.avoidFirstPeriod || teacher.preferences?.avoidLastPeriod || teacher.preferences?.maxConsecutive || (teacher.preferences?.preferredDays || []).length > 0
                      ? "Configured"
                      : "Default"}
                  </td>
                  <td className="actions-cell">
                    {editId === teacher._id ? (
                      <div className="actions-buttons">
                        <button
                          onClick={handleEditSubmit}
                          className="primary-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          {mutationMessage ? "Working..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="secondary-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="actions-buttons">
                        <button
                          onClick={() => handleEdit(teacher)}
                          className="primary-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(teacher._id)}
                          className="danger-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          {mutationMessage ? "Working..." : "Delete"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default ManageTeacher;
