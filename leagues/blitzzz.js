export const blitzzzConfig = {
  name: "Blitzzz",
  displayName: "Blitzzz Fantasy Football League",
  logo: "/logos/blitzzz-logo.png",
  favicon: "/favicons/blitzzz-favicon.png",
  colors: {
    primary: "#0ea5e9",      // Blue
    secondary: "#0b1220",
    accent: "#38bdf8",
    background: "#f8fafc"
  },
  espn: {
    leagueId: process.env.VITE_BLITZZZ_LEAGUE_ID,
    defaultSeason: process.env.VITE_BLITZZZ_SEASON || "2025"
  },
  adminPassword: process.env.VITE_BLITZZZ_ADMIN_PASSWORD,
  database: {
    prefix: "blitzzz_"
  }
};