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

  // Check for mobile portrait FIRST with simple browser alert
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isPortrait = window.innerHeight > window.innerWidth;
  const isSmallScreen = window.innerWidth <= 768;
  const hidePrompt = localStorage.getItem('hideRotationPrompt') === 'true';
  
  // Show simple browser alert with emojis for mobile portrait users
  // Show simple browser alert with emojis for mobile portrait users
if (isMobile && isPortrait && isSmallScreen && !hidePrompt) {
  // First prompt - just OK button, no cancel option
  alert("📱↻ ROTATE YOUR PHONE TO LANDSCAPE MODE!!📱↻\n\n📱↻\n\n📱↻\n\nClick OK to continue.");
  
  // Second prompt - Yes/No for don't show again
  const dontShowAgain = confirm("📱↻ Don't show this rotation message reminder again?📱↻\n\n📱↻YOU NOT GONNA FORGET RIGHT?!📱↻\n\n📱↻\n\n📱↻\n\nClick OK for Yes, Cancel for No.");
  if (dontShowAgain) {
    localStorage.setItem('hideRotationPrompt', 'true');
  }
}

  setSelectedLeague(leagueId);
  setAnimationPhase('selecting');

  // Normal animation flow
  const clickedLogo = event.currentTarget;
  const allLogos = document.querySelectorAll('.logo-card');
  
  const otherLogo = Array.from(allLogos).find(logo => logo !== clickedLogo);
  
  if (otherLogo) {
    otherLogo.style.transition = 'opacity 1s ease-out';
    otherLogo.style.opacity = '0';
    otherLogo.style.animation = 'logoPulse 2s ease-in-out infinite';
  }
  
  const rect = clickedLogo.getBoundingClientRect();
  const screenCenterX = window.innerWidth / 2;
  const screenCenterY = window.innerHeight / 2;
  const logoCenterX = rect.left + rect.width / 2;
  const logoCenterY = rect.top + rect.height / 2;
  const rawMoveX = screenCenterX - logoCenterX;
  const rawMoveY = screenCenterY - logoCenterY;
  
  let finalScale = 1.10;
  if (window.innerWidth <= 768) {
    if (window.innerHeight > window.innerWidth) {
      finalScale = 1.0;
    } else {
      finalScale = 0.8;
    }
  }
  
  const compensationFactor = 1.00;
  const adjustedMoveX = rawMoveX * compensationFactor;
  const adjustedMoveY = rawMoveY * compensationFactor;
  
  clickedLogo.style.animation = 'none';
  clickedLogo.className = 'logo-card';
  clickedLogo.offsetHeight;
  
  clickedLogo.setAttribute('style', `
    animation: none !important;
    transition: transform 2s ease-out, opacity 1.7s ease-out 1.7s !important;
    transform: translate(${adjustedMoveX}px, ${adjustedMoveY}px) scale(${finalScale}) !important;
    z-index: 1000 !important;
    cursor: default !important;
    pointer-events: none !important;
    transform-origin: center center !important;
    opacity: 0 !important;
  `);

  setTimeout(() => {
    if (leagueConfigs && leagueConfigs[leagueId]) {
      onLeagueSelect({ id: leagueId, ...leagueConfigs[leagueId] });
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
  <>
    <div className="landing-container">
      <div className="landing-content">
        
        <div className="logo-selection-container">
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
    </div>
          </>
);
}
