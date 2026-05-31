import React, { useState, useContext } from "react";
import axios from "../../api/axios";
import DataContext from "../../context/DataContext";

const AddTeacher = () => {
  const { refetchData } = useContext(DataContext);
  const [name, setName] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "name") setName(value);
    if (name === "facultyId") setFacultyId(value);
  };

  const validate = () => {
    if (!name.trim()) return "Teacher name is required.";
    if (!facultyId.trim()) return "Faculty ID is required.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      await axios.post(`/faculties`, {
        name: name,
        id: facultyId,
      });

      setSuccess("Teacher added successfully!");
      setName("");
      setFacultyId("");
      refetchData();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add teacher.");
    }
    setLoading(false);
  };

  return (
    <div className="form-container">
      <h2>Add Teacher</h2>
      <form onSubmit={handleSubmit} className="styled-form">
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            name="name"
            placeholder="Faculty Name"
            value={name}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label>Faculty ID</label>
          <input
            type="text"
            name="facultyId"
            placeholder="Faculty ID"
            value={facultyId}
            onChange={handleChange}
            required
          />
        </div>
        <button type="submit" disabled={loading} className="primary-btn">
          {loading ? "Adding..." : "Add Teacher"}
        </button>
      </form>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
    </div>
  );
};

export default AddTeacher;
