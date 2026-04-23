import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const SavedTimetables = () => {
    const [timetables, setTimetables] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionMessage, setActionMessage] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const fetchTimetables = async () => {
            try {
                setIsLoading(true);
                const response = await api.get('/timetables');
                setTimetables(response.data);
                setError(null);
            } catch (err) {
                setError('Failed to fetch saved timetables. Please try again later.');
                console.error('Error fetching timetables:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTimetables();
    }, []);

    if (isLoading) {
        return <div>Loading timetables...</div>;
    }

    if (error) {
        return <div style={{ color: 'red' }}>{error}</div>;
    }

    const handleViewClick = (id) => {
        setActionMessage('Opening timetable editor. Please wait...');
        navigate(`/timetable/${id}`);
    };

    return (
        <div className="manage-container">
            <h2>Saved Timetables</h2>
            {actionMessage ? <div className="loading-message" style={{ marginBottom: 12 }}>{actionMessage}</div> : null}
            {timetables.length === 0 ? (
                <p>No saved timetables found.</p>
            ) : (
                <table className="styled-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Source</th>
                            <th>Status</th>
                            <th>Version</th>
                            <th>Saved At</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {timetables.map((tt) => (
                            <tr key={tt._id}>
                                <td>{tt.name}</td>
                                <td>{tt.source}</td>
                                <td>{tt.status || 'draft'}</td>
                                <td>{tt.edit_version || 1}</td>
                                <td>{new Date(tt.createdAt).toLocaleString()}</td>
                                <td>
                                    <button
                                        className="primary-btn"
                                        onClick={() => handleViewClick(tt._id)}
                                    >
                                        View
                                    </button>
                                    {(tt.source === 'generator' || tt.status === 'generated') && (
                                        <button
                                            className="secondary-btn"
                                            onClick={() => {
                                                setActionMessage('Opening timetable editor. Please wait...');
                                                navigate(`/manual-timetable?sourceTimetableId=${tt._id}`);
                                            }}
                                            style={{ marginLeft: '8px' }}
                                        >
                                            Edit
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default SavedTimetables;
