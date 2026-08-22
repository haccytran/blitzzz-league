// src/config/leagueConfigs.js

export const leagueConfigs = {
  blitzzz: {
    id: 'blitzzz',
    name: "Blitzzz",
    displayName: "Blitzzz Fantasy Football League",
    logo: "/Blitzzz-logo-transparent.png",
    favicon: "/favicon.ico",
    colors: {
      primary: "#0ea5e9",
      secondary: "#0b1220"
    },
    espn: {
      leagueId: "226912", // Replace with actual ESPN League ID
      defaultSeason: "2025"
    }
  },
  
  example2: {
    id: 'example2',
    name: "Example League 2",
    displayName: "Another Fantasy League",
    logo: "/default-logo.png",
    favicon: "/favicon.ico",
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