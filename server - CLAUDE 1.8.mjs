// --- server.mjs (Version 4.0 - Complete PostgreSQL + All Features) ---
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");

const PORT = process.env.PORT || 8787;
const ADMIN_PASSWORD = process.env.VITE_ADMIN_PASSWORD || "changeme";

const app = express();
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
async function getLeagueData() {
  return await readJson(LEAGUE_DATA_FILE, {
    announcements: [],
    weeklyList: [],
    members: [],
    waivers: [],
    buyins: {},
    duesPayments: {}, // ADD THIS LINE
    leagueSettingsHtml: "<h2>League Settings</h2><ul><li>Scoring: Standard</li><li>Transactions counted from <b>Thu 12:00 AM PT → Wed 11:59 PM PT</b>; first two are free, then $5 each.</li></ul>",
    tradeBlock: [],
    rosters: {},
    lastUpdated: new Date().toISOString()
  });
}
async function saveLeagueData(data) {
  data.lastUpdated = new Date().toISOString();
  await writeJson(LEAGUE_DATA_FILE, data);
}

// =========================
// League Data API Routes
// =========================

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
            nameById[id] = athlete.fullName || athlete.displayName || athlete.name || `Player ${id}`;
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

// === WAIVERS ===
app.post("/api/league-data/waivers", requireAdmin, async (req, res) => {
  try {
    const { userId, player, date } = req.body;
    if (!userId || !player) {
      return res.status(400).json({ error: "User ID and player required" });
    }

    const data = await getLeagueData();
    const newWaiver = {
      id: nid(),
      userId,
      player: player.trim(),
      date: date || today()
    };
    
    data.waivers = data.waivers || [];
    data.waivers.unshift(newWaiver);
    await saveLeagueData(data);

    res.json({ success: true, waiver: newWaiver });
  } catch (error) {
    console.error('Failed to add waiver:', error);
    res.status(500).json({ error: "Failed to add waiver" });
  }
});

app.delete("/api/league-data/waivers", requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Waiver ID required" });
    }

    const data = await getLeagueData();
    data.waivers = (data.waivers || []).filter(w => w.id !== id);
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete waiver:', error);
    res.status(500).json({ error: "Failed to delete waiver" });
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
  if (DATABASE_URL) {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT * FROM polls_data ORDER BY updated_at DESC LIMIT 1');
      client.release();
      
      if (result.rows.length > 0) {
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
  return await readJson("polls.json", { polls: {}, votes: {}, teamCodes: {} });
}

async function savePolls(pollsState) {
  if (DATABASE_URL) {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT id FROM polls_data ORDER BY updated_at DESC LIMIT 1');
      
      if (result.rows.length > 0) {
        await client.query(`
          UPDATE polls_data SET 
          polls = $1, votes = $2, team_codes = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `, [
          JSON.stringify(pollsState.polls),
          JSON.stringify(pollsState.votes), 
          JSON.stringify(pollsState.teamCodes),
          result.rows[0].id
        ]);
      } else {
        await client.query(`
          INSERT INTO polls_data (polls, votes, team_codes) VALUES ($1, $2, $3)
        `, [
          JSON.stringify(pollsState.polls),
          JSON.stringify(pollsState.votes), 
          JSON.stringify(pollsState.teamCodes)
        ]);
      }
      
      client.release();
    } catch (err) {
      console.error('Database polls save error:', err);
      await writeJson("polls.json", pollsState);
    }
  } else {
    await writeJson("polls.json", pollsState);
  }
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
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { seasonId, teams } = req.body || {};
  if (!seasonId || !Array.isArray(teams)) return res.status(400).send("Missing seasonId or teams[]");
  
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
  const pollsState = await loadPolls();
  
  const out = Object.values(pollsState.polls || {}).map(p => {
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
  res.json({ polls: out });
});

app.post("/api/polls/create", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).send("Bad request");
  
  const pollsState = await loadPolls();
  const id = nid();
  pollsState.polls[id] = { 
    id, 
    question: String(question), 
    closed: false, 
    options: options.map(label => ({ id: nid(), label: String(label) })) 
  };
  
  await savePolls(pollsState);
  res.json({ ok: true, pollId: id });
});

app.post("/api/polls/close", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId, closed } = req.body || {};
  
  const pollsState = await loadPolls();
  if (!pollId || !pollsState.polls[pollId]) return res.status(404).send("Not found");
  
  pollsState.polls[pollId].closed = !!closed;
  await savePolls(pollsState);
  res.json({ ok: true });
});

app.post("/api/polls/delete", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId } = req.body || {};
  if (!pollId) return res.status(400).send("Missing pollId");
  
  const pollsState = await loadPolls();
  if (pollsState.polls[pollId]) delete pollsState.polls[pollId];
  if (pollsState.votes[pollId]) delete pollsState.votes[pollId];
  
  await savePolls(pollsState);
  res.json({ ok: true });
});

app.get("/api/polls/team-codes", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const seasonId = req.query?.seasonId;
  if (!seasonId) return res.status(400).send("Missing seasonId");
  
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
const WEEK_START_DAY = 4;
function fmtPT(dateLike){ return new Date(dateLike).toLocaleString(); }
function normalizeEpoch(x){
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  if (x > 0 && x < 1e11) return x * 1000;
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
function firstThursdayOfSeptember(year){
  const d = new Date(year, 8, 1);
  const offset = (4 - d.getDay() + 7) % 7; // 4 = Thursday
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}
const DAY = 24*60*60*1000;
function weekBucket(date, seasonYear) {
  const z = new Date(date);
  const w1 = firstThursdayOfSeptember(Number(seasonYear)); // Updated to use Thursday
  const diff = z.getTime() - w1.getTime();
  const week = Math.max(1, Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1);
  const start = new Date(w1.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  return { week, start };
}


function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeek(date);
  const week1 = startOfLeagueWeek(firstThursdayOfSeptember(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0;
  return { week, start };
}

function weekRangeLabelDisplay(start){
  const thu = new Date(start); thu.setHours(0,0,0,0);
  const wed = new Date(thu); wed.setDate(wed.getDate()+6); wed.setHours(23,59,0,0);
  const short = (d)=> new Date(d).toLocaleDateString(undefined,{month:"short", day:"numeric"});
  return `${short(thu)}–${short(wed)} (cutoff Wed 11:59 PM PT)`;
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
  const candidates = [sp, sp-1, sp+1].filter(x => x>=1 && x < series.length);
  return candidates.some(s => series?.[s]?.[teamId]?.has(pid));
};

// Replace your validateTransactions function with this ChatGPT-inspired approach:

async function validateTransactions(transactions, series, draftPicks, seasonYear, { leagueId, seasonId, req }) {
  console.log(`[DEBUG] Starting roster-verified validation of ${transactions.length} raw transactions`);
  
  // Step 1: Only filter out CANCEL transactions
  let validTransactions = transactions.filter(t => t.method !== "CANCEL");
  console.log(`[DEBUG] After CANCEL filtering: ${validTransactions.length} transactions`);
  
  // Step 2: Build paired transactions by txId (keeps ADD+DROP together)
  const txPairsByKey = new Map(); // key: `${txId}|${teamId}`
  
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
        teamIdRaw: r.teamIdRaw || r.teamId, // PRESERVE THIS
        team: r.team, // PRESERVE TEAM NAME
        add: null, 
        drop: null,
        originalTransaction: r // PRESERVE ORIGINAL FOR REFERENCE
      };
      txPairsByKey.set(key, rec);
    }
    
    if (r.action === "ADD")  rec.add = r.playerId;
    if (r.action === "DROP") rec.drop = r.playerId;
  }
  
  const txPairs = [...txPairsByKey.values()].filter(x => x.add || x.drop);
  console.log(`[DEBUG] Built ${txPairs.length} transaction pairs`);
  
  // Step 3: Build roster owner map for scoring periods we need (only for PROCESS adds)
   
    
  // Step 4: Keep only winners for waivers; keep all EXECUTEs
  const kept = [];
  let processWinners = 0;
  let processLosers = 0;
  
  for (const rec of txPairs) {
    if (rec.method === "EXECUTE") {
      kept.push(rec);
      continue;
    }
    
    if (rec.method === "PROCESS" && rec.add) {
  const winner = isOwnerAtSomeSP(series, rec.add, rec.teamId, rec.sp);
  if (winner) {
    kept.push(rec);
    processWinners++;
    console.log(`[DEBUG] Waiver winner: Team ${rec.teamId} gets player ${rec.add} in SP ${rec.sp}`);
  } else {
    processLosers++;
    console.log(`[DEBUG] No roster match for PROCESS add pid=${rec.add}, team=${rec.teamId}, sp=${rec.sp} (checked sp±1)`);
  }
  continue;
}
    
    // Handle PROCESS transactions with only drops or other cases
    if (rec.method === "PROCESS") {
      kept.push(rec);
    }
  }
  
  console.log(`[DEBUG] Waiver processing: ${processWinners} winners, ${processLosers} losers filtered out`);
  
  // Step 5: Expand back out to individual ADD/DROP transactions - PRESERVE ALL ORIGINAL DATA
  const finalTransactions = [];
  
  for (const r of kept) {
    const baseTransaction = {
      date: new Date(r.ts),
      teamIdRaw: r.teamIdRaw, // PRESERVE THIS
      teamId: r.teamId, // PRESERVE THIS
      team: r.team, // PRESERVE TEAM NAME
      method: r.method,
      eventId: r.txId,
      src: r.originalTransaction.src || "validated",
      playerName: null // Will be filled later
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
  
  // Step 6: Final deduplication for truly identical rows
  const seen = new Set();
  const dedupedFinal = finalTransactions.filter(r => {
    const k = `${r.date.getTime()}|${r.teamIdRaw}|${r.playerId}|${r.action}|${r.method}`;
    if (seen.has(k)) {
      console.log(`[DEBUG] Removing duplicate: ${r.action} ${r.playerId} by team ${r.teamIdRaw}`);
      return false;
    }
    seen.add(k);
    return true;
  });
  
  console.log(`[DEBUG] Final validation results:`);
  console.log(`- Transaction pairs processed: ${txPairs.length}`);
  console.log(`- Pairs kept after waiver verification: ${kept.length}`);
  console.log(`- Final individual transactions: ${dedupedFinal.length}`);
  console.log(`- Final ADDs: ${dedupedFinal.filter(t => t.action === "ADD").length}`);
  console.log(`- Final DROPs: ${dedupedFinal.filter(t => t.action === "DROP").length}`);
  
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
    
  const out = [];
  for (const t of rows){
    const when = new Date(normalizeEpoch(t.processDate ?? t.proposedDate ?? t.executionDate ?? t.date ?? t.timestamp ?? Date.now()));
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
            teamId: fromTeamId, date:when, action:"DROP", method:"FA", src, 
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
  return series;
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
          map[id] = athlete.fullName || athlete.displayName || athlete.name || `Player ${id}`;
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

// Get draft data for baseline
const draftPicks = await fetchDraftData({ leagueId, seasonId, req });
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25 });
  console.log(`[DEBUG] Total moves extracted from all sources: ${all.length}`);
  console.log(`[DEBUG] Sample moves:`, all.slice(0, 3));
  
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25 });
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
  r.action === "ADD" && r.method !== "DRAFT"
);
const drops = validatedTransactions.filter(r => r.action === "DROP");

console.log(`[DEBUG] After simple filtering: ${billableAdds.length} billable adds, ${drops.length} drops`);
console.log(`[DEBUG] Excluded CANCEL transactions, kept PROCESS and EXECUTE`);

// Enhanced filtering to surface players “added” by multiple teams (likely failed bids)
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
  [...billableAdds, ...drops]
    .map(r => (r.player ? null : r.playerId))
    .filter(Boolean)
)];

const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp: 25 });

for (const r of [...billableAdds, ...drops]) {
  if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;
}
  
let rawMoves = [...billableAdds, ...drops].map(r => {
    const wb = weekBucket(r.date, seasonId);
    return {
      date: fmtPT(r.date),
      ts: new Date(r.date).getTime(),
      week: wb.week,
      range: weekRangeLabelDisplay(wb.start),
      team: r.team,
      player: r.player || (r.playerId ? `#${r.playerId}` : "—"),
      action: r.action,
      method: r.method,
      source: r.src,
      playerId: r.playerId || null
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
    if (r.action !== "ADD" || r.week <= 0) continue;
    if (!perWeek.has(r.week)) perWeek.set(r.week, new Map());
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
    
    // If no specific season requested, use the server's current display season
    if (!seasonId) {
      const displaySetting = await readJson("current_display_season.json", { season: "2025" });
      seasonId = displaySetting.season; // Use 'season', not 'defaultSeason'
    }
    
    if (DATABASE_URL) {
      const client = await pool.connect();
      const result = await client.query('SELECT report_data FROM reports WHERE season_id = $1', [seasonId]);
      client.release();
      if (result.rows.length > 0) {
        return res.json(result.rows[0].report_data);
      }
    }
    
    const preferred = await readJson(`report_${seasonId}.json`, null);
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

app.post("/api/report/update", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { leagueId, seasonId } = req.body || {};
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
    
    // Save to database if available
    if (DATABASE_URL) {
      const client = await pool.connect();
      await client.query(`
        INSERT INTO reports (season_id, report_data, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (season_id) DO UPDATE SET 
        report_data = $2, updated_at = CURRENT_TIMESTAMP
      `, [seasonId, JSON.stringify(snapshot)]);

  // ADD THIS: Update default season in database too
  await client.query(`
  INSERT INTO league_data (data_type, data_value) 
  VALUES ('current_display_season', $1)
  ON CONFLICT (data_type) DO UPDATE SET 
  data_value = EXCLUDED.data_value, updated_at = CURRENT_TIMESTAMP
`, [JSON.stringify({ season: seasonId, updatedAt: Date.now() })]);
      client.release();
    }
    
// In server.mjs, around line 780 in the updateOfficialSnapshot function
await writeJson(`report_${seasonId}.json`, snapshot);

// ADD THIS LINE BACK:
const defaultSetting = { season: seasonId, updatedAt: Date.now() };
await writeJson("current_display_season.json", defaultSetting);

setProgress(jobId, 100, "Snapshot complete");

    res.json({ ok: true, weeks: (report?.weekRows || []).length });
  } catch (err) {
    console.error('Report update failed:', err);
    setProgress(jobId, 100, "Failed");
    res.status(502).send(err?.message || String(err));
  }
});

// =========================
// Static hosting
// =========================
const CLIENT_DIR = path.join(__dirname, "dist");
app.use(express.static(CLIENT_DIR));
app.get(/^(?!\/api).*/, (_req, res) => { 
  res.sendFile(path.join(CLIENT_DIR, "index.html")); 
});

// =========================
// Server startup
// =========================
app.listen(PORT, () => { 
  console.log(`Server running on http://localhost:${PORT}`); 
  console.log(`Database: ${DATABASE_URL ? 'PostgreSQL' : 'File system'}`);
});