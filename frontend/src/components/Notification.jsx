import React, { useState, useEffect } from 'react';
import '../styles/Notification.css';

const Notification = () => {
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    const handleNotification = (event) => {
      const { message, type } = event.detail;
      setNotification({ message, type });

      // Auto-hide after 5 seconds
      const timer = setTimeout(() => {
        setNotification(null);
      }, 5000);

      return () => clearTimeout(timer);
    };

    window.addEventListener('app:notification', handleNotification);

    return () => {
      window.removeEventListener('app:notification', handleNotification);
    };
  }, []);

  if (!notification) return null;

  return (
    <div className={`notification-toast ${notification.type}`}>
      <div className="notification-content">
        {notification.message}
      </div>
      <button className="notification-close" onClick={() => setNotification(null)}>
        &times;
      </button>
    </div>
  );
};

export default Notification;
