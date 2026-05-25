import React from 'react';
import { Cpu, Users, ShieldAlert, Lock, Layers, Download } from 'lucide-react';

const features = [
  {
    icon: <Cpu size={32} />,
    title: 'AI-Powered Engine',
    description: 'Advanced algorithms solve complex scheduling constraints in seconds, finding the optimal balance for every department.'
  },
  {
    icon: <Users size={32} />,
    title: 'Teacher Preferences',
    description: 'Easily manage teacher availability and specific work-hour preferences to ensure high faculty satisfaction.'
  },
  {
    icon: <ShieldAlert size={32} />,
    title: 'Conflict Detection',
    description: 'Built-in real-time auditing catches overlaps in rooms, teachers, or subjects before the timetable is even finalized.'
  },
  {
    icon: <Lock size={32} />,
    title: 'Fixed Slot Control',
    description: 'Manually lock specific lectures or labs to fixed times. The engine works around your mandatory requirements.'
  },
  {
    icon: <Layers size={32} />,
    title: 'Electives & Labs',
    description: 'Full support for complex elective groups, laboratory sessions, and shared classroom resources across different years.'
  },
  {
    icon: <Download size={32} />,
    title: 'Instant Exports',
    description: 'Generate high-quality PDF or Excel reports for individual teachers, classes, or entire departments with one click.'
  }
];

const Features = () => {
  return (
    <section id="features" className="section">
      <div className="container">
        <div className="section-title">
          <h2>Everything You Need</h2>
          <p>Powerful features designed to handle the complexity of modern educational institutions.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          {features.map((feature, index) => (
            <div key={index} style={{ padding: '2rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', transition: 'transform 0.2s', backgroundColor: 'white' }}>
              <div style={{ color: 'var(--primary)', marginBottom: '1rem' }}>{feature.icon}</div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>{feature.title}</h3>
              <p style={{ fontSize: '1rem', margin: 0 }}>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
