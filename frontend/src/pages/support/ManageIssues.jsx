import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API from "../../api/axios";
import "../../styles/App.css";

const ManageIssues = () => {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetchIssues();
  }, []);

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const res = await API.get("/issues");
      setIssues(res.data);
      setLoading(false);
    } catch (err) {
      setError("Failed to fetch issues.");
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "Open": return "#e74c3c";
      case "In Progress": return "#f39c12";
      case "Resolved": return "#27ae60";
      case "Closed": return "#7f8c8d";
      default: return "#333";
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case "Critical": return "#c0392b";
      case "High": return "#e67e22";
      case "Medium": return "#f1c40f";
      case "Low": return "#2ecc71";
      default: return "#333";
    }
  };

  return (
    <div className="manage-container">
      <h2>Support Tickets</h2>
      <div className="actions-bar">
        <button onClick={() => navigate("/support/create")}>Report New Issue</button>
        <button onClick={fetchIssues} className="secondary-btn">Refresh</button>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : issues.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>No tickets found.</div>
      ) : (
        <div className="table-responsive">
          <table className="styled-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue._id}>
                  <td>{issue.title}</td>
                  <td>{issue.category}</td>
                  <td>
                    <span style={{ color: getPriorityColor(issue.priority), fontWeight: 'bold' }}>
                      {issue.priority}
                    </span>
                  </td>
                  <td>
                    <span style={{ 
                      backgroundColor: getStatusColor(issue.status), 
                      color: '#fff', 
                      padding: '4px 8px', 
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 'bold'
                    }}>
                      {issue.status}
                    </span>
                  </td>
                  <td>{issue.creatorEmail}</td>
                  <td>{new Date(issue.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button 
                      className="primary-btn"
                      onClick={() => navigate(`/support/issue/${issue._id}`)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ManageIssues;
