import React, { useState, useContext } from "react";
import axios from "../../api/axios";
import DataContext from "../../context/DataContext";

function AddSubject() {
  const { classes, refetchData } = useContext(DataContext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sem, setSem] = useState("");
  const [type, setType] = useState("theory");
  const [classesPerWeek, setClassesPerWeek] = useState("");
  const [combinedClasses, setCombinedClasses] = useState([]);
  const [isElective, setIsElective] = useState(false);

  const handleChange = (e) => {
    const { name, value, checked } = e.target;
    if (name === "name") setName(value);
    if (name === "code") setCode(value);
    if (name === "sem") setSem(value);
    if (name === "type") setType(value);
    if (name === "isElective") setIsElective(checked);
    if (name === "combinedClasses") {
      if (checked) {
        setCombinedClasses([...combinedClasses, value]);
      } else {
        setCombinedClasses(combinedClasses.filter((id) => id !== value));
      }
    }
  };

  const validate = () => {
    if (!name.trim()) return "Subject name is required.";
    if (!code.trim()) return "Subject code is required.";
    if (!sem.trim()) return "Semester/Class is required.";
    if (!type.trim()) return "subject type are required";
    if (classesPerWeek !== "") {
      const parsedClassesPerWeek = Number(classesPerWeek);
      if (!Number.isFinite(parsedClassesPerWeek) || parsedClassesPerWeek < 1) {
        return "Classes per week must be at least 1.";
      }
    }
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
      await axios.post("/subjects", {
        name,
        id: code,
        sem,
        type: type,
        classesPerWeek: classesPerWeek === "" ? undefined : Number(classesPerWeek),
        combined_classes: combinedClasses,
        isElective,
      });
      setSuccess("Subject added successfully!");
      setName("");
      setCode("");
      setSem("");
      setType("theory");
      setClassesPerWeek("");
      setCombinedClasses([]);
      setIsElective(false);
      refetchData();
    } catch {
      setError("Failed to add subject.");
    }
    setLoading(false);
  };

  return (
    <div className="form-container">
      <h2>Add Subject</h2>
      <form onSubmit={handleSubmit} className="styled-form">
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            name="name"
            placeholder="Subject Name"
            value={name}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label>Subject Code</label>
          <input
            type="text"
            name="code"
            placeholder="Subject Code"
            value={code}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label>Semester/Class</label>
          <input
            type="text"
            name="sem"
            placeholder="Semester/Class"
            value={sem}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label>Classes per Week</label>
          <input
            type="number"
            name="classesPerWeek"
            min="1"
            placeholder="Optional default"
            value={classesPerWeek}
            onChange={(e) => setClassesPerWeek(e.target.value)}
          />
          <small>Used as a default when assigning this subject to classes or teachers.</small>
        </div>

       <div className="form-group">
        <label>Subject Type</label>
        <select
          name="type"
          onChange={handleChange}
          required
          defaultValue="theory"
        >
          <option value="theory">Theory</option>
          <option value="lab">Lab</option>
          <option value="no_teacher">Not Single Teacher</option>
        </select>
      </div>
      <div className="form-group elective-highlight-group">
        <label className="checkbox-label elective-highlight-label">
          <input
            type="checkbox"
            name="isElective"
            checked={isElective}
            onChange={handleChange}
          />
          Mark as Elective Subject
        </label>
        <small>This subject will be treated as elective in timetable rules.</small>
      </div>
      <div className="form-group">
          <label>Combined Classes</label>
          <div className="form-checkbox-group">
            {classes.map((c) => (
              <label key={c._id} className="checkbox-label">
                <input
                  type="checkbox"
                  name="combinedClasses"
                  value={c._id}
                  checked={combinedClasses.includes(c._id)}
                  onChange={handleChange}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" disabled={loading} className="primary-btn">
          {loading ? "Adding..." : "Add Subject"}
        </button>
      </form>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
    </div>
  );
}

export default AddSubject;
