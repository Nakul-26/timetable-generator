import React from 'react';
import { Mail, MessageSquare, Phone } from 'lucide-react';

const Contact = () => {
  const email = "eclipse0937ln67.com"; // User should replace this
  const whatsappNumber = "918762937949";
  const subject = "Inquiry about Timetable Generator";
  const waMessage = "Hi, I'm interested in the Timetable Generator. Can you help me get started?";

  return (
    <section id="contact" className="section">
      <div className="container">
        <div style={{ backgroundColor: 'var(--muted)', borderRadius: 'var(--radius)', padding: '4rem 2rem', textAlign: 'center' }}>
          <div className="section-title">
            <h2>Ready to Optimize Your Institution?</h2>
            <p>Get in touch today to see how the Timetable Generator can work for your specific needs.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <a 
                href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(waMessage)}`} 
                target="_blank"
                rel="noopener noreferrer"
                className="btn" 
                style={{ 
                  fontSize: '1.125rem', 
                  padding: '1rem 2.5rem', 
                  backgroundColor: '#25D366', 
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <Phone size={24} style={{ marginRight: '0.75rem' }} /> WhatsApp Me
              </a>
              <a 
                href={`mailto:${email}?subject=${encodeURIComponent(subject)}`} 
                className="btn btn-primary" 
                style={{ fontSize: '1.125rem', padding: '1rem 2.5rem' }}
              >
                <Mail size={24} style={{ marginRight: '0.75rem' }} /> Email Me
              </a>
            </div>
            <p style={{ fontSize: '0.875rem', marginBottom: 0 }}>
              <MessageSquare size={16} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} /> 
              I usually respond within a few hours on WhatsApp.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
