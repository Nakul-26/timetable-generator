import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import API from "../../api/axios";
import { useAuth } from "../../context/AuthContext";

const IssueDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [issue, setIssue] = useState(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const navigate = useNavigate();

  const isSuper = user?.role === "superadmin";

  useEffect(() => {
    fetchIssue();
  }, [id]);

  const fetchIssue = async () => {
    try {
      setLoading(true);
      const res = await API.get(`/issues/${id}`);
      setIssue(res.data);
      setLoading(false);
    } catch (err) {
      setError("Failed to fetch issue details.");
      setLoading(false);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await API.post(`/issues/${id}/comments`, { message: comment });
      setIssue(res.data);
      setComment("");
    } catch (err) {
      alert("Failed to add comment.");
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    setUpdatingStatus(true);
    try {
      const res = await API.patch(`/issues/${id}`, { status: newStatus });
      setIssue(res.data);
    } catch (err) {
      alert("Failed to update status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Loading issue details...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!issue) return <div style={{ padding: '20px' }}>Issue not found.</div>;

  return (
    <div className="manage-container">
      {/* Image Modal */}
      {selectedImage && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            cursor: 'zoom-out'
          }}
          onClick={() => setSelectedImage(null)}
        >
          <img 
            src={selectedImage} 
            alt="Fullscreen" 
            style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: '8px' }} 
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <button onClick={() => navigate("/support")} className="secondary-btn">← Back to Tickets</button>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {isSuper && (
            <>
              <button 
                onClick={() => handleUpdateStatus("In Progress")} 
                className="secondary-btn"
                disabled={updatingStatus || issue.status === "In Progress"}
              >
                In Progress
              </button>
              <button 
                onClick={() => handleUpdateStatus("Resolved")} 
                className="primary-btn"
                disabled={updatingStatus || issue.status === "Resolved"}
              >
                Mark Resolved
              </button>
            </>
          )}
          {(isSuper || issue.createdBy === user?._id) && (
            <button 
              onClick={() => handleUpdateStatus(issue.status === "Closed" ? "Open" : "Closed")} 
              className="danger-btn"
              disabled={updatingStatus}
            >
              {issue.status === "Closed" ? "Reopen" : "Close Ticket"}
            </button>
          )}
        </div>
      </div>

      <div className="issue-card" style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 14px rgba(0,0,0,0.05)', marginBottom: '30px', border: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
          <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>#{issue._id.slice(-6)}</span>
          <span style={{ 
            backgroundColor: issue.status === "Resolved" ? "#27ae60" : issue.status === "Open" ? "#e74c3c" : issue.status === "In Progress" ? "#f39c12" : "#7f8c8d", 
            color: '#fff', 
            padding: '4px 12px', 
            borderRadius: '20px',
            fontSize: '0.85rem',
            fontWeight: 'bold'
          }}>
            {issue.status}
          </span>
        </div>
        <h2 style={{ marginTop: 0, marginBottom: '10px' }}>{issue.title}</h2>
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', color: '#6b7280', fontSize: '0.9rem', flexWrap: 'wrap' }}>
          <span><strong>Category:</strong> {issue.category}</span>
          <span><strong>Priority:</strong> {issue.priority}</span>
          <span><strong>Created By:</strong> {issue.creatorEmail}</span>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '20px 0' }} />
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#374151', marginBottom: '20px' }}>
          {issue.description}
        </div>

        {isSuper && issue.metadata && (
          <div style={{ marginTop: '20px', padding: '15px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ marginTop: 0, marginBottom: '10px', fontSize: '0.95rem', color: '#1e293b' }}>Technical Details</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '0.85rem', color: '#64748b' }}>
              <div><strong>Browser:</strong> {issue.metadata.browser}</div>
              <div><strong>OS:</strong> {issue.metadata.os}</div>
              <div style={{ gridColumn: '1 / -1' }}><strong>Reported From:</strong> <span style={{ wordBreak: 'break-all' }}>{issue.metadata.pageUrl}</span></div>
            </div>
          </div>
        )}

        {issue.attachments && issue.attachments.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ marginBottom: '10px' }}>Attachments</h4>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {issue.attachments.map((url, index) => (
                <img 
                  key={index} 
                  src={url} 
                  alt={`Attachment ${index + 1}`} 
                  style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px', cursor: 'zoom-in', border: '1px solid #ddd' }}
                  onClick={() => setSelectedImage(url)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <h3>Comments & Updates</h3>
      <div className="comments-section" style={{ marginBottom: '30px' }}>
        {issue.comments.length === 0 ? (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: '20px', background: '#f9fafb', borderRadius: '8px' }}>No comments yet.</p>
        ) : (
          issue.comments.map((c, index) => (
            <div key={index} style={{ 
              background: c.user === user?._id ? '#f0f4ff' : '#fff', 
              padding: '15px', 
              borderRadius: '10px', 
              marginBottom: '15px',
              border: '1px solid #eee',
              borderLeft: c.user === user?._id ? '4px solid #4f46e5' : '4px solid #d1d5db'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', flexWrap: 'wrap' }}>
                <strong style={{ color: '#1f2937' }}>{c.userEmail}</strong>
                <small style={{ color: '#6b7280' }}>{new Date(c.createdAt).toLocaleString()}</small>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', color: '#4b5563', marginTop: '8px' }}>{c.message}</div>
            </div>
          ))
        )}
      </div>

      <div className="add-comment" style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 14px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
        <h4 style={{ marginTop: 0, marginBottom: '15px' }}>Add Comment</h4>
        <form onSubmit={handleAddComment}>
          <textarea
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '15px', fontSize: '1rem', fontFamily: 'inherit' }}
            rows="4"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Type your message here..."
            required
          />
          <button type="submit" className="primary-btn" disabled={submittingComment}>
            {submittingComment ? "Sending..." : "Post Comment"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default IssueDetail;
