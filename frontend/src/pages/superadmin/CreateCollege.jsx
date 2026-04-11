import React, { useState } from 'react';
import axios from '../../api/axios.jsx';
import './CreateCollege.css';

const CreateCollege = () => {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    collegeId: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

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
      const response = await axios.post('/api/superadmin/colleges', formData);
      setMessage('College created successfully!');
      setFormData({ name: '', code: '', collegeId: '' });
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to create college');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-college">
      <h1>Create College</h1>
      <form onSubmit={handleSubmit} className="college-form">
        <div className="form-group">
          <label htmlFor="name">College Name</label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="code">College Code</label>
          <input
            type="text"
            id="code"
            name="code"
            value={formData.code}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="collegeId">College ID</label>
          <input
            type="text"
            id="collegeId"
            name="collegeId"
            value={formData.collegeId}
            onChange={handleChange}
            required
          />
          <small>Will be normalized to lowercase</small>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create College'}
        </button>
      </form>
      {message && <p className="message">{message}</p>}
      <button onClick={() => window.location.href = '/superadmin'} className="back-btn">Back to Dashboard</button>
    </div>
  );
};

export default CreateCollege;