// --- standard header (keep exactly one copy) ---
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fs from "fs/promises";           // use fs/promises (no readFileSync)
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, "data");   // one declaration only

const PORT           = process.env.PORT || 8787;
const ADMIN_PASSWORD = process.env.VITE_ADMIN_PASSWORD || "changeme";
const LEAGUE_TZ      = "America/Los_Angeles"; // PT

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ===== ENHANCED LOGGING SYSTEM =====
class ProcessLogger {
  constructor() {
    this.logs = [];
    this.stats = {
      totalRawTransactions: 0,
      transactionsBySource: {},
      transactionsBySP: {},
      filteredOut: { dedup: 0, verification: 0, finalDedup: 0 },
      errors: []
    };
  }
  log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: JSON.stringify(data, null, 2)
    };
    this.logs.push(entry);
    console.log(`[${level.toUpperCase()}] ${message}`, data);
  }
  error(message, error, data = {}) {
    const errorEntry = {
      message,
      error: error?.message || String(error),
      stack: error?.stack,
      data
    };
    this.stats.errors.push(errorEntry);
    this.log('ERROR', message, errorEntry);
  }
  info(message, data = {}) { this.log('INFO', message, data); }
  debug(message, data = {}) { this.log('DEBUG', message, data); }
  getFullLog() { return { stats: this.stats, logs: this.logs, totalLogs: this.logs.length }; }
}






// ===== POLLS v2.1 — state + save/load (BEGIN) =====

// Keep one shared state for polls; persist to data/polls.json
const POLLS_FILE = path.join(DATA_DIR, "polls.json");

let pollsState = { polls: {}, votes: {}, teamCodes: {} };

async function loadPolls21() {
  try {
    const raw = await fs.readFile(POLLS_FILE, "utf-8");
    const data = JSON.parse(raw);
    pollsState.polls     = data.polls     || {};
    pollsState.votes     = data.votes     || {};
    pollsState.teamCodes = data.teamCodes || {};
  } catch { /* first run is fine */ }
}
async function savePolls21() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(POLLS_FILE, JSON.stringify(pollsState, null, 2), "utf-8");
}

// friendly short word code; one per team per season

await loadPolls21();
// ===== POLLS v2.1 — state + save/load (END) =====



function codeKey(seasonId, teamId){ return `${seasonId}:${teamId}`; }

// --- Season-wide team codes (one per team, reused across all polls) ---

// friendly single-word codes; add/remove to taste
const FRIENDLY_WORDS = [
  "MANGO","FALCON","TIGER","ORCA","BISON","HAWK","PANDA","EAGLE","MAPLE","CEDAR","ONYX","ZINC",
  "SAPPHIRE","COBALT","QUARTZ","NEON","NOVA","COMET","BOLT","BLITZ","STORM","GLACIER","RAPTOR",
  "VIPER","COUGAR","WOLF","SHARK","LYNX","OTTER","MOOSE","BEAR","FOX","RAVEN","ROBIN","DRAGON",
  "PHOENIX","ORBIT","ROCKET","ATLAS","APEX","DELTA","OMEGA","THUNDER","SURGE","WAVE","EMBER",
  "FROST","POLAR","COSMIC","SHADOW","AQUA"
];

function randomFriendlyCode() {
  return FRIENDLY_WORDS[Math.floor(Math.random() * FRIENDLY_WORDS.length)];
}

// make sure containers exist
pollsState.teamCodes = pollsState.teamCodes || {};
pollsState.votes     = pollsState.votes     || {};

// Commissioner: generate (or ensure) a code for every team in the season
app.post("/api/polls/issue-team-codes", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { seasonId, teams } = req.body || {};
  if (!seasonId || !Array.isArray(teams)) return res.status(400).send("Missing seasonId or teams[]");

  // keep codes stable if already created; otherwise assign a new friendly word
  const used = new Set(Object.values(pollsState.teamCodes).map(v => v.code));
  const issued = [];
  for (const t of teams) {
    const key = `${seasonId}:${t.id}`;
    if (!pollsState.teamCodes[key]) {
      let code;
      // avoid accidental duplicates
      do { code = randomFriendlyCode(); } while (used.has(code));
      used.add(code);
      pollsState.teamCodes[key] = { code, createdAt: Date.now() };
    }
    issued.push({ teamId: t.id, teamName: t.name, code: pollsState.teamCodes[key].code });
  }
  await savePolls21();

  res.json({ issued: issued.length, codes: issued });
});

// Vote using the season-wide team code (one vote per poll per team)
app.post("/api/polls/vote", async (req, res) => {
  const { pollId, optionId, seasonId, teamCode } = req.body || {};
  if (!pollId || !optionId || !seasonId || !teamCode) {
    return res.status(400).send("Missing pollId/optionId/seasonId/teamCode");
  }

  // resolve teamId from code for this season
  let teamId = null;
  for (const [k, v] of Object.entries(pollsState.teamCodes)) {
    if (k.startsWith(`${seasonId}:`) && String(v.code).toUpperCase() === String(teamCode).toUpperCase()) {
      teamId = Number(k.split(":")[1]);
      break;
    }
  }
  if (!teamId) return res.status(403).send("Invalid code");

  pollsState.votes[pollId] = pollsState.votes[pollId] || {};
  // allow changing your vote; uncomment next line and remove overwrite if you want “locked” votes
  // if (pollsState.votes[pollId][teamId]) return res.status(409).send("Already voted");
  pollsState.votes[pollId][teamId] = optionId;

  await savePolls21();

  res.json({ ok: true, byTeam: pollsState.votes[pollId] });
});

/* =========================
   Setup
   ========================= */


/* ===== Progress (in-memory) ===== */
const jobProgress = new Map(); // jobId -> { pct, msg, t }
function setProgress(jobId, pct, msg) {
  if (!jobId) return;
  jobProgress.set(jobId, { pct: Math.max(0, Math.min(100, Math.round(pct))), msg: String(msg || ""), t: Date.now() });
}
// lightweight polling endpoint
app.get("/api/progress", (req, res) => {
  const { jobId } = req.query || {};
  const v = jobProgress.get(jobId);
  res.json(v || { pct: 0, msg: "" });
});

/* =========================
   File helpers
   ========================= */
const fpath = (name) => path.join(DATA_DIR, name);

async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(fpath(name), "utf8")); }
  catch { return fallback; }
}
async function writeJson(name, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
}


/* =========================
   Time helpers (Wed→Tue league week) — robust PT conversion
   ========================= */
const dtfPT = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TZ,               // "America/Los_Angeles"
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Return a Date whose clock reflects PT (no locale string parsing). */
function toPT(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const parts = Object.fromEntries(dtfPT.formatToParts(d).map(p => [p.type, p.value]));
  // Build a UTC timestamp that represents the PT wall clock time.
  return new Date(Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second
  ));
}

/** Pretty-print a timestamp in PT for labels/debug. */
function fmtPT(dateLike) {
  return new Date(dateLike).toLocaleString("en-US", { timeZone: LEAGUE_TZ });
}


const WEEK_START_DAY = 3; // Wednesday
function startOfLeagueWeekPT(date){
  const z = toPT(date);
  const base = new Date(z); base.setHours(0,0,0,0);
  const back = (base.getDay() - WEEK_START_DAY + 7) % 7;
  base.setDate(base.getDate() - back);
  if (z < base) base.setDate(base.getDate() - 7);
  return base;
}
function firstWednesdayOfSeptemberPT(year){
  const d = toPT(new Date(year, 8, 1));
  const offset = (3 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}

// --- Precise week bucketing (Wed→Tue), with early-Wed waiver grace window ---
const DAY = 24*60*60*1000;
const WAIVER_EARLY_WED_SHIFT_MS = 5 * 60 * 60 * 1000; // 5 hours

function weekBucketPT(date, seasonYear) {
  // Normalize to PT
  const z0 = toPT(new Date(date));

  // If the timestamp is in the *early* part of Wednesday (PT), shift it
  // back a few hours so it counts toward the week that ended Tue 11:59 PM.
  // (This matches real waiver processing behavior.)
  let z = new Date(z0);
  if (z.getDay() === 3 /* Wed */ && z.getHours() < 5) {
    z = new Date(z.getTime() - WAIVER_EARLY_WED_SHIFT_MS);
  }

  // Anchor at the first Wednesday of September (00:00 PT)
  const w1 = firstWednesdayOfSeptemberPT(Number(seasonYear));

  // 1-based week index, clamped at 1
  const diff = z.getTime() - w1.getTime();
  const week = Math.max(1, Math.floor(diff / (7 * DAY)) + 1);

  // Start of that league week (for labels)
  const start = new Date(w1.getTime() + (week - 1) * 7 * DAY);
  return { week, start };
}

function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeekPT(date);
  const week1 = startOfLeagueWeekPT(firstWednesdayOfSeptemberPT(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0; // preseason bucket
  return { week, start };
}
function weekRangeLabelDisplay(startPT){
  const wed = new Date(startPT); wed.setHours(0,0,0,0);
  const tue = new Date(wed); tue.setDate(tue.getDate()+6); tue.setHours(23,59,0,0);
  const short = (d)=> toPT(d).toLocaleDateString(undefined,{month:"short", day:"numeric"});
  return `${short(wed)}–${short(tue)} (cutoff Tue 11:59 PM PT)`;
}
function normalizeEpoch(x){
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  if (x > 0 && x < 1e11) return x * 1000; // seconds → ms
  return x;
}

/* =========================
   ESPN proxy (cookie-optional, multi-host fallback)
   ========================= */
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
  // A referer that looks like a human browsing your league helps avoid bot pages:
  "Referer": "https://fantasy.espn.com/football/team",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
};

// Robust fetch that retries when ESPN sends HTML / bot pages / 429s.
async function fetchJSONWithRetry(url, { requireCookie, req, label, logger }) {
  const headers = { ...BROWSER_HEADERS };
  if (requireCookie) {
    const ck = buildCookie(req);
    if (ck) { headers.Cookie = ck; logger?.debug(`Cookie attached for ${label}`, { len: ck.length }); }
    else { logger?.error(`Missing cookie for ${label}`); }
  }

  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      logger?.debug(`HTTP attempt ${attempt} → ${label}`, { url });
      const res = await fetch(url, { headers });
      const ct  = res.headers.get("content-type") || "";
      const txt = await res.text();

      logger?.debug(`Response ${res.status} for ${label}`, { ct, bodyLen: txt.length, attempt });

      if (ct.includes("application/json")) {
        try { return JSON.parse(txt); }
        catch (e) {
          lastErr = `JSON parse failed: ${e?.message || e}`;
          logger?.error(`Parse failed for ${label}`, e, { preview: txt.slice(0, 200) });
        }
      } else {
        lastErr = `status ${res.status}, ct ${ct}, body: ${txt.slice(0,160).replace(/\s+/g," ")}`;
        logger?.error(`Non-JSON for ${label}`, { status: res.status, ct, preview: txt.slice(0, 200) });
      }

      // backoff + jitter
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt) + Math.random() * 1000));
    } catch (e) {
      lastErr = `Network error: ${e?.message || e}`;
      logger?.error(`Network error for ${label}`, e, { attempt });
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  const err = new Error(`ESPN non-JSON for ${label}: ${lastErr}`);
  logger?.error(`All attempts failed for ${label}`, err);
  throw err;
}

async function espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie = false, logger }) {
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
  for (let i = 0; i < urls.length; i++) {
    try {
      logger?.debug(`Trying ESPN URL ${i+1}/${urls.length} for ${view}`, { url: urls[i].split("?")[0], sp: scoringPeriodId ?? null });
      const json = await fetchJSONWithRetry(urls[i], { requireCookie, req, label: `${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}`, logger });
      logger?.debug(`Success with URL ${i+1} for ${view}`);
      return json;
    } catch (e) {
      last = e; logger?.debug(`URL ${i+1} failed for ${view}`, { error: e.message });
      await new Promise(r => setTimeout(r, 200));
    }
  }
  const err = new Error(last?.message || "Unknown ESPN error");
  logger?.error(`All ESPN URLs failed for ${view}`, err);
  throw err;
}

/* Pass-through endpoint used by the UI (set ?auth=1 to force cookies) */
app.get("/api/espn", async (req, res) => {
  const logger = new ProcessLogger();
  try {
    const { leagueId, seasonId, view, scoringPeriodId, auth, debug } = req.query;
    logger.info("ESPN proxy request", { leagueId, seasonId, view, scoringPeriodId, auth });

    const json = await espnFetch({
      leagueId, seasonId, view, scoringPeriodId, req,
      requireCookie: auth === "1",
      logger
    });

    if (debug === "1") {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(path.join(DATA_DIR, "last-espn-log.json"), JSON.stringify(logger.getFullLog(), null, 2), "utf8");
      return res.json({ _debugFile: "data/last-espn-log.json", data: json });
    }

    res.json(json);
  } catch (e) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, "last-espn-log.json"), JSON.stringify(logger.getFullLog(), null, 2), "utf8");
    res.status(502).send(String(e.message || e));
  }
});


// ===== POLLS v2.1 — routes (tallies use season team codes) =====
const nid = () => Math.random().toString(36).slice(2, 10);

// Return all polls with live tallies (by season team codes)
app.get("/api/polls", (req, res) => {
  const seasonId = String(req.query?.seasonId || "");

  function tallied(p) {
    const byTeam = pollsState.votes?.[p.id] || {};   // { teamId: optionId }
    const tally = {};
    Object.values(byTeam).forEach(opt => {
      tally[opt] = (tally[opt] || 0) + 1;
    });

    const codesTotal = seasonId
      ? Object.keys(pollsState.teamCodes || {}).filter(k => k.startsWith(`${seasonId}:`)).length
      : Object.keys(pollsState.teamCodes || {}).length;

    return {
      id: p.id,
      question: p.question,
      closed: !!p.closed,
      options: (p.options || []).map(o => ({
        id: o.id,
        label: o.label,
        votes: tally[o.id] || 0
      })),
      codesUsed: Object.keys(byTeam).length,
      codesTotal
    };
  }

  const out = Object.values(pollsState.polls || {}).map(tallied);
  res.json({ polls: out });
});

// Create a poll (stores in pollsState.polls)
app.post("/api/polls/create", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).send("Bad request");

  const id = nid();
  pollsState.polls[id] = {
    id,
    question: String(question),
    closed: false,
    options: options.map(label => ({ id: nid(), label: String(label) }))
  };
  await savePolls21();
  res.json({ ok: true, pollId: id });
});

// Delete a poll
app.post("/api/polls/delete", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");

  const { pollId } = req.body || {};
  if (!pollId) return res.status(400).send("Missing pollId");

  // v2 store: pollsState
  if (pollsState?.polls && pollsState.polls[pollId]) {
    delete pollsState.polls[pollId];   // remove the poll
    delete pollsState.votes[pollId];   // remove all its votes
    await savePolls21();               // persist v2 store
    return res.json({ ok: true });
  }

  // Fallback: legacy file-based polls.json (only if you still have old polls there)
  try {
    const data = await readJson("polls.json", { polls: [] });
    const before = data.polls.length;
    data.polls = data.polls.filter(p => p.id !== pollId);
    if (data.polls.length === before) return res.status(404).send("Not found");
    await writeJson("polls.json", data);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).send(String(e.message || e));
  }
});

// Close/reopen a poll
app.post("/api/polls/close", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId, closed } = req.body || {};
  if (!pollId || !pollsState.polls[pollId]) return res.status(404).send("Not found");

  pollsState.polls[pollId].closed = !!closed;
  await savePolls21();
  res.json({ ok: true });
});


/* =========================
   Official Snapshot (commissioner builds once; league reads)
   ========================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const REPORT_FILE = "report.json";
const teamName = (t) => (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`);

function isWithinWaiverWindowPT(dateLike){
  const z = toPT(new Date(dateLike));
  if (z.getDay() !== 3) return false; // not Wed
  const minutes = z.getHours()*60 + z.getMinutes();
  return minutes <= 4*60 + 30; // <= 4:30am PT
}
function inferMethod(typeStr, typeNum, t, it){
  const s = String(typeStr ?? "").toUpperCase();
  const ts = normalizeEpoch(t?.processDate ?? t?.proposedDate ?? t?.executionDate ?? t?.date ?? Date.now());
  if (/WAIVER|CLAIM/.test(s)) return "WAIVER";
  if ([5,7].includes(typeNum)) return "WAIVER";
  if (t?.waiverProcessDate || it?.waiverProcessDate) return "WAIVER";
  if (t?.bidAmount != null || t?.winningBid != null) return "WAIVER";
  if (isWithinWaiverWindowPT(ts)) return "WAIVER";
  return "FA";
}
const pickPlayerId   = (it)=> it?.playerId
 ?? it?.playerPoolEntry?.player?.id
  ?? it?.player?.id
  ?? it?.athleteId
?? it?.entityId 
?? null;


const pickPlayerName = (it,t)=> it?.playerPoolEntry?.player?.fullName 
|| it?.player?.fullName 
|| it?.athlete?.fullName
|| t?.playerPoolEntry?.player?.fullName 
|| t?.player?.fullName 
|| null;

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
// Build a full list of moves from all sources across scoring periods
async function fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp = 25, onProgress, logger }) {
  const all = [];

  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Reading ESPN activity…");

    const before = all.length;

    // --- First pass (cookie = true) ---
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: true, logger });
      all.push(...extractMoves(j, "tx"));
    } catch {}
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: true, logger });
      all.push(...extractMoves(j, "recent"));
    } catch {}
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, req, requireCookie: true, logger });
      all.push(...extractMovesFromComm(j));
    } catch {}

    // small pause between weeks
    await sleep(120 + Math.floor(Math.random() * 120));

    // If this week looks “thin”, try a rescue pass with cookie = false.
    // (On some Render IPs, cookie-auth can trigger anti-bot; the no-cookie
    // site endpoints sometimes succeed for the same week.)
    const addedFirstPass = all.length - before;
    if (addedFirstPass < 6) { // tweak threshold if you like
      try {
        const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: false, logger });
        all.push(...extractMoves(j, "tx"));
      } catch {}
      try {
        const j = await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: false, logger });
        all.push(...extractMoves(j, "recent"));
      } catch {}
      try {
        const j = await espnFetch({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, req, requireCookie: false, logger });
        all.push(...extractMovesFromComm(j));
      } catch {}

      await sleep(220);
    }
  }

  return all
    .map(e => ({ ...e, date: e.date instanceof Date ? e.date : new Date(e.date) }))
    .sort((a, b) => a.date - b.date);
}


async function fetchRosterSeries({ leagueId, seasonId, req, maxSp = 25, onProgress, logger }) {
  const series = [];
  let lastGood = {}; // carry-forward fallback if a week fails

  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Building roster timeline…");

    // up to 3 tries: vanilla → cookie → cookie (with small backoff)
    let attempt = 0, done = false;
    while (!done && attempt < 3) {
      attempt++;
      try {
        const r = await espnFetch({
          leagueId, seasonId, view: "mRoster", scoringPeriodId: sp, req, logger, 
          requireCookie: attempt > 1 // try cookie on retries
        });

        const byTeam = {};
        for (const t of (r?.teams || [])) {
          const set = new Set();
          for (const e of (t?.roster?.entries || [])) {
            const pid = e?.playerPoolEntry?.player?.id;
            if (pid) set.add(pid);
          }
          byTeam[t.id] = set;
        }

        if (Object.keys(byTeam).length > 0) {
          series[sp] = byTeam;
          lastGood = byTeam; // remember last good snapshot
        } else {
          // API returned no teams — use previous good snapshot
          series[sp] = lastGood;
        }
        done = true;
      } catch {
        // small backoff before next attempt
        await new Promise(r => setTimeout(r, 400 + attempt * 250));
        if (attempt >= 3) {
          // still failing — use last good snapshot so we don't drop moves
          series[sp] = lastGood;
          done = true;
        }

  await sleep(150);

      }
    }
  }

  return series;
}


const isOnRoster = (series, sp, teamId, playerId) => !!(playerId && series?.[sp]?.[teamId]?.has(playerId));
const spFromDate = (dateLike, seasonYear)=> Math.max(1, Math.min(25, (leagueWeekOf(new Date(dateLike), seasonYear).week || 1)));


function isGenuineAddBySeries(row, series, seasonYear) {
  // If we don't know the player, let it count (cannot verify)
  if (!row.playerId) return true;

  // Only verify WAIVER adds. FA adds can be added/dropped same week and should still count.
  if (String(row.method).toUpperCase() !== "WAIVER") return true;

  const sp = spFromDate(row.date, seasonYear);  // 1..25
  const teamId = Number(row.teamIdRaw ?? row.teamId); // <- numeric!

  const before = Math.max(1, sp - 1);
  const later  = [sp, sp + 1, sp + 2].filter(n => n < series.length);

  const wasBefore    = isOnRoster(series, before, teamId, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, teamId, row.playerId));

  return !wasBefore && appearsLater;
}


function isExecutedDropBySeries(row, series, seasonYear){
  // If the transaction JSON didn’t carry a playerId (common on site.web.api),
  // assume the drop was executed rather than silently discarding it.
  if (!row.playerId) return true;
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  // look ahead a touch more so re-adds in the same/later week don’t erase the drop
  const later = [sp, sp+1, sp+2, sp+3].filter(n=> n < series.length);
  const wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return wasBefore && !appearsLater;
}
async function buildPlayerMap({ leagueId, seasonId, req, ids, maxSp=25, onProgress, logger }){
  const need = new Set((ids||[]).filter(Boolean));
  const map = {}; if (need.size===0) return map;
  for (let sp=1; sp<=maxSp; sp++){
onProgress?.(sp, maxSp, "Resolving player names…");
    try {
      const r = await espnFetch({ leagueId, seasonId, view:"mRoster", scoringPeriodId: sp, req, requireCookie:false, logger });
      for (const t of (r?.teams||[])) {
        for (const e of (t.roster?.entries||[])) {
          const p = e.playerPoolEntry?.player;
          const pid = p?.id;
          if (pid && need.has(pid)) { map[pid] = p.fullName || p.name || `#${pid}`; need.delete(pid); }
        }
      }
      if (need.size===0) break;
    } catch {}

  await sleep(150);


  }
  return map;
}

async function buildOfficialReport({ leagueId, seasonId, req }){
  // Team names — public in most leagues
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false, logger });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

  // All raw moves from three sources (cookie-required)
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25 });

  // Roster series (public) to verify executed adds/drops and get names later
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25 });

 // Dedup → annotate (make teamIdRaw a Number!)
const deduped = dedupeMoves(all).map(e => ({
  ...e,
  teamIdRaw: Number(e.teamId),
  team: idToName[e.teamId] || `Team ${e.teamId}`,
  player: e.playerName || null
}));


// Verify against roster snapshots to keep only *winning* waiver adds and *executed* drops.
const verified = [];
for (const r of deduped) {
  if (r.action === "ADD") {
  // If we don't know the player, skip — we can't prove it was a winning add.
  if (!r.playerId) continue;

  const sp  = spFromDate(r.date, seasonId);
  const tid = r.teamIdRaw;

  // must NOT be on the roster the week before (avoid counting bids / no-ops)
  const wasBefore =
    isOnRoster(series, Math.max(1, sp - 1), tid, r.playerId);

  // MUST appear soon after (handles waiver posting lag)
  const appears =
    isOnRoster(series, sp,   tid, r.playerId) ||
    isOnRoster(series, sp+1, tid, r.playerId) ||
    isOnRoster(series, sp+2, tid, r.playerId);

  if (!wasBefore && appears) verified.push(r);
}

 else if (r.action === "DROP") {
    // Only count executed drops (player was on the roster before, and gone after).
    if (!r.playerId) continue;

    const sp  = spFromDate(r.date, seasonId);
    const tid = r.teamIdRaw;

    const wasBefore =
      isOnRoster(series, Math.max(1, sp-1), tid, r.playerId) ||
      isOnRoster(series, sp,              tid, r.playerId);

    const appearsLater =
      isOnRoster(series, sp+1, tid, r.playerId) ||
      isOnRoster(series, sp+2, tid, r.playerId);

    if (wasBefore && !appearsLater) verified.push(r);
  }
}

// Backfill missing player names for verified events
const needIds = [...new Set(verified.map(r => r.player ? null : r.playerId).filter(Boolean))];
const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25 });
for (const r of verified) if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;

// Flatten for UI — definitive week math (avoids off-by-one) + de-dupe repeated DROPs
let rawMoves = verified.map(r => {
  const wb = weekBucketPT(r.date, seasonId);
  return {
    date: fmtPT(r.date),
    ts: toPT(new Date(r.date)).getTime(),          // raw PT timestamp (ms) for de-dupe
    week: wb.week,                                 // 1-based, never 0
    range: weekRangeLabelDisplay(wb.start),        // correct Wed→Tue label
    team: r.team,
    player: r.player || (r.playerId ? `#${r.playerId}` : "—"),
    action: r.action,                              // ADD | DROP
    method: r.method,                              // WAIVER | FA (when inferred)
    source: r.src,                                 // tx | recent | comm
    playerId: r.playerId || null
  };
}).sort((a,b)=> (a.week - b.week) || (new Date(a.date) - new Date(b.date)));

// Collapse duplicate DROP lines (same as before)
const DEDUPE_WINDOW_MS = 3 * 60 * 1000;
const dedupedMoves = [];
const lastByKey = new Map(); // key -> {action, ts}

for (const m of rawMoves) {
  const key = `${m.team}|${m.playerId || m.player}`;

  if (m.action === "DROP") {
    const prev = lastByKey.get(key);
    if (prev && prev.action === "DROP" && Math.abs(m.ts - prev.ts) <= DEDUPE_WINDOW_MS) {
      continue;
    }
    lastByKey.set(key, { action: "DROP", ts: m.ts });
  } else if (m.action === "ADD") {
    lastByKey.set(key, { action: "ADD", ts: m.ts });
  }

  dedupedMoves.push(m);
}

// Replace rawMoves with the cleaned list (and strip helper field)
rawMoves = dedupedMoves.map(({ ts, ...rest }) => rest);

// Collapse duplicate DROP lines: same team + same player repeated within ~3 min,
// unless there was an ADD for that player by that team in between.

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Dues: first 2 adds per team per week are free; $5 each afterwards
  const perWeek = new Map(); // week -> Map(team -> count)
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

  const totalsRows = [...totals.entries()]
    .map(([name, v]) => ({ name, adds: v.adds, owes: v.owes }))
    .sort((a,b)=> b.owes - a.owes || a.name.localeCompare(b.name));

  return { lastSynced: fmtPT(new Date()), totalsRows, weekRows, rawMoves };
}

/* Snapshot routes */
app.get("/api/report", async (req, res) => {
  const seasonId = req.query?.seasonId;
  const preferred = seasonId ? await readJson(`report_${seasonId}.json`, null) : null;
  const fallback  = await readJson("report.json", null); // legacy fallback
  const report = preferred || fallback;
  if (!report) return res.status(404).send("No report");
  res.json(report);

});

app.post("/api/report/update", async (req, res) => {
  const logger = new ProcessLogger();
  try {
    // …
    const moves = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25, onProgress:…, logger });
    const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25, onProgress:…, logger });
    const needIds = [...new Set(moves.map(m => m.playerId).filter(Boolean))];
    const nameMap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25, onProgress:…, logger });
    // …
  } catch (err) {
    // before sending the error, persist the debug log:
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, "last-espn-log.json"), JSON.stringify(logger.getFullLog(), null, 2), "utf8");
    // …
  }
});

 console.log("[REPORT/UPDATE] start", req.body);
  // gate: only commissioner can run the official snapshot
  if (req.header("x-admin") !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized");
  }

  const { leagueId, seasonId } = req.body || {};
  if (!leagueId || !seasonId) {
    return res.status(400).send("Missing leagueId or seasonId");
  }

  // the UI passes a jobId in the query for progress polling
  const jobId = (req.query?.jobId || `job_${Date.now()}`);

  try {
    // 5% — starting
    setProgress(jobId, 5, "Fetching teams…");
    const mTeam = await espnFetch({
      leagueId, seasonId, view: "mTeam", req, requireCookie: false, logger
    });

    // 10% → 55% — transactions across scoring periods
    const moves = await fetchSeasonMovesAllSources({
      leagueId, seasonId, req, maxSp: 25,
      onProgress: (sp, max, msg) => {
        const pct = 10 + Math.round((sp / max) * 45);
        setProgress(jobId, pct, `${msg} (${sp}/${max})`);
      }
    });

    // 55% → 82% — roster snapshots (used by your downstream logic)
    const series = await fetchRosterSeries({
      leagueId, seasonId, req, maxSp: 25,
      onProgress: (sp, max, msg) => {
        const pct = 55 + Math.round((sp / max) * 27);
        setProgress(jobId, pct, `${msg} (${sp}/${max})`);
      }
    });

    // 82% → 92% — resolve any missing playerId → name
    const needIds = [...new Set(moves.map(m => m.playerId).filter(Boolean))];
    const nameMap = await buildPlayerMap({
      leagueId, seasonId, req, ids: needIds, maxSp: 25,
      onProgress: (sp, max, msg) => {
        const pct = 82 + Math.round((sp / max) * 10);
        setProgress(jobId, pct, `${msg} (${sp}/${max})`);
      }
    });

    // 92% → 100% — your existing report builder
    setProgress(jobId, 92, "Computing official totals…");

    // If your build function needs series/nameMap, pass them;
    // if it already pulls from ESPN internally, just ignore these locals.
    const report = await buildOfficialReport({
      leagueId, seasonId, req,
      // series, nameMap    // uncomment if your builder expects them
    });

// persist per-season (also update legacy report.json for compatibility)
const snapshot = { seasonId, leagueId, ...report };
await writeJson(`report_${seasonId}.json`, snapshot);
await writeJson("report.json", snapshot);

setProgress(jobId, 100, "Snapshot complete");
res.json({ ok: true, weeks: (report?.weekRows || []).length });
console.log("[REPORT/UPDATE] done"); 
  } catch (err) {
    setProgress(jobId, 100, "Failed");
    res.status(502).send(err?.message || String(err));
  }
});

app.get("/api/debug/last-espn-log", async (_req, res) => {
  try {
    const p = path.join(DATA_DIR, "last-espn-log.json");
    const raw = await fs.readFile(p, "utf8");
    res.type("application/json").send(raw);
  } catch {
    res.status(404).send("No log yet");
  }
});

app.get("/api/debug/trans-check", async (req, res) => {
  const leagueId = req.query.leagueId;
  const seasonId = req.query.seasonId;
  if (!leagueId || !seasonId) return res.status(400).send("leagueId and seasonId required");

  const rows = [];
  for (let sp = 1; sp <= 25; sp++) {
    const row = { sp };
    for (const [view, tag] of [
      ["mTransactions2", "tx"],
      ["recentActivity", "recent"],
      ["kona_league_communication", "comm"]
    ]) {
      try {
        const j = await espnFetch({ leagueId, seasonId, view, scoringPeriodId: sp, req, requireCookie: true, logger });
        const count =
          (Array.isArray(j?.transactions) && j.transactions.length) ||
          (Array.isArray(j?.events) && j.events.length) ||
          (Array.isArray(j?.messages) && j.messages.length) ||
          (Array.isArray(j?.topics) && j.topics.length) ||
          (Array.isArray(j) && j.length) ||
          0;
        row[tag] = count;
      } catch {
        row[tag] = "ERR";
      }
      await sleep(120);
    }
    rows.push(row);
  }
  res.json(rows);
});

/* ===== Debug endpoint: mRoster availability by scoring period ===== */
app.get("/api/debug/roster-check", async (req, res) => {
  const { leagueId, seasonId } = req.query || {};
  if (!leagueId || !seasonId) return res.status(400).send("leagueId and seasonId required");

  const out = [];
  for (let sp = 1; sp <= 25; sp++) {
    const row = { sp };
    try {
      const r = await espnFetch({ leagueId, seasonId, view: "mRoster", scoringPeriodId: sp, req, requireCookie: false, logger });
      const teamCount = Array.isArray(r?.teams) ? r.teams.length : 0;
      const playerSlots = (r?.teams || []).reduce((n, t) => n + (t?.roster?.entries?.length || 0), 0);
      row.teams = teamCount;    // should be 10 for your league
      row.entries = playerSlots; // total roster entries that week
    } catch (e) {
      row.teams = "ERR";
      row.entries = 0;
    }
    out.push(row);
  }
  res.json(out);
});

app.get("/api/debug/sp-health", async (req, res) => {
  const { leagueId, seasonId } = req.query || {};
  if (!leagueId || !seasonId) return res.status(400).send("leagueId & seasonId required");

  const out = [];
  for (let sp = 1; sp <= 25; sp++) {
    const row = { sp, tx: "ok", recent: "ok", comm: "ok" };
    try { await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: true, logger }); }
    catch (e) { row.tx = (e.message || "").slice(0, 120); }
    await sleep(80);
    try { await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: true, logger }); }
    catch (e) { row.recent = (e.message || "").slice(0, 120); }
    await sleep(80);
    try { await espnFetch({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, req, requireCookie: true, logger }); }
    catch (e) { row.comm = (e.message || "").slice(0, 120); }
    await sleep(120);
    out.push(row);
  }
  res.json(out);
});


// serve the built client (Vite "dist" folder)
const CLIENT_DIR = path.join(__dirname, "dist");
app.use(express.static(CLIENT_DIR));
// Serve the SPA for anything that's NOT /api/*
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});


// --- BEGIN: add/dedupe helpers ---

// true only for *real* adds: winning waiver adds or free-agent adds.
// (ignore draft, trade, and non-winning waiver attempts)
function isActualAdd(txn) {
  if (!txn || !Array.isArray(txn.items)) return false;

  // ESPN sends waivers with type "WAIVER" and status "EXECUTED"
  // Free agent adds are type "FREEAGENT" and status "EXECUTED"
  const isWaiverWinner =
    txn.type === "WAIVER" &&
    txn.status === "EXECUTED" &&
    txn.items.some(it => it.type === "ADD");

  const isFreeAgentAdd =
    txn.type === "FREEAGENT" &&
    txn.status === "EXECUTED" &&
    txn.items.some(it => it.type === "ADD");

  return isWaiverWinner || isFreeAgentAdd;
}

// turn raw ESPN txns into our flat rows array,
// counting only real adds once (per player+team+scoringPeriod),
// but including every DROP (they don't affect dues but you log them).
function buildRowsDedupeWaivers(transactions) {
  const rows = [];
  const seenAdd = new Set(); // key: playerId@teamId@sp

  for (const t of transactions || []) {
    const sp = t.scoringPeriodId;
    const when = t.processDate ?? t.proposedDate ?? 0;

    // include all DROPs (useful for history)
    for (const d of (t.items || []).filter(i => i.type === "DROP")) {
      rows.push({
        type: "DROP",
        teamId: d.fromTeamId ?? t.teamId ?? 0,
        playerId: d.playerId,
        scoringPeriodId: sp,
        ts: when
      });
    }

    // include only real ADDs (FA + winning waivers), one per player/team/period
    if (isActualAdd(t)) {
      for (const a of t.items.filter(i => i.type === "ADD")) {
        const key = `${a.playerId}@${a.toTeamId}@${sp}`;
        if (!seenAdd.has(key)) {
          seenAdd.add(key);
          rows.push({
            type: "ADD",
            teamId: a.toTeamId,
            playerId: a.playerId,
            scoringPeriodId: sp,
            ts: when
          });
        }
      }
    }
  }

  // keep rows in time order so your UI feels right
  rows.sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));
  return rows;
}

// --- END: add/dedupe helpers ---



/* =========================
   Start server
   ========================= */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
