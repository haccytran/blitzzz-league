// --- server.mjs (consolidated) ---
// Combines: robust fetch/logging + PT-safe time math + Version 3.5 transactions
// Adds: POLLS v2.1 routes; legacy report fields for Dues; season-aware report files

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

// ---------- Progress tracker ----------
const jobProgress = new Map();
function setProgress(jobId, pct, msg) {
  if (!jobId) return;
  jobProgress.set(jobId, { pct: Math.max(0, Math.min(100, Math.round(pct))), msg: String(msg || ""), t: Date.now() });
}
app.get("/api/progress", (req, res) => {
  const { jobId } = req.query || {};
  res.json(jobProgress.get(jobId) || { pct: 0, msg: "" });
});

// ---------- File helpers ----------
const fpath = (name) => path.join(DATA_DIR, name);
async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(fpath(name), "utf8")); }
  catch { return fallback; }
}
async function writeJson(name, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
}

// ---------- PT helpers (host-TZ independent) ----------
const dtfPT = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});
export function toPT(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const parts = Object.fromEntries(dtfPT.formatToParts(d).map(p => [p.type, p.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}
export function fmtPT(dateLike) {
  return new Date(dateLike).toLocaleString("en-US", { timeZone: LEAGUE_TZ });
}
const WEEK_START_DAY = 3; // Wed
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
const DAY = 24*60*60*1000;
const WAIVER_EARLY_WED_SHIFT_MS = 5 * 60 * 60 * 1000;
export function weekBucketPT(date, seasonYear) {
  const z0 = toPT(new Date(date));
  let z = new Date(z0);
  if (z.getDay() === 3 && z.getHours() < 5) z = new Date(z.getTime() - WAIVER_EARLY_WED_SHIFT_MS);
  const w1 = firstWednesdayOfSeptemberPT(Number(seasonYear));
  const diff = z.getTime() - w1.getTime();
  const week = Math.max(1, Math.floor(diff / (7 * DAY)) + 1);
  const start = new Date(w1.getTime() + (week - 1) * 7 * DAY);
  return { week, start };
}
export function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeekPT(date);
  const week1 = startOfLeagueWeekPT(firstWednesdayOfSeptemberPT(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0;
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
  if (x > 0 && x < 1e11) return x * 1000;
  return x;
}

// ---------- ProcessLogger (light) ----------
class ProcessLogger {
  constructor(){ this.logs=[]; }
  log(level, message, data={}){ console.log(`[${level}] ${message}`, data); this.logs.push({t:new Date().toISOString(), level, message, data}); }
  debug(m,d){ this.log("DEBUG",m,d); }
  info(m,d){ this.log("INFO",m,d); }
  error(m,e,d){ this.log("ERROR",m,{err: e?.message||String(e), ...(d||{})}); }
  getFullLog(){ return { logs: this.logs }; }
}

// ---------- ESPN fetch with fallbacks ----------
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
async function fetchJSONWithRetry(url, { requireCookie, req, label, logger }) {
  const headers = { ...BROWSER_HEADERS };
  if (requireCookie) {
    const ck = buildCookie(req);
    if (ck) { headers.Cookie = ck; logger?.debug(`Cookie attached for ${label}`, { len: ck.length }); }
  }
  let lastErr = "";
  for (let attempt=1; attempt<=2; attempt++){
    try {
      logger?.debug(`HTTP ${attempt} → ${label}`, { url });
      const res = await fetch(url, { headers });
      const ct  = res.headers.get("content-type") || "";
      const txt = await res.text();
      if (ct.includes("application/json")) return JSON.parse(txt);
      lastErr = `status ${res.status}, ct ${ct}`;
      throw new Error("Non-JSON");
    } catch(e){
      lastErr = e?.message || String(e);
      await new Promise(r => setTimeout(r, 250*attempt));
    }
  }
  throw new Error(`ESPN non-JSON for ${label}: ${lastErr}`);
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
  const logger2 = logger || new ProcessLogger();
  for (let i=0;i<urls.length;i++){
    try {
      const json = await fetchJSONWithRetry(urls[i], { requireCookie, req, label: `${view}${scoringPeriodId?` (SP ${scoringPeriodId})`:""}`, logger: logger2 });
      return json;
    } catch(e){ logger2.debug(`URL fail ${i+1}/${urls.length}`, { err: e.message }); }
  }
  throw new Error("All ESPN URLs failed");
}
app.get("/api/espn", async (req, res) => {
  const logger = new ProcessLogger();
  try {
    const { leagueId, seasonId, view, scoringPeriodId, auth, debug } = req.query;
    const json = await espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie: auth==="1", logger });
    if (debug === "1") {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(path.join(DATA_DIR, "last-espn-log.json"), JSON.stringify(logger.getFullLog(), null, 2), "utf8");
      return res.json({ _debugFile:"data/last-espn-log.json", data: json });
    }
    res.json(json);
  } catch (e) { res.status(502).send(String(e.message||e)); }
});

// ---------- POLLS v2.1 (from Version 3.5) ----------
const POLLS_FILE = path.join(DATA_DIR, "polls.json");
let pollsState = { polls: {}, votes: {}, teamCodes: {} };
async function loadPolls() {
  try {
    const raw = await fs.readFile(POLLS_FILE, "utf-8");
    const data = JSON.parse(raw);
    pollsState.polls     = data.polls     || {};
    pollsState.votes     = data.votes     || {};
    pollsState.teamCodes = data.teamCodes || {};
  } catch {}
}
async function savePolls() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(POLLS_FILE, JSON.stringify(pollsState, null, 2), "utf-8");
}
await loadPolls();

const FRIENDLY_WORDS = [
  "MANGO","FALCON","TIGER","ORCA","BISON","HAWK","PANDA","EAGLE","MAPLE","CEDAR","ONYX","ZINC",
  "SAPPHIRE","COBALT","QUARTZ","NEON","NOVA","COMET","BOLT","BLITZ","STORM","GLACIER","RAPTOR",
  "VIPER","COUGAR","WOLF","SHARK","LYNX","OTTER","MOOSE","BEAR","FOX","RAVEN","ROBIN","DRAGON",
  "PHOENIX","ORBIT","ROCKET","ATLAS","APEX","DELTA","OMEGA","THUNDER","SURGE","WAVE","EMBER",
  "FROST","POLAR","COSMIC","SHADOW","AQUA"
];
const randomFriendlyCode = () => FRIENDLY_WORDS[Math.floor(Math.random() * FRIENDLY_WORDS.length)];

// issue codes once per team per season
app.post("/api/polls/issue-team-codes", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { seasonId, teams } = req.body || {};
  if (!seasonId || !Array.isArray(teams)) return res.status(400).send("Missing seasonId or teams[]");
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
  await savePolls();
  res.json({ issued: issued.length, codes: issued });
});

// list polls with tallies
app.get("/api/polls", (req, res) => {
  const seasonId = String(req.query?.seasonId || "");
  const out = Object.values(pollsState.polls || {}).map(p => {
    const byTeam = pollsState.votes?.[p.id] || {};
    const tally = {};
    Object.values(byTeam).forEach(opt => { tally[opt] = (tally[opt] || 0) + 1; });
    const codesTotal = seasonId
      ? Object.keys(pollsState.teamCodes || {}).filter(k => k.startsWith(`${seasonId}:`)).length
      : Object.keys(pollsState.teamCodes || {}).length;
    return {
      id: p.id,
      question: p.question,
      closed: !!p.closed,
      options: (p.options || []).map(o => ({ id: o.id, label: o.label, votes: tally[o.id] || 0 })),
      codesUsed: Object.keys(byTeam).length,
      codesTotal
    };
  });
  res.json({ polls: out });
});

// create/close/delete
const nid = () => Math.random().toString(36).slice(2, 10);
app.post("/api/polls/create", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).send("Bad request");
  const id = nid();
  pollsState.polls[id] = { id, question: String(question), closed: false, options: options.map(label => ({ id: nid(), label: String(label) })) };
  await savePolls();
  res.json({ ok: true, pollId: id });
});
app.post("/api/polls/close", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId, closed } = req.body || {};
  if (!pollId || !pollsState.polls[pollId]) return res.status(404).send("Not found");
  pollsState.polls[pollId].closed = !!closed;
  await savePolls();
  res.json({ ok: true });
});
app.post("/api/polls/delete", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId } = req.body || {};
  if (!pollId) return res.status(400).send("Missing pollId");
  if (pollsState.polls[pollId]) delete pollsState.polls[pollId];
  if (pollsState.votes[pollId]) delete pollsState.votes[pollId];
  await savePolls();
  res.json({ ok: true });
});
app.get("/api/polls/team-codes", (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const seasonId = req.query?.seasonId;
  if (!seasonId) return res.status(400).send("Missing seasonId");
  const rows = [];
  for (const [k,v] of Object.entries(pollsState.teamCodes || {})) {
    if (k.startsWith(`${seasonId}:`)) rows.push({ teamId: Number(k.split(":")[1]), code: v.code, createdAt: v.createdAt });
  }
  res.json({ codes: rows });
});
app.post("/api/polls/vote", async (req, res) => {
  const { pollId, optionId, seasonId, teamCode } = req.body || {};
  if (!pollId || !optionId || !seasonId || !teamCode) return res.status(400).send("Missing pollId/optionId/seasonId/teamCode");
  let teamId = null;
  for (const [k, v] of Object.entries(pollsState.teamCodes)) {
    if (k.startsWith(`${seasonId}:`) && String(v.code).toUpperCase() === String(teamCode).toUpperCase()) { teamId = Number(k.split(":")[1]); break; }
  }
  if (!teamId) return res.status(403).send("Invalid code");
  pollsState.votes[pollId] = pollsState.votes[pollId] || {};
  pollsState.votes[pollId][teamId] = optionId; // allow changing vote
  await savePolls();
  res.json({ ok: true, byTeam: pollsState.votes[pollId] });
});

// ---------- Transactions / Snapshot ----------
const REPORT_FILE = "report.json";
const teamName = (t) => (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`);

function isWithinWaiverWindowPT(dateLike){
  const z = toPT(new Date(dateLike));
  if (z.getDay() !== 3) return false;
  const minutes = z.getHours()*60 + z.getMinutes();
  return minutes <= 4*60 + 30;
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
const pickPlayerId   = (it)=> it?.playerId ?? it?.playerPoolEntry?.player?.id ?? it?.player?.id ?? it?.athleteId ?? it?.entityId ?? null;
const pickPlayerName = (it,t)=> it?.playerPoolEntry?.player?.fullName || it?.player?.fullName || it?.athlete?.fullName || t?.playerPoolEntry?.player?.fullName || t?.player?.fullName || null;

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
    const items = Array.isArray(t.items) ? t.items : Array.isArray(t.messages) ? t.messages : Array.isArray(t.changes) ? t.changes : (t.item ? [t.item] : []);
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
async function fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp = 25, onProgress, logger }) {
  const all = [];
  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Reading ESPN activity…");
    try { const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: true, logger }); all.push(...extractMoves(j, "tx")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, req, requireCookie: false, logger }); all.push(...extractMoves(j, "tx")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, req, requireCookie: true, logger }); all.push(...extractMoves(j, "recent")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, req, requireCookie: true, logger }); all.push(...extractMovesFromComm(j)); } catch {}
    await sleep(120 + Math.floor(Math.random() * 120));
  }
  return all.map(e => ({ ...e, date: e.date instanceof Date ? e.date : new Date(e.date) })).sort((a, b) => a.date - b.date);
}
async function fetchRosterSeries({ leagueId, seasonId, req, maxSp = 25, onProgress, logger }) {
  const series = [];
  let lastGood = {};
  for (let sp = 1; sp <= maxSp; sp++) {
    onProgress?.(sp, maxSp, "Building roster timeline…");
    let done=false, attempt=0;
    while(!done && attempt<3){
      attempt++;
      try {
        const r = await espnFetch({ leagueId, seasonId, view: "mRoster", scoringPeriodId: sp, req, requireCookie: attempt>1, logger });
        const byTeam = {};
        for (const t of (r?.teams || [])) {
          const set = new Set();
          for (const e of (t?.roster?.entries || [])) {
            const pid = e?.playerPoolEntry?.player?.id;
            if (pid) set.add(pid);
          }
          byTeam[t.id] = set;
        }
        if (Object.keys(byTeam).length > 0) { series[sp] = byTeam; lastGood = byTeam; }
        else { series[sp] = lastGood; }
        done=true;
      } catch(e){ await sleep(200); if (attempt>=3) { series[sp]=lastGood; done=true; } }
    }
  }
  return series;
}
const isOnRoster = (series, sp, teamId, playerId) => !!(playerId && series?.[sp]?.[teamId]?.has(playerId));
const spFromDate = (dateLike, seasonYear)=> Math.max(1, Math.min(25, (leagueWeekOf(new Date(dateLike), seasonYear).week || 1)));
function isGenuineAddBySeries(row, series, seasonYear) {
  if (!row.playerId) return true;
  const sp = spFromDate(row.date, seasonYear);
  const teamId = Number(row.teamIdRaw ?? row.teamId);
  const before = Math.max(1, sp - 1);
  const later  = [sp, sp + 1, sp + 2].filter(n => n < series.length);
  const wasBefore    = isOnRoster(series, before, teamId, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, n, teamId, row.playerId));
  return !wasBefore && appearsLater;
}
function isExecutedDropBySeries(row, series, seasonYear){
  if (!row.playerId) return false;
  const sp = spFromDate(row.date, seasonYear);
  const teamId = Number(row.teamIdRaw ?? row.teamId);
  const before = Math.max(1, sp - 1);
  const later  = [sp, sp + 1, sp + 2].filter(n => n < series.length);
  const wasBefore    = isOnRoster(series, before, teamId, row.playerId) || isOnRoster(series, sp, teamId, row.playerId);
  const appearsLater = later.some(n => isOnRoster(series, n, teamId, row.playerId));
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
  }
  return map;
}

// Build the definitive report JSON (+ legacy fields for Dues)
async function buildOfficialReport({ leagueId, seasonId, req, logger }){
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false, logger });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25, logger });
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25, logger });

  const deduped = dedupeMoves(all).map(e => ({
    ...e,
    teamIdRaw: Number(e.teamId),
    team: idToName[e.teamId] || `Team ${e.teamId}`,
    player: e.playerName || null
  }));

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

  const needIds = [...new Set(verified.map(r => r.player ? null : r.playerId).filter(Boolean))];
  const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25, logger });
  for (const r of verified) if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;

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

  // collapse duplicate DROPs in short window
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

  // Build NEW weeks structure
  const weeksMap = new Map();
  for (const row of rawMoves) {
    const key = `${row.week}|${row.range}`;
    if (!weeksMap.has(key)) weeksMap.set(key, { week: row.week, range: row.range, rows: [], adds: 0, drops: 0 });
    const W = weeksMap.get(key);
    W.rows.push(row);
    if (row.action === "ADD") W.adds++;
    if (row.action === "DROP") W.drops++;
  }
  const weeksArrayNew = [...weeksMap.values()].sort((a,b)=> a.week - b.week);

  // Legacy Dues view: per-week team counts → owes
  const perWeekAdds = new Map(); // week -> Map(team -> count)
  const rangeByWeek = new Map();
  for (const row of rawMoves) {
    if (row.action !== "ADD" || row.week <= 0) continue;
    if (!perWeekAdds.has(row.week)) perWeekAdds.set(row.week, new Map());
    rangeByWeek.set(row.week, row.range);
    const m = perWeekAdds.get(row.week);
    m.set(row.team, (m.get(row.team) || 0) + 1);
  }
  const weekRowsLegacy = [];
  const totals = new Map();
  for (const [w, m] of [...perWeekAdds.entries()].sort((a,b)=>a[0]-b[0])) {
    const entries = [];
    for (const [team, count] of m.entries()) {
      const owes = Math.max(0, count - 2) * 5;
      entries.push({ name: team, count, owes });
      const t = totals.get(team) || { adds:0, owes:0 };
      t.adds += count; t.owes += owes; totals.set(team, t);
    }
    entries.sort((a,b)=> a.name.localeCompare(b.name));
    weekRowsLegacy.push({ week:w, range: rangeByWeek.get(w) || "", entries });
  }
  const totalsRows = [...totals.entries()].map(([name, v]) => ({ name, adds: v.adds, owes: v.owes }))
    .sort((a,b)=> b.owes - a.owes || a.name.localeCompare(b.name));

  return {
    seasonId,
    builtAt: new Date().toISOString(),
    // New
    weeks: weeksArrayNew,
    rows: rawMoves,
    totalAdds: rawMoves.filter(r=>r.action==="ADD").length,
    totalDrops: rawMoves.filter(r=>r.action==="DROP").length,
    // Legacy (for Dues page)
    lastSynced: fmtPT(new Date()),
    weekRows: weekRowsLegacy,
    rawMoves,
    totalsRows
  };
}

// ---------- Build/Serve report endpoints ----------
app.post("/api/build", async (req, res) => {
  const logger = new ProcessLogger();
  try {
    const { leagueId, seasonId, jobId } = req.body || {};
    if (!leagueId || !seasonId) return res.status(400).send("Missing leagueId/seasonId");
    setProgress(jobId, 2, "Starting…");
    const report = await buildOfficialReport({ leagueId: String(leagueId), seasonId: Number(seasonId), req, logger });
    setProgress(jobId, 98, "Saving…");
    await writeJson(REPORT_FILE, report);
    await writeJson(`report_${seasonId}.json`, report);
    setProgress(jobId, 100, "Done");
    res.json({ ok: true, saved: `data/${REPORT_FILE}` });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

// Legacy route used by your UI button
app.post("/api/report/update", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { leagueId, seasonId } = req.body || {};
  if (!leagueId || !seasonId) return res.status(400).send("Missing leagueId/seasonId");
  const jobId = (req.query?.jobId || `job_${Date.now()}`);
  try {
    setProgress(jobId, 5, "Computing…");
    const logger = new ProcessLogger();
    const report = await buildOfficialReport({ leagueId: String(leagueId), seasonId: Number(seasonId), req, logger });
    await writeJson(REPORT_FILE, report);
    await writeJson(`report_${seasonId}.json`, report);
    setProgress(jobId, 100, "Done");
    res.json({ ok: true, weeks: (report?.weekRows || []).length });
  } catch (e) {
    setProgress(jobId, 100, "Failed");
    res.status(500).send(String(e.message || e));
  }
});
app.post("/api/report/update2", async (req, res) => {
  req.url = req.url.replace("/api/report/update2", "/api/report/update");
  return app._router.handle(req, res);
});

app.get("/api/report", async (req, res) => {
  const seasonId = req.query?.seasonId;
  let data = null;
  if (seasonId) data = await readJson(`report_${seasonId}.json`, null);
  if (!data) data = await readJson(REPORT_FILE, null);
  if (!data) return res.status(404).send("No report yet");
  res.json(data);
});

// ---------- Static hosting (Express 5-safe regex, skip /api) ----------
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
