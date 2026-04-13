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
                <div style={{ marginTop: 8 }}>
                  <button onClick={async () => {
                    const email = window.prompt('New email', a.email) || a.email;
                    const pwd = window.prompt('New password (leave blank to keep)', '') || undefined;
                    const cid = window.prompt('College ID (leave blank for none)', a.collegeId || '') || '';
                    try {
                      const body = { email };
                      if (pwd) body.password = pwd;
                      body.collegeId = cid || null;
                      await axios.put(`/superadmin/admins/${a._id}`, body);
                      fetchAdmins();
                    } catch (err) { alert(err?.response?.data?.error || 'Update failed'); }
                  }}>Edit</button>
                  <button style={{ marginLeft: 8 }} onClick={async () => {
                    if (!confirm('Delete this admin?')) return;
                    try { await axios.delete(`/superadmin/admins/${a._id}`); fetchAdmins(); }
                    catch (err) { alert(err?.response?.data?.error || 'Delete failed'); }
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

export default SuperadminAdmins;
