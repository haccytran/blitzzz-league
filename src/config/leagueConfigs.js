// src/config/leagueConfigs.js

export const leagueConfigs = {
  blitzzz: {
    id: 'blitzzz',
    name: "Blitzzz",
    displayName: "Blitzzz Fantasy Football League",
    logo: "/Blitzzz-logo-transparent.png",
    favicon: "/favicon.ico",
    adminPassword: "temporary420",
    colors: {
      primary: "#0ea5e9",
      secondary: "#0b1220"
    },
    espn: {
      leagueId: "226912", // Replace with actual ESPN League ID
      defaultSeason: "2025"
    }
  },
  
  sculpin: {
    id: 'sculpin',
    name: "Sculpin",
    displayName: "Sculpin Fantasy Football League",
    logo: "/sculpin-logo.png",
    favicon: "/favicon.ico",
    adminPassword: "cocoshouse",
    colors: {
      primary: "#16a34a",
      secondary: "#0f172a"
    },
    espn: {
      leagueId: "58645", // Replace with actual ESPN League ID
      defaultSeason: "2025"
    }
  }
};

// Function to get config by league ID
export function getLeagueConfig(leagueId) {
  return leagueConfigs[leagueId] || leagueConfigs.blitzzz; // fallback to blitzzz
}