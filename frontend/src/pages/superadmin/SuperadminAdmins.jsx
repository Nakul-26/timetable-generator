import React, { useEffect, useState } from 'react';
import axios from '../../api/axios.jsx';
import './SuperadminDashboard.css';

const SuperadminAdmins = () => {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    try {
      const res = await axios.get('/superadmin/admins');
      setAdmins(res.data.admins || []);
    } catch (err) {
      setError('Failed to load admins');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading admins...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="superadmin-dashboard">
      <h1>Admin Management</h1>
      <div className="colleges-list">
        <h2>Admins ({admins.length})</h2>
        {admins.length === 0 ? (
          <p>No admins found.</p>
        ) : (
          <div className="colleges-grid">
            {admins.map(a => (
              <div key={a._id} className="college-card">
                <h3>{a.email}</h3>
                <p><strong>Role:</strong> {a.role}</p>
                <p><strong>College ID:</strong> {a.collegeId || '—'}</p>
                <p><strong>Created:</strong> {new Date(a.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperadminAdmins;
