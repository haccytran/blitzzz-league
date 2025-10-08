import React from 'react';
import Logo from './Logo.jsx';

export default function LandingPage() {
  const navigateToLeague = (slug) => {
    window.location.href = `/${slug}/`;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div className="container" style={{ maxWidth: '800px', textAlign: 'center' }}>
        <h1 style={{ 
          color: 'white', 
          fontSize: '3rem', 
          marginBottom: '2rem',
          textShadow: '0 2px 4px rgba(0,0,0,0.3)'
        }}>
          Fantasy Football Leagues
        </h1>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '2rem',
          marginTop: '3rem'
        }}>
          {/* Blitzzz League */}
          <div 
            className="card"
            style={{
              padding: '2rem',
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              border: '2px solid transparent'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.15)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)';
            }}
            onClick={() => navigateToLeague('blitzzz')}
          >
            <Logo size={120} />
            <h2 style={{ 
              color: '#0b2e4a', 
              marginTop: '1rem', 
              fontSize: '2rem',
              marginBottom: '0.5rem'
            }}>
              Blitzzz League
            </h2>
            <p style={{ color: '#64748b', fontSize: '1.1rem' }}>
              Enter the Blitzzz League
            </p>
          </div>

          {/* Sculpin League */}
          <div 
            className="card"
            style={{
              padding: '2rem',
              background: 'white',
              borderRadius: '12px', 
              boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              border: '2px solid transparent'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.15)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)';
            }}
            onClick={() => navigateToLeague('sculpin')}
          >
            <div style={{
              width: '120px',
              height: '120px', 
              background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              fontSize: '3rem',
              color: 'white',
              fontWeight: 'bold'
            }}>
              S
            </div>
            <h2 style={{
              color: '#134e4a',
              marginTop: '1rem',
              fontSize: '2rem', 
              marginBottom: '0.5rem'
            }}>
              Sculpin League
            </h2>
            <p style={{ color: '#64748b', fontSize: '1.1rem' }}>
              Enter the Sculpin League
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}