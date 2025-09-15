// src/components/LandingPage.jsx - Updated with side-by-side layout
import React, { useState, useEffect } from 'react';

export function LandingPage({ onLeagueSelect }) {
  const [selectedLeague, setSelectedLeague] = useState(null);
const [animationPhase, setAnimationPhase] = useState('initial');
  const [showRotationPopup, setShowRotationPopup] = useState(false); // 'initial', 'selecting', 'selected'

  // Load league configs
  const [leagueConfigs, setLeagueConfigs] = useState(null);

  useEffect(() => {
    import('../config/leagueConfigs').then(({ leagueConfigs }) => {
      setLeagueConfigs(leagueConfigs);
    });
  }, []);

 const handleLogoClick = (leagueId, event) => {
  if (animationPhase === 'selecting') return;

  // Better mobile detection
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isPortrait = window.innerHeight > window.innerWidth;
  const isSmallScreen = window.innerWidth <= 768;
  const hidePrompt = localStorage.getItem('hideRotationPrompt') === 'true';
  
  // Only show popup if it's actually a mobile device in portrait mode
  if (isMobile && isPortrait && isSmallScreen && !hidePrompt) {
    setSelectedLeague(leagueId);
    setAnimationPhase('selecting');
    setShowRotationPopup(true);
    return;
  }

  // Reset popup state for non-mobile
  setShowRotationPopup(false);

  // Normal animation flow for desktop/landscape/users who disabled prompt
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
  
  let finalScale = 1.33;
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
    transform: translate(${adjustedMoveX}px, ${adjustedMoveY}px) scale(1.00) !important;
    z-index: 1000 !important;
    cursor: default !important;
    pointer-events: none !important;
    transform-origin: center center !important;
    opacity: 0 !important;
  `);

  setSelectedLeague(leagueId);
  setAnimationPhase('selecting');

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
        <p className="landing-subtitle">SELECT LEAGUE</p>
        
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
    
    {showRotationPopup && (
      <div className="popup-backdrop">
        <div className="popup-modal">
          <div className="popup-icon">📱</div>
          <h3>Rotate Your Device</h3>
          <p>For the best experience, please rotate your device to landscape mode.</p>
          <div className="popup-checkbox">
            <input 
              type="checkbox" 
              id="dontShowRotation" 
              onChange={(e) => {
                if (e.target.checked) {
                  localStorage.setItem('hideRotationPrompt', 'true');
                } else {
                  localStorage.removeItem('hideRotationPrompt');
                }
              }}
            />
            <label htmlFor="dontShowRotation">Don't show this message again</label>
          </div>
          <button 
            className="popup-ok-btn"
            onClick={() => {
              setShowRotationPopup(false);
              setAnimationPhase('selected');
              setTimeout(() => {
                if (leagueConfigs && leagueConfigs[selectedLeague]) {
                  onLeagueSelect({ id: selectedLeague, ...leagueConfigs[selectedLeague] });
                }
              }, 100);
            }}
          >
            OK
          </button>
        </div>
      </div>
    )}
  </>
);
}
