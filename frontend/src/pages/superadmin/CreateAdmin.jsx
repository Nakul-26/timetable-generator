import React, { useState, useEffect } from 'react';
import axios from '../../api/axios.jsx';
import './CreateAdmin.css';

const CreateAdmin = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    collegeId: ''
  });
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchColleges();
  }, []);

  const fetchColleges = async () => {
    try {
      const response = await axios.get('/api/superadmin/colleges');
      setColleges(response.data.colleges || []);
    } catch (err) {
      console.error('Failed to load colleges', err);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await axios.post('/api/superadmin/admins', formData);
      setMessage('Admin created successfully!');
      setFormData({ email: '', password: '', collegeId: '' });
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to create admin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-admin">
      <h1>Create Admin</h1>
      <form onSubmit={handleSubmit} className="admin-form">
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            minLength="8"
          />
        </div>
        <div className="form-group">
          <label htmlFor="collegeId">College</label>
          <select
            id="collegeId"
            name="collegeId"
            value={formData.collegeId}
            onChange={handleChange}
            required
          >
            <option value="">Select a college</option>
            {colleges.map(college => (
              <option key={college._id} value={college.collegeId}>
                {college.name} ({college.collegeId})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Admin'}
        </button>
      </form>
      {message && <p className="message">{message}</p>}
      <button onClick={() => window.location.href = '/superadmin'} className="back-btn">Back to Dashboard</button>
    </div>
  );
};

export default CreateAdmin;