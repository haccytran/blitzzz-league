// src/components/LandingPage.jsx - Updated with side-by-side layout
import React, { useState, useEffect } from 'react';

export function LandingPage({ onLeagueSelect }) {
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [animationPhase, setAnimationPhase] = useState('initial'); // 'initial', 'selecting', 'selected'

  // Load league configs
  const [leagueConfigs, setLeagueConfigs] = useState(null);

  useEffect(() => {
    import('../config/leagueConfigs').then(({ leagueConfigs }) => {
      setLeagueConfigs(leagueConfigs);
    });
  }, []);

  const handleLogoClick = (leagueId) => {
    if (animationPhase === 'selecting') return; // Prevent clicks during animation

    setSelectedLeague(leagueId);
    setAnimationPhase('selecting');

    // After 3 seconds, complete the selection
    setTimeout(() => {
      setAnimationPhase('selected');
      
      // After animation completes, navigate to the league
setTimeout(() => {
  if (leagueConfigs && leagueConfigs[leagueId]) {
    onLeagueSelect({ id: leagueId, ...leagueConfigs[leagueId] });
  }
}, 0); // Immediate transition to splash screen
    }, 3000);
  };

  if (!leagueConfigs) {
    return (
      <div className="landing-container">
        <div className="landing-content">
          <h1 className="landing-title">Loading...</h1>
        </div>
      </div>
    );
  }

  const blitzzz = leagueConfigs.blitzzz;
  const sculpin = leagueConfigs.sculpin;

  return (
    <div className="landing-container">
      <div className="landing-content">
        <p className="landing-subtitle">SELECT LEAGUE</p>
        
        <div className="logo-selection-container">
          {/* Blitzzz Logo */}
          <div 
            className={`logo-card ${
              animationPhase === 'initial' ? 'logo-fade-in' : 
              animationPhase === 'selecting' && selectedLeague === 'blitzzz' ? 'logo-grow' :
              animationPhase === 'selecting' && selectedLeague !== 'blitzzz' ? 'logo-fade-out' :
              ''
            }`}
            onClick={() => handleLogoClick('blitzzz')}
            style={{ 
              cursor: animationPhase === 'selecting' ? 'default' : 'pointer',
              pointerEvents: animationPhase === 'selecting' ? 'none' : 'auto'
            }}
          >
            <img 
              src={blitzzz.logo} 
              alt={`${blitzzz.name} Logo`} 
              className="league-logo-large"
            />
          </div>

          {/* Sculpin Logo */}
          <div 
            className={`logo-card ${
              animationPhase === 'initial' ? 'logo-fade-in' : 
              animationPhase === 'selecting' && selectedLeague === 'sculpin' ? 'logo-grow' :
              animationPhase === 'selecting' && selectedLeague !== 'sculpin' ? 'logo-fade-out' :
              ''
            }`}
            onClick={() => handleLogoClick('sculpin')}
            style={{ 
              cursor: animationPhase === 'selecting' ? 'default' : 'pointer',
              pointerEvents: animationPhase === 'selecting' ? 'none' : 'auto'
            }}
          >
            <img 
              src={sculpin.logo} 
              alt={`${sculpin.name} Logo`} 
              className="league-logo-large"
            />
          </div>
        </div>
      </div>
    </div>
  );
}