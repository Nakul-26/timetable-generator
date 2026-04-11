import React, { useEffect, useState } from 'react';
import axios from '../../api/axios.jsx';
import './SuperadminDashboard.css';

const SuperadminColleges = () => {
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      <h1>College Management</h1>
      <div className="colleges-list">
        <h2>Colleges ({colleges.length})</h2>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperadminColleges;
