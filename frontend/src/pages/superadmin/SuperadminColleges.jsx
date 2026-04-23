import React, { useEffect, useState } from 'react';
import axios from '../../api/axios.jsx';
import './SuperadminDashboard.css';

const SuperadminColleges = () => {
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    fetchColleges();
  }, []);

  const fetchColleges = async () => {
    try {
      const res = await axios.get('/superadmin/colleges');
      setColleges(res.data.colleges || []);
    } catch (err) {
      setError('Failed to load colleges');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading colleges...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="superadmin-dashboard">
      <div className="header">
        <h1>College Management</h1>
        <div className="toolbar">
          <span className="count-badge">{colleges.length} colleges</span>
          <button className="btn btn-edit" onClick={async () => {
            const name = window.prompt('College name') || '';
            if (!name) return;
            const code = window.prompt('College code') || '';
            const collegeId = window.prompt('College ID (unique)') || '';
            try {
              setActionMessage("Creating college. Please wait...");
              await axios.post('/superadmin/colleges', { name, code, collegeId });
              fetchColleges();
            } catch (err) { alert(err?.response?.data?.error || 'Create failed'); }
            finally { setActionMessage(""); }
          }}>New college</button>
        </div>
      </div>
      {actionMessage ? <div className="loading-message" style={{ marginBottom: 12 }}>{actionMessage}</div> : null}
      <div className="colleges-list">
        <h2>Colleges</h2>
        {colleges.length === 0 ? (
          <p>No colleges found.</p>
        ) : (
          <div className="colleges-grid">
            {colleges.map(college => (
              <div key={college._id} className="college-card">
                <h3>{college.name}</h3>
                <p><strong>Code:</strong> {college.code}</p>
                <p><strong>College ID:</strong> {college.collegeId}</p>
                <p><strong>Created:</strong> {new Date(college.createdAt).toLocaleDateString()}</p>
                <div className="actions">
                  <button className="btn btn-edit" onClick={async () => {
                    const name = window.prompt('New name', college.name) || college.name;
                    const code = window.prompt('New code', college.code) || college.code;
                    const cid = window.prompt('New collegeId', college.collegeId) || college.collegeId;
                    try {
                      setActionMessage("Updating college. Please wait...");
                      await axios.put(`/superadmin/colleges/${college._id}`, { name, code, collegeId: cid });
                      fetchColleges();
                    } catch (err) { alert(err?.response?.data?.error || 'Update failed'); }
                    finally { setActionMessage(""); }
                  }}>Edit</button>
                  <button className="btn btn-delete" onClick={async () => {
                    if (!confirm('Delete this college? This cannot be undone.')) return;
                    try {
                      setActionMessage("Deleting college. Please wait...");
                      await axios.delete(`/superadmin/colleges/${college._id}`);
                      fetchColleges();
                    }
                    catch (err) { alert(err?.response?.data?.error || 'Delete failed'); }
                    finally { setActionMessage(""); }
                  }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperadminColleges;
