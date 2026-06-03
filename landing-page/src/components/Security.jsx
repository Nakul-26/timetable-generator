import React from 'react';
import { ShieldCheck, Lock, Code, Database } from 'lucide-react';

const securityFeatures = [
  {
    icon: <Database size={32} />,
    title: 'Injection Prevention',
    description: 'Full protection against SQL and NoSQL injection attacks. We use Mongoose ODM with parameterized queries to ensure every database interaction is sanitized and safe.'
  },
  {
    icon: <Code size={32} />,
    title: 'XSS & CSRF Protection',
    description: 'Built-in defense against Cross-Site Scripting (XSS) through React\'s automatic escaping and specialized sanitization for PDF/Excel exports. Secure session handling blocks CSRF attempts.'
  },
  {
    icon: <ShieldCheck size={32} />,
    title: 'Multi-tenant Isolation',
    description: 'Our proprietary "College Scope" middleware ensures strict logical separation. Data from different institutions never mix, guaranteed by multi-layer tenant validation.'
  },
  {
    icon: <Lock size={32} />,
    title: 'Enterprise RBAC',
    description: 'Granular Role-Based Access Control (RBAC). Only authenticated admins with the correct permissions can view or modify your institution\'s sensitive schedules.'
  }
];

const Security = () => {
  return (
    <section id="security" className="section" style={{ backgroundColor: 'var(--muted)' }}>
      <div className="container">
        <div className="section-title">
          <h2>Enterprise-Grade Security</h2>
          <p>We build security into the core of our platform to protect your institution from modern web threats.</p>
        </div>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '2rem' 
        }}>
          {securityFeatures.map((feature, index) => (
            <div key={index} style={{ 
              padding: '2rem', 
              borderRadius: 'var(--radius)', 
              backgroundColor: 'white',
              boxShadow: 'var(--shadow)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              transition: 'transform 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <div style={{ color: 'var(--primary)', marginBottom: '1.25rem' }}>{feature.icon}</div>
              <h3 style={{ fontSize: '1.125rem', marginBottom: '0.75rem' }}>{feature.title}</h3>
              <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--secondary)', lineHeight: '1.6' }}>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Security;
