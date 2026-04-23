import React, { useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/axios";
import AssignModal from "./AssignModal";
import DataContext from "../../context/DataContext";
import * as XLSX from "xlsx";

function ManageClass() {
  const { classes, subjects, faculties, assignments, loading, error, refetchData } = useContext(DataContext);
  const [editId, setEditId] = useState(null);
  const [excelMessage, setExcelMessage] = useState("");
  const [excelError, setExcelError] = useState("");
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [mutationMessage, setMutationMessage] = useState("");
  const fileInputRef = useRef(null);

  // State for the assignment modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);

  // State variables for editing a class
  const [editName, setEditName] = useState("");
  const [editSemester, setEditSemester] = useState("");
  const [editSection, setEditSection] = useState("");
  const [editClassId, setEditClassId] = useState("");
  const [editDaysPerWeek, setEditDaysPerWeek] = useState(5);

  // 🔍 Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [filterClassId, setFilterClassId] = useState("");
  const [filterName, setFilterName] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [filterSemester, setFilterSemester] = useState("");

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

  const parseDaysPerWeek = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 5;
    const rounded = Math.round(parsed);
    return Math.max(1, Math.min(7, rounded));
  };

  const handleDownloadTemplate = () => {
    clearExcelStatus();
    const rows = [
      ["id", "name", "sem", "section", "days_per_week"],
      ["", "", "", "", "5"]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Classes");
    XLSX.writeFile(workbook, "classes_template.xlsx");
    setExcelMessage("Template downloaded.");
  };

  const handleExportClasses = () => {
    clearExcelStatus();
    const rows = classes.map((classItem) => {
      const assignedSubjects = assignments
        .filter((a) => a.class?._id === classItem._id)
        .map((a) => a.subject?.name)
        .filter(Boolean)
        .join(", ");
      const assignedFaculties = (classItem.faculties || [])
        .map((f) => f?.name)
        .filter(Boolean)
        .join(", ");

      return {
        id: classItem.id || "",
        name: classItem.name || "",
        sem: classItem.sem || "",
        section: classItem.section || "",
        days_per_week: classItem.days_per_week || 5,
        assignedSubjects,
        assignedFaculties
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Classes");
    XLSX.writeFile(workbook, "classes_export.xlsx");
    setExcelMessage("Classes exported.");
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

      const normalizedRows = rawRows.map((row) => ({
        id: getCellValue(row, ["id", "ID", "classId", "Class ID"]),
        name: getCellValue(row, ["name", "Name", "className", "Class Name"]),
        sem: getCellValue(row, ["sem", "Sem", "semester", "Semester", "class", "Class"]),
        section: getCellValue(row, ["section", "Section"]),
        days_per_week: parseDaysPerWeek(getCellValue(row, ["days_per_week", "daysPerWeek", "Days Per Week"]))
      }));

      const validRows = normalizedRows.filter((row) => row.id && row.name && row.sem && row.section);
      if (validRows.length === 0) {
        throw new Error("No valid rows found. Required columns: id, name, sem, section.");
      }

      const duplicateIds = new Set();
      const seenIds = new Set();
      validRows.forEach((row) => {
        const key = row.id.toLowerCase();
        if (seenIds.has(key)) duplicateIds.add(row.id);
        seenIds.add(key);
      });
      if (duplicateIds.size > 0) {
        throw new Error(`Duplicate class IDs in file: ${Array.from(duplicateIds).join(", ")}`);
      }

      const existingById = new Map(
        classes
          .filter((c) => c?.id)
          .map((c) => [String(c.id).toLowerCase(), c])
      );

      let createdCount = 0;
      let updatedCount = 0;
      for (const row of validRows) {
        const existing = existingById.get(row.id.toLowerCase());
        if (existing) {
          await api.put(`/classes/${existing._id}`, row);
          updatedCount += 1;
        } else {
          await api.post("/classes", row);
          createdCount += 1;
        }
      }

      refetchData(["classes"]);
      setExcelMessage(`Upload complete. Created: ${createdCount}, Updated: ${updatedCount}.`);
    } catch (err) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to upload classes from Excel.";
      setExcelError(message);
    } finally {
      setUploadingExcel(false);
      if (event.target) event.target.value = "";
    }
  };

  const handleAddClass = () => {
    navigate("/class/add");
  };

  const handleOpenModal = (klass) => {
    setSelectedClass(klass);
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this class?")) return;
    setMutationMessage("Deleting class. Please wait...");
    try {
      await api.delete(`/classes/${id}`);
      refetchData(['classes']);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
    }
  };

  const handleEdit = (classItem) => {
    setEditId(classItem._id);
    setEditName(classItem.name);
    setEditSection(classItem.section);
    setEditSemester(classItem.sem);
    setEditClassId(classItem.id);
    setEditDaysPerWeek(classItem.days_per_week || 5);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setMutationMessage("Saving class changes. Please wait...");
    try {
      const updatedData = {
        name: editName,
        sem: editSemester,
        section: editSection,
        id: editClassId,
        days_per_week: editDaysPerWeek,
      };
      await api.put(`/classes/${editId}`, updatedData);
      setEditId(null);
      refetchData(['classes']);
    } catch (err) {
      console.log(`Error: ${err.message}`);
    } finally {
      setMutationMessage("");
    }
  };

  // 🔎 Apply filters
  const filteredClasses = classes.filter((c) => {
    return (
      (!filterClassId || (c.id && c.id.toLowerCase().includes(filterClassId.toLowerCase()))) &&
      (!filterName || (c.name && c.name.toLowerCase().includes(filterName.toLowerCase()))) &&
      (!filterSection || (c.section && c.section.toLowerCase().includes(filterSection.toLowerCase()))) &&
      (!filterSemester || (c.sem && String(c.sem).toLowerCase().includes(filterSemester.toLowerCase())))
    );
  });

  const resetFilters = () => {
    setFilterClassId("");
    setFilterName("");
    setFilterSection("");
    setFilterSemester("");
  };

  return (
    <div className="manage-container">
      <h2>Manage Classes</h2>
      <div className="actions-bar">
        <button onClick={handleAddClass}>Add new class</button>
        <button onClick={handleDownloadTemplate} className="secondary-btn">Download Excel Template</button>
        <button onClick={triggerExcelUpload} className="secondary-btn" disabled={uploadingExcel}>
          {uploadingExcel ? "Uploading..." : "Upload Filled Excel"}
        </button>
        <button onClick={handleExportClasses} className="secondary-btn">Export Classes Excel</button>
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

      {uploadingExcel ? <div className="success-message">Uploading classes from Excel. Please wait...</div> : null}
      {mutationMessage ? <div className="loading-message">{mutationMessage}</div> : null}
      {excelMessage ? <div className="success-message">{excelMessage}</div> : null}
      {excelError ? <div className="error-message">{excelError}</div> : null}

      {/* 🔽 Filters */}
      {showFilters && (
        <div className="filters-container">
          <input
            type="text"
            placeholder="Search by Class ID"
            value={filterClassId}
            onChange={(e) => setFilterClassId(e.target.value)}
          />
          <input
            type="text"
            placeholder="Search by Name"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Search by Section"
            value={filterSection}
            onChange={(e) => setFilterSection(e.target.value)}
          />
          <input
            type="text"
            placeholder="Search by Semester/Class"
            value={filterSemester}
            onChange={(e) => setFilterSemester(e.target.value)}
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
              <th>Class ID</th>
              <th>Name</th>
              <th>Section</th>
              <th>Semester/Class</th>
              <th>Days/Week</th>
              <th>Assigned Subjects</th>
              <th>Assigned Faculties</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.isArray(filteredClasses) &&
              filteredClasses.map((classItem) => (
                <tr key={classItem._id}>
                  <td>
                    {editId === classItem._id ? (
                      <input
                        type="text"
                        value={editClassId}
                        onChange={(e) => setEditClassId(e.target.value)}
                      />
                    ) : (
                      classItem.id
                    )}
                  </td>
                  <td>
                    {editId === classItem._id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    ) : (
                      classItem.name
                    )}
                  </td>
                  <td>
                    {editId === classItem._id ? (
                      <input
                        type="text"
                        value={editSection}
                        onChange={(e) => setEditSection(e.target.value)}
                      />
                    ) : (
                      classItem.section
                    )}
                  </td>
                  <td>
                    {editId === classItem._id ? (
                      <input
                        type="text"
                        value={editSemester}
                        onChange={(e) => setEditSemester(e.target.value)}
                      />
                    ) : (
                      classItem.sem
                    )}
                  </td>
                  <td>
                    {editId === classItem._id ? (
                      <input
                        type="number"
                        value={editDaysPerWeek}
                        onChange={(e) => setEditDaysPerWeek(e.target.value)}
                      />
                    ) : (
                      classItem.days_per_week || 5
                    )}
                  </td>
                  <td>
                    {assignments
                      .filter(a => a.class?._id === classItem._id)
                      .map(a => (
                        <div key={a._id}>{a.subject?.name}</div>
                      ))}
                  </td>
                  <td>
                      {(classItem.faculties || []).map(f => (
                          <div key={f._id}>{f.name}</div>
                      ))}
                  </td>
                  <td className="actions-cell">
                    {editId === classItem._id ? (
                      <div className="actions-buttons">
                        <button onClick={handleEditSubmit} className="primary-btn" disabled={Boolean(mutationMessage)}>
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
                          onClick={() => handleOpenModal(classItem)}
                          className="secondary-btn"
                        >
                          Assignments
                        </button>
                        <button
                          onClick={() => handleEdit(classItem)}
                          className="primary-btn"
                          disabled={Boolean(mutationMessage)}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(classItem._id)}
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
      {isModalOpen && (
        <AssignModal
            klass={selectedClass}
            subjects={subjects}
            faculties={faculties}
            onClose={() => setIsModalOpen(false)}
            onSave={() => {
                setIsModalOpen(false);
            }}
        />
      )}
    </div>
  );
}

export default ManageClass;
