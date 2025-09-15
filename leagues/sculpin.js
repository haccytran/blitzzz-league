export const sculpinConfig = {
  name: "Sculpin",
  displayName: "Sculpin Fantasy Football League", 
  logo: "/logos/sculpin-logo.png",
  favicon: "/favicons/sculpin-favicon.png",
  colors: {
    primary: "#16a34a",      // Green
    secondary: "#0f172a",
    accent: "#22c55e",
    background: "#f6f8fa"
  },
  espn: {
    leagueId: process.env.VITE_SCULPIN_LEAGUE_ID,
    defaultSeason: process.env.VITE_SCULPIN_SEASON || "2025"
  },
  adminPassword: process.env.VITE_SCULPIN_ADMIN_PASSWORD,
  database: {
    prefix: "sculpin_"
  }
};