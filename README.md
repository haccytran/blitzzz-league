# Blitzzz League

A commissioner site for two ESPN Fantasy Football leagues — **Blitzzz** and **Sculpin** — sharing one codebase. It pulls live data from the ESPN Fantasy API and adds things ESPN doesn't offer on its own: power rankings, playoff odds, a "luck index," strength of schedule, season and positional records, waiver/trade tracking, dues and buy-in tracking, weekly awards, and league polls.

**Live site:** [blitzzz-league.onrender.com](https://blitzzz-league.onrender.com)

## How it's put together

This project has three parts that work together:

1. **The website** (`src/`) — a React app built with Vite. Almost the entire interface lives in `src/App.jsx`. Visitors are routed to the Blitzzz or Sculpin version of the site either by subdomain, by a `?league=` link, or by picking a league on the landing page.
2. **The main server** (`server.mjs`) — a Node/Express backend with around 70 API routes. It talks to the Postgres database and to the ESPN Fantasy API, and serves the website's data (rosters, standings, waivers, trades, dues, polls, and so on).
3. **The stats service** (`python-stats-service/`) — a separate Python/Flask service that does the heavier number-crunching: power rankings, playoff odds, luck index, strength of schedule, season/positional records, and weekly awards. It talks to the same database.

Both the main server and the stats service are deployed as two separate services on **Render** (`blitzzz-league` and `Python`), and both auto-deploy whenever changes are pushed to the `main` branch on GitHub.

## The two leagues

| League | ESPN League ID |
|---|---|
| Blitzzz | 226912 |
| Sculpin | 58645 |

League-specific settings (name, colors, logo, ESPN league ID) live in `src/config/leagueConfigs.js`.

## Running it locally

You'll need Node.js 18+ and Python 3 installed.

**1. Install dependencies**
```
npm install
```

**2. Set up your environment variables**

Create a `.env` file in the project root (this file is never committed to GitHub — see "Environment variables" below for what goes in it).

**3. Start the site**
```
npm run dev
```
This runs the website and the Node server together. The site will be available at `http://localhost:5173` (Vite's default), with the API running at `http://localhost:8787`.

**4. (Optional) Run the Python stats service locally**
```
cd python-stats-service
pip install -r requirements.txt
python stats_service.py
```

## Environment variables

These go in a `.env` file in the project root (and the equivalent settings in Render's dashboard for the live site). None of these should ever be committed to GitHub or shared publicly:

- `DATABASE_URL` — connection string for the Postgres (Neon) database
- `SWID` and `ESPN_S2` — your ESPN login session cookies, needed to read private league data from the ESPN API
- `PORT` — which port the Node server runs on (defaults to 8787 locally)
- `VITE_ESPN_LEAGUE_ID` / `VITE_ESPN_SEASON` — default league/season used as a fallback

If ESPN starts rejecting requests to private league data, it usually means `SWID`/`ESPN_S2` have expired — log back into ESPN Fantasy in a browser and copy the fresh cookie values in to replace them (both locally in `.env` and on both Render services).

## Project structure

```
blitzzz-league/
├── server.mjs                  # Main Node/Express API server
├── src/
│   ├── App.jsx                 # Main React app (most of the UI)
│   ├── components/LandingPage.jsx
│   ├── config/leagueConfigs.js # Per-league settings
│   ├── hooks/useLeagueConfig.js
│   └── utils/leagueStorage.js
├── leagues/                    # Alternate env-var-based league config (not yet wired in)
├── python-stats-service/       # Python/Flask stats microservice
│   └── stats_service.py
├── data/                       # JSON snapshots/reports the app reads and writes at runtime
├── public/                     # Static assets (logos, favicon)
└── _archive/                   # Old file revisions kept for reference, not tracked in git
```

## Known cleanup items

A few things that are known but not yet fixed:

- `src/config/leagueConfigs.js` still hardcodes each league's admin password directly in the file, rather than reading it from an environment variable. `leagues/blitzzz.js` and `leagues/sculpin.js` show the intended environment-variable pattern, but aren't wired into the app yet.
- Several API routes in `server.mjs` are defined twice with near-identical paths (leftover from earlier edits) — functional, but worth consolidating.
- `python-stats-service/espn_debug.json` is a large (~38 MB) debug data dump that probably shouldn't be a tracked file long-term.

## History

This project has gone through a lot of iteration (with AI coding assistant help) and used to accumulate a large number of manually-saved backup copies of `server.mjs`, `App.jsx`, and other files directly in the project folder. Those have since been moved to `_archive/` (kept locally, excluded from git) — GitHub's own commit history is the source of truth for past versions going forward.
