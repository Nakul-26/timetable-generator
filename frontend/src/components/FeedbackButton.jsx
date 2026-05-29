import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../styles/FeedbackButton.css';

const FeedbackButton = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show on login page or if already on support pages
  if (location.pathname === '/login' || location.pathname.startsWith('/support')) {
    return null;
  }
  
  return (
    <div 
      className="floating-feedback-btn" 
      onClick={() => navigate('/support/create')}
      title="Report an Issue"
    >
      <span role="img" aria-label="feedback">💬</span>
      <span className="feedback-text">Feedback</span>
    </div>
  );
};

export default FeedbackButton;
