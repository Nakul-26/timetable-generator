import React from 'react';

const steps = [
  {
    number: '01',
    title: 'Setup Core Data',
    description: 'Add your teachers, subjects, and classes through our intuitive interface.'
  },
  {
    number: '02',
    title: 'Assign Allocations',
    description: 'Define who teaches what. Use our bulk-mapping tools for large departments.'
  },
  {
    number: '03',
    title: 'Generate & Export',
    description: 'Run the generator, perform a final audit, and download your perfectly synced schedules.'
  }
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="section" style={{ backgroundColor: '#0f172a', color: 'white' }}>
      <div className="container">
        <div className="section-title">
          <h2 style={{ color: 'white' }}>How It Works</h2>
          <p style={{ color: '#94a3b8' }}>A simple three-step process to transform your institutional scheduling.</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3rem', justifyContent: 'center' }}>
          {steps.map((step, index) => (
            <div key={index} style={{ flex: '1', minWidth: '250px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem', lineHeight: 1 }}>{step.number}</div>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{step.title}</h3>
              <p style={{ color: '#94a3b8' }}>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
