import React from 'react';
import Hero from './components/Hero';
import Demo from './components/Demo';
import Pricing from './components/Pricing';
import Features from './components/Features';
import Security from './components/Security';
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
            <a href="#demo" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Watch Demo</a>
            <a href="#features" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Features</a>
            <a href="#security" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Security</a>
            <a href="#pricing" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Pricing</a>
            <a href="#how-it-works" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>How it Works</a>
            <a href="#contact" style={{ transition: 'color 0.2s' }} onMouseOver={(e) => e.target.style.color = 'var(--primary)'} onMouseOut={(e) => e.target.style.color = 'inherit'}>Contact</a>
          </div>
        </div>
      </nav>

      <main>
        <Hero />
        <Demo />
        <Features />
        <Security />
        <Pricing />
        <HowItWorks />
        <Contact />
      </main>

      <footer style={{ padding: '3rem 0', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <div className="container">
          <p style={{ marginBottom: '1rem' }}>&copy; {new Date().getFullYear()} Timetable Generator. All rights reserved.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem' }}>
            <a href="https://wa.me/918762937949" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--secondary)', fontSize: '0.875rem' }}>WhatsApp: +91 87629 37949</a>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--secondary)' }}>
            Built for modern educational institutions.
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp Button */}
      <a 
        href="https://wa.me/918762937949?text=Hi, I'm interested in the Timetable Generator." 
        target="_blank" 
        rel="noopener noreferrer"
        style={{
          position: 'fixed',
          bottom: '2rem',
          right: '2rem',
          backgroundColor: '#25D366',
          color: 'white',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          transition: 'transform 0.2s'
        }}
        onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
        onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>
    </div>
  );
}

export default App;
