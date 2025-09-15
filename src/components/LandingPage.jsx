// src/components/LandingPage.jsx - Updated with side-by-side layout
import React, { useState, useEffect } from 'react';

export function LandingPage({ onLeagueSelect }) {
  const [selectedLeague, setSelectedLeague] = useState(null);
const [animationPhase, setAnimationPhase] = useState('initial'); // 'initial', 'selecting', 'selected'
const [showRotationPopup, setShowRotationPopup] = useState(false);

  // Load league configs
  const [leagueConfigs, setLeagueConfigs] = useState(null);

  useEffect(() => {
    import('../config/leagueConfigs').then(({ leagueConfigs }) => {
      setLeagueConfigs(leagueConfigs);
    });
  }, []);

 const handleLogoClick = (leagueId, event) => {
  if (animationPhase === 'selecting') return;

  setSelectedLeague(leagueId);
  setAnimationPhase('selecting');

  // Normal animation flow for ALL devices first
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

  // Check if we should show popup AFTER animation starts (1 second delay)
  setTimeout(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isPortrait = window.innerHeight > window.innerWidth;
    const isSmallScreen = window.innerWidth <= 768;
    const hidePrompt = localStorage.getItem('hideRotationPrompt') === 'true';
    
    if (isMobile && isPortrait && isSmallScreen && !hidePrompt) {
      setShowRotationPopup(true);
    } else {
      // Auto-continue if no popup needed
      setTimeout(() => {
        if (leagueConfigs && leagueConfigs[leagueId]) {
          onLeagueSelect({ id: leagueId, ...leagueConfigs[leagueId] });
        }
      }, 1000);
    }
  }, 1000);
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
    {showRotationPopup && (
  <div className="simple-popup-backdrop">
    <div className="simple-popup">
      <div className="popup-emojis">📱 ↻</div>
      <h3>Rotate Your Device</h3>
      <p>For the best experience, please rotate your device to landscape mode.</p>
      <div className="popup-checkbox-row">
        <input 
          type="checkbox" 
          id="dontShowAgain" 
          onChange={(e) => {
            if (e.target.checked) {
              localStorage.setItem('hideRotationPrompt', 'true');
            } else {
              localStorage.removeItem('hideRotationPrompt');
            }
          }}
        />
        <label htmlFor="dontShowAgain">Do not show this message again</label>
      </div>
      <button 
        className="popup-continue-btn"
        onClick={() => {
          setShowRotationPopup(false);
          if (leagueConfigs && leagueConfigs[selectedLeague]) {
            onLeagueSelect({ id: selectedLeague, ...leagueConfigs[selectedLeague] });
          }
        }}
      >
        Continue
      </button>
    </div>
  </div>
)}
      </>
);
}
