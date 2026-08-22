// --- server-merged.mjs ---
// Built by combining the robust fetch/logging skeleton from the "Error Free Fetching"
// server with the ESPN transactions/filtering/calculation logic from "Version 3.5",
// and adding the robust, explicit Pacific Time (PT) helpers to avoid host TZ issues.
//
// Drop-in replacement: rename this file to `server.mjs` in your project.
//
// Env you can set (all optional):
//   PORT, VITE_ADMIN_PASSWORD, SWID, ESPN_S2 (or S2), ESPN_COOKIE, TZ (ignored by our PT helpers)
//   LEAGUE_TZ (defaults to America/Los_Angeles)

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
const LEAGUE_TZ      = process.env.LEAGUE_TZ || "America/Los_Angeles";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ========== Lightweight progress tracker ==========
const jobProgress = new Map(); // jobId -> { pct, msg, t }
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

// ========== File helpers ==========
const fpath = (name) => path.join(DATA_DIR, name);
async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(fpath(name), "utf8")); }
  catch { return fallback; }
}
async function writeJson(name, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
}

// ========== Robust PT timezone helpers (explicit zone; host TZ independent) ==========
// We DO NOT rely on system TZ. We compute PT wall-clock with Intl.DateTimeFormat(timeZone).
const dtfPT = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TZ,   // "America/Los_Angeles"
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

/** Return a Date whose clock reflects PT (no locale string parsing). */
export function toPT(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const parts = Object.fromEntries(dtfPT.formatToParts(d).map(p => [p.type, p.value]));
  // Build a UTC timestamp that represents the PT wall clock time.
  return new Date(Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second
  ));
}

/** Pretty-print a timestamp in PT for labels/debug. */
export function fmtPT(dateLike) {
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

export function weekBucketPT(date, seasonYear) {
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
export function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeekPT(date);
  const week1 = startOfLeagueWeekPT(firstWednesdayOfSeptemberPT(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0; // preseason bucket
  return { week, start };
}
export function weekRangeLabelDisplay(startPT){
  const wed = new Date(startPT); wed.setHours(0,0,0,0);
  const tue = new Date(wed); tue.setDate(tue.getDate()+6); tue.setHours(23,59,0,0);
  const short = (d)=> toPT(d).toLocaleDateString(undefined,{month:"short", day:"numeric"});
  return `${short(wed)}–${short(tue)} (cutoff Tue 11:59 PM PT)`;
}
export function normalizeEpoch(x){
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  if (x > 0 && x < 1e11) return x * 1000; // seconds → ms
  return x;
}

// ========== Process logger (for rich debug logs) ==========
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

// ========== ESPN proxy (cookie-optional, multi-host fallback) ==========
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
  for (let attempt = 1; attempt <= 2; attempt++) {  // fewer retries per host
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
        // Bot/HTML page—don’t burn more retries on this host.
        const preview = txt.slice(0, 160).replace(/\s+/g, " ");
        lastErr = `status ${res.status}, ct ${ct}, body: ${preview}`;
        logger?.error(`Non-JSON for ${label} (fast-fail)`, { status: res.status, ct, preview });
        throw new Error(`Non-JSON (${ct})`);
      }

      // backoff + jitter
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt) + Math.random() * 400));
    } catch (e) {
      lastErr = `Network error: ${e?.message || e}`;
      logger?.error(`Network error for ${label}`, e, { attempt });
      await new Promise(r => setTimeout(r, 400 * attempt));
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
    // This one is consistently JSON
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${v}${sp}${bust}`,
    // Secondary JSON source
    `https://site.web.api.espn.com/apis/fantasy/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${v}${sp}${bust}`,
    // Last: main site (often returns HTML bot page on Render IPs)
    `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${v}${sp}${bust}`
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

// ========== ESPN transactions — taken from Version 3.5 (normalized) ==========
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
    // Quick no-cookie follow-up (many hosts allow this and return JSON)
    try {
      const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: false, logger });
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

// Build roster snapshots for each scoring period (with carry-forward fallback)
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
  const appearsLater = later.some(n => isOnRoster(series, n, teamId, row.playerId));

  return !wasBefore && appearsLater;
}
function isExecutedDropBySeries(row, series, seasonYear){
  // If the transaction JSON didn’t carry a playerId (common on site.web.api),
  // assume the drop was executed rather than silently discarding it.
  if (!row.playerId) return true;

  const sp = spFromDate(row.date, seasonYear);
  const teamId = Number(row.teamIdRaw ?? row.teamId);

  const before = Math.max(1, sp - 1);
  const later  = [sp, sp + 1, sp + 2].filter(n => n < series.length);

  const wasBefore    = isOnRoster(series, before, teamId, row.playerId) || isOnRoster(series, sp, teamId, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, n, teamId, row.playerId));

  return wasBefore && !appearsLater;
}

// Resolve player names when missing (look across roster snapshots)
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
  }
  return map;
}

// Build the definitive report JSON
async function buildOfficialReport({ leagueId, seasonId, req, logger }){
  // Team names — public in most leagues
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false, logger });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

  // All raw moves from three sources
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25, logger });

  // Roster series (public) to verify executed adds/drops and get names later
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25, logger });

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
      if (!isGenuineAddBySeries(r, series, seasonId)) continue;
      verified.push(r);
    } else if (r.action === "DROP") {
      if (!isExecutedDropBySeries(r, series, seasonId)) continue;
      verified.push(r);
    }
  }

  // Backfill missing player names for verified events
  const needIds = [...new Set(verified.map(r => r.player ? null : r.playerId).filter(Boolean))];
  const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25, logger });
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
      method: r.method,                              // WAIVER | FA (inferred)
      source: r.src,                                 // tx | recent | comm
      playerId: r.playerId || null
    };
  }).sort((a,b)=> (a.week - b.week) || (new Date(a.date) - new Date(b.date)));

  // Collapse duplicate DROP lines: same team + same player repeated within ~3 min,
  // unless there was an ADD for that player by that team in between.
  const DEDUPE_WINDOW_MS = 3 * 60 * 1000;
  const dedupedMoves = [];
  const lastByKey = new Map(); // key -> {action, ts}

  for (const m of rawMoves) {
    const key = `${m.team}|${m.playerId || m.player}`;

    if (m.action === "DROP") {
      const prev = lastByKey.get(key);
      if (prev && prev.action === "DROP" && Math.abs(m.ts - prev.ts) <= DEDUPE_WINDOW_MS) {
        // Same team dropped same player at the same moment: skip duplicate
        continue;
      }
      lastByKey.set(key, { action: "DROP", ts: m.ts });
    } else if (m.action === "ADD") {
      // If the team re-ADDs, we reset the chain so a later DROP will show again
      lastByKey.set(key, { action: "ADD", ts: m.ts });
    }

    dedupedMoves.push(m);
  }

  // Replace rawMoves with the cleaned list (and strip helper field)
  rawMoves = dedupedMoves.map(({ ts, ...rest }) => rest);

  // Build weekly rows (with totals) for UI
  const weeks = new Map();
  for (const row of rawMoves) {
    const key = `${row.week}|${row.range}`;
    if (!weeks.has(key)) weeks.set(key, { week: row.week, range: row.range, rows: [], adds: 0, drops: 0 });
    const W = weeks.get(key);
    W.rows.push(row);
    if (row.action === "ADD") W.adds++;
    if (row.action === "DROP") W.drops++;
  }
  const weekRows = [...weeks.values()].sort((a,b)=> a.week - b.week);

  return {
    seasonId: seasonId,
    builtAt: new Date().toISOString(),
    weeks: weekRows,
    totalAdds: rawMoves.filter(r=>r.action==="ADD").length,
    totalDrops: rawMoves.filter(r=>r.action==="DROP").length,
    rows: rawMoves
  };
}

// ========== Build/serve report endpoints ==========
app.post("/api/build", async (req, res) => {
  const logger = new ProcessLogger();
  try {
    const { leagueId, seasonId, jobId } = req.body || {};
    if (!leagueId || !seasonId) return res.status(400).send("Missing leagueId/seasonId");
    setProgress(jobId, 2, "Starting…");
    const report = await buildOfficialReport({
      leagueId: String(leagueId),
      seasonId: Number(seasonId),
      req,
      logger
    });
    setProgress(jobId, 98, "Saving…");
    await writeJson(REPORT_FILE, report);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, "last-build-log.json"), JSON.stringify(logger.getFullLog(), null, 2), "utf8");
    setProgress(jobId, 100, "Done");
    res.json({ ok: true, saved: `data/${REPORT_FILE}`, _debugLog: "data/last-build-log.json" });
  } catch (e) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, "last-build-log.json"), JSON.stringify(logger.getFullLog(), null, 2), "utf8");
    res.status(500).send(String(e.message || e));
  }
});

app.get("/api/report", async (req, res) => {
  const data = await readJson(REPORT_FILE, null);
  if (!data) return res.status(404).send("No report yet");
  res.json(data);
});

// ========== Static hosting (optional) ==========
const DIST_DIR = path.join(__dirname, "dist");
app.use(express.static(DIST_DIR));
app.get(/^(?!\/api\/).*/, async (req, res, next) => {
  try {
    const indexPath = path.join(DIST_DIR, "index.html");
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
