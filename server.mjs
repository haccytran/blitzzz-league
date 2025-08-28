// --- server.mjs (Version 3.7, PostgreSQL + Fixes) ---
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
// Optional PostgreSQL import
let Pool = null;
try {
  const pkg = await import('pg');
  Pool = pkg.Pool;
} catch (err) {
  console.log('PostgreSQL not available, using file storage');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, "data");

const PORT           = process.env.PORT || 8787;
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
      // League data table
      await client.query(`
        CREATE TABLE IF NOT EXISTS league_data (
          id SERIAL PRIMARY KEY,
          data_type VARCHAR(50) NOT NULL,
          data_key VARCHAR(100),
          data_value JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Polls table
      await client.query(`
        CREATE TABLE IF NOT EXISTS polls_data (
          id SERIAL PRIMARY KEY,
          polls JSONB DEFAULT '{}',
          votes JSONB DEFAULT '{}',
          team_codes JSONB DEFAULT '{}',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Reports table
      await client.query(`
        CREATE TABLE IF NOT EXISTS reports (
          season_id VARCHAR(20) PRIMARY KEY,
          report_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert initial polls data if not exists
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
    try { return JSON.parse(await fs.readFile(fpath(name), "utf8")); }
    catch { return fallback; }
  }
}

async function writeJson(name, obj) {
  if (DATABASE_URL) {
    try {
      const client = await pool.connect();
      const dataType = name.replace('.json', '');
      await client.query(`
        INSERT INTO league_data (data_type, data_value, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (data_type) DO UPDATE SET 
        data_value = $2, updated_at = CURRENT_TIMESTAMP
      `, [dataType, JSON.stringify(obj)]);
      client.release();
    } catch (err) {
      console.error('Database write error:', err);
      // Fallback to file system
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

// =========================
// League Data Storage
// =========================
const LEAGUE_DATA_FILE = "league_data.json";

async function getLeagueData() {
  return await readJson(LEAGUE_DATA_FILE, {
    announcements: [],
    weeklyList: [],
    members: [],
    waivers: [],
    buyins: {},
    leagueSettingsHtml: "<h2>League Settings</h2><ul><li>Scoring: Standard</li><li>Transactions counted from <b>Wed 12:00 AM PT → Tue 11:59 PM PT</b>; first two are free, then $5 each.</li></ul>",
    tradeBlock: [],
    rosters: {},
    lastUpdated: new Date().toISOString()
  });
}

async function saveLeagueData(data) {
  data.lastUpdated = new Date().toISOString();
  await writeJson(LEAGUE_DATA_FILE, data);
}

// Helper for generating IDs
const nid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);

// =========================
// League Data API Routes
// =========================

// GET all league data
app.get("/api/league-data", async (req, res) => {
  try {
    const data = await getLeagueData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to load league data" });
  }
});

// === ANNOUNCEMENTS ===
app.get("/api/league-data/announcements", async (req, res) => {
  try {
    const data = await getLeagueData();
    res.json({ announcements: data.announcements || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load announcements" });
  }
});

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
    res.status(500).json({ error: "Failed to delete announcement" });
  }
});

// === WEEKLY CHALLENGES ===
app.get("/api/league-data/weekly", async (req, res) => {
  try {
    const data = await getLeagueData();
    res.json({ weeklyList: data.weeklyList || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load weekly challenges" });
  }
});

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
    res.status(500).json({ error: "Failed to delete member" });
  }
});

app.post("/api/league-data/import-teams", requireAdmin, async (req, res) => {
  try {
    const { teams } = req.body;
    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: "Teams array required" });
    }

    const data = await getLeagueData();
    data.members = teams.map(name => ({ id: nid(), name }));
    await saveLeagueData(data);

    res.json({ success: true, imported: teams.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to import teams" });
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
    res.status(500).json({ error: "Failed to delete waiver" });
  }
});

app.post("/api/league-data/reset-waivers", requireAdmin, async (req, res) => {
  try {
    const data = await getLeagueData();
    data.waivers = [];
    await saveLeagueData(data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset waivers" });
  }
});

// === BUY-INS (Fixed with proper server-side persistence) ===
app.post("/api/league-data/buyins", requireAdmin, async (req, res) => {
  try {
    const { seasonKey, updates } = req.body;
    if (!seasonKey || !updates) {
      return res.status(400).json({ error: "Season key and updates required" });
    }

    const data = await getLeagueData();
    data.buyins = data.buyins || {};
    data.buyins[seasonKey] = updates;
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update buy-ins" });
  }
});

// === ROSTERS (Server-side storage) ===
app.get("/api/league-data/rosters", async (req, res) => {
  try {
    const { seasonId } = req.query;
    const data = await getLeagueData();
    const rosters = data.rosters || {};
    res.json({ rosters: rosters[seasonId] || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load rosters" });
  }
});

app.post("/api/league-data/rosters", requireAdmin, async (req, res) => {
  try {
    const { seasonId, rosters } = req.body;
    if (!seasonId || !rosters) {
      return res.status(400).json({ error: "Season ID and rosters required" });
    }

    const data = await getLeagueData();
    data.rosters = data.rosters || {};
    data.rosters[seasonId] = rosters;
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to save rosters" });
  }
});

// === LEAGUE SETTINGS ===
app.post("/api/league-data/settings", requireAdmin, async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ error: "HTML content required" });
    }

    const data = await getLeagueData();
    data.leagueSettingsHtml = html.trim();
    await saveLeagueData(data);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to save league settings" });
  }
});

// === TRADING BLOCK ===
app.get("/api/league-data/trading", async (req, res) => {
  try {
    const data = await getLeagueData();
    res.json({ tradeBlock: data.tradeBlock || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load trades" });
  }
});

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
    res.status(500).json({ error: "Failed to delete trade" });
  }
});

// =========================
// Polls (v2.1) - PostgreSQL compatible
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
      await client.query(`
        UPDATE polls_data SET 
        polls = $1, votes = $2, team_codes = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM polls_data ORDER BY updated_at DESC LIMIT 1)
      `, [
        JSON.stringify(pollsState.polls),
        JSON.stringify(pollsState.votes), 
        JSON.stringify(pollsState.teamCodes)
      ]);
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
// Keep existing ESPN/Report functionality
// =========================

// Progress
const jobProgress = new Map();
function setProgress(jobId, pct, msg) {
  if (!jobId) return;
  jobProgress.set(jobId, { pct: Math.max(0, Math.min(100, Math.round(pct))), msg: String(msg || ""), t: Date.now() });
}
app.get("/api/progress", (req, res) => {
  const { jobId } = req.query || {};
  res.json(jobProgress.get(jobId) || { pct: 0, msg: "" });
});

// Week helpers (NATIVE LOCAL TIME)
const WEEK_START_DAY = 3; // Wednesday
function fmtPT(dateLike){ return new Date(dateLike).toLocaleString(); }
function normalizeEpoch(x){
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  if (x > 0 && x < 1e11) return x * 1000;
  return x;
}
function isWithinWaiverWindow(dateLike){
  const z = new Date(dateLike);
  if (z.getDay() !== 3) return false;
  const minutes = z.getHours()*60 + z.getMinutes();
  return minutes <= 4*60 + 30;
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
  const offset = (3 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}
const DAY = 24*60*60*1000;
const WAIVER_EARLY_WED_SHIFT_MS = 5 * 60 * 60 * 1000;
function weekBucket(date, seasonYear) {
  let z = new Date(date);
  if (z.getDay() === 3 && z.getHours() < 5) z = new Date(z.getTime() - WAIVER_EARLY_WED_SHIFT_MS);
  const w1 = firstWednesdayOfSeptember(Number(seasonYear));
  const diff = z.getTime() - w1.getTime();
  const week = Math.max(1, Math.floor(diff / (7 * DAY)) + 1);
  const start = new Date(w1.getTime() + (week - 1) * 7 * DAY);
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
  return `${short(wed)}–${short(tue)} (cutoff Tue 11:59 PM PT)`;
}

// ESPN proxy (3.5 behavior)
function buildCookie(req) {
  const hdr = req.headers["x-espn-cookie"];
  if (hdr) return String(hdr);
  const swid = process.env.SWID;
  const s2   = process.env.ESPN_S2 || process.env.S2;
  if (swid && s2) return `SWID=${swid}; ESPN_S2=${s2}`;
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
  try { return { ok:true, json: JSON.parse(text), status: r.status }; }
  catch {
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
    const json = await espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie: auth === "1" });
    res.json(json);
  } catch (e) { res.status(502).send(String(e.message || e)); }
});

// Transactions+report (3.5 behavior, restored)
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
const pickPlayerId   = (it)=> it?.playerId ?? it?.playerPoolEntry?.player?.id ?? it?.entityId ?? null;
const pickPlayerName = (it,t)=> it?.playerPoolEntry?.player?.fullName || it?.player?.fullName || t?.playerPoolEntry?.player?.fullName || t?.player?.fullName || null;
function extractMoves(json, src="tx"){
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
      const method = inferMethod(typeStr, typeNum, t, null);
      const teamId = t.toTeamId ?? t.teamId ?? t.forTeamId ?? t.targetTeamId ?? t.fromTeamId ?? null;
      if (teamId != null) out.push({ teamId, date:when, action, method, src, eventId, playerId: t.playerId ?? null, playerName: t.playerName ?? null });
      continue;
    }
    for (const it of items){
      const iTypeStr = it.type ?? it.moveType ?? it.action;
      const iTypeNum = Number.isFinite(it.type) ? it.type : null;
      const method = inferMethod(iTypeStr ?? typeStr, iTypeNum ?? typeNum, t, it);
      if (/ADD|WAIVER|CLAIM/i.test(String(iTypeStr)) || [1,5,7].includes(iTypeNum)) {
        const toTeamId = it.toTeamId ?? it.teamId ?? it.forTeamId ?? t.toTeamId ?? t.teamId ?? null;
        if (toTeamId != null) out.push({ teamId: toTeamId, date:when, action:"ADD",  method, src, eventId: it.id ?? eventId ?? null, playerId: pickPlayerId(it), playerName: pickPlayerName(it,t) });
      }
      if (/DROP/i.test(String(iTypeStr)) || [2].includes(iTypeNum)) {
        const fromTeamId = it.fromTeamId ?? t.fromTeamId ?? it.teamId ?? null;
        if (fromTeamId != null) out.push({ teamId: fromTeamId, date:when, action:"DROP", method:"FA", src, eventId: it.id ?? eventId ?? null, playerId: pickPlayerId(it), playerName: pickPlayerName(it,t) });
      }
    }
  }
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
        if (/ADD|WAIVER|CLAIM/.test(s) && teamId != null) out.push({ teamId, date:when, action:"ADD",  method:/WAIVER|CLAIM/.test(s) ? "WAIVER":"FA", src:"comm", playerId:a.playerId||null });
        if (/DROP/.test(s)           && teamId != null) out.push({ teamId, date:when, action:"DROP", method:"FA", src:"comm", playerId:a.playerId||null });
      }
    }
  }
  return out;
}
function dedupeMoves(events){
  const seen = new Set(), out = [];
  for (const e of events){
    const tMin = Math.floor(new Date(e.date).getTime() / 60000);
    const key = e.eventId ? `id:${e.eventId}|a:${e.action}` : `tm:${e.teamId}|p:${e.playerId||""}|a:${e.action}|m:${tMin}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
  }
  return out;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp=25, onProgress }){
  const all = [];
  for (let sp=1; sp<=maxSp; sp++){
    onProgress?.(sp, maxSp, "Reading ESPN activity…");
    try { const j = await espnFetch({ leagueId, seasonId, view:"mTransactions2", scoringPeriodId: sp, req, requireCookie:true }); all.push(...extractMoves(j,"tx")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view:"recentActivity", scoringPeriodId: sp, req, requireCookie:true }); all.push(...extractMoves(j,"recent")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view:"kona_league_communication", scoringPeriodId: sp, req, requireCookie:true }); all.push(...extractMovesFromComm(j)); } catch {}
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
    } catch {}
    if (Object.keys(byTeam).length === 0) byTeam = lastGood;
    else lastGood = byTeam;
    series[sp] = byTeam;
  }
  return series;
}
const isOnRoster = (series, sp, teamId, playerId) => !!(playerId && series?.[sp]?.[teamId]?.has(playerId));
const spFromDate = (dateLike, seasonYear)=> Math.max(1, Math.min(25, (leagueWeekOf(new Date(dateLike), seasonYear).week || 1)));
function isGenuineAddBySeries(row, series, seasonYear){
  if (!row.playerId) return true; // lenient as in 3.5
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  const later = [sp, sp+1, sp+2].filter(n=>n<series.length);
  const wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  const appearsLater = later.some(n=> isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return !wasBefore && appearsLater;
}
function isExecutedDropBySeries(row, series, seasonYear){
  if (!row.playerId) return true; // lenient as in 3.5
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  const later = [sp, sp+1, sp+2].filter(n=>n<series.length);
  const wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId) || isOnRoster(series, sp, row.teamIdRaw, row.playerId);
  const appearsLater = later.some(n=> isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return wasBefore && !appearsLater;
}
async function buildPlayerMap({ leagueId, seasonId, req, ids, maxSp=25, onProgress }){
  const need = new Set((ids||[]).filter(Boolean));
  const map = {}; if (need.size===0) return map;
  for (let sp=1; sp<=maxSp; sp++){
    onProgress?.(sp, maxSp, "Resolving player names…");
    try {
      const r = await espnFetch({ leagueId, seasonId, view:"mRoster", scoringPeriodId: sp, req, requireCookie:false });
      for (const t of (r?.teams||[])) {
        for (const e of (t.roster?.entries||[])) {
          const p = e.playerPoolEntry?.player;
          const pid = p?.id;
          if (pid && need.has(pid)) { map[pid] = p.fullName || p.name || `#${pid}`; need.delete(pid); }
        }
      }
      if (need.size===0) break;
    } catch {}
  }
  return map;
}
async function buildOfficialReport({ leagueId, seasonId, req }){
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25 });
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25 });
  const deduped = dedupeMoves(all).map(e => ({ ...e, teamIdRaw: e.teamId, team: idToName[e.teamId] || `Team ${e.teamId}`, player: e.playerName || null }));
  const adds  = deduped.filter(r => r.action === "ADD"  && isGenuineAddBySeries(r, series, seasonId));
  const drops = deduped.filter(r => r.action === "DROP" && isExecutedDropBySeries(r, series, seasonId));
  const needIds = [...new Set([...adds, ...drops].map(r => r.player ? null : r.playerId).filter(Boolean))];
  const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25 });
  for (const r of [...adds, ...drops]) if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;
  let rawMoves = [...adds, ...drops].map(r => {
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
  const DEDUPE_WINDOW_MS = 3 * 60 * 1000;
  const dedupedMoves = [];
  const lastByKey = new Map();
  for (const m of rawMoves) {
    const key = `${m.team}|${m.playerId || m.player}`;
    if (m.action === "DROP") {
      const prev = lastByKey.get(key);
      if (prev && prev.action === "DROP" && Math.abs(m.ts - prev.ts) <= DEDUPE_WINDOW_MS) continue;
      lastByKey.set(key, { action: "DROP", ts: m.ts });
    } else if (m.action === "ADD") {
      lastByKey.set(key, { action: "ADD", ts: m.ts });
    }
    dedupedMoves.push(m);
  }
  rawMoves = dedupedMoves.map(({ ts, ...rest }) => rest);
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
  for (const r of rawMoves) if (r.week>0 && !rangeByWeek[r.week]) rangeByWeek[r.week] = r.range;
  for (const w of [...perWeek.keys()].sort((a,b)=>a-b)) {
    const entries = [];
    const m = perWeek.get(w);
    for (const [team, count] of m.entries()) {
      const owes = Math.max(0, count - 2) * 5;
      entries.push({ name: team, count, owes });
      const t = totals.get(team) || { adds:0, owes:0 };
      t.adds += count; t.owes += owes; totals.set(team, t);
    }
    entries.sort((a,b)=> a.name.localeCompare(b.name));
    weekRows.push({ week:w, range: rangeByWeek[w] || "", entries });
  }
  const totalsRows = [...totals.entries()].map(([name, v]) => ({ name, adds: v.adds, owes: v.owes }))
    .sort((a,b)=> b.owes - a.owes || a.name.localeCompare(b.name));
  return { lastSynced: fmtPT(new Date()), totalsRows, weekRows, rawMoves };
}

// Snapshot routes
app.get("/api/report", async (req, res) => {
  const seasonId = req.query?.seasonId;
  const preferred = seasonId ? await readJson(`report_${seasonId}.json`, null) : null;
  const fallback  = await readJson(REPORT_FILE, null);
  const report = preferred || fallback;
  if (!report) return res.status(404).send("No report");
  res.json(report);
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
    await writeJson(`report_${seasonId}.json`, snapshot);
    await writeJson(REPORT_FILE, snapshot);
    setProgress(jobId, 100, "Snapshot complete");
    res.json({ ok: true, weeks: (report?.weekRows || []).length });
  } catch (err) {
    setProgress(jobId, 100, "Failed");
    res.status(502).send(err?.message || String(err));
  }
});

// Static hosting
const CLIENT_DIR = path.join(__dirname, "dist");
app.use(express.static(CLIENT_DIR));
app.get(/^(?!\/api).*/, (_req, res) => { res.sendFile(path.join(CLIENT_DIR, "index.html")); });

app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });