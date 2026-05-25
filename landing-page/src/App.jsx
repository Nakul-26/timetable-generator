import React from 'react';
import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Contact from './components/Contact';

function App() {
  return (
    <div className="app">
      <nav style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        backgroundColor: 'rgba(255, 255, 255, 0.8)', 
        backdropFilter: 'blur(10px)', 
        borderBottom: '1px solid var(--border)',
        zIndex: 1000,
        height: '4rem',
        display: 'flex',
        alignItems: 'center'
      }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--primary)' }}>
            TIMETABLE<span style={{ color: 'var(--foreground)' }}>GEN</span>
          </div>
          <div style={{ display: 'flex', gap: '2rem', fontWeight: 500, fontSize: '0.875rem' }}>
            <a href="#features" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Features</a>
            <a href="#how-it-works" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>How it Works</a>
            <a href="#contact" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Contact</a>
          </div>
        </div>
      </nav>

      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Contact />
      </main>

      <footer style={{ padding: '3rem 0', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <div className="container">
          <p style={{ marginBottom: '1rem' }}>&copy; {new Date().getFullYear()} Timetable Generator. All rights reserved.</p>
          <div style={{ fontSize: '0.75rem', color: 'var(--secondary)' }}>
            Built for modern educational institutions.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
