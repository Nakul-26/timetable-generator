import React from 'react';

const Demo = () => {
  return (
    <section className="demo section" id="demo" style={{ backgroundColor: 'white', padding: '5rem 0' }}>
      <div className="container">
        <div style={{ textAlign: 'center', maxWidth: '1000px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>See it in Action</h2>
          <p style={{ fontSize: '1.125rem', marginBottom: '3rem', color: 'var(--secondary)' }}>
            Watch how easily you can generate complex timetables with our intuitive interface.
          </p>
          <div style={{ 
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', 
            borderRadius: '1rem', 
            overflow: 'hidden',
            backgroundColor: 'var(--muted)',
            lineHeight: 0
          }}>
            <video 
              width="100%" 
              height="auto" 
              controls 
              poster="" 
              style={{ display: 'block' }}
            >
              <source src="/demo.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Demo;
