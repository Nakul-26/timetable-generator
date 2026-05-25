import React from 'react';
import { Mail, MessageSquare } from 'lucide-react';

const Contact = () => {
  const email = "eclipse0937ln67.com"; // User should replace this
  const subject = "Inquiry about Timetable Generator";

  return (
    <section id="contact" className="section">
      <div className="container">
        <div style={{ backgroundColor: 'var(--muted)', borderRadius: 'var(--radius)', padding: '4rem 2rem', textAlign: 'center' }}>
          <div className="section-title">
            <h2>Ready to Optimize Your Institution?</h2>
            <p>Get in touch today to see how the Timetable Generator can work for your specific needs.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <a 
              href={`mailto:${email}?subject=${encodeURIComponent(subject)}`} 
              className="btn btn-primary" 
              style={{ fontSize: '1.125rem', padding: '1rem 2.5rem' }}
            >
              <Mail size={24} style={{ marginRight: '0.75rem' }} /> Contact Me via Email
            </a>
            <p style={{ fontSize: '0.875rem', marginBottom: 0 }}>
              <MessageSquare size={16} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} /> 
              I usually respond within 24 hours.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
