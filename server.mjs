// --- standard header (keep exactly one copy) ---
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, "data");

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
      filteredOut: {
        dedup: 0,
        verification: 0,
        finalDedup: 0
      },
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

  info(message, data = {}) {
    this.log('INFO', message, data);
  }

  debug(message, data = {}) {
    this.log('DEBUG', message, data);
  }

  getSummary() {
    return {
      stats: this.stats,
      totalLogs: this.logs.length,
      errorCount: this.stats.errors.length
    };
  }

  getFullLog() {
    return {
      summary: this.getSummary(),
      logs: this.logs
    };
  }
}

// ===== POLLS v2.1 (keeping your existing poll system) =====
const POLLS_FILE = path.join(DATA_DIR, "polls.json");
let pollsState = { polls: {}, votes: {}, teamCodes: {} };

async function loadPolls21() {
  try {
    const raw = await fs.readFile(POLLS_FILE, "utf-8");
    const data = JSON.parse(raw);
    pollsState.polls = data.polls || {};
    pollsState.votes = data.votes || {};
    pollsState.teamCodes = data.teamCodes || {};
  } catch { /* first run is fine */ }
}

async function savePolls21() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(POLLS_FILE, JSON.stringify(pollsState, null, 2), "utf-8");
}

await loadPolls21();

// ===== POLL ROUTES (keeping your existing implementation) =====
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

pollsState.teamCodes = pollsState.teamCodes || {};
pollsState.votes = pollsState.votes || {};

app.post("/api/polls/issue-team-codes", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { seasonId, teams } = req.body || {};
  if (!seasonId || !Array.isArray(teams)) return res.status(400).send("Missing seasonId or teams[]");

  const used = new Set(Object.values(pollsState.teamCodes).map(v => v.code));
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
  await savePolls21();
  res.json({ issued: issued.length, codes: issued });
});

app.post("/api/polls/vote", async (req, res) => {
  const { pollId, optionId, seasonId, teamCode } = req.body || {};
  if (!pollId || !optionId || !seasonId || !teamCode) {
    return res.status(400).send("Missing pollId/optionId/seasonId/teamCode");
  }

  let teamId = null;
  for (const [k, v] of Object.entries(pollsState.teamCodes)) {
    if (k.startsWith(`${seasonId}:`) && String(v.code).toUpperCase() === String(teamCode).toUpperCase()) {
      teamId = Number(k.split(":")[1]);
      break;
    }
  }
  if (!teamId) return res.status(403).send("Invalid code");

  pollsState.votes[pollId] = pollsState.votes[pollId] || {};
  pollsState.votes[pollId][teamId] = optionId;
  await savePolls21();
  res.json({ ok: true, byTeam: pollsState.votes[pollId] });
});

app.get("/api/polls", (req, res) => {
  const seasonId = String(req.query?.seasonId || "");

  function tallied(p) {
    const byTeam = pollsState.votes?.[p.id] || {};
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

app.post("/api/polls/create", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).send("Bad request");

  const id = Math.random().toString(36).slice(2, 10);
  pollsState.polls[id] = {
    id,
    question: String(question),
    closed: false,
    options: options.map(label => ({ id: Math.random().toString(36).slice(2, 10), label: String(label) }))
  };
  await savePolls21();
  res.json({ ok: true, pollId: id });
});

app.post("/api/polls/delete", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId } = req.body || {};
  if (!pollId) return res.status(400).send("Missing pollId");

  if (pollsState?.polls && pollsState.polls[pollId]) {
    delete pollsState.polls[pollId];
    delete pollsState.votes[pollId];
    await savePolls21();
    return res.json({ ok: true });
  }

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

app.post("/api/polls/close", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId, closed } = req.body || {};
  if (!pollId || !pollsState.polls[pollId]) return res.status(404).send("Not found");

  pollsState.polls[pollId].closed = !!closed;
  await savePolls21();
  res.json({ ok: true });
});

// ===== PROGRESS TRACKING =====
const jobProgress = new Map();
function setProgress(jobId, pct, msg) {
  if (!jobId) return;
  jobProgress.set(jobId, { pct: Math.max(0, Math.min(100, Math.round(pct))), msg: String(msg || ""), t: Date.now() });
}

app.get("/api/progress", (req, res) => {
  const { jobId } = req.query || {};
  const v = jobProgress.get(jobId);
  res.json(v || { pct: 0, msg: "" });
});

// ===== FILE HELPERS =====
const fpath = (name) => path.join(DATA_DIR, name);

async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(fpath(name), "utf8")); }
  catch { return fallback; }
}

async function writeJson(name, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
}

// ===== TIME HELPERS =====
const dtfPT = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TZ,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

function toPT(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const parts = Object.fromEntries(dtfPT.formatToParts(d).map(p => [p.type, p.value]));
  return new Date(Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second
  ));
}

function fmtPT(dateLike) {
  return new Date(dateLike).toLocaleString("en-US", { timeZone: LEAGUE_TZ });
}

const WEEK_START_DAY = 3;
function startOfLeagueWeekPT(date) {
  const z = toPT(date);
  const base = new Date(z); base.setHours(0,0,0,0);
  const back = (base.getDay() - WEEK_START_DAY + 7) % 7;
  base.setDate(base.getDate() - back);
  if (z < base) base.setDate(base.getDate() - 7);
  return base;
}

function firstWednesdayOfSeptemberPT(year) {
  const d = toPT(new Date(year, 8, 1));
  const offset = (3 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}

const DAY = 24*60*60*1000;
const WAIVER_EARLY_WED_SHIFT_MS = 5 * 60 * 60 * 1000;

function weekBucketPT(date, seasonYear) {
  const z0 = toPT(new Date(date));
  let z = new Date(z0);
  if (z.getDay() === 3 && z.getHours() < 5) {
    z = new Date(z.getTime() - WAIVER_EARLY_WED_SHIFT_MS);
  }
  const w1 = firstWednesdayOfSeptemberPT(Number(seasonYear));
  const diff = z.getTime() - w1.getTime();
  const week = Math.max(1, Math.floor(diff / (7 * DAY)) + 1);
  const start = new Date(w1.getTime() + (week - 1) * 7 * DAY);
  return { week, start };
}

function leagueWeekOf(date, seasonYear) {
  const start = startOfLeagueWeekPT(date);
  const week1 = startOfLeagueWeekPT(firstWednesdayOfSeptemberPT(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0;
  return { week, start };
}

function weekRangeLabelDisplay(startPT) {
  const wed = new Date(startPT); wed.setHours(0,0,0,0);
  const tue = new Date(wed); tue.setDate(tue.getDate()+6); tue.setHours(23,59,0,0);
  const short = (d) => toPT(d).toLocaleDateString(undefined,{month:"short", day:"numeric"});
  return `${short(wed)}–${short(tue)} (cutoff Tue 11:59 PM PT)`;
}

function normalizeEpoch(x) {
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  if (x > 0 && x < 1e11) return x * 1000;
  return x;
}

// ===== ENHANCED ESPN FETCHING =====
function buildCookie(req) {
  const hdr = req.headers["x-espn-cookie"];
  if (hdr) return String(hdr);
  const swid = process.env.SWID;
  const s2 = process.env.ESPN_S2 || process.env.S2;
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
  "Referer": "https://fantasy.espn.com/football/team",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJSONWithRetry(url, { requireCookie, req, label, logger }) {
  const headers = { ...BROWSER_HEADERS };
  if (requireCookie) {
    const ck = buildCookie(req);
    if (ck) {
      headers.Cookie = ck;
      logger?.debug(`Using cookie for ${label}`, { cookieLength: ck.length });
    } else {
      logger?.error(`No cookie available for ${label} but requireCookie=true`);
    }
  }

  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      logger?.debug(`Attempt ${attempt} for ${label}`, { url });
      const res = await fetch(url, { headers });
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();

      logger?.debug(`Response received for ${label}`, {
        status: res.status,
        contentType: ct,
        bodyLength: text.length,
        attempt
      });

      if (ct.includes("application/json")) {
        try {
          const json = JSON.parse(text);
          logger?.debug(`JSON parsed successfully for ${label}`, {
            hasTransactions: !!json.transactions,
            hasEvents: !!json.events,
            hasTopics: !!json.topics,
            transactionCount: Array.isArray(json.transactions) ? json.transactions.length : 0,
            eventCount: Array.isArray(json.events) ? json.events.length : 0
          });
          return json;
        } catch (e) {
          lastErr = `JSON parse failed: ${e?.message || e}`;
          logger?.error(`JSON parse failed for ${label}`, e, { bodyPreview: text.slice(0, 200) });
        }
      } else {
        lastErr = `status ${res.status}, ct ${ct}, body: ${text.slice(0, 160).replace(/\s+/g, " ")}`;
        logger?.error(`Non-JSON response for ${label}`, { status: res.status, contentType: ct, bodyPreview: text.slice(0, 200) });
      }

      // Exponential backoff with jitter
      const backoffMs = 500 * Math.pow(2, attempt) + Math.random() * 1000;
      await sleep(backoffMs);
    } catch (e) {
      lastErr = `Network error: ${e?.message || e}`;
      logger?.error(`Network error for ${label}`, e, { attempt });
      await sleep(1000 * attempt);
    }
  }
  
  const error = new Error(`ESPN fetch failed for ${label}: ${lastErr}`);
  logger?.error(`All attempts failed for ${label}`, error);
  throw error;
}

async function espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie = false, logger }) {
  if (!leagueId || !seasonId || !view) throw new Error("Missing leagueId/seasonId/view");
  
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const bust = `&_=${Date.now()}`;
  const viewEnc = encodeURIComponent(view);

  const urls = [
    `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${viewEnc}${sp}${bust}`,
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${viewEnc}${sp}${bust}`,
    `https://site.web.api.espn.com/apis/fantasy/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${viewEnc}${sp}${bust}`
  ];

  let last = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      logger?.debug(`Trying ESPN URL ${i + 1}/${urls.length} for ${view}`, { url: url.split('?')[0] });
      const result = await fetchJSONWithRetry(url, { requireCookie, req, label: `${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}`, logger });
      logger?.debug(`Success with URL ${i + 1} for ${view}`);
      return result;
    } catch (e) {
      last = e;
      logger?.debug(`URL ${i + 1} failed for ${view}, trying next...`, { error: e.message });
      await sleep(200); // Brief pause between URL attempts
    }
  }
  
  const error = new Error(`All ESPN URLs failed: ${last?.message || "Unknown error"}`);
  logger?.error(`All ESPN URLs failed for ${view}`, error);
  throw error;
}

app.get("/api/espn", async (req, res) => {
  const logger = new ProcessLogger();
  try {
    const { leagueId, seasonId, view, scoringPeriodId, auth } = req.query;
    logger.info("ESPN proxy request", { leagueId, seasonId, view, scoringPeriodId, auth });
    
    const json = await espnFetch({
      leagueId, seasonId, view, scoringPeriodId, req,
      requireCookie: auth === "1",
      logger
    });
    
    logger.info("ESPN proxy success", { 
      dataKeys: Object.keys(json || {}),
      transactionCount: Array.isArray(json?.transactions) ? json.transactions.length : 0
    });
    
    res.json(json);
  } catch (e) {
    logger.error("ESPN proxy failed", e);
    res.status(502).send(String(e.message || e));
  }
});

// ===== ENHANCED TRANSACTION PROCESSING =====
const teamName = (t) => (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`);

function isWithinWaiverWindowPT(dateLike) {
  const z = toPT(new Date(dateLike));
  if (z.getDay() !== 3) return false;
  const minutes = z.getHours()*60 + z.getMinutes();
  return minutes <= 4*60 + 30;
}

function inferMethod(typeStr, typeNum, t, it) {
  const s = String(typeStr ?? "").toUpperCase();
  const ts = normalizeEpoch(t?.processDate ?? t?.proposedDate ?? t?.executionDate ?? t?.date ?? Date.now());
  if (/WAIVER|CLAIM/.test(s)) return "WAIVER";
  if ([5,7].includes(typeNum)) return "WAIVER";
  if (t?.waiverProcessDate || it?.waiverProcessDate) return "WAIVER";
  if (t?.bidAmount != null || t?.winningBid != null) return "WAIVER";
  if (isWithinWaiverWindowPT(ts)) return "WAIVER";
  return "FA";
}

const pickPlayerId = (it) => it?.playerId ?? it?.playerPoolEntry?.player?.id ?? it?.player?.id ?? it?.athleteId ?? it?.entityId ?? null;
const pickPlayerName = (it,t) => it?.playerPoolEntry?.player?.fullName || it?.player?.fullName || it?.athlete?.fullName || t?.playerPoolEntry?.player?.fullName || t?.player?.fullName || null;

function extractMoves(json, src="tx", logger) {
  const rows = (Array.isArray(json?.transactions) && json.transactions) ||
    (Array.isArray(json?.events) && json.events) ||
    (Array.isArray(json?.messages) && json.messages) ||
    (Array.isArray(json) && json) ||
    (json?.transactions && typeof json.transactions === "object" ? Object.values(json.transactions) : null) ||
    (json?.events && typeof json.events === "object" ? Object.values(json.events) : null) ||
    (json && typeof json === "object" && !Array.isArray(json) ? Object.values(json) : null) ||
    [];

  logger?.debug(`Extracting moves from ${src}`, { 
    rawRowCount: rows.length,
    jsonStructure: Object.keys(json || {}),
    hasTransactions: !!json?.transactions,
    hasEvents: !!json?.events
  });

  const out = [];
  for (const t of rows) {
    const when = new Date(normalizeEpoch(t.processDate ?? t.proposedDate ?? t.executionDate ?? t.date ?? t.timestamp ?? Date.now()));
    const eventId = t.id ?? t.transactionId ?? t.proposedTransactionId ?? t.proposalId ?? null;
    const items = Array.isArray(t.items) ? t.items
                : Array.isArray(t.messages) ? t.messages
                : Array.isArray(t.changes) ? t.changes
                : (t.item ? [t.item] : []);
    const typeStr = t.type ?? t.moveType ?? t.status;
    const typeNum = Number.isFinite(t.type) ? t.type : null;

    logger?.debug(`Processing transaction`, {
      eventId,
      typeStr,
      typeNum,
      itemCount: items.length,
      when: when.toISOString(),
      teamId: t.toTeamId ?? t.teamId ?? t.forTeamId
    });

    if (!items.length) {
      const action = /DROP/i.test(typeStr) ? "DROP" : "ADD";
      const method = inferMethod(typeStr, typeNum, t, null);
      const teamId = t.toTeamId ?? t.teamId ?? t.forTeamId ?? t.targetTeamId ?? t.fromTeamId ?? null;
      if (teamId != null) {
        out.push({ teamId, date:when, action, method, src, eventId, playerId: t.playerId ?? null, playerName: t.playerName ?? null });
      }
      continue;
    }

    for (const it of items) {
      const iTypeStr = it.type ?? it.moveType ?? it.action;
      const iTypeNum = Number.isFinite(it.type) ? it.type : null;
      const method = inferMethod(iTypeStr ?? typeStr, iTypeNum ?? typeNum, t, it);
      
      if (/ADD|WAIVER|CLAIM/i.test(String(iTypeStr)) || [1,5,7].includes(iTypeNum)) {
        const toTeamId = it.toTeamId ?? it.teamId ?? it.forTeamId ?? t.toTeamId ?? t.teamId ?? null;
        if (toTeamId != null) {
          out.push({ 
            teamId: toTeamId, 
            date: when, 
            action: "ADD", 
            method, 
            src, 
            eventId: it.id ?? eventId ?? null, 
            playerId: pickPlayerId(it), 
            playerName: pickPlayerName(it,t) 
          });
        }
      }
      if (/DROP/i.test(String(iTypeStr)) || [2].includes(iTypeNum)) {
        const fromTeamId = it.fromTeamId ?? t.fromTeamId ?? it.teamId ?? null;
        if (fromTeamId != null) {
          out.push({ 
            teamId: fromTeamId, 
            date: when, 
            action: "DROP", 
            method: "FA", 
            src, 
            eventId: it.id ?? eventId ?? null, 
            playerId: pickPlayerId(it), 
            playerName: pickPlayerName(it,t) 
          });
        }
      }
    }
  }

  logger?.debug(`Extracted ${out.length} moves from ${src}`, {
    addCount: out.filter(m => m.action === "ADD").length,
    dropCount: out.filter(m => m.action === "DROP").length,
    waiverCount: out.filter(m => m.method === "WAIVER").length,
    faCount: out.filter(m => m.method === "FA").length
  });

  return out;
}

function extractMovesFromComm(json, logger) {
  const topics = (Array.isArray(json?.topics) && json.topics) ||
    (json?.topics && typeof json.topics === "object" ? Object.values(json.topics) : []) ||
    (Array.isArray(json) ? json : []);
  
  logger?.debug("Extracting moves from communication", { topicCount: topics.length });
  
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
  
  logger?.debug(`Extracted ${out.length} moves from communication`);
  return out;
}

function dedupeMoves(events, logger) {
  const seen = new Set();
  const out = [];
  let dedupCount = 0;
  
  logger?.debug(`Starting