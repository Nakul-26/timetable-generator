import React from 'react';
import { Check } from 'lucide-react';

const Pricing = () => {
  const plans = [
    {
      name: "Free Trial",
      target: "Everyone",
      price: "₹0",
      period: "for 30 days",
      features: ["Full features access", "30 days duration", "Unlimited timetable generation", "Email support"],
      cta: "Start Free Trial",
      highlighted: false
    },
    {
      name: "Basic",
      target: "Small Schools (<500 students)",
      price: "₹4,999",
      period: "per year",
      features: ["Core generator engine", "Conflict detection", "Up to 500 students", "Standard support"],
      cta: "Get Started",
      highlighted: false
    },
    {
      name: "Standard",
      target: "Medium Schools (500–1500 students)",
      price: "₹9,999",
      period: "per year",
      features: ["Advanced optimization", "Multiple department support", "Up to 1500 students", "Priority support"],
      cta: "Get Started",
      highlighted: true
    },
    {
      name: "Premium",
      target: "Large Schools / PU / Degree Colleges",
      price: "₹19,999",
      period: "per year",
      features: ["Enterprise-grade solver", "Custom constraints", "Unlimited students", "Dedicated account manager"],
      cta: "Get Started",
      highlighted: false
    }
  ];

  return (
    <section className="pricing section" id="pricing" style={{ backgroundColor: 'var(--muted)' }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Simple, Transparent Pricing</h2>
          <p style={{ fontSize: '1.25rem', color: 'var(--secondary)', maxWidth: '700px', margin: '0 auto' }}>
            Choose the plan that best fits your institution's size and needs. 
            <br />
            <strong>Replaces 3–5 days of manual work every term. Pays for itself in the first week.</strong>
          </p>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
          gap: '2rem',
          alignItems: 'stretch'
        }}>
          {plans.map((plan, index) => (
            <div key={index} style={{ 
              backgroundColor: plan.highlighted ? 'white' : 'transparent',
              padding: '2.5rem 2rem',
              borderRadius: '1rem',
              border: plan.highlighted ? '2px solid var(--primary)' : '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: plan.highlighted ? 'var(--shadow-lg)' : 'none',
              position: 'relative',
              transform: plan.highlighted ? 'scale(1.05)' : 'none',
              zIndex: plan.highlighted ? 1 : 0
            }}>
              {plan.highlighted && (
                <div style={{ 
                  position: 'absolute', 
                  top: '-12px', 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                  padding: '4px 12px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  textTransform: 'uppercase'
                }}>
                  Most Popular
                </div>
              )}
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{plan.name}</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--secondary)', marginBottom: '1.5rem', height: '2.5rem' }}>{plan.target}</p>
              
              <div style={{ marginBottom: '2rem' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800 }}>{plan.price}</span>
                <span style={{ fontSize: '1rem', color: 'var(--secondary)' }}> /{plan.period}</span>
              </div>

              <ul style={{ marginBottom: '2.5rem', flexGrow: 1 }}>
                {plan.features.map((feature, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                    <Check size={18} color="var(--primary)" style={{ marginRight: '0.75rem', flexShrink: 0 }} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <a href="#contact" className={`btn ${plan.highlighted ? 'btn-primary' : ''}`} style={{ 
                width: '100%', 
                border: plan.highlighted ? 'none' : '1px solid var(--border)',
                backgroundColor: plan.highlighted ? 'var(--primary)' : 'white',
                textDecoration: 'none'
              }}>
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <div style={{ 
          marginTop: '4rem', 
          textAlign: 'center', 
          padding: '2rem', 
          backgroundColor: 'white', 
          borderRadius: '1rem', 
          border: '1px dashed var(--primary)',
          maxWidth: '800px',
          margin: '4rem auto 0 auto'
        }}>
          <h3 style={{ fontSize: '1.25rem', color: 'var(--primary)', marginBottom: '0.5rem' }}>Our Personal Commitment</h3>
          <p style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
            "You can request for new features, changes, or custom integrations for free. We build for you."
          </p>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
