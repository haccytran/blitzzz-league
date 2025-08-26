// server.mjs — cookie-optional ESPN proxy + official snapshot + polls
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   Setup
   ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT = process.env.PORT || 8787;

const ADMIN_PASSWORD = process.env.VITE_ADMIN_PASSWORD || "changeme";
const LEAGUE_TZ = "America/Los_Angeles"; // Pacific Time

const DATA_DIR = path.join(__dirname, "data");
await fs.mkdir(DATA_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* =========================
   File helpers
   ========================= */
const fpath = (name) => path.join(DATA_DIR, name);

async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(fpath(name), "utf8")); }
  catch { return fallback; }
}
async function writeJson(name, obj) {
  await fs.writeFile(fpath(name), JSON.stringify(obj, null, 2), "utf8");
}

/* =========================
   Time helpers (Wed→Tue league week)
   ========================= */
function toPT(d) { return new Date(d.toLocaleString("en-US", { timeZone: LEAGUE_TZ })); }
function fmtPT(d) { return toPT(d).toLocaleString(); }

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
    return {
      ok:false, status: r.status,
      snippet: text.slice(0,200).replace(/\s+/g," "),
      ct: r.headers.get("content-type") || ""
    };
  }
}

async function espnFetch({ leagueId, seasonId, view, scoringPeriodId, req, requireCookie = false }) {
  if (!leagueId || !seasonId || !view) throw new Error("Missing leagueId/seasonId/view");
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const bust = `&_=${Date.now()}`;
  const viewEnc = encodeURIComponent(view);

  // Public-friendly → lm-api-reads → site.web fallback
  const urls = [
    `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${viewEnc}${sp}${bust}`,
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${viewEnc}${sp}${bust}`,
    `https://site.web.api.espn.com/apis/fantasy/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=${viewEnc}${sp}${bust}`
  ];

  let last = null;
  for (const url of urls) {
    const res = await tryFetchJSON(url, requireCookie, req);
    if (res.ok) return res.json;
    last = res;
  }
  throw new Error(
    `ESPN returned non-JSON for ${view}${scoringPeriodId?` (SP ${scoringPeriodId})`:""}. ` +
    `Status ${last?.status||"?"}, ct ${last?.ct||"?"}. Snippet: ${last?.snippet||""}`
  );
}

/* Pass-through endpoint used by the UI (set ?auth=1 to force cookies) */
app.get("/api/espn", async (req, res) => {
  try {
    const { leagueId, seasonId, view, scoringPeriodId, auth } = req.query;
    const json = await espnFetch({
      leagueId, seasonId, view, scoringPeriodId, req,
      requireCookie: auth === "1"
    });
    res.json(json);
  } catch (e) {
    res.status(502).send(String(e.message || e));
  }
});

/* =========================
   Polls API (code-based voting)
   ========================= */
const POLLS_FILE = "polls.json";
const nid = () => Math.random().toString(36).slice(2, 10);

app.get("/api/polls", async (_req, res) => {
  const data = await readJson(POLLS_FILE, { polls: [] });
  const safe = data.polls.map(p => ({
    id: p.id, question: p.question, closed: !!p.closed,
    options: (p.options||[]).map(o => ({ id:o.id, label:o.label, votes:o.votes|0 })),
    codesUsed: (p.codes||[]).filter(c=>c.used).length,
    codesTotal: (p.codes||[]).length
  }));
  res.json({ polls: safe });
});

app.post("/api/polls/create", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).send("Bad request");
  const data = await readJson(POLLS_FILE, { polls: [] });
  const poll = { id:nid(), question, closed:false, options: options.map(l=>({ id:nid(), label:l, votes:0 })), codes:[] };
  data.polls.unshift(poll);
  await writeJson(POLLS_FILE, data);
  res.json({ ok:true, pollId: poll.id });
});

app.post("/api/polls/generate", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId, codes } = req.body || {};
  const data = await readJson(POLLS_FILE, { polls: [] });
  const poll = data.polls.find(p => p.id === pollId);
  if (!poll) return res.status(404).send("Not found");
  poll.codes = (Array.isArray(codes)?codes:[]).map(c => ({
    code: String(c.code||"").toUpperCase(), name: c.name||"", used:false
  }));
  await writeJson(POLLS_FILE, data);
  res.json({ ok:true, total: poll.codes.length });
});

app.post("/api/polls/vote", async (req, res) => {
  const { pollId, code, optionId } = req.body || {};
  const data = await readJson(POLLS_FILE, { polls: [] });
  const poll = data.polls.find(p => p.id === pollId);
  if (!poll) return res.status(404).send("Not found");
  if (poll.closed) return res.status(423).send("Poll closed");
  const entry = (poll.codes||[]).find(c => c.code === String(code||"").toUpperCase());
  if (!entry) return res.status(401).send("Invalid code");
  if (entry.used) return res.status(409).send("Already used");
  const opt = (poll.options||[]).find(o => o.id === optionId);
  if (!opt) return res.status(400).send("Bad option");
  opt.votes = (opt.votes|0) + 1;
  entry.used = true;
  await writeJson(POLLS_FILE, data);
  res.json({ ok:true });
});

app.post("/api/polls/delete", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId } = req.body || {};
  const data = await readJson(POLLS_FILE, { polls: [] });
  const before = data.polls.length;
  data.polls = data.polls.filter(p => p.id !== pollId);
  if (data.polls.length === before) return res.status(404).send("Not found");
  await writeJson(POLLS_FILE, data);
  res.json({ ok:true });
});

app.post("/api/polls/close", async (req, res) => {
  if (req.header("x-admin") !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  const { pollId, closed } = req.body || {};
  const data = await readJson(POLLS_FILE, { polls: [] });
  const poll = data.polls.find(p => p.id === pollId);
  if (!poll) return res.status(404).send("Not found");
  poll.closed = !!closed;
  await writeJson(POLLS_FILE, data);
  res.json({ ok:true });
});

/* =========================
   Official Snapshot (commissioner builds once; league reads)
   ========================= */
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
async function fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp=25 }){
  const all = [];
  for (let sp=1; sp<=maxSp; sp++){
    try { const j = await espnFetch({ leagueId, seasonId, view:"mTransactions2", scoringPeriodId: sp, req, requireCookie:true }); all.push(...extractMoves(j,"tx")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view:"recentActivity", scoringPeriodId: sp, req, requireCookie:true }); all.push(...extractMoves(j,"recent")); } catch {}
    try { const j = await espnFetch({ leagueId, seasonId, view:"kona_league_communication", scoringPeriodId: sp, req, requireCookie:true }); all.push(...extractMovesFromComm(j)); } catch {}
  }
  return all.map(e => ({ ...e, date: e.date instanceof Date ? e.date : new Date(e.date) }))
            .sort((a,b)=> a.date - b.date);
}
async function fetchRosterSeries({ leagueId, seasonId, req, maxSp=25 }){
  const series = [];
  for (let sp=1; sp<=maxSp; sp++){
    try {
      const r = await espnFetch({ leagueId, seasonId, view:"mRoster", scoringPeriodId: sp, req, requireCookie:false });
      const byTeam = {};
      for (const t of (r?.teams || [])) {
        const set = new Set();
        for (const e of (t.roster?.entries || [])) {
          const pid = e.playerPoolEntry?.player?.id;
          if (pid) set.add(pid);
        }
        byTeam[t.id] = set;
      }
      series[sp] = byTeam;
    } catch { series[sp] = {}; }
  }
  return series;
}
const isOnRoster = (series, sp, teamId, playerId) => !!(playerId && series?.[sp]?.[teamId]?.has(playerId));
const spFromDate = (dateLike, seasonYear)=> Math.max(1, Math.min(25, (leagueWeekOf(new Date(dateLike), seasonYear).week || 1)));
function isGenuineAddBySeries(row, series, seasonYear){
  if (!row.playerId) return true;
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  const later = [sp, sp+1, sp+2].filter(n=>n<series.length);
  const wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  const appearsLater = later.some(n=> isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return !wasBefore && appearsLater;
}
function isExecutedDropBySeries(row, series, seasonYear){
  if (!row.playerId) return false;
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  const later = [sp, sp+1, sp+2].filter(n=>n<series.length);
  const wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  const appearsLater = later.some(n=> isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return wasBefore && !appearsLater;
}
async function buildPlayerMap({ leagueId, seasonId, req, ids, maxSp=25 }){
  const need = new Set((ids||[]).filter(Boolean));
  const map = {}; if (need.size===0) return map;
  for (let sp=1; sp<=maxSp; sp++){
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
  // Team names — public in most leagues
  const mTeam = await espnFetch({ leagueId, seasonId, view:"mTeam", req, requireCookie:false });
  const idToName = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, teamName(t)]));

  // All raw moves from three sources (cookie-required)
  const all = await fetchSeasonMovesAllSources({ leagueId, seasonId, req, maxSp:25 });

  // Roster series (public) to verify executed adds/drops and get names later
  const series = await fetchRosterSeries({ leagueId, seasonId, req, maxSp:25 });

  // Dedup → annotate
  const deduped = dedupeMoves(all).map(e => ({
    ...e,
    teamIdRaw: e.teamId,
    team: idToName[e.teamId] || `Team ${e.teamId}`,
    player: e.playerName || null
  }));

  // Keep executed events only
  const adds  = deduped.filter(r => r.action === "ADD"  && isGenuineAddBySeries(r, series, seasonId));
  const drops = deduped.filter(r => r.action === "DROP" && isExecutedDropBySeries(r, series, seasonId));

  // Backfill missing player names via roster snapshots
  const needIds = [...new Set([...adds, ...drops].map(r => r.player ? null : r.playerId).filter(Boolean))];
  const pmap = await buildPlayerMap({ leagueId, seasonId, req, ids: needIds, maxSp:25 });
  for (const r of [...adds, ...drops]) if (!r.player && r.playerId) r.player = pmap[r.playerId] || `#${r.playerId}`;


// Flatten for UI — definitive week math (avoids off-by-one)
const rawMoves = [...adds, ...drops].map(r => {
  const wb = weekBucketPT(r.date, seasonId); // <- NEW helper
  return {
    date: fmtPT(r.date),
    week: wb.week,                              // 1-based, never 0
    range: weekRangeLabelDisplay(wb.start),     // correct Wed→Tue label
    team: r.team,
    player: r.player || (r.playerId ? `#${r.playerId}` : "—"),
    action: r.action,            // ADD | DROP
    method: r.method,            // WAIVER | FA (when we can infer it)
    source: r.src,               // tx | recent | comm
    playerId: r.playerId || null
  };
}).sort((a,b)=> (a.week - b.week) || (new Date(a.date) - new Date(b.date)));
  

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
app.get("/api/report", async (_req, res) => {
  const report = await readJson("report.json", null);
  if (!report) return res.status(404).send("No report");
  res.json(report);
});

app.post("/api/report/update", async (req, res) => {
  if (ADMIN_PASSWORD && req.header("x-admin") !== ADMIN_PASSWORD)
    return res.status(401).send("Unauthorized");

  const { leagueId, seasonId } = req.body || {};
  if (!leagueId || !seasonId) return res.status(400).send("Missing leagueId/seasonId");
  try {
    const report = await buildOfficialReport({ leagueId, seasonId, req });
    await writeJson("report.json", report);
    res.json({ ok:true, lastSynced: report.lastSynced });
  } catch (e) {
    res.status(502).send(String(e.message || e));
  }
});

/* =========================
   Start server
   ========================= */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
