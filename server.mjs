// --- server.mjs (Version 4.0 - Complete PostgreSQL + All Features) ---
import dotenv from "dotenv";
dotenv.config();
console.log('ESPN_S2 loaded:', !!process.env.ESPN_S2);
console.log('SWID loaded:', !!process.env.SWID);

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pkg from 'pg';
import cookieParser from 'cookie-parser';
const { Pool } = pkg;

const DEFAULT_LEAGUE_ID = process.env.VITE_ESPN_LEAGUE_ID || "";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");

const PORT = process.env.PORT || 8787;
const ADMIN_PASSWORD = process.env.VITE_ADMIN_PASSWORD || "changeme";

const app = express();
app.use(cookieParser());
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// =========================
// PostgreSQL Setup
// =========================
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

// after: const pool = new Pool({ connectionString: DATABASE_URL, ssl: ... })
pool.on('connect', (client) => {
  client.query("SET search_path = public").catch((err) => {
    console.error("Failed to set search_path to public", err);
  });
});


  // Initialize database tables
 async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS league_data (
        id SERIAL PRIMARY KEY,
        data_type VARCHAR(50) NOT NULL UNIQUE,  -- This should create the constraint
        data_key VARCHAR(100),
        data_value JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

// ADD THESE NEW TABLES:
    
    // Weekly snapshots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_snapshots (
        id SERIAL PRIMARY KEY,
        league_id VARCHAR(50) NOT NULL,
        season_id VARCHAR(20) NOT NULL,
        week_number INTEGER NOT NULL,
        snapshot_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(league_id, season_id, week_number)
      )
    `);

    // Team stats history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_stats_history (
        id SERIAL PRIMARY KEY,
        league_id VARCHAR(50) NOT NULL,
        season_id VARCHAR(20) NOT NULL,
        week_number INTEGER NOT NULL,
        team_id INTEGER NOT NULL,
        team_name VARCHAR(200) NOT NULL,
        points_for DECIMAL(10,2),
        points_against DECIMAL(10,2),
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        ties INTEGER DEFAULT 0,
        roster_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(league_id, season_id, week_number, team_id)
      )
    `);

    // League records table (for tracking all-time bests)
    await client.query(`
      CREATE TABLE IF NOT EXISTS league_records (
        id SERIAL PRIMARY KEY,
        league_id VARCHAR(50) NOT NULL,
        record_type VARCHAR(100) NOT NULL,
        record_category VARCHAR(50) NOT NULL,
        team_name VARCHAR(200),
        player_name VARCHAR(200),
        value DECIMAL(10,2),
        season_id VARCHAR(20),
        week_number INTEGER,
        set_date TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(league_id, record_type, record_category)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_lookup 
        ON weekly_snapshots(league_id, season_id, week_number)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_stats_lookup 
        ON team_stats_history(league_id, season_id, team_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_league_records_lookup 
        ON league_records(league_id, record_category)
    `);
    
    // Add this additional constraint creation to ensure it exists
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_league_data_type 
      ON league_data (data_type)
    `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS polls_data (
          id SERIAL PRIMARY KEY,
          polls JSONB DEFAULT '{}',
          votes JSONB DEFAULT '{}',
          team_codes JSONB DEFAULT '{}',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS reports (
          season_id VARCHAR(20) PRIMARY KEY,
          report_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const pollsResult = await client.query('SELECT COUNT(*) FROM polls_data');
      if (parseInt(pollsResult.rows[0].count) === 0) {
        await client.query('INSERT INTO polls_data (polls, votes, team_codes) VALUES ($1, $2, $3)', 
          ['{}', '{}', '{}']);
      }



      console.log('Database initialized successfully');
    } catch (err) {
      console.error('Database initialization error:', err);
    } finally {
      client.release();
    }
  }

  initDB().catch(console.error);
}

// =========================
// Update Node.js Server with Fallback (Python stuff)
// =========================

// Automatically detect environment
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 
  (process.env.RENDER ? 'https://python-1e1g.onrender.com' : 'http://localhost:5001');

console.log(`[ENVIRONMENT] Running in ${process.env.RENDER ? 'RENDER' : 'LOCAL'} mode`);
console.log(`[ENVIRONMENT] Python service URL: ${PYTHON_SERVICE_URL}`);

async function callPythonService(endpoint, data) {
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      timeout: 30000 // 30 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Python service error: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`[PYTHON SERVICE] ${endpoint} failed:`, error.message);
    throw error;
  }
}

// Updated power rankings endpoint with fallback
app.get("/api/leagues/:leagueId/power-rankings/:seasonId", async (req, res) => {
  try {
    const { leagueId, seasonId } = req.params;
    const { currentWeek } = req.query;
    
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    // Try Python service first
    try {
      console.log('[POWER RANKINGS] Attempting Python service...');
      const result = await callPythonService('/power-rankings', {
  leagueId: espnLeagueId,
  year: parseInt(seasonId),
  currentWeek: parseInt(currentWeek) || 4,
  espn_s2: process.env.ESPN_S2 || req.cookies?.espn_s2,
  swid: process.env.SWID || req.cookies?.swid
});
      
      console.log('[POWER RANKINGS] Python service succeeded');
      return res.json(result);
    } catch (pythonError) {
      console.log('[POWER RANKINGS] Python service failed, using JavaScript fallback');
      
      // Fallback to JavaScript implementation
      const snapshots = await getSeasonSnapshots(espnLeagueId, seasonId);
      if (snapshots.length === 0) {
        return res.status(404).json({ error: "No historical data available" });
      }
      
      const rankings = calculateDoritoStatsPowerRankings(snapshots, parseInt(currentWeek) || 4);
      return res.json({ rankings });
    }
    
  } catch (error) {
    console.error('Power rankings calculation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Updated playoff odds endpoint with fallback
app.get("/api/leagues/:leagueId/playoff-odds/:seasonId", async (req, res) => {
  try {
    const { leagueId, seasonId } = req.params;
    const { currentWeek, simulations } = req.query;
    
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    // Try Python service first
    try {
      console.log('[PLAYOFF ODDS] Attempting Python service...');
      const result = await callPythonService('/playoff-odds', {
        leagueId: espnLeagueId,
  year: parseInt(seasonId),
  currentWeek: parseInt(currentWeek) || 4,
  espn_s2: process.env.ESPN_S2 || req.cookies?.espn_s2,
  swid: process.env.SWID || req.cookies?.swid
});
      
      console.log('[PLAYOFF ODDS] Python service succeeded');
      return res.json(result);
    } catch (pythonError) {
      console.log('[PLAYOFF ODDS] Python service failed, using JavaScript fallback');
      
      // Fallback to JavaScript implementation
      const odds = await calculatePlayoffOdds({
        leagueId: espnLeagueId,
        seasonId,
        currentWeek: parseInt(currentWeek) || 4,
        numSimulations: parseInt(simulations) || 10000,
        req
      });
      
      return res.json({ playoffOdds: odds });
    }
    
  } catch (error) {
    console.error('Playoff odds calculation failed:', error);
    res.status(500).json({ error: error.message });
  }
});


app.get('/api/leagues/:leagueId/season-records', async (req, res) => {
  console.log('*** SEASON RECORDS ROUTE HIT ***', req.params, req.query);
  try {
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    const espnLeagueId = leagueConfigs[req.params.leagueId] || req.params.leagueId;
    
    const response = await fetch(`http://localhost:5001/season-records?leagueId=${espnLeagueId}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Season records error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leagues/:leagueId/positional-records', async (req, res) => {
  try {
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    const espnLeagueId = leagueConfigs[req.params.leagueId] || req.params.leagueId;
    
    const response = await fetch(`http://localhost:5001/positional-records?leagueId=${espnLeagueId}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/test-route', (req, res) => {
  res.json({ message: 'Route working!' });
});

// =========================
// Data Storage Functions
// =========================
const fpath = (name) => path.join(DATA_DIR, name);

async function readJson(name, fallback) {
  if (DATABASE_URL) {
    try {
      const client = await pool.connect();
      const result = await client.query(
        'SELECT data_value FROM league_data WHERE data_type = $1 ORDER BY updated_at DESC LIMIT 1',
        [name.replace('.json', '')]
      );
      client.release();
      return result.rows.length > 0 ? result.rows[0].data_value : fallback;
    } catch (err) {
      console.error('Database read error:', err);
      return fallback;
    }
  } else {
    try { 
      return JSON.parse(await fs.readFile(fpath(name), "utf8")); 
    } catch { 
      return fallback; 
    }
  }
}

async function writeJson(name, obj) {
  if (DATABASE_URL) {
    try {
      const client = await pool.connect();
      const dataType = name.replace('.json', '');
      
      // First try to update existing record
      const updateResult = await client.query(
        'UPDATE league_data SET data_value = $1, updated_at = CURRENT_TIMESTAMP WHERE data_type = $2',
        [JSON.stringify(obj), dataType]
      );
      
      // If no rows were updated, insert a new record
      if (updateResult.rowCount === 0) {
        await client.query(
          'INSERT INTO league_data (data_type, data_value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
          [dataType, JSON.stringify(obj)]
        );
      }
      
      client.release();
    } catch (err) {
      console.error('Database write error:', err);
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
    }
  } else {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
  }
}

// Authentication helper
const requireAdmin = (req, res, next) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Helper functions
const nid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);

// =========================
// League Data Storage
// =========================
const LEAGUE_DATA_FILE = "league_data.json";

// Update your getLeagueData function in server.mjs to include duesPayments
async function getLeagueData(leagueId = 'default') {
  const fileName = `league_data_${leagueId}.json`;
  console.log(`[SERVER] Attempting to read file: ${fileName}`);
  return await readJson(fileName, {
    announcements: [],
    weeklyList: [],
    members: [],
    waivers: [],
    buyins: {},
    duesPayments: {},
    leagueSettingsHtml: "<h2>League Settings</h2><ul><li>Scoring: Standard</li><li>Transactions counted from <b>Thu 12:00 AM PT → Wed 11:59 PM PT</b>; first two are free, then $5 each.</li></ul>",
    tradeBlock: [],
    rosters: {},
    lastUpdated: new Date().toISOString()
  });

console.log(`[SERVER] Successfully read ${fileName} with ${data.announcements?.length || 0} announcements`);
  return data;
}

async function saveLeagueData(data, leagueId = 'default') {
  data.lastUpdated = new Date().toISOString();
  const fileName = `league_data_${leagueId}.json`;
  await writeJson(fileName, data);
}
// =========================
// League Data API Routes
// =========================

// Add this simple endpoint for keep-alive pings
app.get('/api/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

// MAIN LEAGUE DATA ROUTE - PUT THIS FIRST
app.get("/api/league-data", async (req, res) => {
  try {
    const data = await getLeagueData();
    res.json(data);
  } catch (error) {
    console.error('Failed to load league data:', error);
    res.status(500).json({ error: "Failed to load league data" });
  }
});

app.get("/api/draft", async (req, res) => {
  try {
    const { leagueId, seasonId } = req.query;
    if (!leagueId || !seasonId) {
      return res.status(400).json({ error: "Missing leagueId or seasonId" });
    }

    // Get NFL teams for D/ST names (same as your console script)
    let nflTeamById = {};
    try {
      const teamsResponse = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams");
      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json();
        for (const e of (teamsData.sports?.[0]?.leagues?.[0]?.teams || [])) {
          const t = e.team;
          nflTeamById[t.id] = t.displayName || t.name || t.abbreviation;
        }
      }
    } catch (error) {
      console.log('Failed to fetch NFL teams, using fallback names');
    }

    const dstName = (negId) => {
      const teamId = Math.abs(negId) - 16000; // ESPN D/ST ids are -16000 - proTeamId
      const team = nflTeamById[teamId] || `Team ${teamId}`;
      return `${team} D/ST`;
    };

    // Get draft data
    const draftJson = await espnFetch({ 
      leagueId, 
      seasonId, 
      view: "mDraftDetail", 
      req, 
      requireCookie: true 
    });

    const rawPicks = (draftJson?.draftDetail?.picks || []).map(pick => ({
      pickNumber: pick.pickNumber || pick.overallPickNumber,
      round: pick.roundId,
      teamId: pick.teamId,
      playerId: pick.playerId || pick.player?.id,
      playerName: pick.player?.fullName || null
    })).filter(p => p.playerId && p.teamId);

    // Collect all unique player IDs that need names
    const needNames = rawPicks
      .filter(p => !p.playerName && p.playerId)
      .map(p => p.playerId);

    const uniqueIds = [...new Set(needNames)];
    const nameById = {};

    // Resolve player names
    const posIds = uniqueIds.filter(id => id > 0);
    const negIds = uniqueIds.filter(id => id < 0);

    // Resolve positive IDs via ESPN athletes API
    for (let i = 0; i < posIds.length; i += 20) {
      const batch = posIds.slice(i, i + 20);
      await Promise.all(batch.map(async id => {
        try {
          const response = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${id}`);
          if (response.ok) {
            const athlete = await response.json();
const name = athlete.fullName || athlete.displayName || athlete.name || `Player ${id}`;
const position = athlete.position?.abbreviation || "";
nameById[id] = position ? `${name} (${position})` : name;
          } else {
            nameById[id] = `Player ${id}`;
          }
        } catch (error) {
          nameById[id] = `Player ${id}`;
        }
      }));
      await sleep(100);
    }

    // Resolve D/ST names using the NFL teams data
    negIds.forEach(id => {
      nameById[id] = dstName(id);
    });

    // Apply resolved names to picks
    const picks = rawPicks.map(pick => ({
      ...pick,
      playerName: pick.playerName || nameById[pick.playerId] || `Player ${pick.playerId}`
    }));

    res.json({ picks });
  } catch (error) {
    console.error('Draft fetch error:', error);
    res.status(500).json({ error: "Failed to fetch draft data" });
  }
});

// =========================
// League-Specific API Routes
// =========================

// League-specific data endpoint
app.get("/api/leagues/:leagueId/data", async (req, res) => {
  try {
    console.log(`[SERVER] === Loading data for league: ${req.params.leagueId} ===`);
    const data = await getLeagueData(req.params.leagueId);
    console.log(`[SERVER] Loaded ${data.announcements?.length || 0} announcements for ${req.params.leagueId}`);
    
    // Log first announcement to verify data separation
    if (data.announcements?.[0]) {
      console.log(`[SERVER] First announcement preview: "${data.announcements[0].html?.substring(0, 50)}..."`);
    }
    
    res.json(data);
  } catch (error) {
    console.error(`[SERVER] Failed to load league data for ${req.params.leagueId}:`, error);
    res.status(500).json({ error: "Failed to load league data" });
  }
});

// League-specific announcements
app.post("/api/leagues/:leagueId/announcements", requireAdmin, async (req, res) => {
  try {
    const { html } = req.body;
    if (!html || !html.trim()) {
      return res.status(400).json({ error: "HTML content required" });
    }

  const data = await getLeagueData(req.params.leagueId);
    console.log('Loaded data file for league:', req.params.leagueId, 'announcements count:', data.announcements?.length || 0);
    const newAnnouncement = {
      id: nid(),
      html: html.trim(),
      createdAt: Date.now(),
      leagueId: req.params.leagueId  // Add league ID to track which league
    };
    
    data.announcements = data.announcements || [];
    data.announcements.unshift(newAnnouncement);
    await saveLeagueData(data, req.params.leagueId); 

    res.json({ success: true, announcement: newAnnouncement });
  } catch (error) {
    console.error('Failed to create announcement:', error);
    res.status(500).json({ error: "Failed to create announcement" });
  }
});

// Add similar league-specific routes for all your CRUD operations
app.delete("/api/leagues/:leagueId/announcements", requireAdmin, async (req, res) => {
  // Same logic as existing but with league context
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Announcement ID required" });
    }

  const data = await getLeagueData(req.params.leagueId); 
    data.announcements = (data.announcements || []).filter(a => a.id !== id);
    await saveLeagueData(data, req.params.leagueId); 

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete announcement:', error);
    res.status(500).json({ error: "Failed to delete announcement" });
  }
});

// Continue adding routes for: /weekly, /members, /waivers, /trading, /settings, etc.
// Each following the same pattern: /api/leagues/:leagueId/[endpoint]


// =========================
// League-Specific API Routes (Multi-League System)
// =========================

// League-specific data endpoint
app.get("/api/leagues/:leagueId/data", async (req, res) => {
  try {
    // For now, all leagues share the same data structure
    // You could later implement league-specific data storage by using req.params.leagueId
    const data = await getLeagueData();
    res.json(data);
  } catch (error) {
    console.error(`Failed to load league data for ${req.params.leagueId}:`, error);
    res.status(500).json({ error: "Failed to load league data" });
  }
});

// League-specific announcements
app.post("/api/leagues/:leagueId/announcements", requireAdmin, async (req, res) => {
  try {
    const { html } = req.body;
    if (!html || !html.trim()) {
      return res.status(400).json({ error: "HTML content required" });
    }

    const data = await getLeagueData();
    const newAnnouncement = {
      id: nid(),
      html: html.trim(),
      createdAt: Date.now(),
      leagueId: req.params.leagueId
    };
    
    data.announcements = data.announcements || [];
    data.announcements.unshift(newAnnouncement);
    await saveLeagueData(data);

    res.json({ success: true, announcement: newAnnouncement });
  } catch (error) {
    console.error('Failed to create announcement:', error);
    res.status(500).json({ error: "Failed to create announcement" });
  }
});

app.delete("/api/leagues/:leagueId/announcements", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Announcement ID required" });
    }

    const data = await getLeagueData();
    data.announcements = (data.announcements || []).filter(a => a.id !== id);
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete announcement:', error);
    res.status(500).json({ error: "Failed to delete announcement" });
  }
});

// League-specific weekly challenges
app.post("/api/leagues/:leagueId/weekly", requireAdmin, async (req, res) => {
  try {
    const { entry } = req.body;
    if (!entry) {
      return res.status(400).json({ error: "Entry required" });
    }

    const data = await getLeagueData(req.params.leagueId);
    const newEntry = { 
      ...entry, 
      id: entry.id || nid(), 
      createdAt: entry.createdAt || Date.now(),
      leagueId: req.params.leagueId
    };
    
    data.weeklyList = data.weeklyList || [];
    data.weeklyList.unshift(newEntry);
    await saveLeagueData(data, req.params.leagueId);

    res.json({ success: true, entry: newEntry });
  } catch (error) {
    console.error('Failed to create weekly challenge:', error);
    res.status(500).json({ error: "Failed to create weekly challenge" });
  }
});

app.delete("/api/leagues/:leagueId/weekly", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Challenge ID required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    data.weeklyList = (data.weeklyList || []).filter(w => w.id !== id);
    await saveLeagueData(data, req.params.leagueId);  

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete weekly challenge:', error);
    res.status(500).json({ error: "Failed to delete weekly challenge" });
  }
});

// Luck Index
app.post('/api/leagues/:leagueId/luck-index/:seasonId', async (req, res) => {
  try {
    const { leagueId, seasonId } = req.params;
    const { currentWeek } = req.query;
    
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    console.log('[LUCK INDEX] Request:', { leagueId, espnLeagueId, seasonId, currentWeek });

    const data = await callPythonService('/luck-index', {
      leagueId: espnLeagueId,
      year: parseInt(seasonId),
      currentWeek: parseInt(currentWeek) || 5,
      espn_s2: process.env.ESPN_S2 || req.cookies?.espn_s2,
      swid: process.env.SWID || req.cookies?.swid
    });

    console.log('[LUCK INDEX] Python response:', data);
    res.json(data);
  } catch (err) {
    console.error('[LUCK INDEX] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// League-specific members
app.delete("/api/leagues/:leagueId/members", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Member ID required" });
    }

     const data = await getLeagueData(req.params.leagueId);
    data.members = (data.members || []).filter(m => m.id !== id);
    data.waivers = (data.waivers || []).filter(w => w.userId !== id);
    await saveLeagueData(data, req.params.leagueId); 

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete member:', error);
    res.status(500).json({ error: "Failed to delete member" });
  }
});

// League-specific waivers
app.post("/api/leagues/:leagueId/waivers", requireAdmin, async (req, res) => {
  try {
    const { userId, player, date } = req.body;
    if (!userId || !player) {
      return res.status(400).json({ error: "User ID and player required" });
    }

    const data = await getLeagueData(req.params.leagueId);  
    const newWaiver = {
      id: nid(),
      userId,
      player: player.trim(),
      date: date || today(),
      leagueId: req.params.leagueId
    };
    
    data.waivers = data.waivers || [];
    data.waivers.unshift(newWaiver);
    await saveLeagueData(data, req.params.leagueId);

    res.json({ success: true, waiver: newWaiver });
  } catch (error) {
    console.error('Failed to add waiver:', error);
    res.status(500).json({ error: "Failed to add waiver" });
  }
});

app.delete("/api/leagues/:leagueId/waivers", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Waiver ID required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    data.waivers = (data.waivers || []).filter(w => w.id !== id);
    await saveLeagueData(data, req.params.leagueId); 

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete waiver:', error);
    res.status(500).json({ error: "Failed to delete waiver" });
  }
});

app.post("/api/leagues/:leagueId/reset-waivers", requireAdmin, async (req, res) => {
  try {
    const data = await getLeagueData(req.params.leagueId); 
    data.waivers = [];
    data.announcements = [];
    await saveLeagueData(data, req.params.leagueId);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to reset waivers:', error);
    res.status(500).json({ error: "Failed to reset waivers" });
  }
});

// League-specific trading
app.post("/api/leagues/:leagueId/trading", requireAdmin, async (req, res) => {
  try {
    const { trade } = req.body;
    if (!trade) {
      return res.status(400).json({ error: "Trade data required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    const newTrade = { 
      ...trade, 
      id: nid(), 
      createdAt: Date.now(),
      leagueId: req.params.leagueId
    };
    
    data.tradeBlock = data.tradeBlock || [];
    data.tradeBlock.unshift(newTrade);
    await saveLeagueData(data, req.params.leagueId); 

    res.json({ success: true, trade: newTrade });
  } catch (error) {
    console.error('Failed to add trade:', error);
    res.status(500).json({ error: "Failed to add trade" });
  }
});

app.delete("/api/leagues/:leagueId/trading", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Trade ID required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    data.tradeBlock = (data.tradeBlock || []).filter(t => t.id !== id);
    await saveLeagueData(data, req.params.leagueId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete trade:', error);
    res.status(500).json({ error: "Failed to delete trade" });
  }
});

// League-specific buy-ins
app.post("/api/leagues/:leagueId/buyins", requireAdmin, async (req, res) => {
  try {
    const { seasonKey, updates } = req.body;
    if (!seasonKey || !updates) {
      return res.status(400).json({ error: "Season key and updates required" });
    }

    const data = await getLeagueData(req.params.leagueId);
    data.buyins = data.buyins || {};
    data.buyins[seasonKey] = { ...data.buyins[seasonKey], ...updates };
    await saveLeagueData(data, req.params.leagueId); 

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update buy-ins:', error);
    res.status(500).json({ error: "Failed to update buy-ins" });
  }
});

// League-specific dues payments
app.post("/api/leagues/:leagueId/dues-payments", requireAdmin, async (req, res) => {
  try {
    const { seasonId, updates } = req.body;
    if (!seasonId || !updates) {
      return res.status(400).json({ error: "Season ID and updates required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    data.duesPayments = data.duesPayments || {};
    data.duesPayments[seasonId] = { ...data.duesPayments[seasonId], ...updates };
    await saveLeagueData(data, req.params.leagueId);  

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update dues payments:', error);
    res.status(500).json({ error: "Failed to update dues payments" });
  }
});

// League-specific settings
app.post("/api/leagues/:leagueId/settings", requireAdmin, async (req, res) => {
  try {
    const { html } = req.body;
    if (html === undefined || html === null) {
      return res.status(400).json({ error: "HTML content required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    data.leagueSettingsHtml = String(html).trim();
    await saveLeagueData(data, req.params.leagueId);  

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save league settings:', error);
    res.status(500).json({ error: "Failed to save league settings" });
  }
});

// League-specific team imports
app.post("/api/leagues/:leagueId/import-teams", requireAdmin, async (req, res) => {
  try {
    const { teams, seasonId, rosterData } = req.body;
    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: "Teams array required" });
    }

    const data = await getLeagueData(req.params.leagueId); 
    const existingMembers = data.members || [];
    
    const membersByName = Object.fromEntries(existingMembers.map(m => [m.name, m]));
    
    data.members = teams.map(name => {
      const existing = membersByName[name];
      return existing ? existing : { id: nid(), name };
    });
    
    if (seasonId && rosterData) {
      data.rosters = data.rosters || {};
      data.rosters[seasonId] = {
        rosterData,
        lastUpdated: new Date().toISOString()
      };
    }
    
    await saveLeagueData(data, req.params.leagueId); 
    
    res.json({ success: true, imported: teams.length });
  } catch (error) {
    console.error('Failed to import teams:', error);
    res.status(500).json({ error: "Failed to import teams" });
  }
});

// League-specific rosters route
app.get("/api/leagues/:leagueId/rosters", async (req, res) => {
  try {
    const { seasonId } = req.query;
    if (!seasonId) {
      return res.status(400).json({ error: "Season ID required" });
    }

    const data = await getLeagueData(req.params.leagueId);
    const seasonRosters = data.rosters && data.rosters[seasonId];
    
    if (seasonRosters) {
      res.json(seasonRosters);
    } else {
      res.json({ rosterData: [], lastUpdated: null });
    }
  } catch (error) {
    console.error('Failed to load rosters:', error);
    res.status(500).json({ error: "Failed to load rosters" });
  }
});

// === ANNOUNCEMENTS ===
app.post("/api/league-data/announcements", requireAdmin, async (req, res) => {
  try {
    const { html } = req.body;
    if (!html || !html.trim()) {
      return res.status(400).json({ error: "HTML content required" });
    }

    const data = await getLeagueData();
    const newAnnouncement = {
      id: nid(),
      html: html.trim(),
      createdAt: Date.now()
    };
    
    data.announcements = data.announcements || [];
    data.announcements.unshift(newAnnouncement);
    await saveLeagueData(data);

    res.json({ success: true, announcement: newAnnouncement });
  } catch (error) {
    console.error('Failed to create announcement:', error);
    res.status(500).json({ error: "Failed to create announcement" });
  }
});

app.delete("/api/league-data/announcements", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Announcement ID required" });
    }

    const data = await getLeagueData();
    data.announcements = (data.announcements || []).filter(a => a.id !== id);
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete announcement:', error);
    res.status(500).json({ error: "Failed to delete announcement" });
  }
});

// === BUY-INS ===
app.post("/api/league-data/buyins", requireAdmin, async (req, res) => {
  try {
    const { seasonKey, updates } = req.body;
    if (!seasonKey || !updates) {
      return res.status(400).json({ error: "Season key and updates required" });
    }

    const data = await getLeagueData();
    data.buyins = data.buyins || {};
    data.buyins[seasonKey] = { ...data.buyins[seasonKey], ...updates };
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update buy-ins:', error);
    res.status(500).json({ error: "Failed to update buy-ins" });
  }
});

// === WEEKLY CHALLENGES ===
app.post("/api/league-data/weekly", requireAdmin, async (req, res) => {
  try {
    const { entry } = req.body;
    if (!entry) {
      return res.status(400).json({ error: "Entry required" });
    }

    const data = await getLeagueData();
    const newEntry = { ...entry, id: entry.id || nid(), createdAt: entry.createdAt || Date.now() };
    
    data.weeklyList = data.weeklyList || [];
    data.weeklyList.unshift(newEntry);
    await saveLeagueData(data);

    res.json({ success: true, entry: newEntry });
  } catch (error) {
    console.error('Failed to create weekly challenge:', error);
    res.status(500).json({ error: "Failed to create weekly challenge" });
  }
});

app.delete("/api/league-data/weekly", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Challenge ID required" });
    }

    const data = await getLeagueData();
    data.weeklyList = (data.weeklyList || []).filter(w => w.id !== id);
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete weekly challenge:', error);
    res.status(500).json({ error: "Failed to delete weekly challenge" });
  }
});

// === MEMBERS ===
app.post("/api/league-data/members", requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Member name required" });
    }

    const data = await getLeagueData();
    const newMember = { id: nid(), name: name.trim() };
    
    data.members = data.members || [];
    data.members.push(newMember);
    await saveLeagueData(data);

    res.json({ success: true, member: newMember });
  } catch (error) {
    console.error('Failed to add member:', error);
    res.status(500).json({ error: "Failed to add member" });
  }
});

app.delete("/api/league-data/members", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Member ID required" });
    }

    const data = await getLeagueData();
    data.members = (data.members || []).filter(m => m.id !== id);
    data.waivers = (data.waivers || []).filter(w => w.userId !== id);
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete member:', error);
    res.status(500).json({ error: "Failed to delete member" });
  }
});

// === ROSTERS ===
app.post("/api/league-data/import-teams", requireAdmin, async (req, res) => {
  try {
    const { teams, seasonId, rosterData } = req.body;
    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: "Teams array required" });
    }

    const data = await getLeagueData();
    const existingMembers = data.members || [];
    
    // Create a map of existing members by name to preserve IDs
    const membersByName = Object.fromEntries(existingMembers.map(m => [m.name, m]));
    
    // Import teams while preserving existing member IDs where possible
    data.members = teams.map(name => {
      const existing = membersByName[name];
      return existing ? existing : { id: nid(), name };
    });
    
    // Store roster data if provided
    if (seasonId && rosterData) {
      data.rosters = data.rosters || {};
      data.rosters[seasonId] = {
        rosterData,
        lastUpdated: new Date().toISOString()
      };
    }
    
    await saveLeagueData(data);
    
    res.json({ success: true, imported: teams.length });
  } catch (error) {
    console.error('Failed to import teams:', error);
    res.status(500).json({ error: "Failed to import teams" });
  }
});

app.get("/api/league-data/rosters", async (req, res) => {
  try {
    const { seasonId } = req.query;
    if (!seasonId) {
      return res.status(400).json({ error: "Season ID required" });
    }

    const data = await getLeagueData();
    const seasonRosters = data.rosters && data.rosters[seasonId];
    
    if (seasonRosters) {
      res.json(seasonRosters);
    } else {
      res.json({ rosterData: [], lastUpdated: null });
    }
  } catch (error) {
    console.error('Failed to load rosters:', error);
    res.status(500).json({ error: "Failed to load rosters" });
  }
});

// Capture weekly snapshot endpoint
app.post("/api/leagues/:leagueId/snapshot", requireAdmin, async (req, res) => {
  try {
    const { seasonId, weekNumber } = req.body;
    const { leagueId } = req.params;
    
    if (!seasonId || !weekNumber) {
      return res.status(400).json({ error: "Season ID and week number required" });
    }

    // Map frontend league ID to ESPN league ID
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;

    const snapshot = await captureWeeklySnapshot({
      leagueId: espnLeagueId,
      seasonId,
      weekNumber,
      req
    });

    res.json({ success: true, snapshot });
  } catch (error) {
    console.error('Snapshot capture failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get weekly snapshot
app.get("/api/leagues/:leagueId/snapshot/:seasonId/:weekNumber", async (req, res) => {
  try {
    const { leagueId, seasonId, weekNumber } = req.params;
    
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    const snapshot = await getWeeklySnapshot(espnLeagueId, seasonId, parseInt(weekNumber));
    
    if (snapshot) {
      res.json(snapshot);
    } else {
      res.status(404).json({ error: "Snapshot not found" });
    }
  } catch (error) {
    console.error('Failed to retrieve snapshot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all snapshots for a season
app.get("/api/leagues/:leagueId/snapshots/:seasonId", async (req, res) => {
  try {
    const { leagueId, seasonId } = req.params;
    
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    const snapshots = await getSeasonSnapshots(espnLeagueId, seasonId);
    res.json({ snapshots });
  } catch (error) {
    console.error('Failed to retrieve snapshots:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get team history
app.get("/api/leagues/:leagueId/team-history/:seasonId/:teamId", async (req, res) => {
  try {
    const { leagueId, seasonId, teamId } = req.params;
    
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    const history = await getTeamHistory(espnLeagueId, seasonId, parseInt(teamId));
    res.json({ history });
  } catch (error) {
    console.error('Failed to retrieve team history:', error);
    res.status(500).json({ error: error.message });
  }
});


// Strength of schedule - PROXY TO PYTHON
app.get("/api/leagues/:leagueId/strength-of-schedule/:seasonId", async (req, res) => {
  try {
    const { leagueId, seasonId } = req.params;
    const currentWeek = parseInt(req.query.currentWeek) || 1;
    
    // Map friendly league IDs to ESPN IDs
    const leagueConfigs = {
      'blitzzz': '226912',
      'sculpin': '58645'
    };
    
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;
    
    console.log(`[SOS] Calling Python service for league: ${espnLeagueId}, season: ${seasonId}, week: ${currentWeek}`);

    // Call Python service for SOS calculation
    const pythonResponse = await fetch(`http://localhost:5001/strength-of-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: espnLeagueId,
        seasonId: seasonId,
        currentWeek: currentWeek
      })
    });

    if (!pythonResponse.ok) {
      throw new Error(`Python service returned ${pythonResponse.status}`);
    }

    const pythonData = await pythonResponse.json();
    console.log(`[SOS] Python service succeeded`);
    
    res.json(pythonData);
    
  } catch (error) {
    console.error('[SOS] Python service failed:', error);
    res.status(500).json({ 
      error: 'Failed to calculate strength of schedule',
      details: error.message 
    });
  }
});

app.post("/api/league-data/reset-waivers", requireAdmin, async (req, res) => {
  try {
    const data = await getLeagueData();
    data.waivers = [];
    data.announcements = [];
    await saveLeagueData(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to reset waivers:', error);
    res.status(500).json({ error: "Failed to reset waivers" });
  }
});

// === LEAGUE SETTINGS ===
app.post("/api/league-data/settings", requireAdmin, async (req, res) => {
  try {
    const { html } = req.body;
    if (html === undefined || html === null) {
      return res.status(400).json({ error: "HTML content required" });
    }

    const data = await getLeagueData();
    data.leagueSettingsHtml = String(html).trim();
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save league settings:', error);
    res.status(500).json({ error: "Failed to save league settings" });
  }
});

// === TRADING BLOCK ===
app.post("/api/league-data/trading", requireAdmin, async (req, res) => {
  try {
    const { trade } = req.body;
    if (!trade) {
      return res.status(400).json({ error: "Trade data required" });
    }

    const data = await getLeagueData();
    const newTrade = { ...trade, id: nid(), createdAt: Date.now() };
    
    data.tradeBlock = data.tradeBlock || [];
    data.tradeBlock.unshift(newTrade);
    await saveLeagueData(data);

    res.json({ success: true, trade: newTrade });
  } catch (error) {
    console.error('Failed to add trade:', error);
    res.status(500).json({ error: "Failed to add trade" });
  }
});


app.delete("/api/league-data/trading", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Trade ID required" });
    }

    const data = await getLeagueData();
    data.tradeBlock = (data.tradeBlock || []).filter(t => t.id !== id);
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete trade:', error);
    res.status(500).json({ error: "Failed to delete trade" });
  }
});

// === DUES PAYMENTS ===
app.post("/api/league-data/dues-payments", requireAdmin, async (req, res) => {
  try {
    const { seasonId, updates } = req.body;
    if (!seasonId || !updates) {
      return res.status(400).json({ error: "Season ID and updates required" });
    }

    const data = await getLeagueData();
    data.duesPayments = data.duesPayments || {};
    data.duesPayments[seasonId] = { ...data.duesPayments[seasonId], ...updates };
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update dues payments:', error);
    res.status(500).json({ error: "Failed to update dues payments" });
  }
});

// =========================
// Polls System
// =========================
async function loadPolls() {
  console.log('=== LOADPOLLS DEBUG ===');
  console.log('DATABASE_URL exists:', !!DATABASE_URL);
  
  if (DATABASE_URL) {
    try {
      console.log('Trying to load from database...');
      const client = await pool.connect();
      const result = await client.query('SELECT * FROM polls_data ORDER BY updated_at DESC LIMIT 1');
      client.release();
      
      console.log('Database query result:', result.rows.length, 'rows');
      if (result.rows.length > 0) {
        console.log('Database polls data:', result.rows[0].polls);
        console.log('Database votes data:', result.rows[0].votes);
        
        return {
          polls: result.rows[0].polls || {},
          votes: result.rows[0].votes || {},
          teamCodes: result.rows[0].team_codes || {}
        };
      }
    } catch (err) {
      console.error('Database polls load error:', err);
    }
  }
  
  console.log('Trying to load from file system...');
  const fileResult = await readJson("polls.json", { polls: {}, votes: {}, teamCodes: {} });
  console.log('File system polls data:', fileResult);
  console.log('=== END LOADPOLLS DEBUG ===');
  
  return fileResult;
}

async function savePolls(pollsState) {
  console.log('=== SAVEPOLLS DEBUG ===');
  console.log('Saving polls state:', pollsState);
  console.log('Polls object:', pollsState.polls);
  console.log('Polls type:', typeof pollsState.polls);
  console.log('Polls keys:', Object.keys(pollsState.polls || {}));
  
  if (DATABASE_URL) {
    try {
      const client = await pool.connect();
      
      // Delete any duplicate/empty rows first
      await client.query('DELETE FROM polls_data WHERE id > 1');
      
      // Update the first row (which has your existing data)
      const updateResult = await client.query(
        'UPDATE polls_data SET polls = $1, votes = $2, team_codes = $3, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
        [JSON.stringify(pollsState.polls || {}), JSON.stringify(pollsState.votes || {}), JSON.stringify(pollsState.teamCodes || {})]
      );
      
      // If no row exists with id=1, insert it
      if (updateResult.rowCount === 0) {
        await client.query(
          'INSERT INTO polls_data (id, polls, votes, team_codes) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET polls = $1, votes = $2, team_codes = $3, updated_at = CURRENT_TIMESTAMP',
          [JSON.stringify(pollsState.polls || {}), JSON.stringify(pollsState.votes || {}), JSON.stringify(pollsState.teamCodes || {})]
        );
      }
      
      client.release();
      console.log('Saved to database');
    } catch (err) {
      console.error('Database polls save error:', err);
      // Fall back to file system
      await writeJson("polls.json", pollsState);
    }
  } else {
    console.log('Saving to file system...');
    await writeJson("polls.json", pollsState);
    console.log('Saved to file system');
  }
  console.log('=== END SAVEPOLLS DEBUG ===');
}

const FRIENDLY_WORDS = [
  "MANGO","FALCON","TIGER","ORCA","BISON","HAWK","PANDA","EAGLE","MAPLE","CEDAR","ONYX","ZINC",
  "SAPPHIRE","COBALT","QUARTZ","NEON","NOVA","COMET","BOLT","BLITZ","STORM","GLACIER","RAPTOR",
  "VIPER","COUGAR","WOLF","SHARK","LYNX","OTTER","MOOSE","BEAR","FOX","RAVEN","ROBIN","DRAGON",
  "PHOENIX","ORBIT","ROCKET","ATLAS","APEX","DELTA","OMEGA","THUNDER","SURGE","WAVE","EMBER",
  "FROST","POLAR","COSMIC","SHADOW","AQUA"
];
const randomFriendlyCode = () => FRIENDLY_WORDS[Math.floor(Math.random() * FRIENDLY_WORDS.length)];

app.post("/api/polls/issue-team-codes", async (req, res) => {
  const adminHeader = req.header("x-admin");
  const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];  // ← Make sure this line exists
  if (!validPasswords.includes(adminHeader)) {
    return res.status(401).send("Unauthorized");
  }
  
  const { seasonId, teams } = req.body || {};
  if (!seasonId || !Array.isArray(teams)) return res.status(400).send("Missing seasonId or teams[]");
  
  // ... rest of the function stays the same  
  const pollsState = await loadPolls();
  const used = new Set(Object.values(pollsState.teamCodes || {}).map(v => v.code));
  const issued = [];
  
  for (const t of teams) {
    const key = `${seasonId}:${t.id}`;
    if (!pollsState.teamCodes[key]) {
      let code;
      do { code = randomFriendlyCode(); } while (used.has(code));
      used.add(code);
      pollsState.teamCodes[key] = { code, createdAt: Date.now() };
    }
    issued.push({ teamId: t.id, teamName: t.name, code: pollsState.teamCodes[key].code });
  }
  
  await savePolls(pollsState);
  res.json({ issued: issued.length, codes: issued });
});

app.post("/api/polls/vote", async (req, res) => {
  const { pollId, optionId, seasonId, teamCode } = req.body || {};
  if (!pollId || !optionId || !seasonId || !teamCode) return res.status(400).send("Missing fields");
  
  const pollsState = await loadPolls();
  let teamId = null;
  
  for (const [k,v] of Object.entries(pollsState.teamCodes)) {
    if (k.startsWith(`${seasonId}:`) && String(v.code).toUpperCase() === String(teamCode).toUpperCase()) { 
      teamId = Number(k.split(":")[1]); 
      break; 
    }
  }
  
  if (!teamId) return res.status(403).send("Invalid code");
  
  const poll = pollsState.polls[pollId];
  if (poll && poll.closed) return res.status(423).send("This poll is closed");
  
  pollsState.votes[pollId] = pollsState.votes[pollId] || {};
  pollsState.votes[pollId][teamId] = optionId;
  
  await savePolls(pollsState);
  res.json({ ok: true, byTeam: pollsState.votes[pollId] });
});

app.get("/api/polls", async (req, res) => {
  const seasonId = String(req.query?.seasonId || "");
  const leagueId = String(req.query?.leagueId || "default");  // ← ADD THIS
  const pollsState = await loadPolls();
  
  console.log('=== POLLS DEBUG ===');
  console.log('Request seasonId:', seasonId);
  console.log('Request leagueId:', leagueId);  // ← ADD THIS
  console.log('All polls in state:', Object.keys(pollsState.polls || {}));
  
  // Filter polls by league  ← ADD THIS FILTERING
  const leaguePolls = Object.values(pollsState.polls || {}).filter(p => 
    (p.leagueId || 'default') === leagueId
  );
  
  const out = leaguePolls.map(p => {  // ← CHANGE FROM Object.values to leaguePolls
    const byTeam = pollsState.votes?.[p.id] || {};
    const tally = {};
    Object.values(byTeam).forEach(opt => { tally[opt] = (tally[opt] || 0) + 1; });
    const codesTotal = seasonId
      ? Object.keys(pollsState.teamCodes || {}).filter(k => k.startsWith(`${seasonId}:`)).length
      : Object.keys(pollsState.teamCodes || {}).length;
    return {
      id: p.id, question: p.question, closed: !!p.closed,
      options: (p.options || []).map(o => ({ id: o.id, label: o.label, votes: tally[o.id] || 0 })),
      codesUsed: Object.keys(byTeam).length, codesTotal
    };
  });
  
  console.log('Filtered output for league:', leagueId, out.length, 'polls');
  console.log('=== END POLLS DEBUG ===');
  
  res.json({ polls: out });
});

app.post("/api/polls/create", async (req, res) => {
  const adminHeader = req.header("x-admin");
  const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];
  if (!validPasswords.includes(adminHeader)) {
    return res.status(401).send("Unauthorized");
  }
  
  const { question, options, leagueId } = req.body || {};  // ← ADD leagueId
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).send("Bad request");
  
  const pollsState = await loadPolls();
  const id = nid();
  pollsState.polls[id] = { 
    id, 
    question: String(question), 
    closed: false, 
    leagueId: leagueId || 'default',  // ← ADD THIS LINE
    options: options.map(label => ({ id: nid(), label: String(label) })) 
  };
  
  await savePolls(pollsState);
  res.json({ ok: true, pollId: id });
});

app.post("/api/polls/close", async (req, res) => {
  const adminHeader = req.header("x-admin");
  const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];
  if (!validPasswords.includes(adminHeader)) {
    return res.status(401).send("Unauthorized");
  }
  const { pollId, closed } = req.body || {};
  
  const pollsState = await loadPolls();
  if (!pollId || !pollsState.polls[pollId]) return res.status(404).send("Not found");
  
  pollsState.polls[pollId].closed = !!closed;
  await savePolls(pollsState);
  res.json({ ok: true });
});

app.post("/api/polls/delete", async (req, res) => {
  const adminHeader = req.header("x-admin");
  const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];
  if (!validPasswords.includes(adminHeader)) {
    return res.status(401).send("Unauthorized");
  }
  
  const { pollId } = req.body || {};  // ← ADD THIS LINE
  if (!pollId) return res.status(400).send("Missing pollId");
  
  const pollsState = await loadPolls();
  if (pollsState.polls[pollId]) delete pollsState.polls[pollId];
  if (pollsState.votes[pollId]) delete pollsState.votes[pollId];
  
  await savePolls(pollsState);
  res.json({ ok: true });
});

app.post("/api/polls/edit", async (req, res) => {
  const adminHeader = req.header("x-admin");
  const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];
  if (!validPasswords.includes(adminHeader)) {
    return res.status(401).send("Unauthorized");
  }
  
  const { pollId, question, newOptions } = req.body || {};  // ← ADD THIS LINE
  if (!pollId || !question || !Array.isArray(newOptions)) return res.status(400).send("Bad request");
  
  const pollsState = await loadPolls();
  const poll = pollsState.polls[pollId];
  if (!poll) return res.status(404).send("Poll not found");
  
  poll.question = String(question);
  const existingOptionIds = new Set(poll.options.map(o => o.id));
  
  for (const newOption of newOptions) {
    if (!poll.options.find(o => o.label === newOption)) {
      poll.options.push({ id: nid(), label: String(newOption) });
    }
  }
  
  await savePolls(pollsState);
  res.json({ ok: true });
});
app.get("/api/polls/team-codes", async (req, res) => {
  const adminHeader = req.header("x-admin");
  const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];  // ← UPDATE THIS LINE
  if (!validPasswords.includes(adminHeader)) {
    return res.status(401).send("Unauthorized");
  }
  
  const seasonId = req.query?.seasonId;
  if (!seasonId) return res.status(400).send("Missing seasonId");
  
  // ... rest of function unchanged  
  const pollsState = await loadPolls();
  const rows = [];
  
  for (const [k,v] of Object.entries(pollsState.teamCodes || {})) {
    if (k.startsWith(`${seasonId}:`)) {
      rows.push({ teamId: Number(k.split(":")[1]), code: v.code, createdAt: v.createdAt });
    }
  }
  
  res.json({ codes: rows });
});

// =========================
// Progress tracking for ESPN operations
// =========================
const jobProgress = new Map();
function setProgress(jobId, pct, msg) {
  if (!jobId) return;
  jobProgress.set(jobId, { 
    pct: Math.max(0, Math.min(100, Math.round(pct))), 
    msg: String(msg || ""), 
    t: Date.now() 
  });
}
app.get("/api/progress", (req, res) => {
  const { jobId } = req.query || {};
  res.json(jobProgress.get(jobId) || { pct: 0, msg: "" });
});

// =========================
// Week helpers
// =========================
const WEEK_START_DAY = 3;
function fmtPT(dateLike){ return new Date(dateLike).toLocaleString(); }
function normalizeEpoch(x){
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  
  // Handle very large timestamps (likely already in milliseconds but incorrect)
  if (x > 1e15) return Date.now(); // Use current time for corrupted timestamps
  
  // Check if it's already in milliseconds (13 digits) vs seconds (10 digits)
  if (x > 1e12) return x; // Already milliseconds
  if (x > 1e9 && x < 1e12) return x * 1000; // Convert seconds to milliseconds
  
  return x;
}

function isWithinWaiverWindow(dateLike){
  const z = new Date(dateLike);
  if (z.getDay() !== 4) return false; // Thursday
  const minutes = z.getHours()*60 + z.getMinutes();
  return minutes <= 4*60 + 30; // 4:30 AM (keep same early morning window)
}
function startOfLeagueWeek(date){
  const z = new Date(date);
  const base = new Date(z); base.setHours(0,0,0,0);
  const back = (base.getDay() - WEEK_START_DAY + 7) % 7;
  base.setDate(base.getDate() - back);
  if (z < base) base.setDate(base.getDate() - 7);
  return base;
}
function firstWednesdayOfSeptember(year){
  const d = new Date(year, 8, 1);
  const offset = (3 - d.getDay() + 7) % 7; // 3 = Wednesday
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}
const DAY = 24*60*60*1000;
function weekBucket(date, seasonYear) {
  const z = new Date(date);
  const w1 = firstWednesdayOfSeptember(Number(seasonYear)); // Updated to use Thursday
  const diff = z.getTime() - w1.getTime();
  let week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
if (week < 1) week = 0; // Pre-season
  const start = new Date(w1.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  return { week, start };
}


function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeek(date);
  const week1 = startOfLeagueWeek(firstWednesdayOfSeptember(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0;
  return { week, start };
}

function weekRangeLabelDisplay(start){
  const wed = new Date(start); wed.setHours(0,0,0,0);
  const tue = new Date(wed); tue.setDate(tue.getDate()+6); tue.setHours(23,59,0,0);
  const short = (d)=> new Date(d).toLocaleDateString(undefined,{month:"short", day:"numeric"});
  return `${short(wed)}—${short(tue)} (cutoff Tue 11:59 PM PT)`; // Fixed: Use proper em dash
}

// Enhanced method inference with better classification
function enhancedInferMethod(typeStr, typeNum, transaction, item) {
  const s = String(typeStr ?? "").toUpperCase();
  
  // Handle ESPN's execution types directly
  if (transaction?.executionType) {
    const execType = String(transaction.executionType).toUpperCase();
    if (execType === "CANCEL") return "CANCEL";
    if (execType === "PROCESS") return "PROCESS"; // Waivers
    if (execType === "EXECUTE") return "EXECUTE"; // Free agents
  }
  
  // Fallback to string matching
  if (/CANCEL/i.test(s)) return "CANCEL";
  if (/PROCESS|WAIVER/i.test(s)) return "PROCESS";
  if (/EXECUTE/i.test(s)) return "EXECUTE";
  if (/DRAFT/i.test(s) || typeNum === 0) return "DRAFT";
  
  // Default fallback
  return "EXECUTE";
}

// Enhanced draft data fetching
async function fetchDraftData({ leagueId, seasonId, req, onProgress }) {
  onProgress?.(0, 1, "Fetching draft data...");
  
  try {
    const draftJson = await espnFetch({ 
      leagueId, seasonId, view: "mDraftDetail", req, requireCookie: true 
    });
    
    const picks = (draftJson?.draftDetail?.picks || []).map(pick => ({
      teamId: pick.teamId,
      playerId: pick.playerId || pick.player?.id,
      pickNumber: pick.pickNumber || pick.overallPickNumber,
      round: pick.roundId,
      executionDate: pick.date || draftJson?.draftDetail?.draftSettings?.date
    })).filter(p => p.playerId && p.teamId);
    
    console.log(`[DEBUG] Found ${picks.length} draft picks`);
    return picks;
  } catch (error) {
    console.error('[DEBUG] Failed to fetch draft data:', error.message);
    return [];
  }
}

// Enhanced transaction validation with draft awareness
function isGenuineAddWithDraftContext(move, series, draftPicks, seasonYear) {
  if (move.method === "DRAFT") return true;
  if (!move.playerId) return true;
  
  const teamId = move.teamIdRaw || move.teamId;
  const playerId = move.playerId; // Define playerId here
  
  const wasDrafted = draftPicks.some(pick => 
    pick.teamId === teamId && pick.playerId === playerId
  );
  
  if (wasDrafted) {
    console.log(`[DEBUG] Player ${playerId} was drafted by team ${teamId}, skipping add validation`);
    return false;
  }
  
  return isGenuineAddBySeries(move, series, seasonYear);
}

const isOwnerAtSomeSP = (series, pid, teamId, sp) => {
  const candidates = [sp, sp-1, sp+1].filter(x => x>=1 && x < series.roster.length);
  return candidates.some(s => series.roster?.[s]?.[teamId]?.has(pid));
};

// Replace your validateTransactions function with this ChatGPT-inspired approach:

async function validateTransactions(transactions, series, draftPicks, seasonYear, { leagueId, seasonId, req }) {
  console.log(`[DEBUG] Starting roster-verified validation of ${transactions.length} raw transactions`);
  
  // Step 1: Only filter out CANCEL transactions
  let validTransactions = transactions.filter(t => t.method !== "CANCEL");
  console.log(`[DEBUG] After CANCEL filtering: ${validTransactions.length} transactions`);
  
  // Step 2: Build paired transactions by txId
  const txPairsByKey = new Map();
  
  for (const r of validTransactions) {
    const txId = r.eventId || `${r.teamIdRaw || r.teamId}-${Math.floor(new Date(r.date).getTime() / 1000)}`;
    const key = `${txId}|${r.teamIdRaw || r.teamId}`;
    
    let rec = txPairsByKey.get(key);
    if (!rec) {
      rec = { 
        txId, 
        ts: new Date(r.date).getTime(), 
        method: r.method, 
        sp: r.sp || weekBucket(r.date, seasonId).week,
        teamId: r.teamIdRaw || r.teamId,
        teamIdRaw: r.teamIdRaw || r.teamId,
        team: r.team,
        add: null, 
        drop: null,
        originalTransaction: r,
        bidAmount: r.bidAmount,
        executionType: r.executionType
      };
      txPairsByKey.set(key, rec);
    }
    
    if (r.action === "ADD") rec.add = r.playerId;
    if (r.action === "DROP") rec.drop = r.playerId;
  }
  
  const txPairs = [...txPairsByKey.values()].filter(x => x.add || x.drop);
  console.log(`[DEBUG] Built ${txPairs.length} transaction pairs`);
  
  // Build a map of all drops to detect later drops of added players
  const allDrops = new Map(); // playerId -> [{teamId, timestamp}, ...]
  for (const rec of txPairs) {
    if (rec.drop) {
      if (!allDrops.has(rec.drop)) allDrops.set(rec.drop, []);
      allDrops.get(rec.drop).push({ teamId: rec.teamId, ts: rec.ts });
    }
  }
  
  // Process transactions
  const kept = [];
  let processWinners = 0;
  let processLosers = 0;
  
  for (const rec of txPairs) {
    // Always keep EXECUTE transactions (Free Agents)
    if (rec.method === "EXECUTE") {
      kept.push(rec);
      continue;
    }
    
    // Always keep standalone drops
    if (rec.drop && !rec.add) {
      kept.push(rec);
      continue;
    }
    
    // For PROCESS transactions with adds
    if (rec.method === "PROCESS" && rec.add) {
      // Check roster to verify if player was actually added
      const onRoster = isOwnerAtSomeSP(series, rec.add, rec.teamId, rec.sp);
      
      // Check if this player was dropped by the same team later
      const laterDropped = allDrops.get(rec.add)?.some(drop => 
        drop.teamId === rec.teamId && drop.ts > rec.ts
      ) || false;
      
      // For waiver claims with bid amounts
      if (rec.bidAmount !== null && rec.bidAmount !== undefined) {
        // If it has a bid amount, it's likely a real waiver claim
        // Keep it if: on roster OR was later dropped by same team
        if (onRoster || laterDropped) {
          kept.push(rec);
          processWinners++;
          console.log(`[DEBUG] Waiver winner (bid $${rec.bidAmount}): Team ${rec.teamId} gets player ${rec.add}${laterDropped ? ' (later dropped)' : ''}`);
        } else {
          processLosers++;
          console.log(`[DEBUG] Failed waiver bid: Team ${rec.teamId} bid $${rec.bidAmount} for ${rec.add} but didn't get them`);
        }
      } else {
        // No bid amount - use roster check
        if (onRoster || laterDropped) {
          kept.push(rec);
          processWinners++;
        } else {
          processLosers++;
          console.log(`[DEBUG] No roster match for PROCESS add pid=${rec.add}, team=${rec.teamId}, sp=${rec.sp}`);
        }
      }
      continue;
    }
    
    // Keep any other transactions
    kept.push(rec);
  }
  
  console.log(`[DEBUG] Waiver processing: ${processWinners} winners, ${processLosers} losers filtered out`);
  
  // Expand back to individual transactions
  const finalTransactions = [];
  
  for (const r of kept) {
    const baseTransaction = {
      date: new Date(r.ts),
      teamIdRaw: r.teamIdRaw,
      teamId: r.teamId,
      team: r.team,
      method: r.method,
      eventId: r.txId,
      src: r.originalTransaction.src || "validated",
      playerName: null,
      bidAmount: r.bidAmount
    };
    
    if (r.add) {
      finalTransactions.push({
        ...baseTransaction,
        action: "ADD",
        playerId: r.add
      });
    }
    
    if (r.drop) {
      finalTransactions.push({
        ...baseTransaction,
        action: "DROP",
        playerId: r.drop
      });
    }
  }
  
  // Final deduplication
  const seen = new Set();
  const dedupedFinal = finalTransactions.filter(r => {
    const k = `${r.date.getTime()}|${r.teamIdRaw}|${r.playerId}|${r.action}|${r.method}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  
  console.log(`[DEBUG] Final validation results: ${dedupedFinal.length} transactions`);
  
  // Debug logging for 4th Gen And Goal
  const fourthGenTransactions = dedupedFinal.filter(t => t.team === "4th Gen And Goal");
  console.log(`[DEBUG] 4th Gen And Goal transactions: ${fourthGenTransactions.length}`);
  fourthGenTransactions.forEach(t => {
    console.log(`  - ${t.action} ${t.playerId} on ${t.date.toISOString()} via ${t.method}${t.bidAmount ? ` ($${t.bidAmount})` : ''}`);
  });
  
  return dedupedFinal;
}

// =========================
// ESPN proxy
// =========================
// =========================
// ESPN proxy
// =========================
function buildCookie(req) {
  const hdr = req.headers["x-espn-cookie"];
  if (hdr) return String(hdr);
  const swid = process.env.SWID;
  const s2   = process.env.ESPN_S2 || process.env.S2;
  
  console.log("Building cookie - SWID:", swid ? "present" : "missing", "S2:", s2 ? "present" : "missing");
  
  if (swid && s2) return `SWID=${swid}; ESPN_S2=${s2}`;
  if (swid) return `SWID=${swid}`;  // Use just SWID
  if (process.env.ESPN_COOKIE) return process.env.ESPN_COOKIE;
  return "";
}

const BROWSER_HEADERS = {
  "x-fantasy-source": "kona",
  "x-fantasy-platform": "kona",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://fantasy.espn.com",
  "Referer": "https://fantasy.espn.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
};

async function tryFetchJSON(url, requireCookie, req) {
  const headers = { ...BROWSER_HEADERS };
  if (requireCookie) {
    const ck = buildCookie(req);
    if (ck) headers.Cookie = ck;
  }
  const r = await fetch(url, { headers });
  const text = await r.text();
  try { 
    return { ok:true, json: JSON.parse(text), status: r.status }; 
  } catch {
    return { ok:false, status: r.status, snippet: text.slice(0,200).replace(/\s+/g," "), ct: r.headers.get("content-type") || "" };
  }
}

async function espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie = false }) {
  if (!leagueId || !seasonId || !view) throw new Error("Missing leagueId/seasonId/view");
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const bust = `&_=${Date.now()}`;
  const v = encodeURIComponent(view);
  const urls = [
    `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${v}${sp}${bust}`,
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${v}${sp}${bust}`,
    `https://site.web.api.espn.com/apis/fantasy/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${v}${sp}${bust}`
  ];
  let last = null;
  for (const url of urls) {
    const res = await tryFetchJSON(url, requireCookie, req);
    if (res.ok) return res.json;
    last = res;
  }
  throw new Error(`ESPN non-JSON for ${view}${scoringPeriodId?` (SP ${scoringPeriodId})`:""}; status ${last?.status}; ct ${last?.ct}; snippet: ${last?.snippet}`);
}

app.get("/api/espn", async (req, res) => {
  try {
    const { leagueId, seasonId, view, scoringPeriodId, auth } = req.query;
    console.log(`[Server ESPN] Fetching ${view} for league ${leagueId}, season ${seasonId}${scoringPeriodId ? `, SP ${scoringPeriodId}` : ''}`);
    const startTime = Date.now();
    
    const json = await espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie: auth === "1" });
    
    const elapsed = Date.now() - startTime;
    console.log(`[Server ESPN] Success ${view}: ${elapsed}ms`);
    res.json(json);
  } catch (e) { 
    console.error(`[Server ESPN] Failed ${req.query.view}:`, e.message);
    res.status(502).send(String(e.message || e)); 
  }
});

// =========================
// Transactions and Reports
// =========================
const REPORT_FILE = "report.json";
const teamName = (t) => (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`);

function posIdToName(id) {
  const map = { 
    0: "QB", 1: "TQB", 2: "RB", 3: "WR", 4: "WR",
    5: "WR/TE", 6: "TE", 16: "DEF", 17: "K"
  };
  return map?.[id] || "—";
}

function slotIdToName(lineupSlotCounts) {
  const map = {
    0: "QB", 2: "RB", 3: "RB/WR", 4: "WR",
    6: "TE", 16: "D/ST", 17: "K", 20: "Bench",
    21: "IR", 23: "FLEX"
  };
  return new Proxy(map, {
    get: (target, prop) => target[prop] || "—"
  });
}

function inferMethod(typeStr, typeNum, t, it){
  const s = String(typeStr ?? "").toUpperCase();
  const ts = normalizeEpoch(t?.processDate ?? t?.proposedDate ?? t?.executionDate ?? t?.date ?? Date.now());
  if (/WAIVER|CLAIM/.test(s)) return "WAIVER";
  if ([5,7].includes(typeNum)) return "WAIVER";
  if (t?.waiverProcessDate || it?.waiverProcessDate) return "WAIVER";
  if (t?.bidAmount != null || t?.winningBid != null) return "WAIVER";
  if (isWithinWaiverWindow(ts)) return "WAIVER";
  return "FA";
}

const pickPlayerId = (it) => it?.playerId ?? it?.playerPoolEntry?.player?.id ?? it?.entityId ?? null;
const pickPlayerName = (it,t) => it?.playerPoolEntry?.player?.fullName || it?.player?.fullName || t?.playerPoolEntry?.player?.fullName || t?.player?.fullName || null;

function extractMoves(json, src="tx"){
  console.log(`[DEBUG] extractMoves called with src="${src}", data keys:`, Object.keys(json || {}));
  console.log(`[DEBUG] Transaction count:`, json?.transactions?.length || 0);
  
// COMPREHENSIVE DEBUG - CHECK ALL UNDERACHIEVERS TRANSACTIONS
  if (json?.transactions) {
    const underachieverTransactions = json.transactions.filter(t => {
      // Check if any team ID matches The Underachievers (look for team 19 based on your data)
      return t.teamId === 19 || t.toTeamId === 19 || t.fromTeamId === 19 ||
             (t.items && t.items.some(item => item.toTeamId === 19 || item.fromTeamId === 19));
    });
    
    if (underachieverTransactions.length > 0) {
      console.log(`[DEBUG] Found ${underachieverTransactions.length} Underachievers transactions in ${src}:`);
      underachieverTransactions.forEach((t, i) => {
        const date = new Date((t.processDate || t.proposedDate || t.executionDate || t.date) * 1000);
        console.log(`[DEBUG] Underachievers Transaction ${i}:`);
        console.log(`  Date: ${date.toISOString()}`);
        console.log(`  Type: ${t.type}, ExecutionType: ${t.executionType}`);
        console.log(`  TeamId: ${t.teamId}, ToTeam: ${t.toTeamId}, FromTeam: ${t.fromTeamId}`);
        console.log(`  Items: ${t.items?.length || 0}`);
        
        if (t.items) {
          t.items.forEach((item, idx) => {
            console.log(`    Item ${idx}: playerId=${item.playerId}, type=${item.type}, toTeam=${item.toTeamId}, fromTeam=${item.fromTeamId}`);
          });
        }
      });
    }
    
    // Also check for Tyler Allgeier specifically (playerId 4373626)
    const allgeierTransactions = json.transactions.filter(t => {
      return t.playerId === 4373626 || 
             (t.items && t.items.some(item => item.playerId === 4373626));
    });
    
    if (allgeierTransactions.length > 0) {
      console.log(`[DEBUG] Found Tyler Allgeier transactions in ${src}:`);
      allgeierTransactions.forEach(t => {
        const date = new Date((t.processDate || t.proposedDate || t.executionDate || t.date) * 1000);
        console.log(`  Date: ${date.toISOString()}, Team: ${t.teamId}, Type: ${t.type}`);
      });
    }
  }
  // END NEW DEBUG

  if (json?.transactions?.length > 0) {
    console.log(`[DEBUG] Sample transaction:`, JSON.stringify(json.transactions[0], null, 2));
  }
  
  const rows =
    (Array.isArray(json?.transactions) && json.transactions) ||
    (Array.isArray(json?.events) && json.events) ||
    (Array.isArray(json?.messages) && json.messages) ||
    (Array.isArray(json) && json) ||
    (json?.transactions && typeof json.transactions === "object" ? Object.values(json.transactions) : null) ||
    (json?.events && typeof json.events === "object" ? Object.values(json.events) : null) ||
    (json && typeof json === "object" && !Array.isArray(json) ? Object.values(json) : null) ||
    [];

  // ADD DEBUG LOGGING FOR SEP 24 TRANSACTIONS - MOVED TO CORRECT LOCATION
  if (src === "tx") {
    for (const t of rows) {
      const processDate = t.processDate || t.proposedDate || t.executionDate || t.date || t.timestamp;
      if (processDate) {
        const when = new Date(normalizeEpoch(processDate));
        const dateStr = when.toISOString();
        
        if (dateStr.includes('2025-09-24') && (dateStr.includes('01:03') || dateStr.includes('05:03'))) {
          console.log('=== ESPN Sep 24 Transaction Debug ===');
          console.log('Transaction date string:', dateStr);
          console.log('Full transaction:', JSON.stringify(t, null, 2));
          console.log('=== End Debug ===');
        }
      }
    }
  }

  const out = [];
  for (const t of rows){
    const when = new Date(normalizeEpoch(t.processDate ?? t.proposedDate ?? t.executionDate ?? t.date ?? t.timestamp ?? Date.now()));

// ADD THIS DEBUG
if (src === "tx") {
  const rawDate = t.processDate ?? t.proposedDate ?? t.executionDate ?? t.date ?? t.timestamp;
  console.log(`[DEBUG] Raw timestamp: ${rawDate}, Normalized: ${normalizeEpoch(rawDate)}, Final date: ${when.toISOString()}`);
}
    const eventId = t.id ?? t.transactionId ?? t.proposedTransactionId ?? t.proposalId ?? null;
    const items = Array.isArray(t.items) ? t.items
               : Array.isArray(t.messages) ? t.messages
               : Array.isArray(t.changes) ? t.changes
               : (t.item ? [t.item] : []);
    const typeStr = t.type ?? t.moveType ?? t.status;
    const typeNum = Number.isFinite(t.type) ? t.type : null;
    
    if (!items.length) {
      const action = /DROP/i.test(typeStr) ? "DROP" : "ADD";
      const method = enhancedInferMethod(typeStr, typeNum, t, null);
      const teamId = t.toTeamId ?? t.teamId ?? t.forTeamId ?? t.targetTeamId ?? t.fromTeamId ?? null;
      if (teamId != null) {
        out.push({
          teamId, date:when, action, method, src, eventId,
          playerId: t.playerId ?? null, 
playerName: t.playerPoolEntry?.player?.fullName || t.player?.fullName || t.playerName || null
        });
      }
      continue;
    }
    
    for (const it of items){
      const iTypeStr = it.type ?? it.moveType ?? it.action;
      const iTypeNum = Number.isFinite(it.type) ? it.type : null;
      const method = enhancedInferMethod(iTypeStr ?? typeStr, iTypeNum ?? typeNum, t, it);
      
      if (/ADD|WAIVER|CLAIM/i.test(String(iTypeStr)) || [1,5,7].includes(iTypeNum)) {
        const toTeamId = it.toTeamId ?? it.teamId ?? it.forTeamId ?? t.toTeamId ?? t.teamId ?? null;
        if (toTeamId != null) {
          out.push({
            teamId: toTeamId, date:when, action:"ADD", method, src, 
            eventId: it.id ?? eventId ?? null,
            playerId: it?.playerId ?? it?.player?.id ?? it?.entityId ?? null,
playerName: it?.playerPoolEntry?.player?.fullName || 
           it?.player?.fullName || 
           t?.playerPoolEntry?.player?.fullName || 
           t?.player?.fullName || null,
executionType: t?.executionType,
bidAmount: t?.bidAmount,
waiverProcessDate: t?.waiverProcessDate || it?.waiverProcessDate
          });
        }
      }
      
      if (/DROP/i.test(String(iTypeStr)) || [2].includes(iTypeNum)) {
  const fromTeamId = it.fromTeamId ?? t.fromTeamId ?? it.teamId ?? null;
  if (fromTeamId != null) {
    out.push({
      teamId: fromTeamId, date:when, action:"DROP", method, src, 
      eventId: it.id ?? eventId ?? null,
      playerId: pickPlayerId(it), playerName: pickPlayerName(it,t)
    });
  }
}

// Handle DRAFT picks separately (for Recent Activity, but they won't count toward dues)
if (/DRAFT/i.test(String(iTypeStr)) || String(iTypeStr) === "DRAFT") {
  const toTeamId = it.toTeamId ?? t.teamId ?? null;
  if (toTeamId != null) {
    out.push({
      teamId: toTeamId, date:when, action:"ADD", method:"DRAFT", src, 
      eventId: it.id ?? eventId ?? null,
      playerId: pickPlayerId(it), playerName: pickPlayerName(it,t)
    });
  }
}
    }
  }
// Add this right after you build the `out` array, before the return statement:
if (src === "tx") {
  const sep24Transactions = out.filter(move => {
    const dateStr = move.date.toISOString();
    return dateStr.includes('2025-09-24') && dateStr.includes('08:03');
  });
  
  if (sep24Transactions.length > 0) {
    console.log(`[DEBUG] Sep 24 08:03 extracted moves (${sep24Transactions.length}):`, 
      sep24Transactions.map(m => `${m.action} ${m.playerId} by team ${m.teamId}`));
  }
}

// Add this at the end of extractMoves function, before return
console.log(`[DEBUG] extractMoves from ${src}: ${out.filter(o => o.action === "ADD").length} adds, ${out.filter(o => o.action === "DROP").length} drops`);
return out;
}

function extractMovesFromComm(json){
  const topics =
    (Array.isArray(json?.topics) && json.topics) ||
    (json?.topics && typeof json.topics === "object" ? Object.values(json.topics) : []) ||
    (Array.isArray(json) ? json : []);
  const out = [];
  for (const t of topics) {
    const msgs = (Array.isArray(t?.messages)) ? t.messages : (Array.isArray(t?.posts)) ? t.posts : [];
    for (const m of msgs) {
      const when = new Date(normalizeEpoch(m.date ?? m.timestamp ?? t.date ?? Date.now()));
      const acts = (Array.isArray(m.actions) && m.actions) || [];
      for (const a of acts) {
        const s = String(a.type ?? a.action ?? "").toUpperCase();
        const teamId = a.toTeamId ?? a.teamId ?? m.toTeamId ?? m.teamId ?? null;
        if (/ADD|WAIVER|CLAIM/.test(s) && teamId != null) {
          out.push({ teamId, date:when, action:"ADD", method:/WAIVER|CLAIM/.test(s) ? "WAIVER":"FA", src:"comm", playerId:a.playerId||null });
        }
        if (/DROP/.test(s) && teamId != null) {
          out.push({ teamId, date:when, action:"DROP", method:"FA", src:"comm", playerId:a.playerId||null });
        }
      }
    }
  }
  return out;
}

function dedupeMoves(events){
  const seen = new Set();
  const out = [];
  for (const e of events){
    const tMin = Math.floor(new Date(e.date).getTime() / 60000);
    const key = e.eventId
  ? `id:${e.eventId}|tm:${e.teamId}|p:${e.playerId||""}|a:${e.action}`
  : `tm:${e.teamId}|p:${e.playerId||""}|a:${e.action}|m:${tMin}`;
    if (seen.has(key)) continue;
    seen.add(key); 
    out.push(e);
  }
  return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp=25, onProgress }){
  const all = [];
  for (let sp=1; sp<=maxSp; sp++){
    // ADD DEBUG CODE HERE
    if (sp === 3 || sp === 4) {
      console.log(`[DEBUG] ===== CHECKING SCORING PERIOD ${sp} =====`);
    }
    
    onProgress?.(sp, maxSp, "Reading ESPN activity…");
    try { 
      const j = await espnFetch({ leagueId, seasonId, view:"mTransactions2", scoringPeriodId: sp, req, requireCookie:true }); 
      all.push(...extractMoves(j,"tx").map(e => ({ ...e, sp }))); 
    } catch {}
    try { 
      const j = await espnFetch({ leagueId, seasonId, view:"recentActivity", scoringPeriodId: sp, req, requireCookie:true }); 
      all.push(...extractMoves(j,"recent").map(e => ({ ...e, sp }))); 
    } catch {}
    try { 
      const j = await espnFetch({ leagueId, seasonId, view:"kona_league_communication", scoringPeriodId: sp, req, requireCookie:true }); 
      all.push(...extractMovesFromComm(j).map(e => ({ ...e, sp }))); 
    } catch {}
    await sleep(120 + Math.floor(Math.random() * 120));
  }
  return all.map(e => ({ ...e, date: e.date instanceof Date ? e.date : new Date(e.date) }))
            .sort((a,b)=> a.date - b.date);
}

async function fetchRosterSeries({ leagueId, seasonId, req, maxSp=25, onProgress }){
  const series = [];
  let lastGood = {};
  
  for (let sp=1; sp<=maxSp; sp++){
    onProgress?.(sp, maxSp, "Building roster timeline…");
    let byTeam = {};
    
    try {
      const r = await espnFetch({ leagueId, seasonId, view:"mRoster", scoringPeriodId: sp, req, requireCookie:false });
      for (const t of (r?.teams || [])) {
        const set = new Set();
        for (const e of (t.roster?.entries || [])) {
          const pid = e.playerPoolEntry?.player?.id;
          if (pid) set.add(pid);
        }
        byTeam[t.id] = set;
      }
      
      // If we got data, update lastGood
      if (Object.keys(byTeam).length > 0) {
        lastGood = { ...byTeam };
      }
    } catch (error) {
      console.log(`[DEBUG] Failed to fetch roster for SP ${sp}:`, error.message);
    }
    
    // Use current data if available, otherwise use lastGood
    series[sp] = Object.keys(byTeam).length > 0 ? byTeam : { ...lastGood };
  }
  
  console.log(`[DEBUG] Roster series built for ${maxSp} weeks`);
console.log(`[DEBUG] Series structure:`, { 
  length: series.length, 
  hasData: Object.keys(series).length > 0,
  sample: series[1] ? Object.keys(series[1]) : 'no data' 
});
return { roster: series }; // <- ADD THIS WRAPPER
}

const isOnRoster = (series, sp, teamId, playerId) => !!(playerId && series?.[sp]?.[teamId]?.has(playerId));
const spFromDate = (dateLike, seasonYear) => Math.max(1, Math.min(25, (leagueWeekOf(new Date(dateLike), seasonYear).week || 1)));

function isGenuineAddBySeries(row, series, seasonYear){
  if (!row.playerId) return true; // Can't verify without player ID
  
  const sp = spFromDate(row.date, seasonYear);
  const teamId = row.teamIdRaw;
  const playerId = row.playerId;
  
  // Check 2-3 weeks before the transaction
  const beforeChecks = [Math.max(1, sp - 2), Math.max(1, sp - 1)];
  const wasBefore = beforeChecks.some(weekSp => 
    isOnRoster(series, weekSp, teamId, playerId)
  );
  
  // Check 2-3 weeks after the transaction
  const afterChecks = [sp, sp + 1, sp + 2].filter(n => n < series.length);
  const appearsAfter = afterChecks.some(weekSp => 
    isOnRoster(series, weekSp, teamId, playerId)
  );
  
  console.log(`[DEBUG] Genuine add check - Player ${playerId}, Team ${teamId}, Week ${sp}: wasBefore=${wasBefore}, appearsAfter=${appearsAfter}`);
  
  return !wasBefore && appearsAfter;
}

function isExecutedDropBySeries(row, series, seasonYear){
  if (!row.playerId) return true; // Can't verify without player ID, assume valid
  
  const sp = spFromDate(row.date, seasonYear);
  const teamId = row.teamIdRaw;
  const playerId = row.playerId;
  
  // Just check if the player was on the roster at some point before the drop
  // Don't be too strict about exact timing
  const beforeChecks = [Math.max(1, sp - 2), Math.max(1, sp - 1), sp];
  const wasOnRoster = beforeChecks.some(weekSp => 
    isOnRoster(series, weekSp, teamId, playerId)
  );
  
  // If we can't verify from roster data, assume the drop is valid
  // (ESPN wouldn't report a drop if the player wasn't on the team)
  if (!wasOnRoster && sp > 1) {
    console.log(`[DEBUG] Could not verify roster ownership for drop - Player ${playerId}, Team ${teamId}, Week ${sp} - allowing drop`);
    return true;
  }
  
  console.log(`[DEBUG] Drop verification - Player ${playerId}, Team ${teamId}, Week ${sp}: wasOnRoster=${wasOnRoster}`);
  return true; // Be more permissive with drops
}

async function buildPlayerMap({ leagueId, seasonId, req, ids, maxSp=25, onProgress }){
  const need = new Set((ids||[]).filter(Boolean));
  const map = {}; 
  if (need.size===0) return map;
  
  console.log(`[DEBUG] Resolving ${need.size} player names via ESPN API`);
  
  // Get NFL teams for proper D/ST names
  let nflTeamById = {};
  try {
    const teamsResponse = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams");
    if (teamsResponse.ok) {
      const teamsData = await teamsResponse.json();
      for (const e of (teamsData.sports?.[0]?.leagues?.[0]?.teams || [])) {
        const t = e.team;
        nflTeamById[t.id] = t.displayName || t.name || t.abbreviation;
      }
    }
  } catch (error) {
    console.log('[DEBUG] Failed to fetch NFL teams, using fallback names');
  }

  const dstName = (negId) => {
    const teamId = Math.abs(negId) - 16000; // ESPN D/ST ids are -16000 - proTeamId
    const team = nflTeamById[teamId] || `Team ${teamId}`;
    return `${team} D/ST`;
  };
  
  // Separate positive IDs (real players) from negative IDs (D/ST)
  const posIds = [...need].filter(id => id > 0);
  const negIds = [...need].filter(id => id < 0);
  
  // Resolve D/ST names using real NFL team names
  negIds.forEach(id => { map[id] = dstName(id); });
  
  // Enhanced positive ID resolution (keep existing logic)
  const BATCH_SIZE = 40;
  for (let i = 0; i < posIds.length; i += BATCH_SIZE) {
    const batch = posIds.slice(i, i + BATCH_SIZE);
    onProgress?.(i, posIds.length, `Resolving player names (${i + 1}-${Math.min(i + BATCH_SIZE, posIds.length)} of ${posIds.length})...`);
    
    await Promise.all(batch.map(async id => {
      try {
        const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${id}`;
        const response = await fetch(url);
        if (response.ok) {
  const athlete = await response.json();
  const name = athlete.fullName || athlete.displayName || athlete.name || `Player ${id}`;
  const position = athlete.position?.abbreviation || "";
  map[id] = position ? `${name} (${position})` : name;
} else {
          map[id] = `Player ${id}`;
        }
      } catch (error) {
        console.log(`[DEBUG] Failed to resolve player ${id}:`, error.message);
        map[id] = `Player ${id}`;
      }
    }));
    
    await sleep(120);
  }
  
  console.log(`[DEBUG] Resolved ${Object.keys(map).length} player names`);
  return map;
}

async function buildOfficialReport({ leagueId, seasonId, req }){
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

// Add this right after the line: const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

console.log('[DEBUG] Team ID to Name mapping:', idToName);

// Get draft data for baseline
const draftPicks = await fetchDraftData({ leagueId, seasonId, req });
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25 });
  console.log(`[DEBUG] Total moves extracted from all sources: ${all.length}`);
  console.log(`[DEBUG] Sample moves:`, all.slice(0, 3));
  

console.log('[DEBUG] About to build roster series');
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25 });
console.log('[DEBUG] Roster building completed:', {
  rosterExists: !!series.roster,
  rosterLength: series.roster?.length || 0,
  firstFewEntries: series.roster?.slice(0, 3)
});

  const deduped = dedupeMoves(all).map(e => ({ 
    ...e, 
    teamIdRaw: e.teamId, 
    team: idToName[e.teamId] || `Team ${e.teamId}`, 
    player: e.playerName || null 
  }));
  
  // Debug logging for raw transaction breakdown
  console.log(`[DEBUG] Raw transaction breakdown:`);
  console.log(`- Total deduped transactions: ${deduped.length}`);
  console.log(`- ADD transactions: ${deduped.filter(r => r.action === "ADD").length}`);
  console.log(`- DROP transactions: ${deduped.filter(r => r.action === "DROP").length}`);

  // Log some sample drops to see what we're working with
  const sampleDrops = deduped.filter(r => r.action === "DROP").slice(0, 5);
  console.log(`[DEBUG] Sample DROP transactions:`, sampleDrops);
  
// Simplified filtering - just exclude CANCEL transactions
const validatedTransactions = await validateTransactions(deduped, series, draftPicks, seasonId, { 
  leagueId, 
  seasonId, 
  req 
});


const billableAdds = validatedTransactions.filter(r => 
  r.action === "ADD" && r.method !== "DRAFT" && r.week > 0  
);
const allAdds = validatedTransactions.filter(r => 
  r.action === "ADD" && r.method !== "DRAFT"  // No week filter - includes Week 0
);
const drops = validatedTransactions.filter(r => r.action === "DROP");

console.log(`[DEBUG] After simple filtering: ${billableAdds.length} billable adds, ${drops.length} drops`);
console.log(`[DEBUG] Excluded CANCEL transactions, kept PROCESS and EXECUTE`);

// Enhanced filtering to surface players â€œaddedâ€ by multiple teams (likely failed bids)
const playerAddCounts = billableAdds.reduce((acc, r) => {
  const key = r.playerId ?? r.player; // prefer id
  if (!key) return acc;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

Object.entries(playerAddCounts).forEach(([playerId, count]) => {
  if (count > 1) {
    console.log(`[DEBUG] Player ${playerId} was "added" by ${count} teams`);
  }
});

// Resolve missing player names
const needIds = [...new Set(
  [...allAdds, ...drops]  // â† Use allAdds instead of billableAdds
    .map(r => (r.player ? null : r.playerId))
    .filter(Boolean)
)];

const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp: 25 });

for (const r of [...allAdds, ...drops]) {  // â† Use allAdds instead of billableAdds
  if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;
} 

// Detect if this is a FAAB league by checking if any waiver has a bid amount > 0
const isFAABLeague = [...allAdds, ...drops].some(r => 
  r.method === "PROCESS" && r.bidAmount != null && r.bidAmount > 0
);
console.log(`[DEBUG] FAAB League detected: ${isFAABLeague}`);

// First, identify paired transactions
const pairedTransactions = new Set();
[...allAdds, ...drops].forEach((transaction, index, allTransactions) => {
  if (transaction.method === "EXECUTE") {
    // Check if there's a matching transaction (opposite action, same team, same time)
    const hasMatch = allTransactions.some(other => 
      other.team === transaction.team &&
      other.action !== transaction.action &&
      Math.abs(new Date(other.date).getTime() - new Date(transaction.date).getTime()) < 1000 && // Within 1 second
      other.method === "EXECUTE"
    );
    if (hasMatch) {
      const key = `${transaction.team}-${new Date(transaction.date).getTime()}`;
      pairedTransactions.add(key);
    }
  }
});

let rawMoves = [...allAdds, ...drops].map(r => {
    const wb = weekBucket(r.date, seasonId);
    const transactionKey = `${r.team}-${new Date(r.date).getTime()}`;
    const isPaired = pairedTransactions.has(transactionKey) && r.method === "EXECUTE";
    
    // Format method with bid amount for waivers
let displayMethod = r.method === "PROCESS" ? "Waivers" : r.method === "EXECUTE" ? "Free Agent" : r.method;
let bidAmount = null;

// Only include bid amounts if this is a FAAB league
if (displayMethod === "Waivers" && isFAABLeague) {
  bidAmount = r.bidAmount != null ? r.bidAmount : 0;
} else if (displayMethod === "Waivers" && !isFAABLeague) {
  bidAmount = undefined; // Use undefined instead of null
}    
    return {
      date: fmtPT(r.date),
      ts: new Date(r.date).getTime(),
      week: wb.week,
      range: weekRangeLabelDisplay(wb.start),
      team: r.team,
      player: r.player || (r.playerId ? `#${r.playerId}` : "—"),
      action: r.action,
      method: displayMethod,
      isPaired: isPaired,
      source: r.src,
      playerId: r.playerId || null,
      bidAmount: r.bidAmount // Keep raw amount too if needed
    };
  }).sort((a,b)=> (a.week - b.week) || (new Date(a.date) - new Date(b.date)));  
  const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // Increased to 5 minutes
  const dedupedMoves = [];
  const lastByKey = new Map();
  
  for (const m of rawMoves) {
    const key = `${m.team}|${m.playerId || m.player}|${m.action}`;
    
    if (m.action === "DROP") {
      const prev = lastByKey.get(key);
      if (prev && prev.action === "DROP" && Math.abs(m.ts - prev.ts) <= DEDUPE_WINDOW_MS) {
        console.log(`[DEBUG] Skipping duplicate DROP: ${m.team} dropping ${m.player}`);
        continue;
      }
      lastByKey.set(key, { action: "DROP", ts: m.ts });
    } else if (m.action === "ADD") {
      const prev = lastByKey.get(key);
      if (prev && prev.action === "ADD" && Math.abs(m.ts - prev.ts) <= DEDUPE_WINDOW_MS) {
        console.log(`[DEBUG] Skipping duplicate ADD: ${m.team} adding ${m.player}`);
        continue;
      }
      lastByKey.set(key, { action: "ADD", ts: m.ts });
    }
    dedupedMoves.push(m);
  }
  
  rawMoves = dedupedMoves.map(({ ts, ...rest }) => rest);
  
  console.log(`[DEBUG] Final transaction counts after all processing: ${rawMoves.filter(r => r.action === "ADD").length} adds, ${rawMoves.filter(r => r.action === "DROP").length} drops`);
  
  const perWeek = new Map();
  for (const r of rawMoves) {
    if (r.action !== "ADD" || r.week <= 0) continue;     if (!perWeek.has(r.week)) perWeek.set(r.week, new Map());
    const m = perWeek.get(r.week);
    m.set(r.team, (m.get(r.team) || 0) + 1);
  }
  
  const weekRows = [];
  const totals = new Map();
  const rangeByWeek = {};
  for (const r of rawMoves) {
    if (r.week > 0 && !rangeByWeek[r.week]) rangeByWeek[r.week] = r.range;
  }
  
  for (const w of [...perWeek.keys()].sort((a,b)=>a-b)) {
    const entries = [];
    const m = perWeek.get(w);
    for (const [team, count] of m.entries()) {
      const owes = Math.max(0, count - 2) * 5;
      entries.push({ name: team, count, owes });
      const t = totals.get(team) || { adds:0, owes:0 };
      t.adds += count; 
      t.owes += owes; 
      totals.set(team, t);
    }
    entries.sort((a,b)=> a.name.localeCompare(b.name));
    weekRows.push({ week:w, range: rangeByWeek[w] || "", entries });
  }
  
  // Ensure all teams appear in totals, even with 0 adds/owes
  const allTeamNames = Object.values(idToName);
  const totalsRows = allTeamNames.map(teamName => {
    const existing = totals.get(teamName);
    return {
      name: teamName,
      adds: existing ? existing.adds : 0,
      owes: existing ? existing.owes : 0
    };
  }).sort((a,b)=> b.owes - a.owes || a.name.localeCompare(b.name));
      
return { 
  lastSynced: fmtPT(new Date()), 
  totalsRows, 
  weekRows, 
  rawMoves,
  draftSummary: {
    totalPicks: draftPicks.length,
    teamCounts: draftPicks.reduce((acc, pick) => {
      const teamName = idToName[pick.teamId] || `Team ${pick.teamId}`;
      acc[teamName] = (acc[teamName] || 0) + 1;
      return acc;
    }, {})
  }
};

}

// Report routes
app.get("/api/report", async (req, res) => {
  try {
    let seasonId = req.query?.seasonId;
    const leagueId = req.query?.leagueId; // Add league ID parameter
    
    // If no specific season requested, use the server's current display season
    if (!seasonId) {
      const displaySetting = await readJson("current_display_season.json", { season: "2025" });
      seasonId = displaySetting.season;
    }
    
    const leagueKey = leagueId || 'default';
    
    if (DATABASE_URL) {
      const client = await pool.connect();
      const result = await client.query('SELECT report_data FROM reports WHERE season_id = $1', [`${leagueKey}_${seasonId}`]);
      client.release();
      if (result.rows.length > 0) {
        return res.json(result.rows[0].report_data);
      }
    }
    
    const preferred = await readJson(`report_${leagueKey}_${seasonId}.json`, null);
    if (preferred) return res.json(preferred);
    
    return res.status(404).json({ error: "No report found for season " + seasonId });
  } catch (error) {
    console.error('Failed to load report:', error);
    res.status(500).json({ error: "Failed to load report" });
  }
});

// Add this new route for setting which season to display by default
app.post("/api/report/set-display-season", requireAdmin, async (req, res) => {
  try {
    const { seasonId } = req.body;
    if (!seasonId) {
      return res.status(400).json({ error: "Season ID required" });
    }

        
    res.json({ success: true, defaultSeason: seasonId });
  } catch (error) {
    console.error('Failed to set display season:', error);
    res.status(500).json({ error: "Failed to set display season" });
  }
});

// Get the default season - improved version
app.get("/api/report/default-season", async (req, res) => {
  try {
    console.log('[API] Getting default season...');
    
    let seasonData = null;
    
    // Try database first if available
    if (DATABASE_URL) {
      try {
        const client = await pool.connect();
        const result = await client.query(
          'SELECT data_value FROM league_data WHERE data_type = $1 ORDER BY updated_at DESC LIMIT 1',
          ['current_display_season']
        );
        client.release();
        
        if (result.rows.length > 0) {
          seasonData = result.rows[0].data_value;
          console.log('[API] Found season in database:', seasonData);
        }
      } catch (dbError) {
        console.error('[API] Database read error:', dbError);
      }
    }
    
    // Fallback to file system
    if (!seasonData) {
      try {
        seasonData = await readJson("current_display_season.json", { season: "2025" });
        console.log('[API] Found season in file:', seasonData);
      } catch (fileError) {
        console.error('[API] File read error:', fileError);
        seasonData = { season: "2025" };
      }
    }
    
    // Extract and validate season
    let season = seasonData?.season || "2025";
    season = String(season).trim();
    
    // Ensure it's a valid year-like string
    if (!/^\d{4}$/.test(season)) {
      console.warn('[API] Invalid season format:', season, 'using 2025');
      season = "2025";
    }
    
    console.log('[API] Returning season:', season);
    res.json({ season });
    
  } catch (error) {
    console.error('[API] Failed to get default season:', error);
    res.json({ season: "2025" });
  }
});

app.get("/api/report/", async (req, res) => {
  try {
    const setting = await readJson("current_display_season.json", { season: "2025" });
    res.json({ season: setting.season }); // Use consistent property name
  } catch (error) {
    res.json({ season: "2025" });
  }
});

// Get current season setting for rosters/components
app.get("/api/report/current-season", async (req, res) => {
  try {
    const setting = await readJson("current_display_season.json", { season: new Date().getFullYear().toString() });
    res.json({ season: setting.season });
  } catch (error) {
    res.json({ season: new Date().getFullYear().toString() });
  }
});

// Weekly awards (Trophy Case)
app.get("/api/leagues/:leagueId/weekly-awards/:seasonId", async (req, res) => {
  try {
    const { leagueId, seasonId } = req.params;
    const { week } = req.query;

    const leagueConfigs = { blitzzz: '226912', sculpin: '58645' };
    const espnLeagueId = leagueConfigs[leagueId] || leagueId;

    const espn_s2 = req.cookies?.espn_s2 || process.env.ESPN_S2;
    const swid = req.cookies?.swid || process.env.SWID;

    const data = await callPythonService('/weekly-awards', { 
      leagueId: espnLeagueId, 
      year: parseInt(seasonId), 
      week: parseInt(week) || 1, 
      espn_s2, 
      swid 
    });
    
    res.json(data);
  } catch (err) {
    console.error('Weekly awards failed:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/report/update", async (req, res) => {
  const adminHeader = req.header("x-admin");
const validPasswords = [ADMIN_PASSWORD, "cocoshouse", "temporary420"];
if (!validPasswords.includes(adminHeader)) {
  return res.status(401).send("Unauthorized");
}
  const { leagueId, seasonId, currentLeagueId } = req.body || {}; // Add currentLeagueId
  if (!leagueId || !seasonId) return res.status(400).send("Missing leagueId or seasonId");
  const jobId = (req.query?.jobId || `job_${Date.now()}`);
  
  try {
    setProgress(jobId, 5, "Fetching teams…");
    await espnFetch({ leagueId, seasonId, view: "mTeam", req, requireCookie: false });
    
    await fetchSeasonMovesAllSources({
      leagueId, seasonId, req, maxSp: 25,
      onProgress: (sp, max, msg) => setProgress(jobId, 10 + Math.round((sp / max) * 45), `${msg} (${sp}/${max})`)
    });
    
    await fetchRosterSeries({
      leagueId, seasonId, req, maxSp: 25,
      onProgress: (sp, max, msg) => setProgress(jobId, 55 + Math.round((sp / max) * 27), `${msg} (${sp}/${max})`)
    });
    
    setProgress(jobId, 92, "Computing official totals…");
    const report = await buildOfficialReport({ leagueId, seasonId, req });
    const snapshot = { seasonId, leagueId, ...report };
    
    // Save with league-specific key based on currentLeagueId (blitzzz/sculpin)
    const leagueKey = currentLeagueId || 'default'; // Use the frontend league ID
    
    // Save to database if available
    if (DATABASE_URL) {
      const client = await pool.connect();
      await client.query(`
        INSERT INTO reports (season_id, report_data, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (season_id) DO UPDATE SET 
        report_data = $2, updated_at = CURRENT_TIMESTAMP
      `, [`${leagueKey}_${seasonId}`, JSON.stringify(snapshot)]);
      client.release();
    }
    
    // Save to file with league-specific filename
    await writeJson(`report_${leagueKey}_${seasonId}.json`, snapshot);
    
    setProgress(jobId, 100, "Snapshot complete");
    res.json({ ok: true, weeks: (report?.weekRows || []).length });
  } catch (err) {
    console.error('Report update failed:', err);
    setProgress(jobId, 100, "Failed");
    res.status(502).send(err?.message || String(err));
  }
});

async function captureWeeklySnapshot({ leagueId, seasonId, weekNumber, req }) {
  console.log(`[SNAPSHOT] Capturing Week ${weekNumber} for league ${leagueId}, season ${seasonId}`);
  
  try {
    // Fetch all necessary data for this week
    const [teamData, matchupData, boxscoreData, rosterData] = await Promise.all([
      espnFetch({ leagueId, seasonId, view: "mTeam", req, requireCookie: false }),
      espnFetch({ leagueId, seasonId, view: "mMatchup", scoringPeriodId: weekNumber, req, requireCookie: false }),
      espnFetch({ leagueId, seasonId, view: "mBoxscore", scoringPeriodId: weekNumber, req, requireCookie: false }),
      espnFetch({ leagueId, seasonId, view: "mRoster", scoringPeriodId: weekNumber, req, requireCookie: false })
    ]);

    const teamNames = {};
    const teamStats = {};
    
    // Build team name map
    if (teamData.teams) {
      teamData.teams.forEach(team => {
        const name = team.location && team.nickname 
          ? `${team.location} ${team.nickname}` 
          : team.name || `Team ${team.id}`;
        teamNames[team.id] = name;
        
        teamStats[team.id] = {
          teamId: team.id,
          teamName: name,
          pointsFor: 0,
          pointsAgainst: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          weeklyScore: 0,
          opponentScore: 0,
          roster: []
        };
      });
    }

    // Process matchup data for this week
    if (matchupData.schedule) {
      matchupData.schedule.forEach(matchup => {
        if (matchup.matchupPeriodId === weekNumber) {
          const homeId = matchup.home?.teamId;
          const awayId = matchup.away?.teamId;
          const homeScore = matchup.home?.totalPoints || 0;
          const awayScore = matchup.away?.totalPoints || 0;

          if (homeId && teamStats[homeId]) {
            teamStats[homeId].weeklyScore = homeScore;
            teamStats[homeId].opponentScore = awayScore;
            teamStats[homeId].pointsFor += homeScore;
            teamStats[homeId].pointsAgainst += awayScore;
            
            if (homeScore > awayScore) teamStats[homeId].wins++;
            else if (homeScore < awayScore) teamStats[homeId].losses++;
            else teamStats[homeId].ties++;
          }

          if (awayId && teamStats[awayId]) {
            teamStats[awayId].weeklyScore = awayScore;
            teamStats[awayId].opponentScore = homeScore;
            teamStats[awayId].pointsFor += awayScore;
            teamStats[awayId].pointsAgainst += homeScore;
            
            if (awayScore > homeScore) teamStats[awayId].wins++;
            else if (awayScore < homeScore) teamStats[awayId].losses++;
            else teamStats[awayId].ties++;
          }
        }
      });
    }

    // Process roster data
    if (rosterData.teams) {
      rosterData.teams.forEach(team => {
        const teamId = team.id;
        if (teamStats[teamId]) {
          teamStats[teamId].roster = (team.roster?.entries || []).map(entry => {
            const player = entry.playerPoolEntry?.player;
            return {
              playerId: player?.id,
              playerName: player?.fullName,
              position: player?.defaultPositionId,
              lineupSlot: entry.lineupSlotId,
              points: entry.playerPoolEntry?.appliedStatTotal || 0
            };
          });
        }
      });
    }

    // Create snapshot object
    const snapshot = {
      leagueId,
      seasonId,
      weekNumber,
      capturedAt: new Date().toISOString(),
      teams: Object.values(teamStats),
      rawMatchupData: matchupData,
      rawBoxscoreData: boxscoreData
    };

    // Save to database
    if (DATABASE_URL) {
      const client = await pool.connect();
      
      try {
        // Save weekly snapshot
        await client.query(`
          INSERT INTO weekly_snapshots (league_id, season_id, week_number, snapshot_data)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (league_id, season_id, week_number) 
          DO UPDATE SET snapshot_data = $4, created_at = CURRENT_TIMESTAMP
        `, [leagueId, seasonId, weekNumber, JSON.stringify(snapshot)]);

        // Save individual team stats
        for (const team of Object.values(teamStats)) {
          await client.query(`
            INSERT INTO team_stats_history 
              (league_id, season_id, week_number, team_id, team_name, 
               points_for, points_against, wins, losses, ties, roster_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (league_id, season_id, week_number, team_id)
            DO UPDATE SET 
              points_for = $6, points_against = $7, wins = $8, 
              losses = $9, ties = $10, roster_data = $11,
              created_at = CURRENT_TIMESTAMP
          `, [
            leagueId, seasonId, weekNumber, team.teamId, team.teamName,
            team.pointsFor, team.pointsAgainst, team.wins, team.losses, team.ties,
            JSON.stringify(team.roster)
          ]);
        }

        console.log(`[SNAPSHOT] Successfully saved Week ${weekNumber} snapshot to database`);
      } finally {
        client.release();
      }
    } else {
      // Fallback to file system
      await writeJson(`snapshot_${leagueId}_${seasonId}_week${weekNumber}.json`, snapshot);
      console.log(`[SNAPSHOT] Successfully saved Week ${weekNumber} snapshot to file`);
    }

    return snapshot;

  } catch (error) {
    console.error(`[SNAPSHOT] Failed to capture Week ${weekNumber}:`, error);
    throw error;
  }
}

async function getWeeklySnapshot(leagueId, seasonId, weekNumber) {
  if (DATABASE_URL) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT snapshot_data FROM weekly_snapshots WHERE league_id = $1 AND season_id = $2 AND week_number = $3',
        [leagueId, seasonId, weekNumber]
      );
      client.release();
      return result.rows.length > 0 ? result.rows[0].snapshot_data : null;
    } catch (err) {
      client.release();
      throw err;
    }
  } else {
    return await readJson(`snapshot_${leagueId}_${seasonId}_week${weekNumber}.json`, null);
  }
}

async function getSeasonSnapshots(leagueId, seasonId) {
  if (DATABASE_URL) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT week_number, snapshot_data FROM weekly_snapshots WHERE league_id = $1 AND season_id = $2 ORDER BY week_number',
        [leagueId, seasonId]
      );
      client.release();
      return result.rows.map(row => ({
        week: row.week_number,
        data: row.snapshot_data
      }));
    } catch (err) {
      client.release();
      throw err;
    }
  } else {
    // File system fallback - would need directory scanning
    return [];
  }
}

async function getTeamHistory(leagueId, seasonId, teamId) {
  if (DATABASE_URL) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM team_stats_history WHERE league_id = $1 AND season_id = $2 AND team_id = $3 ORDER BY week_number',
        [leagueId, seasonId, teamId]
      );
      client.release();
      return result.rows;
    } catch (err) {
      client.release();
      throw err;
    }
  } else {
    return [];
  }
}

// DoritoStats Power Ranking Calculations
function calculateDoritoStatsPowerRankings(seasonSnapshots, currentWeek) {
  if (!seasonSnapshots || seasonSnapshots.length === 0) {
    throw new Error('No historical data available for power rankings');
  }

  // Aggregate season stats from all weeks
  const teamSeasonStats = {};
  
  seasonSnapshots.forEach(snapshot => {
    if (snapshot.data && snapshot.data.teams) {
      snapshot.data.teams.forEach(team => {
        if (!teamSeasonStats[team.teamId]) {
          teamSeasonStats[team.teamId] = {
            teamId: team.teamId,
            teamName: team.teamName,
            weeklyScores: [],
            weeklyOpponentScores: [],
            totalPointsFor: 0,
            totalPointsAgainst: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            gamesPlayed: 0
          };
        }
        
        const stats = teamSeasonStats[team.teamId];
        if (team.weeklyScore > 0) {
          stats.weeklyScores.push(team.weeklyScore);
          stats.weeklyOpponentScores.push(team.opponentScore || 0);
          stats.totalPointsFor += team.weeklyScore;
          stats.totalPointsAgainst += (team.opponentScore || 0);
          stats.wins += team.wins || 0;
          stats.losses += team.losses || 0;
          stats.ties += team.ties || 0;
          stats.gamesPlayed++;
        }
      });
    }
  });

  // Calculate each component for each team
  const rankings = Object.values(teamSeasonStats).map(team => {
    const avgPointsFor = team.totalPointsFor / team.gamesPlayed;
    const avgPointsAgainst = team.totalPointsAgainst / team.gamesPlayed;
    
    // DOMINANCE: Based on DoritoStats formula
    // Dom = 0.18 * (2*PF + PA)
    const dominance = 0.18 * ((2 * team.totalPointsFor) + team.totalPointsAgainst);
    
    // CONSISTENCY: Based on inverse of score variability
    // Cons = 130 / (StdDev + 12)
    const mean = avgPointsFor;
    const variance = team.weeklyScores.reduce((sum, score) => {
      return sum + Math.pow(score - mean, 2);
    }, 0) / team.gamesPlayed;
    const stdDev = Math.sqrt(variance);
    const consistency = 130 / (stdDev + 12);
    
    // LUCK: All-play wins vs actual wins differential
    // Calculate all-play record for each week
    let allPlayWins = 0;
    let allPlayLosses = 0;
    
    seasonSnapshots.forEach(snapshot => {
      if (snapshot.data && snapshot.data.teams) {
        const weekScores = snapshot.data.teams
          .filter(t => t.weeklyScore > 0)
          .map(t => ({ teamId: t.teamId, score: t.weeklyScore }));
        
        const thisTeamWeek = weekScores.find(t => t.teamId === team.teamId);
        if (thisTeamWeek) {
          // Count how many teams this team would beat
          weekScores.forEach(opponent => {
            if (opponent.teamId !== team.teamId) {
              if (thisTeamWeek.score > opponent.score) {
                allPlayWins++;
              } else if (thisTeamWeek.score < opponent.score) {
                allPlayLosses++;
              }
            }
          });
        }
      }
    });
    
    const allPlayWinPct = (allPlayWins + allPlayLosses) > 0 
      ? allPlayWins / (allPlayWins + allPlayLosses) 
      : 0;
    const actualWinPct = team.gamesPlayed > 0 
      ? team.wins / team.gamesPlayed 
      : 0;
    
    // Luck is the difference (scaled to 0-100)
    const luck = (actualWinPct - allPlayWinPct) * 100;
    
    // COMPREHENSIVE POWER SCORE: DoritoStats formula
    // Power = (0.8 * Dom) + (0.15 * Luck) + (0.05 * Cons)
    const comprehensivePowerScore = (0.8 * dominance) + (0.15 * luck) + (0.05 * consistency);
    
    // Simple power score (your original)
    const winPct = actualWinPct;
    const medianWins = allPlayWins; // Approximate using all-play wins
    const medianWinPct = allPlayWinPct;
    const simplePowerScore = (team.totalPointsFor * 2) + 
                            (team.totalPointsFor * winPct) + 
                            (team.totalPointsFor * medianWinPct);
    
    return {
      teamId: team.teamId,
      teamName: team.teamName,
      comprehensivePowerScore: Math.round(comprehensivePowerScore * 100) / 100,
      simplePowerScore: Math.round(simplePowerScore * 100) / 100,
      dominance: Math.round(dominance * 100) / 100,
      consistency: Math.round(consistency * 100) / 100,
      luck: Math.round(luck * 100) / 100,
      totalPointsFor: Math.round(team.totalPointsFor * 100) / 100,
      totalPointsAgainst: Math.round(team.totalPointsAgainst * 100) / 100,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      allPlayRecord: `${allPlayWins}-${allPlayLosses}`
    };
  });
  
  // Sort by comprehensive power score
  rankings.sort((a, b) => b.comprehensivePowerScore - a.comprehensivePowerScore);
  
  return rankings;
}

// DoritoStats Playoff Odds Simulation
async function calculatePlayoffOdds({ leagueId, seasonId, currentWeek, numSimulations = 10000, req }) {
  console.log(`[PLAYOFF ODDS] Starting ${numSimulations} simulations for week ${currentWeek}`);
  
  const snapshots = await getSeasonSnapshots(leagueId, seasonId);
  if (snapshots.length === 0) {
    throw new Error('No historical data available for playoff odds');
  }
  
  // Get schedule data
  const scheduleData = await espnFetch({ 
    leagueId, 
    seasonId, 
    view: "mMatchup", 
    req, 
    requireCookie: false 
  });
  
  const totalWeeks = 14;
  const playoffSpots = 6;
  
  // Build team stats from completed weeks only
  const teamStats = {};
  const teamIds = [];
  
  snapshots.forEach(snapshot => {
    if (snapshot.week > currentWeek) return; // Only use completed weeks
    
    snapshot.data.teams.forEach(team => {
      if (!teamStats[team.teamId]) {
        teamStats[team.teamId] = {
          teamId: team.teamId,
          teamName: team.teamName,
          weeklyScores: [],
          currentWins: 0,
          currentLosses: 0,
          currentTies: 0,
          currentPointsFor: 0
        };
        teamIds.push(team.teamId);
      }
      
      const stats = teamStats[team.teamId];
      if (team.weeklyScore > 0) {
        stats.weeklyScores.push(team.weeklyScore);
        stats.currentPointsFor += team.weeklyScore;
        stats.currentWins = team.wins || 0;
        stats.currentLosses = team.losses || 0;
        stats.currentTies = team.ties || 0;
      }
    });
  });
  
  // Calculate mean and std dev for each team
  Object.values(teamStats).forEach(team => {
    const scores = team.weeklyScores;
    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    team.avgScore = mean;
    team.stdDev = Math.sqrt(variance);
    
    // Initialize simulation counters
    team.playoffCount = 0;
    team.positionCounts = Array(teamIds.length).fill(0);
    team.projectedWins = 0;
    team.projectedLosses = 0;
    team.projectedTies = 0;
    team.projectedPointsFor = 0;
  });
  
  // Build remaining schedule
  const remainingMatchups = [];
  if (scheduleData.schedule) {
    for (let week = currentWeek + 1; week <= totalWeeks; week++) {
      const weekMatchups = scheduleData.schedule.filter(m => m.matchupPeriodId === week);
      weekMatchups.forEach(matchup => {
        if (matchup.home?.teamId && matchup.away?.teamId) {
          remainingMatchups.push({
            week,
            homeTeamId: matchup.home.teamId,
            awayTeamId: matchup.away.teamId
          });
        }
      });
    }
  }
  
  console.log(`[PLAYOFF ODDS] Simulating ${remainingMatchups.length} remaining games across ${numSimulations} simulations`);
  
  // Run Monte Carlo simulations
  for (let sim = 0; sim < numSimulations; sim++) {
    const simStandings = {};
    
    // Copy current records
    teamIds.forEach(teamId => {
      const team = teamStats[teamId];
      simStandings[teamId] = {
        wins: team.currentWins,
        losses: team.currentLosses,
        ties: team.currentTies,
        pointsFor: team.currentPointsFor
      };
    });
    
    // Simulate each remaining game using normal distribution
    remainingMatchups.forEach(matchup => {
      const homeTeam = teamStats[matchup.homeTeamId];
      const awayTeam = teamStats[matchup.awayTeamId];
      
      if (homeTeam && awayTeam) {
        // Generate scores from normal distribution (Box-Muller transform)
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
        
        const homeScore = homeTeam.avgScore + (z0 * homeTeam.stdDev);
        const awayScore = awayTeam.avgScore + (z1 * awayTeam.stdDev);
        
        // Update standings
        if (Math.abs(homeScore - awayScore) < 0.1) { // Tie threshold
          simStandings[matchup.homeTeamId].ties++;
          simStandings[matchup.awayTeamId].ties++;
        } else if (homeScore > awayScore) {
          simStandings[matchup.homeTeamId].wins++;
          simStandings[matchup.awayTeamId].losses++;
        } else {
          simStandings[matchup.awayTeamId].wins++;
          simStandings[matchup.homeTeamId].losses++;
        }
        
        simStandings[matchup.homeTeamId].pointsFor += homeScore;
        simStandings[matchup.awayTeamId].pointsFor += awayScore;
      }
    });
    
    // Rank teams by wins, then points
    const finalStandings = teamIds
      .map(teamId => ({ teamId, ...simStandings[teamId] }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      });
    
    // Record results
    finalStandings.forEach((standing, index) => {
      const team = teamStats[standing.teamId];
      
      if (index < playoffSpots) {
        team.playoffCount++;
      }
      team.positionCounts[index]++;
      
      // Accumulate for averages
      team.projectedWins += standing.wins;
      team.projectedLosses += standing.losses;
      team.projectedTies += standing.ties;
      team.projectedPointsFor += standing.pointsFor;
    });
  }
  
  // Calculate final percentages and averages
  const results = teamIds.map(teamId => {
    const team = teamStats[teamId];
    
    return {
      teamName: team.teamName,
      currentRecord: `${team.currentWins}-${team.currentLosses}${team.currentTies > 0 ? `-${team.currentTies}` : ''}`,
      projectedWins: Math.round((team.projectedWins / numSimulations) * 10) / 10,
      projectedLosses: Math.round((team.projectedLosses / numSimulations) * 10) / 10,
      projectedTies: Math.round((team.projectedTies / numSimulations) * 10) / 10,
      projectedPointsFor: Math.round((team.projectedPointsFor / numSimulations) * 10) / 10,
      playoffOdds: Math.round((team.playoffCount / numSimulations) * 1000) / 10,
      positions: team.positionCounts.map((count, index) => ({
        position: index + 1,
        probability: Math.round((count / numSimulations) * 1000) / 10
      }))
    };
  });
  
  // Sort by playoff odds
  results.sort((a, b) => b.playoffOdds - a.playoffOdds);
  
  return results;
}

// =========================
// Enhanced Auto-refresh system - Multi-League Version
// =========================
let autoRefreshInterval = null;
let isRefreshing = false;
let lastRefreshAttempt = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
const BASE_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Define both leagues to refresh
const LEAGUES_TO_REFRESH = [
  { id: 'blitzzz', espnId: '226912' },
  { id: 'sculpin', espnId: '58645' }
];

// Enhanced logging
function logRefresh(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = `[AUTO-REFRESH] ${timestamp}`;
  
  if (level === 'error') {
    console.error(`${prefix} - ERROR: ${message}`);
  } else {
    console.log(`${prefix} - ${message}`);
  }
}

async function runAutoRefreshForLeague(leagueConfig) {
  const startTime = Date.now();
  logRefresh(`Starting refresh for league: ${leagueConfig.id}`);
  
  try {
    // Add connection test first
    if (DATABASE_URL) {
      try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
      } catch (dbError) {
        throw new Error(`Database connection failed: ${dbError.message}`);
      }
    }

    const displaySetting = await readJson("current_display_season.json", { season: "2025" });
    const seasonId = displaySetting.season;
    
    if (!leagueConfig.espnId || !seasonId) {
      throw new Error(`Missing ESPN ID (${leagueConfig.espnId}) or season (${seasonId}) for ${leagueConfig.id}`);
    }

    logRefresh(`Refreshing data for league ${leagueConfig.id}, season ${seasonId}`);

    // === ADD: Import Teams First ===
    logRefresh(`Importing teams for ${leagueConfig.id}...`);
    try {
      // Fetch team and roster data
      const [teamJson, rosJson, setJson] = await Promise.all([
        espnFetch({ leagueId: leagueConfig.espnId, seasonId, view: "mTeam", req: { headers: {} }, requireCookie: true }),
        espnFetch({ leagueId: leagueConfig.espnId, seasonId, view: "mRoster", req: { headers: {} }, requireCookie: true }),
        espnFetch({ leagueId: leagueConfig.espnId, seasonId, view: "mSettings", req: { headers: {} }, requireCookie: true }),
      ]);
      
      const teams = teamJson?.teams || [];
      if (teams.length > 0) {
        const names = [...new Set(teams.map(t => teamName(t)))];
        const teamsById = Object.fromEntries(teams.map(t => [t.id, teamName(t)]));
        const slotMap = slotIdToName(setJson?.settings?.rosterSettings?.lineupSlotCounts || {});
        
        // Build roster data
        const rosterData = (rosJson?.teams || []).map(t => {
          const entries = (t.roster?.entries || []).map(e => {
  const p = e.playerPoolEntry?.player;
  const fullName = p?.fullName || "Player";
  const slot = slotMap[e.lineupSlotId] || "—";
  
// ADD THE CONSOLE.LOG HERE:

 let position = "";
const slotId = e.lineupSlotId;

if (slotId === 20) { // Bench
  const eligible = p?.eligibleSlots || [];
  
  // RB check FIRST (slot 2)
  if (eligible.includes(2)) {
    position = "RB";
  }
  // Then check for pure TE (has slot 6 but NOT slots 3 or 4)
  else if (eligible.includes(6) && !eligible.includes(3) && !eligible.includes(4)) {
    position = "TE";
  }
  // WR check
  else if (eligible.includes(3) || eligible.includes(4)) {
    position = "WR";
  }
  // QB check
  else if (eligible.includes(0)) {
    position = "QB";
  }
  // D/ST check
  else if (eligible.includes(16)) {
    position = "D/ST";
  }
  // K check
  else if (eligible.includes(17)) {
    position = "K";
  }
  // Fallback
  else if (p?.defaultPositionId) {
    position = posIdToName(p.defaultPositionId);
  }
} else {
  position = slot;
}
  
  return { 
    name: fullName.replace(/\s*\([^)]*\)\s*/g, '').trim(), 
    slot, 
    position
  };
});

          // Sort starters and bench
          const starters = entries.filter(e => e.slot !== "Bench");
          const bench = entries.filter(e => e.slot === "Bench");
          
          const starterOrderWithCounts = [
            { pos: "QB", max: 1 },
            { pos: "RB", max: 2 }, 
            { pos: "RB/WR", max: 1 },
            { pos: "WR", max: 2 },
            { pos: "TE", max: 1 },
            { pos: "FLEX", max: 1 },
            { pos: "D/ST", max: 1 },
            { pos: "K", max: 1 }
          ];

          const sortedStarters = [];
          starterOrderWithCounts.forEach(({ pos, max }) => {
            const playersInPosition = starters.filter(p => p.slot === pos);
            for (let i = 0; i < max; i++) {
              if (playersInPosition[i]) {
                sortedStarters.push(playersInPosition[i]);
              }
            }
          });

          const sortedBench = bench
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => ({
              name: p.position ? `${p.name} (${p.position})` : p.name,
              slot: p.slot
            }));
          
          const finalEntries = [
            ...sortedStarters.map(p => ({ name: p.name, slot: p.slot })),
            ...sortedBench
          ];
          
          return { 
            teamName: teamsById[t.id] || `Team ${t.id}`, 
            entries: finalEntries 
          };
        });
        
        // Save rosters to database/file
        const data = await getLeagueData(leagueConfig.id);
        data.members = names.map(name => {
          const existing = data.members?.find(m => m.name === name);
          return existing || { id: nid(), name };
        });
        
        data.rosters = data.rosters || {};
        data.rosters[seasonId] = {
          rosterData,
          lastUpdated: new Date().toISOString()
        };
        
        await saveLeagueData(data, leagueConfig.id);
        logRefresh(`Imported ${names.length} teams with rosters for ${leagueConfig.id}`);
      }
    } catch (importError) {
      logRefresh(`Failed to import teams for ${leagueConfig.id}: ${importError.message}`, 'error');
      // Don't throw - continue with report update even if import fails
    }

    // Create a race condition with timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Refresh timeout after 4 minutes')), 240000)
    );

    const refreshPromise = buildOfficialReport({ 
      leagueId: leagueConfig.espnId, 
      seasonId, 
      req: { headers: {} }
    });

    const report = await Promise.race([refreshPromise, timeoutPromise]);
    
// Capture weekly snapshots for completed weeks
const now = new Date();
const currentWeekNum = leagueWeekOf(now, seasonId).week || 0;

for (let week = 1; week <= currentWeekNum; week++) {
  try {
    await captureWeeklySnapshot({
      leagueId: leagueConfig.espnId,
      seasonId,
      weekNumber: week,
      req: { headers: {} }
    });
    logRefresh(`Captured Week ${week} snapshot for ${leagueConfig.id}`);
  } catch (snapErr) {
    logRefresh(`Failed to capture Week ${week} snapshot: ${snapErr.message}`, 'error');
  }
}

    if (report && report.totalsRows && report.totalsRows.length > 0) {
      const snapshot = { seasonId, leagueId: leagueConfig.espnId, ...report };
      
      // Save to database with retry logic
      if (DATABASE_URL) {
        let saveSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const client = await pool.connect();
            await client.query(`
              INSERT INTO reports (season_id, report_data, updated_at) 
              VALUES ($1, $2, CURRENT_TIMESTAMP)
              ON CONFLICT (season_id) DO UPDATE SET 
              report_data = $2, updated_at = CURRENT_TIMESTAMP
            `, [`${leagueConfig.id}_${seasonId}`, JSON.stringify(snapshot)]);
            client.release();
            saveSuccess = true;
            break;
          } catch (dbError) {
            logRefresh(`Database save attempt ${attempt} failed for ${leagueConfig.id}: ${dbError.message}`, 'error');
            if (attempt === 3) throw dbError;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
        
        if (!saveSuccess) {
          throw new Error('Failed to save to database after 3 attempts');
        }
      }
      
      // Always save to file as backup
      try {
        await writeJson(`report_${leagueConfig.id}_${seasonId}.json`, snapshot);
      } catch (fileError) {
        logRefresh(`File save failed for ${leagueConfig.id}: ${fileError.message}`, 'error');
      }
      
      const elapsed = Date.now() - startTime;
      logRefresh(`Successfully updated ${leagueConfig.id} (${elapsed}ms) - ${report.totalsRows.length} teams, ${report.rawMoves?.length || 0} transactions`);
      
      consecutiveFailures = 0;
      return true;
    } else {
      throw new Error('Report generated but contained no data');
    }

  } catch (error) {
    const elapsed = Date.now() - startTime;
    logRefresh(`Failed for league ${leagueConfig.id} after ${elapsed}ms: ${error.message}`, 'error');
    consecutiveFailures++;
    return false;
  }
}

async function runAutoRefresh() {
  if (isRefreshing) {
    logRefresh('Refresh already in progress, skipping this cycle');
    return;
  }

  const now = Date.now();
  if (now - lastRefreshAttempt < 60000) { // Prevent too frequent attempts
    logRefresh('Last refresh attempt was less than 1 minute ago, skipping');
    return;
  }

  isRefreshing = true;
  lastRefreshAttempt = now;
  
  logRefresh('Starting background refresh cycle for all leagues...');
  
  let successCount = 0;
  let failureCount = 0;
  
  // Refresh each league sequentially to avoid overwhelming ESPN API
  for (const leagueConfig of LEAGUES_TO_REFRESH) {
    const success = await runAutoRefreshForLeague(leagueConfig);
    
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
    
    // Wait between leagues only if not the last one
    if (LEAGUES_TO_REFRESH.indexOf(leagueConfig) < LEAGUES_TO_REFRESH.length - 1) {
      logRefresh('Waiting 45 seconds before next league...');
      await new Promise(resolve => setTimeout(resolve, 45000));
    }
  }
  
  const totalElapsed = Date.now() - now;
  logRefresh(`Refresh cycle completed: ${successCount} successes, ${failureCount} failures (${totalElapsed}ms total)`);
  
  isRefreshing = false;
}

// Start auto-refresh cycle with enhanced error handling
function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    logRefresh('Cleared existing refresh interval');
  }
  
  logRefresh('Starting enhanced 10-minute refresh cycle');
  
  const runCycle = async () => {
    try {
      await runAutoRefresh();
      
      // Adjust interval based on failure rate
      let nextInterval = BASE_REFRESH_INTERVAL;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        nextInterval = BASE_REFRESH_INTERVAL * 2; // Double interval after too many failures
        logRefresh(`Increasing refresh interval to ${nextInterval/60000} minutes due to consecutive failures`);
      }
      
    } catch (error) {
      logRefresh(`Cycle failed with unhandled error: ${error.message}`, 'error');
      consecutiveFailures++;
    }
  };
  
  // Run first cycle after 2 minutes instead of immediately
  setTimeout(() => {
    logRefresh('Running initial refresh cycle');
    runCycle();
  }, 120000);
  
  // Set up interval
  autoRefreshInterval = setInterval(runCycle, BASE_REFRESH_INTERVAL);
  
  // Enhanced process handlers
  const handleExit = (signal) => {
    logRefresh(`Received ${signal}, cleaning up auto-refresh`);
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
    if (signal !== 'SIGTERM') {
      process.exit(0);
    }
  };

  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');

  process.on('SIGINT', () => handleExit('SIGINT'));
  process.on('SIGTERM', () => handleExit('SIGTERM'));
  
  process.on('uncaughtException', (error) => {
    logRefresh(`Uncaught exception: ${error.message}`, 'error');
    logRefresh(`Stack: ${error.stack}`, 'error');
    // Don't restart immediately on uncaught exceptions
    setTimeout(() => {
      if (!autoRefreshInterval) {
        logRefresh('Restarting auto-refresh after uncaught exception');
        startAutoRefresh();
      }
    }, 30000);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logRefresh(`Unhandled rejection: ${reason}`, 'error');
    // Log but don't restart - these are usually recoverable
  });
}

// Enhanced status endpoint
app.get("/api/auto-refresh/status", (req, res) => {
  res.json({ 
    status: "running", 
    interval: autoRefreshInterval ? "active" : "inactive",
    timestamp: new Date().toISOString(),
    nextRun: "Every 10 minutes",
    isRefreshing: isRefreshing,
    lastRefreshAttempt: lastRefreshAttempt ? new Date(lastRefreshAttempt).toISOString() : null,
    consecutiveFailures: consecutiveFailures,
    leagues: LEAGUES_TO_REFRESH.length
  });
});


// Start auto-refresh system
startAutoRefresh();

// =========================
// Server startup
// =========================
app.listen(PORT, () => { 
  console.log(`Server running on http://localhost:${PORT}`); 
  console.log(`Database: ${DATABASE_URL ? 'PostgreSQL' : 'File system'}`);
});

// Static hosting - MUST BE LAST
const CLIENT_DIR = path.join(__dirname, "dist");
app.use(express.static(CLIENT_DIR));
