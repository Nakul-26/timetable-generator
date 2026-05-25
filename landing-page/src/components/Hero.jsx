import React from 'react';
import { ArrowRight, Calendar } from 'lucide-react';

const Hero = () => {
  return (
    <header className="hero section" style={{ backgroundColor: 'var(--muted)', paddingTop: '8rem' }}>
      <div className="container">
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: 'white', padding: '0.5rem 1rem', borderRadius: '2rem', marginBottom: '2rem', boxShadow: 'var(--shadow)' }}>
            <Calendar size={20} color="var(--primary)" style={{ marginRight: '0.5rem' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>The Future of Institutional Scheduling</span>
          </div>
          <h1 style={{ fontSize: '3.5rem', marginBottom: '1.5rem' }}>
            Automated <span style={{ color: 'var(--primary)' }}>Timetable Generation</span> Made Simple.
          </h1>
          <p style={{ fontSize: '1.25rem', marginBottom: '2.5rem' }}>
            Say goodbye to scheduling conflicts and manual errors. Our intelligent generator creates optimized, conflict-free timetables for your institution in seconds.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <a href="#contact" className="btn btn-primary">
              Get Started Now <ArrowRight size={20} style={{ marginLeft: '0.5rem' }} />
            </a>
            <a href="#features" className="btn" style={{ border: '1px solid var(--border)', backgroundColor: 'white' }}>
              View Features
            </a>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Hero;
