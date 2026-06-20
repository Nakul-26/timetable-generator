import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import '../styles/App.css'; // Leverage existing global styles

const Generations = () => {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionMessage, setActionMessage] = useState('');
    const navigate = useNavigate();

    const fetchJobs = async (silent = false) => {
        try {
            if (!silent) setIsLoading(true);
            const response = await api.get('/generations');
            setJobs(response.data);
            setError(null);
        } catch (err) {
            console.error('Error fetching generation jobs:', err);
            if (!silent) {
                setError(err.response?.data?.error || 'Failed to fetch generations. Please try again later.');
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    // Poll if there are any active (running or pending) jobs
    useEffect(() => {
        fetchJobs();

        const interval = setInterval(() => {
            const hasActiveJobs = jobs.some(
                (job) => job.status === 'running' || job.status === 'pending'
            );
            if (hasActiveJobs) {
                fetchJobs(true);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [jobs.some((job) => job.status === 'running' || job.status === 'pending')]);

    const handleStopGeneration = async (id) => {
        try {
            setActionMessage('Stopping generation job...');
            await api.post(`/stop-generator/${id}`);
            setActionMessage('Stop signal sent successfully.');
            setTimeout(() => setActionMessage(''), 3000);
            fetchJobs(true);
        } catch (err) {
            console.error('Failed to stop generation:', err);
            setActionMessage('Failed to stop generation.');
            setTimeout(() => setActionMessage(''), 3000);
        }
    };

    const handleDeleteGeneration = async (id) => {
        if (!window.confirm('Are you sure you want to delete this generation history? This will also delete any saved timetables generated from this run.')) {
            return;
        }
        try {
            setActionMessage('Deleting generation and associated results...');
            await api.delete(`/generations/${id}`);
            setActionMessage('Generation history deleted.');
            setTimeout(() => setActionMessage(''), 3000);
            fetchJobs(true);
        } catch (err) {
            console.error('Failed to delete generation:', err);
            setActionMessage('Failed to delete generation.');
            setTimeout(() => setActionMessage(''), 3000);
        }
    };

    const handleLoadGeneration = (id) => {
        // Redirect to /timetable with query parameter loadTaskId
        navigate(`/timetable?loadTaskId=${id}`);
    };

    const getStatusPillClass = (status) => {
        switch (status) {
            case 'completed': return 'status-pillcompleted';
            case 'running': return 'status-pillrunning';
            case 'pending': return 'status-pillpending';
            case 'failed': return 'status-pillfailed';
            case 'cancelled': return 'status-pillcancelled';
            default: return '';
        }
    };

    const getStatusPillStyle = (status) => {
        const base = {
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: '600',
            display: 'inline-block',
            textAlign: 'center'
        };
        switch (status) {
            case 'completed':
                return { ...base, backgroundColor: '#e6f7ed', color: '#107c41' };
            case 'running':
                return { ...base, backgroundColor: '#e8f0fe', color: '#1a73e8', animation: 'pulse 2s infinite' };
            case 'pending':
                return { ...base, backgroundColor: '#fef7e0', color: '#b06000' };
            case 'failed':
                return { ...base, backgroundColor: '#fce8e6', color: '#c5221f' };
            case 'cancelled':
                return { ...base, backgroundColor: '#f1f3f4', color: '#5f6368' };
            default:
                return base;
        }
    };

    if (isLoading) {
        return (
            <div className="manage-container" style={{ padding: '40px', textAlign: 'center' }}>
                <div className="loading-spinner" style={{ fontSize: '1.2rem', color: '#5f6368' }}>
                    Loading generation history...
                </div>
            </div>
        );
    }

    return (
        <div className="manage-container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: '700', color: '#202124' }}>Generations History</h2>
                    <p style={{ margin: '4px 0 0 0', color: '#5f6368', fontSize: '0.95rem' }}>
                        Manage past timetable runs, track active generator tasks, and restore configurations.
                    </p>
                </div>
                <button 
                    className="primary-btn"
                    onClick={() => navigate('/timetable')}
                    style={{ padding: '10px 20px', borderRadius: '8px', fontSize: '0.95rem' }}
                >
                    New Generation
                </button>
            </div>

            {actionMessage && (
                <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#e8f0fe',
                    color: '#1a73e8',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    fontWeight: '500',
                    boxShadow: '0 1px 2px 0 rgba(60,64,67,0.3)',
                    transition: 'all 0.3s ease'
                }}>
                    {actionMessage}
                </div>
            )}

            {error && (
                <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#fce8e6',
                    color: '#c5221f',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    fontWeight: '500'
                }}>
                    {error}
                </div>
            )}

            {jobs.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    boxShadow: '0 1px 3px 0 rgba(60,64,67,0.15)',
                    border: '1px solid #dadce0'
                }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚙️</div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: '#202124' }}>No generations found</h3>
                    <p style={{ margin: '0 0 20px 0', color: '#5f6368' }}>Start your first timetable generation task to see it here.</p>
                    <button className="primary-btn" onClick={() => navigate('/timetable')}>
                        Go to Generator
                    </button>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: '20px'
                }}>
                    {jobs.map((job) => {
                        const isTerminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
                        const bestScore = job.result?.bestScore ?? job.result?.score ?? null;
                        const objectiveVal = job.result?.objectiveValue ?? job.result?.objective_value ?? null;
                        
                        return (
                            <div key={job._id} style={{
                                backgroundColor: '#ffffff',
                                borderRadius: '12px',
                                border: '1px solid #dadce0',
                                boxShadow: '0 2px 6px 0 rgba(60,64,67,0.1)',
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                                cursor: 'default'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.shadow = '0 4px 12px 0 rgba(60,64,67,0.15)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'none';
                                e.currentTarget.style.shadow = '0 2px 6px 0 rgba(60,64,67,0.1)';
                            }}>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <span style={getStatusPillStyle(job.status)}>
                                            {job.status.toUpperCase()}
                                        </span>
                                        <span style={{ fontSize: '0.85rem', color: '#5f6368' }}>
                                            {new Date(job.createdAt).toLocaleString()}
                                        </span>
                                    </div>

                                    <h4 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', color: '#202124', fontWeight: '600' }}>
                                        Task #{String(job._id).slice(-8).toUpperCase()}
                                    </h4>

                                    <div style={{ fontSize: '0.9rem', color: '#5f6368', marginBottom: '16px' }}>
                                        <div style={{ marginBottom: '4px' }}>
                                            <strong>Phase:</strong> {job.phase || 'queued'}
                                        </div>
                                        {job.input?.schedule && (
                                            <div style={{ marginBottom: '4px' }}>
                                                <strong>Grid:</strong> {job.input.schedule.daysPerWeek} days × {job.input.schedule.hoursPerDay} periods
                                            </div>
                                        )}
                                        {bestScore !== null && (
                                            <div style={{ marginBottom: '4px', color: '#107c41', fontWeight: '500' }}>
                                                <strong>Score:</strong> {bestScore} {objectiveVal !== null ? `(Objective: ${objectiveVal})` : ''}
                                            </div>
                                        )}
                                        {job.error && (
                                            <div style={{ 
                                                marginTop: '8px', 
                                                padding: '8px', 
                                                backgroundColor: '#fce8e6', 
                                                color: '#c5221f', 
                                                borderRadius: '6px',
                                                fontSize: '0.85rem',
                                                maxHeight: '80px',
                                                overflowY: 'auto'
                                            }}>
                                                {job.error}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    {!isTerminal && (
                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#5f6368', marginBottom: '4px' }}>
                                                <span>Progress</span>
                                                <span>{Math.round(job.progress || 0)}%</span>
                                            </div>
                                            <div style={{ width: '100%', height: '8px', backgroundColor: '#e8eaed', borderRadius: '4px', overflow: 'hidden' }}>
                                                <div style={{ 
                                                    width: `${job.progress || 0}%`, 
                                                    height: '100%', 
                                                    backgroundColor: '#1a73e8', 
                                                    borderRadius: '4px',
                                                    transition: 'width 0.5s ease'
                                                }} />
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                        {job.status === 'completed' && (
                                            <button 
                                                className="primary-btn" 
                                                onClick={() => handleLoadGeneration(job._id)}
                                                style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                                            >
                                                Load Results
                                            </button>
                                        )}
                                        {(!isTerminal && !job.cancel_requested) && (
                                            <button 
                                                className="danger-btn" 
                                                onClick={() => handleStopGeneration(job._id)}
                                                style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                                            >
                                                Stop
                                            </button>
                                        )}
                                        {job.cancel_requested && !isTerminal && (
                                            <button 
                                                className="secondary-btn" 
                                                disabled
                                                style={{ flex: 1, padding: '8px 12px', fontSize: '0.85rem', cursor: 'not-allowed' }}
                                            >
                                                Stopping...
                                            </button>
                                        )}
                                        <button 
                                            className="secondary-btn" 
                                            onClick={() => handleDeleteGeneration(job._id)}
                                            style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            
            {/* Adding styles for pulse animation */}
            <style>{`
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.6; }
                    100% { opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default Generations;
