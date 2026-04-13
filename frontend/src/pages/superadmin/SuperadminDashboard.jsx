import React, { useState, useEffect } from 'react';
import axios from '../../api/axios.jsx';
import './SuperadminDashboard.css';

const SuperadminDashboard = () => {
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchColleges();
  }, []);

  const fetchColleges = async () => {
    try {
      const response = await axios.get('/superadmin/colleges');
      setColleges(response.data.colleges || []);
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
      <h1>Superadmin Dashboard</h1>
      <div className="dashboard-actions">
        <button onClick={() => window.location.href = '/superadmin/colleges'}>Manage Colleges</button>
        <button onClick={() => window.location.href = '/superadmin/admins'}>Manage Admins</button>
      </div>
      <div className="colleges-list">
        <h2>Colleges ({colleges.length})</h2>
        {colleges.length === 0 ? (
          <p>No colleges found. Create your first college!</p>
        ) : (
          <div className="colleges-grid">
            {colleges.map(college => (
              <div key={college._id} className="college-card">
                <h3>{college.name}</h3>
                <p><strong>Code:</strong> {college.code}</p>
                <p><strong>College ID:</strong> {college.collegeId}</p>
                <p><strong>Created:</strong> {new Date(college.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperadminDashboard;