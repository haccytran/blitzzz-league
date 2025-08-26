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
  
  logger?.debug(`Starting deduplication`, { totalEvents: events.length });
  
  for (const e of events) {
    const tMin = Math.floor(new Date(e.date).getTime() / 60000);
    const key = e.eventId ? `id:${e.eventId}|a:${e.action}` : `tm:${e.teamId}|p:${e.playerId||""}|a:${e.action}|m:${tMin}`;
    
    if (seen.has(key)) {
      dedupCount++;
      continue;
    }
    seen.add(key);
    out.push(e);
  }
  
  logger?.debug(`Deduplication complete`, { 
    originalCount: events.length,
    finalCount: out.length,
    removedDuplicates: dedupCount
  });
  
  return out;
}

// --- LENIENT: no waiver/roster checks; count every ADD once per team per week
function buildReportLenientFromEvents({ events, idToName, seasonId }) {
  const rawMoves = [];
  const weekLabel = {};
  const addsPerWeekTeam = new Map(); // week -> Map(team -> addCount)

  const seenAdd = new Set();   // teamId|playerId|week
  const seenDrop = new Set();  // teamId|playerId|3minBucket

  for (const e of events) {
    const tid = Number(e.teamId);
    const team = idToName[tid] || `Team ${tid}`;
    const wb = weekBucketPT(e.date, seasonId);
    const range = weekRangeLabelDisplay(wb.start);
    if (!weekLabel[wb.week]) weekLabel[wb.week] = range;

    if (e.action === "ADD" && e.playerId) {
      const k = `${tid}|${e.playerId}|${wb.week}`;
      if (!seenAdd.has(k)) {
        seenAdd.add(k);
        rawMoves.push({
          date: fmtPT(e.date),
          week: wb.week,
          range,
          team,
          player: e.playerName || `#${e.playerId}`,
          action: "ADD",
          method: e.method || "",
          source: e.src || "tx",
          playerId: e.playerId
        });

        if (!addsPerWeekTeam.has(wb.week)) addsPerWeekTeam.set(wb.week, new Map());
        const m = addsPerWeekTeam.get(wb.week);
        m.set(team, (m.get(team) || 0) + 1);
      }
    } else if (e.action === "DROP") {
      const bucket = Math.floor(new Date(e.date).getTime() / (3 * 60 * 1000));
      const k = `${tid}|${e.playerId || "?"}|${bucket}`;
      if (!seenDrop.has(k)) {
        seenDrop.add(k);
        rawMoves.push({
          date: fmtPT(e.date),
          week: wb.week,
          range,
          team,
          player: e.playerName || (e.playerId ? `#${e.playerId}` : "—"),
          action: "DROP",
          method: e.method || "",
          source: e.src || "tx",
          playerId: e.playerId || null
        });
      }
    }
  }

  // Build per-week rows & league totals (first 2 adds free; $5 after)
  const weekRows = [];
  const totals = new Map();
  for (const [w, m] of [...addsPerWeekTeam.entries()].sort((a,b)=>a[0]-b[0])) {
    const entries = [];
    for (const [team, count] of [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
      const owes = Math.max(0, count - 2) * 5;
      entries.push({ name: team, count, owes });
      const t = totals.get(team) || { adds:0, owes:0 };
      t.adds += count; t.owes += owes; totals.set(team, t);
    }
    weekRows.push({ week: w, range: weekLabel[w] || "", entries });
  }

  const totalsRows = [...totals.entries()]
    .map(([name, v]) => ({ name, adds: v.adds, owes: v.owes }))
    .sort((a,b)=> b.owes - a.owes || a.name.localeCompare(b.name));

  rawMoves.sort((a,b)=> (a.week - b.week) || (new Date(a.date) - new Date(b.date)));
  return { lastSynced: fmtPT(new Date()), totalsRows, weekRows, rawMoves };
}


// ===== ENHANCED ROSTER FETCHING =====
async function fetchRosterSeries({ leagueId, seasonId, req, maxSp = 25, onProgress, logger }) {
  const series = [];
  let lastGood = {};

  logger?.info(`Starting roster series fetch`, { maxSp });

  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Building roster timeline…");
    
    let attempt = 0, done = false;
    while (!done && attempt < 3) {
      attempt++;
      try {
        const r = await espnFetch({
          leagueId, seasonId, view: "mRoster", scoringPeriodId: sp, req,
          requireCookie: attempt > 1,
          logger
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
          lastGood = byTeam;
          logger?.debug(`Roster SP ${sp} success`, { 
            teamCount: Object.keys(byTeam).length,
            totalPlayers: Object.values(byTeam).reduce((sum, set) => sum + set.size, 0)
          });
        } else {
          series[sp] = lastGood;
          logger?.debug(`Roster SP ${sp} empty, using last good`, { lastGoodTeams: Object.keys(lastGood).length });
        }
        done = true;
      } catch (e) {
        logger?.error(`Roster SP ${sp} attempt ${attempt} failed`, e);
        await sleep(400 + attempt * 250);
        if (attempt >= 3) {
          series[sp] = lastGood;
          logger?.error(`Roster SP ${sp} all attempts failed, using last good`);
          done = true;
        }
      }
    }
    await sleep(150);
  }

  logger?.info(`Roster series complete`, { 
    totalScoringPeriods: maxSp,
    successfulScoringPeriods: series.filter(Boolean).length
  });
  
  return series;
}

// ===== ENHANCED TRANSACTION FETCHING =====
async function fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp = 25, onProgress, logger }) {
  const all = [];
  logger?.info(`Starting transaction fetch across all sources`, { maxSp });

  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Reading ESPN activity…");
    logger?.debug(`Processing scoring period ${sp}`);

    const spStats = { sp, sources: {} };

    // Try mTransactions2
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: true, logger });
      const moves = extractMoves(j, "tx", logger);
      all.push(...moves);
      spStats.sources.tx = { count: moves.length, status: "success" };
    } catch (e) {
      logger?.error(`mTransactions2 failed for SP ${sp}`, e);
      spStats.sources.tx = { count: 0, status: "failed", error: e.message };
    }

    // Try recentActivity  
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: true, logger });
      const moves = extractMoves(j, "recent", logger);
      all.push(...moves);
      spStats.sources.recent = { count: moves.length, status: "success" };
    } catch (e) {
      logger?.error(`recentActivity failed for SP ${sp}`, e);
      spStats.sources.recent = { count: 0, status: "failed", error: e.message };
    }

    // Try kona_league_communication
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, req, requireCookie: true, logger });
      const moves = extractMovesFromComm(j, logger);
      all.push(...moves);
      spStats.sources.comm = { count: moves.length, status: "success" };
    } catch (e) {
      logger?.error(`kona_league_communication failed for SP ${sp}`, e);
      spStats.sources.comm = { count: 0, status: "failed", error: e.message };
    }

    logger?.info(`SP ${sp} complete`, spStats);
    await sleep(150);
  }

  const totalMoves = all.length;
  const movesBySource = {
    tx: all.filter(m => m.src === "tx").length,
    recent: all.filter(m => m.src === "recent").length,
    comm: all.filter(m => m.src === "comm").length
  };

  logger?.info(`All sources complete`, { 
    totalMoves,
    movesBySource,
    addCount: all.filter(m => m.action === "ADD").length,
    dropCount: all.filter(m => m.action === "DROP").length
  });

  return all.map(e => ({ 
    ...e, 
    date: e.date instanceof Date ? e.date : new Date(e.date) 
  })).sort((a, b) => a.date - b.date);
}

const isOnRoster = (series, sp, teamId, playerId) => !!(playerId && series?.[sp]?.[teamId]?.has(playerId));
const spFromDate = (dateLike, seasonYear) => Math.max(1, Math.min(25, (leagueWeekOf(new Date(dateLike), seasonYear).week || 1)));

function isGenuineAddBySeries(row, series, seasonYear) {
  if (!row.playerId) return true;
  if (String(row.method).toUpperCase() !== "WAIVER") return true;

  const sp = spFromDate(row.date, seasonYear);
  const teamId = Number(row.teamIdRaw ?? row.teamId);
  const before = Math.max(1, sp - 1);
  const later = [sp, sp + 1, sp + 2].filter(n => n < series.length);

  const wasBefore = isOnRoster(series, before, teamId, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, n, teamId, row.playerId));

  return !wasBefore && appearsLater;
}

function isExecutedDropBySeries(row, series, seasonYear) {
  if (!row.playerId) return true;
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  const later = [sp, sp+1, sp+2, sp+3].filter(n => n < series.length);
  const wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return wasBefore && !appearsLater;
}

async function buildPlayerMap({ leagueId, seasonId, req, ids, maxSp=25, onProgress, logger }) {
  const need = new Set((ids||[]).filter(Boolean));
  const map = {}; 
  if (need.size === 0) return map;
  
  logger?.info(`Building player map`, { playerCount: need.size });
  
  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Resolving player names…");
    try {
      const r = await espnFetch({ leagueId, seasonId, view:"mRoster", scoringPeriodId: sp, req, requireCookie:false, logger });
      for (const t of (r?.teams||[])) {
        for (const e of (t.roster?.entries||[])) {
          const p = e.playerPoolEntry?.player;
          const pid = p?.id;
          if (pid && need.has(pid)) { 
            map[pid] = p.fullName || p.name || `#${pid}`; 
            need.delete(pid); 
          }
        }
      }
      if (need.size === 0) break;
    } catch (e) {
      logger?.error(`Player map fetch failed for SP ${sp}`, e);
    }
    await sleep(150);
  }
  
  logger?.info(`Player map complete`, { 
    resolved: Object.keys(map).length,
    stillMissing: need.size
  });
  
  return map;
}

// Build the official report. mode: "strict" (default) or "lenient"
async function buildOfficialReport({ leagueId, seasonId, req, logger, mode = "strict" }) {
  // Team names (public)
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false, logger });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

  // All raw moves from three sources
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25, logger });

  // Light de-dupe across sources first and annotate
  const deduped = dedupeMoves(all).map(e => ({
    ...e,
    teamIdRaw: Number(e.teamId),
    team: idToName[e.teamId] || `Team ${e.teamId}`,
    player: e.playerName || null
  }));

  // === LENIENT: ignore WAIVER/FA and roster verification entirely ===
  if (String(mode).toLowerCase() === "lenient") {
    return buildReportLenientFromEvents({ events: deduped, idToName, seasonId });
  }

  // === STRICT (original) path — verify against roster snapshots ===
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25, logger });

  const verified = [];
  for (const r of deduped) {
    if (r.action === "ADD") {
      if (!r.playerId) continue; // can't prove it
      const sp  = spFromDate(r.date, seasonId);
      const tid = r.teamIdRaw;

      const wasBefore =
        isOnRoster(series, Math.max(1, sp - 1), tid, r.playerId);

      const appears =
        isOnRoster(series, sp,   tid, r.playerId) ||
        isOnRoster(series, sp+1, tid, r.playerId) ||
        isOnRoster(series, sp+2, tid, r.playerId);

      if (!wasBefore && appears) verified.push(r);
    } else if (r.action === "DROP") {
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
  const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25, logger });
  for (const r of verified) if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;

  // Flatten for UI — definitive week math + DROP de-dupe
  let rawMoves = verified.map(r => {
    const wb = weekBucketPT(r.date, seasonId);
    return {
      date: fmtPT(r.date),
      ts: toPT(new Date(r.date)).getTime(),
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

  // Dues: first 2 adds per team per week are free; $5 each afterwards
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

  const totalsRows = [...totals.entries()]
    .map(([name, v]) => ({ name, adds: v.adds, owes: v.owes }))
    .sort((a,b)=> b.owes - a.owes || a.name.localeCompare(b.name));

  return { lastSynced: fmtPT(new Date()), totalsRows, weekRows, rawMoves };
}

// ===== ENHANCED REPORT ROUTES =====
app.get("/api/report", async (req, res) => {
  const seasonId = req.query?.seasonId;
  const preferred = seasonId ? await readJson(`report_${seasonId}.json`, null) : null;
  const fallback = await readJson("report.json", null);
  const report = preferred || fallback;
  if (!report) return res.status(404).send("No report");
  res.json(report);
});

app.post("/api/report/update", async (req, res) => {
  const logger = new ProcessLogger();
  console.log("[REPORT/UPDATE] start", req.body);

  // only the commissioner
  if (req.header("x-admin") !== ADMIN_PASSWORD) {
    return res.status(401).send("Unauthorized");
  }

  const { leagueId, seasonId } = req.body || {};
  if (!leagueId || !seasonId) {
    return res.status(400).send("Missing leagueId or seasonId");
  }

  const jobId = (req.query?.jobId || `job_${Date.now()}`);
  const mode = String(req.query?.mode || process.env.COUNTING_MODE || "strict").toLowerCase();

  try {
    setProgress(jobId, 5, `Building snapshot (mode: ${mode})…`);

    // Build the report (this function fetches what it needs)
    const report = await buildOfficialReport({ leagueId, seasonId, req, logger, mode });

    // Save snapshot
    const snapshot = { seasonId, leagueId, ...report };
    await writeJson(`report_${seasonId}.json`, snapshot);
    await writeJson("report.json", snapshot); // legacy

    setProgress(jobId, 100, "Snapshot complete");
    res.json({ ok: true, weeks: (report?.weekRows || []).length, mode });
    console.log("[REPORT/UPDATE] done");
  } catch (err) {
    // persist the debug log for inspection
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      path.join(DATA_DIR, "last-espn-log.json"),
      JSON.stringify(logger.getFullLog(), null, 2),
      "utf8"
    );
    setProgress(jobId, 100, "Failed");
    res.status(502).send(err?.message || String(err));
  }
});

// ===== NEW DIAGNOSTIC ENDPOINTS =====

// Get the full diagnostic log from last report generation
app.get("/api/debug/diagnostics", async (req, res) => {
  const seasonId = req.query?.seasonId;
  if (!seasonId) return res.status(400).send("seasonId required");
  
  try {
    const diagnostics = await readJson(`diagnostics_${seasonId}.json`, null);
    res.json(diagnostics || { message: "No diagnostics found - run a report update first" });
  } catch (e) {
    res.status(500).send("Error reading diagnostics");
  }
});

// Quick transaction count comparison
app.get("/api/debug/transaction-summary", async (req, res) => {
  const logger = new ProcessLogger();
  const { leagueId, seasonId } = req.query || {};
  if (!leagueId || !seasonId) return res.status(400).send("leagueId and seasonId required");

  try {
    logger.info("Starting transaction summary");
    
    const rawCounts = {};
    let totalRaw = 0;
    
    // Get raw counts per scoring period
    for (let sp = 1; sp <= 25; sp++) {
      rawCounts[sp] = { tx: 0, recent: 0, comm: 0 };
      
      try {
        const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: true, logger });
        const moves = extractMoves(j, "tx", logger);
        rawCounts[sp].tx = moves.length;
        totalRaw += moves.length;
      } catch (e) { 
        logger.error(`Roster SP ${sp} failed`, e);
      row.teams = "ERR";
      row.entries = 0;
    }
    out.push(row);
  }
  res.json(out);
});

app.get("/api/debug/sp-health", async (req, res) => {
  const logger = new ProcessLogger();
  const { leagueId, seasonId } = req.query || {};
  if (!leagueId || !seasonId) return res.status(400).send("leagueId & seasonId required");

  const out = [];
  for (let sp = 1; sp <= 25; sp++) {
    const row = { sp, tx: "ok", recent: "ok", comm: "ok" };
    
    try { 
      await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: true, logger }); 
    } catch (e) { 
      row.tx = (e.message || "").slice(0, 120); 
      logger.error(`SP health check - mTransactions2 SP ${sp}`, e);
    }
    await sleep(80);
    
    try { 
      await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: true, logger }); 
    } catch (e) { 
      row.recent = (e.message || "").slice(0, 120); 
      logger.error(`SP health check - recentActivity SP ${sp}`, e);
    }
    await sleep(80);
    
    try { 
      await espnFetch({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, req, requireCookie: true, logger }); 
    } catch (e) { 
      row.comm = (e.message || "").slice(0, 120); 
      logger.error(`SP health check - kona_league_communication SP ${sp}`, e);
    }
    await sleep(120);
    out.push(row);
  }
  res.json(out);
});

// ===== NEW SUPER DETAILED DEBUG ENDPOINT =====
app.get("/api/debug/full-pipeline", async (req, res) => {
  const logger = new ProcessLogger();
  const { leagueId, seasonId } = req.query || {};
  if (!leagueId || !seasonId) return res.status(400).send("leagueId and seasonId required");

  try {
    logger.info("Starting full pipeline debug");

    // Step 1: Get team info
    const mTeam = await espnFetch({ leagueId, seasonId, view: "mTeam", req, requireCookie: false, logger });
    const teamInfo = (mTeam?.teams || []).map(t => ({ id: t.id, name: teamName(t) }));
    logger.info("Team info loaded", { teamCount: teamInfo.length, teams: teamInfo });

    // Step 2: Test a few scoring periods in detail
    const testSPs = [1, 5, 10, 15, 20]; // Sample scoring periods
    const spResults = {};

    for (const sp of testSPs) {
      logger.info(`Testing scoring period ${sp}`);
      const spData = { sp, sources: {}, totalMoves: 0 };

      // Test each source
      for (const [view, tag] of [
        ["mTransactions2", "tx"],
        ["recentActivity", "recent"],
        ["kona_league_communication", "comm"]
      ]) {
        try {
          const j = await espnFetch({ 
            leagueId, seasonId, view, scoringPeriodId: sp, req, 
            requireCookie: true, logger 
          });
          
          const moves = view === "kona_league_communication" 
            ? extractMovesFromComm(j, logger)
            : extractMoves(j, tag, logger);

          spData.sources[tag] = {
            success: true,
            rawTransactionCount: Array.isArray(j?.transactions) ? j.transactions.length : 0,
            rawEventCount: Array.isArray(j?.events) ? j.events.length : 0,
            rawTopicCount: Array.isArray(j?.topics) ? j.topics.length : 0,
            extractedMoves: moves.length,
            sampleRawData: j ? Object.keys(j).slice(0, 10) : [],
            sampleMoves: moves.slice(0, 2)
          };
          spData.totalMoves += moves.length;
        } catch (e) {
          logger.error(`Full pipeline test - ${view} SP ${sp}`, e);
          spData.sources[tag] = {
            success: false,
            error: e.message,
            extractedMoves: 0
          };
        }
        await sleep(200);
      }

      spResults[sp] = spData;
    }

    // Step 3: Test roster verification on a sample
    logger.info("Testing roster verification logic");
    const sampleSP = 10;
    let rosterSample = {};
    try {
      const r = await espnFetch({ 
        leagueId, seasonId, view: "mRoster", scoringPeriodId: sampleSP, req, 
        requireCookie: false, logger 
      });
      for (const t of (r?.teams || [])) {
        const playerIds = (t?.roster?.entries || [])
          .map(e => e?.playerPoolEntry?.player?.id)
          .filter(Boolean);
        rosterSample[t.id] = playerIds;
      }
      logger.info(`Roster sample for SP ${sampleSP}`, { 
        teamCount: Object.keys(rosterSample).length,
        totalPlayers: Object.values(rosterSample).reduce((sum, arr) => sum + arr.length, 0)
      });
    } catch (e) {
      logger.error(`Roster sample failed`, e);
    }

    res.json({
      summary: {
        teamCount: teamInfo.length,
        testedScoringPeriods: testSPs,
        totalRawMovesFromSample: Object.values(spResults).reduce((sum, sp) => sum + sp.totalMoves, 0)
      },
      teamInfo,
      scoringPeriodResults: spResults,
      rosterSample,
      fullLog: logger.getFullLog()
    });

  } catch (e) {
    logger.error("Full pipeline debug failed", e);
    res.status(500).json({
      error: e.message,
      logs: logger.logs
    });
  }
});

// ===== STATIC FILE SERVING =====
const CLIENT_DIR = path.join(__dirname, "dist");
app.use(express.static(CLIENT_DIR));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Enhanced logging enabled - check console for detailed transaction processing info`);
});error(`mTransactions2 SP ${sp} failed`, e);
      }

      try {
        const j = await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: true, logger });
        const moves = extractMoves(j, "recent", logger);
        rawCounts[sp].recent = moves.length;
        totalRaw += moves.length;
      } catch (e) {
        logger.error(`recentActivity SP ${sp} failed`, e);
      }

      await sleep(200); // Slower for this diagnostic
    }

    // Get processed count from existing report
    const existingReport = await readJson(`report_${seasonId}.json`, null);
    const processedCount = existingReport?.rawMoves?.length || 0;

    res.json({
      summary: {
        totalRawTransactions: totalRaw,
        totalProcessedTransactions: processedCount,
        difference: totalRaw - processedCount,
        filteringEfficiency: totalRaw > 0 ? Math.round((processedCount / totalRaw) * 100) + "%" : "N/A"
      },
      rawCountsBySP: rawCounts,
      diagnostics: logger.getSummary()
    });
  } catch (e) {
    logger.error("Transaction summary failed", e);
    res.status(500).send(e?.message || String(e));
  }
});

// Test a single scoring period in detail
app.get("/api/debug/scoring-period-detail", async (req, res) => {
  const logger = new ProcessLogger();
  const { leagueId, seasonId, sp } = req.query || {};
  if (!leagueId || !seasonId || !sp) {
    return res.status(400).send("leagueId, seasonId, and sp required");
  }

  try {
    const results = {};
    
    // Test all three endpoints for this SP
    for (const [view, tag] of [
      ["mTransactions2", "tx"],
      ["recentActivity", "recent"], 
      ["kona_league_communication", "comm"]
    ]) {
      try {
        const j = await espnFetch({ 
          leagueId, seasonId, view, scoringPeriodId: sp, req, 
          requireCookie: true, logger 
        });
        
        const moves = view === "kona_league_communication" 
          ? extractMovesFromComm(j, logger)
          : extractMoves(j, tag, logger);
          
        results[tag] = {
          success: true,
          moveCount: moves.length,
          rawDataKeys: Object.keys(j || {}),
          sampleMoves: moves.slice(0, 3).map(m => ({
            action: m.action,
            method: m.method,
            team: m.teamId,
            player: m.playerName || m.playerId,
            date: m.date
          }))
        };
      } catch (e) {
        logger.error(`${view} failed for SP ${sp}`, e);
        results[tag] = {
          success: false,
          error: e.message,
          moveCount: 0
        };
      }
    }

    res.json({
      scoringPeriod: sp,
      results,
      logs: logger.logs
    });
  } catch (e) {
    res.status(500).send(e?.message || String(e));
  }
});

// ===== EXISTING DEBUG ENDPOINTS (enhanced) =====
app.get("/api/debug/trans-check", async (req, res) => {
  const logger = new ProcessLogger();
  const leagueId = req.query.leagueId;
  const seasonId = req.query.seasonId;
  if (!leagueId || !seasonId) return res.status(400).send("leagueId and seasonId required");

  const rows = [];
  let totalCount = 0;

  for (let sp = 1; sp <= 25; sp++) {
    const row = { sp };
    for (const [view, tag] of [
      ["mTransactions2", "tx"],
      ["recentActivity", "recent"],
      ["kona_league_communication", "comm"]
    ]) {
      try {
        const j = await espnFetch({ leagueId, seasonId, view, scoringPeriodId: sp, req, requireCookie: true, logger });
        const count = (Array.isArray(j?.transactions) && j.transactions.length) ||
                     (Array.isArray(j?.events) && j.events.length) ||
                     (Array.isArray(j?.messages) && j.messages.length) ||
                     (Array.isArray(j?.topics) && j.topics.length) ||
                     (Array.isArray(j) && j.length) || 0;
        row[tag] = count;
        totalCount += count;
      } catch (e) {
        logger.error(`${view} SP ${sp} failed`, e);
        row[tag] = "ERR";
      }
      await sleep(120);
    }
    rows.push(row);
  }
  
  logger.info(`Trans-check complete`, { totalRawCount: totalCount });
  res.json({ 
    rows, 
    summary: { totalRawTransactions: totalCount },
    errors: logger.stats.errors
  });
});

app.get("/api/debug/roster-check", async (req, res) => {
  const logger = new ProcessLogger();
  const { leagueId, seasonId } = req.query || {};
  if (!leagueId || !seasonId) return res.status(400).send("leagueId and seasonId required");

  const out = [];
  for (let sp = 1; sp <= 25; sp++) {
    const row = { sp };
    try {
      const r = await espnFetch({ leagueId, seasonId, view: "mRoster", scoringPeriodId: sp, req, requireCookie: false, logger });
      const teamCount = Array.isArray(r?.teams) ? r.teams.length : 0;
      const playerSlots = (r?.teams || []).reduce((n, t) => n + (t?.roster?.entries?.length || 0), 0);
      row.teams = teamCount;
      row.entries = playerSlots;
    } catch (e) {
      logger.