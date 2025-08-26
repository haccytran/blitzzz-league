// src/Logo.jsx
import React from "react";

export default function Logo({ size = 72 }) {
  const s = { width: size, height: size };
  return (
    <svg viewBox="0 0 320 320" style={s} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Blitzzz">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1d4ed8"/>
          <stop offset="100%" stopColor="#1e3a8a"/>
        </linearGradient>
        <linearGradient id="ball" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa"/>
          <stop offset="100%" stopColor="#2563eb"/>
        </linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.25"/>
        </filter>
      </defs>

      {/* Shield */}
      <path d="M160 300c78-36 115-68 115-120V70l-115-20L45 70v110c0 52 37 84 115 120z"
            fill="url(#bg)" filter="url(#soft)" />
      <path d="M160 286c68-32 100-58 100-100V83l-100-17-100 17v103c0 42 32 68 100 100z"
            fill="none" stroke="#93c5fd" strokeWidth="10"/>

      {/* Banner */}
      <path d="M35 155c60 22 190 22 250 0v50c-60 22-190 22-250 0v-50z" fill="#0b4aa8"/>
      <path d="M35 155c60 22 190 22 250 0" fill="none" stroke="#1e40af" strokeWidth="10"/>

      {/* Text */}
      <g transform="translate(160 190)" textAnchor="middle" fontFamily="Impact, Oswald, Arial Black, sans-serif">
        <text y="0" fontSize="56" fill="#0b1f46" stroke="#0b1f46" strokeWidth="10">BLITZZZ</text>
        <text y="0" fontSize="56" fill="#eaf2ff" stroke="#60a5fa" strokeWidth="3">BLITZZZ</text>
      </g>

      {/* Football with pointed tips */}
      <g transform="translate(200 110) rotate(-18)">
        {/* prolate/pointed shape */}
        <path d="M-72 0
                 Q -40 -36 0 -46
                 Q 40 -36 72 0
                 Q 40 36 0 46
                 Q -40 36 -72 0 Z"
              fill="url(#ball)" stroke="#0b3b97" strokeWidth="8"/>
        {/* center lace bar */}
        <rect x="-7" y="-30" width="14" height="60" rx="7" fill="#eaf2ff"/>
        {/* cross laces */}
        <path d="M-38 0h76" stroke="#eaf2ff" strokeWidth="8" strokeLinecap="round"/>
        <path d="M-22 -16c-6 6-6 26 0 32M22 -16c6 6 6 26 0 32"
              stroke="#eaf2ff" strokeWidth="6" strokeLinecap="round" fill="none"/>
      </g>

      {/* Stars */}
      <g fill="#eaf2ff" transform="translate(160 240)">
        <polygon points="0,-10 3,-2 12,-2 5,3 8,12 0,7 -8,12 -5,3 -12,-2 -3,-2"/>
        <g transform="translate(-30 6) scale(0.75)">
          <polygon points="0,-10 3,-2 12,-2 5,3 8,12 0,7 -8,12 -5,3 -12,-2 -3,-2"/>
        </g>
        <g transform="translate(30 6) scale(0.75)">
          <polygon points="0,-10 3,-2 12,-2 5,3 8,12 0,7 -8,12 -5,3 -12,-2 -3,-2"/>
        </g>
      </g>
    </svg>
  );
}
