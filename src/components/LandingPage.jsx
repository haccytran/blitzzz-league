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

 const handleLogoClick = (leagueId, event) => {
  if (animationPhase === 'selecting') return;

  const clickedLogo = event.currentTarget;
  const allLogos = document.querySelectorAll('.logo-card');
  
  // Find the other logo that wasn't clicked
  const otherLogo = Array.from(allLogos).find(logo => logo !== clickedLogo);
  
  // Start fading out the other logo while keeping its pulse
  if (otherLogo) {
    otherLogo.style.transition = 'opacity 1.2s ease-out';
    otherLogo.style.opacity = '0';
    otherLogo.style.animation = 'logoPulse 2s ease-in-out infinite';
  }
  
  const rect = clickedLogo.getBoundingClientRect();
  
  // Calculate exact screen center
  const screenCenterX = window.innerWidth / 2;
  const screenCenterY = window.innerHeight / 2;
  
  // Calculate current logo center
  const logoCenterX = rect.left + rect.width / 2;
  const logoCenterY = rect.top + rect.height / 2;
  
  // Calculate raw distance to center
  const rawMoveX = screenCenterX - logoCenterX;
  const rawMoveY = screenCenterY - logoCenterY;
  
  // Determine final scale based on screen size
  let finalScale = 1.33; // Default for desktop
  
  // Adjust scale for mobile devices
  if (window.innerWidth <= 768) {
    if (window.innerHeight > window.innerWidth) {
      // Portrait mode
      finalScale = 1.0;
    } else {
      // Landscape mode
      finalScale = 0.8;
    }
  }
  
  const compensationFactor = 1.00;
  const adjustedMoveX = rawMoveX * compensationFactor;
  const adjustedMoveY = rawMoveY * compensationFactor;
  
  // Clear existing animations first
  clickedLogo.style.animation = 'none';
  clickedLogo.className = 'logo-card';
  clickedLogo.offsetHeight; // Force reflow
  
  // Apply smooth scaling AND movement animation with responsive scale
  clickedLogo.setAttribute('style', `
    animation: none !important;
    transition: transform 2s ease-out, opacity 1.7s ease-out 1.7s !important;
    transform: translate(${adjustedMoveX}px, ${adjustedMoveY}px) scale(1.00) !important;
    z-index: 1000 !important;
    cursor: default !important;
    pointer-events: none !important;
    transform-origin: center center !important;
    opacity: 0 !important;
  `);

  setSelectedLeague(leagueId);
  setAnimationPhase('selecting');

  // Go directly to the site after 2 seconds (when centering animation completes)
 // Go to site after centering animation plus fade-out time
setTimeout(() => {
  // Check if we're on mobile portrait - if so, wait a bit longer for user to rotate
  const isMobilePortrait = window.innerWidth <= 768 && window.innerHeight > window.innerWidth;
  
  if (isMobilePortrait) {
    // Wait longer on mobile portrait to give user time to see overlay and rotate
    setTimeout(() => {
      if (leagueConfigs && leagueConfigs[leagueId]) {
        onLeagueSelect({ id: leagueId, ...leagueConfigs[leagueId] });
      }
    }, 2000); // Additional 2 seconds for mobile portrait
  } else {
    // Normal timing for landscape and desktop
    if (leagueConfigs && leagueConfigs[leagueId]) {
      onLeagueSelect({ id: leagueId, ...leagueConfigs[leagueId] });
    }
  }
}, 2000);

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
        <div className="logo-selection-container">
          {/* Blitzzz Logo */}
<div 
  className="logo-card"
  onClick={(e) => handleLogoClick('blitzzz', e)}
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
  className="logo-card"
  onClick={(e) => handleLogoClick('sculpin', e)}
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
    {/* Add this rotation overlay */}
    {animationPhase === 'selecting' && (
      <div className="rotation-overlay">
        <div className="rotation-content">
          <div className="phone-icon">📱</div>
          <div className="rotation-arrow">↻</div>
          <p>Please rotate your device to landscape mode for the best experience</p>
        </div>
      </div>
    )}

    </div>

  );
}