// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import Logo from "./Logo.jsx";

/* =========================
   Global Config
   ========================= */
const ADMIN_ENV = import.meta.env.VITE_ADMIN_PASSWORD || "changeme";
const DEFAULT_LEAGUE_ID = import.meta.env.VITE_ESPN_LEAGUE_ID || "";
const DEFAULT_SEASON   = import.meta.env.VITE_ESPN_SEASON || new Date().getFullYear();
const LEAGUE_TZ = "America/Los_Angeles";           // Pacific Time
// Week window: Wednesday 12:00 AM → Tuesday 11:59 PM
const WEEK_START_DAY = 3; // 0=Sun..3=Wed

const API = (p) => (import.meta.env.DEV ? `http://localhost:8787${p}` : p);

/* ---- playful (non-hateful) roasts for wrong commissioner password ---- */
const ROASTS = [
  "Wrong again, champ. Try reading the group chat for once.",
  "Nope. That password works as well as your draft strategy.",
  "Access denied. Maybe ask your QB for a hint.",
  "Incorrect. Bench that attempt and try a new play.",
  "That wasn’t it. You’ve fumbled the bag, my friend.",
  "Denied. Consider a timeout for reflection.",
  "Close… in the same way you were close to making playoffs.",
  "Negative, ghost rider. Pattern not approved.",
  "Nah. That password is as washed as last year’s team.",
  "Still wrong. Maybe trade for a brain cell?",
  "Nope. You’re tilting and it shows.",
  "That’s a miss. Like your waiver claims at 12:02 AM.",
  "False start. Five-yard penalty. Try again.",
  "No dice. Respectfully, touch grass and refocus.",
  "Incorrect. Even auto-draft does better than this.",
  "Denied. Did you try caps lock, coach?",
  "Buddy… no. That password couldn’t beat a bye week.",
  "You whiffed. Like a kicker in a hurricane.",
  "Nah. Your attempt got vetoed by the league.",
  "Wrong. This ain’t daily fantasy—no mulligans here.",
  "That’s a brick. Free throws might be more your sport.",
  "Out of bounds. Re-enter with something sensible.",
  "Nope. Your intel source is clearly that one guy.",
  "Denied. That guess belongs on the waiver wire.",
  "Wrong. You’re running the kneel-down offense.",
  "Not even close. Did your cat type that?",
  "Flag on the play: illegal password formation.",
  "Interception. Defense takes it the other way.",
  "You’ve been sacked. 3rd and long—try again.",
  "Still wrong. This isn’t the Hail Mary you hoped for."
];

/* =========================
   Small UI helpers
   ========================= */
const th = { textAlign:"left", borderBottom:"1px solid #e5e7eb", padding:"6px 8px", whiteSpace:"nowrap" };
const td = { borderBottom:"1px solid #f1f5f9", padding:"6px 8px" };
function nid(){ return Math.random().toString(36).slice(2,9) }
function today(){ return new Date().toISOString().slice(0,10) }
function downloadCSV(name, rows){
  const csv = rows.map(r => r.map(x => `"${String(x??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name; a.click();
  URL.revokeObjectURL(url);
}
const btnPri = { background:"#0ea5e9", color:"#fff" };
const btnSec = { background:"#e5e7eb", color:"#0b1220" };

/* =========================
   Week math: Wed→Tue
   ========================= */
function toPT(d){ return new Date(d.toLocaleString("en-US", { timeZone: LEAGUE_TZ })); }
function startOfLeagueWeekPT(date){
  const z = toPT(date);
  const base = new Date(z); base.setHours(0,0,0,0);
  const dow = base.getDay();
  const back = (dow - WEEK_START_DAY + 7) % 7; // back to Wednesday
  base.setDate(base.getDate() - back);
  if (z < base) base.setDate(base.getDate() - 7);
  return base; // Wednesday 00:00 PT
}
function firstWednesdayOfSeptemberPT(year){
  const d = toPT(new Date(year, 8, 1)); // Sep=8
  const offset = (3 - d.getDay() + 7) % 7; // 3 = Wed
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}
function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeekPT(date);
  const week1 = startOfLeagueWeekPT(firstWednesdayOfSeptemberPT(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0;
  return { week, start, key: localDateKey(start) };
}
function currentWeekLabel(seasonYear){
  const w = leagueWeekOf(new Date(), seasonYear);
  return w.week > 0 ? `Week ${w.week}` : "Preseason";
}
function weekRangeLabelDisplay(startPT){
  const wed = new Date(startPT); wed.setHours(0,0,0,0);
  const tue = new Date(wed); tue.setDate(tue.getDate()+6); tue.setHours(23,59,0,0);
  return `${fmtShort(wed)}–${fmtShort(tue)} (cutoff Tue 11:59 PM PT)`;
}
function weekKeyFrom(w){ return w.key || localDateKey(w.start || new Date()) }
function localDateKey(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}` }
function fmtShort(d){ return toPT(d).toLocaleDateString(undefined,{month:"short", day:"numeric"}) }

/* =========================
   ESPN helpers: fetching & parsing
   ========================= */
function teamName(t){ return (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`); }

async function fetchEspnJson({ leagueId, seasonId, view, scoringPeriodId, auth = false }) {
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const au = auth ? `&auth=1` : "";
  const url = API(`/api/espn?leagueId=${leagueId}&seasonId=${seasonId}&view=${view}${sp}${au}`);
  const r = await fetch(url);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`ESPN returned non-JSON for ${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}. Snippet: ${text.slice(0,160).replace(/\s+/g," ")}`); }
}

/* ----- Transaction extraction / normalization ----- */
function normalizeEpoch(x){
  if (x == null) return Date.now();
  if (typeof x === "string") x = Number(x);
  if (x > 0 && x < 1e11) return x * 1000; // seconds → ms
  return x;
}

// waiver window helper: Wed 00:00–04:30 PT
function isWithinWaiverWindowPT(dateLike){
  const z = toPT(new Date(dateLike));
  if (z.getDay() !== 3) return false;
  const minutes = z.getHours() * 60 + z.getMinutes();
  return minutes <= 4 * 60 + 30;
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

function pickPlayerId(it){
  if (it?.playerId) return it.playerId;
  if (it?.playerPoolEntry?.player?.id) return it.playerPoolEntry.player.id;
  if (it?.entityId) return it.entityId;
  return null;
}
function pickPlayerName(it, t){
  return (
    it?.playerPoolEntry?.player?.fullName ||
    it?.player?.fullName ||
    t?.playerPoolEntry?.player?.fullName ||
    t?.player?.fullName ||
    null
  );
}

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
  const list = Array.isArray(rows) ? rows : [];

  for (const t of list){
    const whenRaw = t.processDate ?? t.proposedDate ?? t.executionDate ?? t.date ?? t.timestamp ?? Date.now();
    const when = normalizeEpoch(whenRaw);
    const date = new Date(when);
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
      if (teamId != null) {
        out.push({
          teamId, date, action, method, src, eventId,
          playerId: t.playerId ?? null, playerName: t.playerName ?? null,
        });
      }
      continue;
    }

    for (const it of items){
      const iTypeStr = it.type ?? it.moveType ?? it.action;
      const iTypeNum = Number.isFinite(it.type) ? it.type : null;
      const method = inferMethod(iTypeStr ?? typeStr, iTypeNum ?? typeNum, t, it);

      // ADD
      if (/ADD|WAIVER|CLAIM/i.test(String(iTypeStr)) || [1,5,7].includes(iTypeNum)) {
        const toTeamId = it.toTeamId ?? it.teamId ?? it.forTeamId ?? t.toTeamId ?? t.teamId ?? null;
        if (toTeamId != null) {
          out.push({
            teamId: toTeamId, date, action:"ADD", method, src, eventId: it.id ?? eventId ?? null,
            playerId: pickPlayerId(it), playerName: pickPlayerName(it,t),
          });
        }
      }
      // DROP
      if (/DROP/i.test(String(iTypeStr)) || [2].includes(iTypeNum)) {
        const fromTeamId = it.fromTeamId ?? t.fromTeamId ?? it.teamId ?? null;
        if (fromTeamId != null) {
          out.push({
            teamId: fromTeamId, date, action:"DROP", method:"FA", src, eventId: it.id ?? eventId ?? null,
            playerId: pickPlayerId(it), playerName: pickPlayerName(it,t),
          });
        }
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
      const when = normalizeEpoch(m.date ?? m.timestamp ?? t.date ?? Date.now());
      const date = new Date(when);
      const acts = (Array.isArray(m.actions) && m.actions) || [];
      for (const a of acts) {
        const s = String(a.type ?? a.action ?? "").toUpperCase();
        const teamId = a.toTeamId ?? a.teamId ?? m.toTeamId ?? m.teamId ?? null;
        if (/ADD|WAIVER|CLAIM/.test(s) && teamId != null) {
          out.push({ teamId, date, action:"ADD", method:/WAIVER|CLAIM/.test(s) ? "WAIVER":"FA", src:"comm", playerId: a.playerId||null });
        }
        if (/DROP/.test(s) && teamId != null) {
          out.push({ teamId, date, action:"DROP", method:"FA", src:"comm", playerId: a.playerId||null });
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
      ? `id:${e.eventId}|a:${e.action}`
      : `tm:${e.teamId}|p:${e.playerId||""}|a:${e.action}|m:${tMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/* ----- Roster series for executed-move verification ----- */
async function fetchRosterSeries({ leagueId, seasonId, maxSp = 25, onProgress }) {
  const series = [];
  for (let sp = 1; sp <= maxSp; sp++) {
    try {
      const r = await fetchEspnJson({ leagueId, seasonId, view: "mRoster", scoringPeriodId: sp });
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
    } catch {
      series[sp] = {};
    }
    onProgress?.(sp, maxSp, "Building roster timeline…");
  }
  return series;
}
function isOnRoster(series, sp, teamId, playerId){
  if (!playerId) return false;
  const s = series?.[sp]?.[teamId];
  return s ? s.has(playerId) : false;
}
function spFromDate(dateLike, seasonYear){
  const w = leagueWeekOf(new Date(dateLike), seasonYear);
  return Math.max(1, Math.min(25, w.week || 1));
}
function isGenuineAddBySeries(row, series, seasonYear){
  if (!row.playerId) return true; // lack id → cannot verify → accept
  const sp = spFromDate(row.date, seasonYear);
  let wasBefore = false;
  if (sp > 1) {
    const before = sp - 1;
    wasBefore = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  }
  const laterSps = [sp, sp + 1, sp + 2].filter(n => n < series.length);
  const appearsLater= laterSps.some(n => isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return !wasBefore && appearsLater;
}
function isExecutedDropBySeries(row, series, seasonYear){
  if (!row.playerId) return false;
  const sp = spFromDate(row.date, seasonYear);
  const before = Math.max(1, sp - 1);
  const laterSps = [sp, sp + 1, sp + 2].filter(n => n < series.length);
  const wasBefore   = isOnRoster(series, before, row.teamIdRaw, row.playerId);
  const appearsLater= laterSps.some(n => isOnRoster(series, n, row.teamIdRaw, row.playerId));
  return wasBefore && !appearsLater;
}

/* ----- Season moves + player map ----- */
async function fetchSeasonMovesAllSources({ leagueId, seasonId, maxSp = 25, onProgress }) {
  const all = [];

  for (let sp = 1; sp <= maxSp; sp++) {
    try {
      const j = await fetchEspnJson({ leagueId, seasonId, view: "mTransactions2", scoringPeriodId: sp, auth: true });
      all.push(...extractMoves(j, "tx"));
    } catch (_) {}
    try {
      const j = await fetchEspnJson({ leagueId, seasonId, view: "recentActivity", scoringPeriodId: sp, auth: true });
      all.push(...extractMoves(j, "recent"));
    } catch (_) {}
    try {
      const j = await fetchEspnJson({ leagueId, seasonId, view: "kona_league_communication", scoringPeriodId: sp, auth: true });
      all.push(...extractMovesFromComm(j));
    } catch (_) {}

    onProgress?.(sp, maxSp, "Reading ESPN activity…");
  }

  return all
    .map(e => ({ ...e, date: e.date instanceof Date ? e.date : new Date(e.date) }))
    .sort((a, b) => a.date - b.date);
}

async function buildPlayerMap({ leagueId, seasonId, ids, maxSp = 25 }) {
  const need = new Set((ids || []).filter(Boolean));
  const map = {};
  if (need.size === 0) return map;

  for (let sp = 1; sp <= maxSp; sp++) {
    try {
      const r = await fetchEspnJson({ leagueId, seasonId, view: "mRoster", scoringPeriodId: sp });
      for (const t of (r?.teams || [])) {
        for (const e of (t.roster?.entries || [])) {
          const p = e.playerPoolEntry?.player;
          const pid = p?.id;
          if (pid && need.has(pid)) {
            map[pid] = p.fullName || p.name || `#${pid}`;
            need.delete(pid);
          }
        }
      }
      if (need.size === 0) break;
    } catch (_) {}
  }

  return map;
}

/* =========================
   App Root
   ========================= */
export default function App(){ return <LeagueHub/> }

function LeagueHub(){
  useEffect(()=>{ document.title = "Blitzzz Fantasy Football League"; }, []);

  const STORAGE_KEY = "ffl_hub_data_v1";
  function load(){
    const defaultData = {
      announcements: [],
      tradeBlock: [],
      weekly: { text: "", weekLabel: "", updatedAt: Date.now() },
      members: [],
      waivers: [],
      leagueSettingsHtml: "<h2>League Settings</h2><ul><li>Scoring: Standard</li><li>Transactions counted from <b>Wed 12:00 AM PT → Tue 11:59 PM PT</b>; first two are free, then $5 each.</li></ul>"
    };
    try{ const raw=localStorage.getItem(STORAGE_KEY); return raw? {...defaultData, ...JSON.parse(raw)} : defaultData } catch { return defaultData }
  }

  const [data,setData]=useState(load);
  const [active,setActive]=useState("dues");

// Deep-link support: keep URL hash <-> active view in sync
const VIEW_IDS = ["announcements","weekly","waivers","dues","tx","rosters","settings","trading","polls"];

// On first load + when hash changes, set the active view
useEffect(() => {
  const applyHash = () => {
    const id = (window.location.hash.replace(/^#\/?/, "") || "").trim();
    if (VIEW_IDS.includes(id)) setActive(id);
  };
  applyHash();
  window.addEventListener("hashchange", applyHash);
  return () => window.removeEventListener("hashchange", applyHash);
}, []);

// Whenever active changes, push it into the hash
useEffect(() => {
  if (VIEW_IDS.includes(active)) {
    const want = `/${active}`;
    if (window.location.hash !== `#${want}`) {
      window.location.hash = want;
    }
  }
}, [active]);


  // Commissioner mode
  const [isAdmin,setIsAdmin] = useState(localStorage.getItem("ffl_is_admin")==="1");
  function nextRoast(){
    const idx = Number(localStorage.getItem("ffl_roast_idx")||"0");
    const msg = ROASTS[idx % ROASTS.length];
    localStorage.setItem("ffl_roast_idx", String(idx+1));
    return msg;
  }
  const login = ()=>{
    const pass = prompt("Enter Commissioner Password:");
    if(pass===ADMIN_ENV){
      setIsAdmin(true);
      localStorage.setItem("ffl_is_admin","1");
      alert("Commissioner mode enabled");
    } else {
      alert(nextRoast());
    }
  };
  const logout = ()=>{ setIsAdmin(false); localStorage.removeItem("ffl_is_admin"); };

  useEffect(()=>{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }, [data]);

  // ESPN config
  const [espn, setEspn] = useState({ leagueId: DEFAULT_LEAGUE_ID, seasonId: DEFAULT_SEASON });
  const seasonYear = Number(espn.seasonId) || new Date().getFullYear();

  // Weeks (respect season)
  const [selectedWeek, setSelectedWeek] = useState(leagueWeekOf(new Date(), seasonYear));
  useEffect(()=>{ setSelectedWeek(leagueWeekOf(new Date(), seasonYear)); }, [seasonYear]);

  const membersById = useMemo(()=>Object.fromEntries(data.members.map(m=>[m.id,m])),[data.members]);

  // Manual waivers (count within Wed→Tue)
  const weekKey = weekKeyFrom(selectedWeek);
  const waiversThisWeek = useMemo(
    () => data.waivers.filter(w => weekKeyFrom(leagueWeekOf(new Date(w.date), seasonYear)) === weekKey),
    [data.waivers, weekKey, seasonYear]
  );
  const waiverCounts = useMemo(()=>{ const c={}; waiversThisWeek.forEach(w=>{ c[w.userId]=(c[w.userId]||0)+1 }); return c; }, [waiversThisWeek]);
  const waiverOwed = useMemo(()=>{ const owed={}; for(const m of data.members){ const count=waiverCounts[m.id]||0; owed[m.id]=Math.max(0,count-2)*5 } return owed; }, [data.members, waiverCounts]);

  // CRUD
  const addAnnouncement = (html)=> setData(d=>({...d, announcements:[{id:nid(), html, createdAt:Date.now()}, ...d.announcements]}));
  const deleteAnnouncement = (id)=> setData(d=>({...d, announcements:d.announcements.filter(a=>a.id!==id)}));
  const addTrade = (t)=> setData(d=>({...d, tradeBlock:[{id:nid(), createdAt:Date.now(), ...t}, ...d.tradeBlock]}));
  const deleteTrade = (id)=> setData(d=>({...d, tradeBlock:d.tradeBlock.filter(t=>t.id!==id)}));
  const updateWeekly = (partial)=> setData(d=>({...d, weekly:{...d.weekly, ...partial, updatedAt:Date.now()}}));
  const addMember = (name)=> setData(d=>({...d, members:[...d.members, {id:nid(), name}]}));
  const deleteMember = (id)=> setData(d=>({...d, members:d.members.filter(m=>m.id!==id), waivers:d.waivers.filter(w=>w.userId!==id)}));
  const addWaiver = (userId, player, date)=> setData(d=>({...d, waivers:[{id:nid(), userId, player, date: date || today()}, ...d.waivers]}));
  const deleteWaiver = (id)=> setData(d=>({...d, waivers:d.waivers.filter(w=>w.id!==id)}));

  // Import ESPN teams (public endpoint)
  const importEspnTeams = async ()=>{
    if(!espn.leagueId) return alert("Enter League ID");
    try{
      const json = await fetchEspnJson({ leagueId: espn.leagueId, seasonId: espn.seasonId, view: "mTeam" });
      const teams = json?.teams || [];
      if(!Array.isArray(teams) || teams.length===0) return alert("No teams found (check ID/season).");
      const names = [...new Set(teams.map(t => teamName(t)))];
      setData(d => ({ ...d, members: names.map(n => ({ id: nid(), name: n })) }));
      alert(`Imported ${names.length} teams.`);
    } catch(e){ alert(e.message || "ESPN fetch failed. Check League/Season."); }
  };

  /* ---- Sync overlay state ---- */
  const [syncing, setSyncing] = useState(false);
  const [syncPct, setSyncPct] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");

  // Official (cached) report
  const [espnReport, setEspnReport] = useState(null);
  const [lastSynced, setLastSynced] = useState("");

  async function loadOfficialReport(silent=false){
    try{
      if(!silent){ setSyncing(true); setSyncPct(0); setSyncMsg("Loading official snapshot…"); }
      const r = await fetch(API("/api/report"));
      if (r.ok){
        const j = await r.json();
        setEspnReport(j || null);
        setLastSynced(j?.lastSynced || "");
      } else {
        if(!silent) alert("No official snapshot found yet.");
      }
    } catch(e){
      if(!silent) alert("Failed to load snapshot.");
    } finally{
      if(!silent) setTimeout(()=>setSyncing(false),200);
    }
  }
  useEffect(()=>{ loadOfficialReport(true); }, []);

  // Commissioner-only: update official snapshot (server fetches from ESPN & stores)
  async function updateOfficialSnapshot(){
    if(!espn.leagueId) return alert("Enter league & season first in League Settings.");
    setSyncing(true); setSyncPct(5); setSyncMsg("Commissioner update: building official snapshot…");
    try{
      const r = await fetch(API("/api/report/update"), {
        method: "POST",
        headers: { "Content-Type":"application/json", "x-admin": ADMIN_ENV },
        body: JSON.stringify({ leagueId: espn.leagueId, seasonId: espn.seasonId })
      });
      if(!r.ok){
        const t = await r.text().catch(()=> "");
        throw new Error(t || "Server rejected update");
      }
      setSyncPct(80); setSyncMsg("Loading new snapshot…");
      await loadOfficialReport(true);
      setSyncPct(100); setSyncMsg("Snapshot ready");
    } catch(e){
      alert(e.message || "Update failed.");
    } finally{
      setTimeout(()=>setSyncing(false), 300);
    }
  }

  /* ---- Views ---- */
  const views = {
    announcements: <AnnouncementsView {...{isAdmin,login,logout,data,setData,addAnnouncement,deleteAnnouncement}} espn={espn} seasonYear={seasonYear} />,
    weekly:       <WeeklyView {...{isAdmin,data,updateWeekly,seasonYear}} />,
    waivers: (
      <Section title="Waivers & Dues" actions={
        <div style={{display:"flex", gap:8}}>
          {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
          <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
          {isAdmin && <button className="btn" style={btnSec} onClick={()=>{ if(confirm("Reset waivers and announcements?")) setData(d=>({...d, announcements:[], waivers:[]})) }}>Reset Season</button>}
        </div>
      }>
        <div className="grid" style={{gridTemplateColumns:"1fr 1fr"}}>
          <div className="card" style={{padding:16}}>
            <h3>Members</h3>
            {isAdmin && <AddMember onAdd={addMember}/>}
            <ul style={{listStyle:"none",padding:0,margin:0}}>
              {data.members.map(m=>(
                <li key={m.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                  <span>{m.name}</span>
                  <span style={{fontSize:14,color:"#334155"}}>Tx (this week): {waiverCounts[m.id]||0} • Owes: ${waiverOwed[m.id]||0}</span>
                  {isAdmin && <button onClick={()=>deleteMember(m.id)} style={{color:"#dc2626",background:"transparent",border:"none",cursor:"pointer"}}>Remove</button>}
                </li>
              ))}
              {data.members.length===0 && <p style={{color:"#64748b"}}>Add members or import via ESPN.</p>}
            </ul>
          </div>

          <div className="card" style={{padding:16}}>
            {isAdmin ? (
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <h3>Log a Pickup</h3>
                  <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} seasonYear={seasonYear}/>
                </div>
                <WaiverForm members={data.members} onAdd={addWaiver} disabled={data.members.length===0} />
              </>
            ) : (
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <h3>Activity (Wed→Tue)</h3>
                <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} seasonYear={seasonYear}/>
              </div>
            )}

            <h4>History (selected week)</h4>
            <ul style={{listStyle:"none",padding:0,margin:0}}>
              {waiversThisWeek.map(w=>(
                <li key={w.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #e2e8f0",fontSize:14}}>
                  <span><b>{membersById[w.userId]?.name||"Unknown"}</b> picked up <b>{w.player}</b> on {w.date}</span>
                  {isAdmin && <button onClick={()=>deleteWaiver(w.id)} style={{color:"#dc2626",background:"transparent",border:"none",cursor:"pointer"}}>Delete</button>}
                </li>
              ))}
              {waiversThisWeek.length===0 && <p style={{color:"#64748b"}}>No activity this week.</p>}
            </ul>
          </div>
        </div>

        {espnReport && (
          <div className="card" style={{padding:12, marginTop:12, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <div>Official dues snapshot loaded. Last updated: <b>{lastSynced || "—"}</b></div>
            <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
          </div>
        )}
      </Section>
    ),
    dues: <DuesView report={espnReport} lastSynced={lastSynced} loadOfficialReport={loadOfficialReport} updateOfficialSnapshot={updateOfficialSnapshot} isAdmin={isAdmin} />,
    tx:   <TransactionsView report={espnReport} />,
    rosters: <Rosters leagueId={espn.leagueId} seasonId={espn.seasonId} />,
    settings: <SettingsView {...{isAdmin,espn,setEspn,importEspnTeams,data,setData}}/>,
    trading: <TradingView {...{isAdmin,addTrade,deleteTrade,data}}/>,
    polls:   <PollsView {...{isAdmin, members:data.members}}/>
  };

  return (
    <>
      <IntroSplash/>
      <div className="container">
        <div className="card app-shell" style={{overflow:"hidden"}}>
<aside
  className="sidebar"
  style={{
    padding: 20,
    background: "linear-gradient(180deg,#0b1220 0%, #0d1b3d 55%, #0b3b7b 100%)",
    color: "#eaf2ff",
    borderRight: "1px solid rgba(255,255,255,.08)"
  }}
>

            <div className="brand">
              <Logo size={96}/>
              <div className="brand-title">Blitzzz <span>Fantasy Football League</span></div>
            </div>
            <NavBtn id="announcements" label="📣 Announcements" active={active} onClick={setActive}/>
            <NavBtn id="weekly"       label="🗓 Weekly Challenges" active={active} onClick={setActive}/>
            <NavBtn id="waivers"      label="💵 Waivers" active={active} onClick={setActive}/>
            <NavBtn id="dues"         label="🧾 Dues" active={active} onClick={setActive}/>
            <NavBtn id="tx"           label="📜 Transactions" active={active} onClick={setActive}/>
            <NavBtn id="rosters"      label="📋 Rosters" active={active} onClick={setActive}/>
            <NavBtn id="settings"     label="⚙️ League Settings" active={active} onClick={setActive}/>
            <NavBtn id="trading"      label="🔁 Trading Block" active={active} onClick={setActive}/>
            <NavBtn id="polls"        label="🗳️ Polls" active={active} onClick={setActive}/>
            <div style={{marginTop:12}}>
              {isAdmin
                ? <button className="btn" style={btnSec} onClick={logout}>Commissioner Log out</button>
                : <button className="btn" style={btnPri} onClick={login}>Commissioner Login</button>}
            </div>
          </aside>
          <main style={{padding:24}}>
            {views[active]}
          </main>
        </div>
      </div>

      {/* Progress overlay */}
      <SyncOverlay open={syncing} pct={syncPct} msg={syncMsg} />
    </>
  );
}

/* =========================
   UI helpers/components
   ========================= */
function NavBtn({id,label,active,onClick}){
  const is = active===id;
  return (
    <button onClick={()=>onClick(id)}
      className={is? "nav-active" : ""}
      style={{display:"block", width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:12, margin:"6px 0", color:"#e2e8f0", background: is?"#1f2937":"transparent", border:"1px solid rgba(255,255,255,0.1)"}}>
      {label}
    </button>
  );
}
function Section({title, actions, children}){
  return (
    <div style={{minHeight:"70vh", display:"flex", flexDirection:"column"}}>
      <header style={{display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid #e2e8f0", paddingBottom:8, marginBottom:16}}>
        <h1 style={{fontSize:20, margin:0}}>{title}</h1>
        <div style={{display:"flex", gap:8}}>{actions}</div>
      </header>
      <div style={{flex:1}}>{children}</div>
    </div>
  );
}

/* ---- Announcements + Activity7 ---- */
function AnnouncementsView({isAdmin,login,logout,data,setData,addAnnouncement,deleteAnnouncement, espn, seasonYear}){
  useEffect(()=>{
    if (!data.weekly.weekLabel) {
      setData(d=>({...d, weekly:{...d.weekly, weekLabel: currentWeekLabel(seasonYear)}}));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonYear]);

  return (
    <Section title="Announcements" actions={
      <>
        {isAdmin ? <button className="btn" style={btnSec} onClick={logout}>Commissioner Log out</button> : <button className="btn" style={btnPri} onClick={login}>Commissioner Login</button>}
        <button className="btn" style={btnSec} onClick={()=>downloadCSV("league-data-backup.csv", [["Exported", new Date().toLocaleString()]],)}>Export</button>
      </>
    }>
      <Activity7 leagueId={espn.leagueId} seasonId={espn.seasonId} />
      {isAdmin && <AnnouncementEditor onPost={addAnnouncement}/>}
      <ul style={{display:"grid", gap:16}}>
        {data.announcements.length===0 && <p style={{color:"#64748b"}}>No announcements yet.</p>}
        {data.announcements.map(a=>(
          <li key={a.id} className="card" style={{padding:16}}>
            <div className="prose" dangerouslySetInnerHTML={{__html:a.html}}/>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:8,fontSize:12,color:"#64748b"}}>
              <span>{new Date(a.createdAt).toLocaleString()}</span>
              {isAdmin && <button onClick={()=>deleteAnnouncement(a.id)} style={{color:"#dc2626",background:"transparent",border:"none",cursor:"pointer"}}>Delete</button>}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
function Activity7({leagueId, seasonId}){
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [stats,setStats] = useState(null);
  async function refresh(){
    if(!leagueId) { setError("Set League ID & Season in League Settings."); return; }
    setError(""); setLoading(true);
    try{
      const teamJson = await fetchEspnJson({ leagueId, seasonId, view:"mTeam" });
      const idToName  = Object.fromEntries((teamJson?.teams||[]).map(t => [t.id, teamName(t)]));
      const allMoves = await fetchSeasonMovesAllSources({ leagueId, seasonId, maxSp: 10 });
      const cutoff = Date.now() - 7*24*60*60*1000;
      const recent = allMoves.filter(a => a.date.getTime() >= cutoff && a.action === "ADD");
      const counts = {};
      recent.forEach(a => { const n = idToName[a.teamId] || `Team ${a.teamId}`; counts[n]=(counts[n]||0)+1; });
      const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
      setStats({ total: recent.length, top });
    }catch(err){ setError(err.message || "Could not load ESPN activity."); }
    setLoading(false);
  }
  useEffect(()=>{ refresh(); }, [leagueId, seasonId]);

  return (
    <div className="card" style={{padding:12, marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <strong>Last 7 Days — Transactions</strong>
        <button className="btn" style={btnSec} onClick={refresh} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
      </div>
      {!leagueId && <div style={{color:"#64748b"}}>Set your ESPN details to see activity.</div>}
      {error && <div style={{color:"#dc2626"}}>{error}</div>}
      {stats && (
        <div style={{marginTop:6}}>
          <div style={{fontSize:14, color:"#64748b"}}>Adds: {stats.total}</div>
          <ul style={{margin:6, marginLeft:18}}>
            {stats.top.map(([name,count])=> <li key={name}>{name} — {count}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---- Polls ---- */
function PollsView({ isAdmin, members }){
  const [polls,setPolls]=useState([]);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");

  async function loadPolls(){
    setLoading(true); setErr("");
    try{
      const r = await fetch(API("/api/polls"));
      const j = await r.json();
      setPolls(j.polls || []);
    }catch(e){ setErr("Failed to load polls"); }
    setLoading(false);
  }
  useEffect(()=>{ loadPolls(); }, []);

  // Create poll
  const [createQ,setCreateQ]=useState(""); const [createOpts,setCreateOpts]=useState("Yes\nNo");
  async function createPoll(){
    const opts = createOpts.split("\n").map(s=>s.trim()).filter(Boolean);
    if(!createQ || opts.length<2) return alert("Enter a question and at least two options.");
    const r = await fetch(API("/api/polls/create"), {
      method:"POST",
      headers: {"Content-Type":"application/json","x-admin": ADMIN_ENV},
      body: JSON.stringify({ question:createQ, options:opts })
    });
    if(!r.ok) return alert("Create failed (commissioner only?)");
    setCreateQ(""); setCreateOpts("Yes\nNo");
    loadPolls();
  }

  // Code generator (short & readable)
  function makeCodeFactory(existing = []) {
    const used = new Set(existing.map(c => c.code?.toUpperCase?.() || c));
    const WORDS = [
      "MANGO","FALCON","TIGER","ORCA","BISON","HAWK","PANDA","EAGLE","MAPLE","CEDAR","ONYX","ZINC",
      "SAPPHIRE","COBALT","QUARTZ","NEON","NOVA","COMET","BOLT","BLITZ","STORM","GLACIER","RAPTOR",
      "VIPER","COUGAR","WOLF","SHARK","LYNX","OTTER","MOOSE","BEAR","FOX","RAVEN","ROBIN","DRAGON",
      "PHOENIX","ORBIT","ROCKET","ATLAS","APEX","DELTA","OMEGA","THUNDER","SURGE","WAVE","EMBER",
      "FROST","POLAR","COSMIC","SHADOW","AQUA","CRIMSON","IVORY","SAGE","INDIGO","AZURE","STEEL",
      "STONE","SPARROW","JAGUAR","PANTHER","RHINO"
    ];
    const slug = s => (s||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6) || "USER";
    return function makeCode(name){
      const base = slug(name);
      for (let tries = 0; tries < 200; tries++) {
        const word = WORDS[Math.floor(Math.random()*WORDS.length)];
        const code = `${base}-${word}`;
        if (!used.has(code)) { used.add(code); return code; }
      }
      const n = Math.floor(10 + Math.random()*90);
      return `${base}-${WORDS[0]}${n}`;
    };
  }

  async function generateCodes(pollId){
    if(members.length===0) return alert("Add/import members first.");
    const maker = makeCodeFactory();
    const codes = members.map(m => ({ name: m.name, code: maker(m.name) }));

    const r = await fetch(API("/api/polls/generate"), {
      method:"POST",
      headers: {"Content-Type":"application/json","x-admin": ADMIN_ENV},
      body: JSON.stringify({ pollId, codes })
    });
    if(!r.ok) return alert("Generate failed (commissioner only?)");

    const rows=[["Name","Code"], ...codes.map(c=>[c.name,c.code])];
    downloadCSV(`poll_${pollId}_codes.csv`, rows);
    loadPolls();
  }

  async function deletePoll(pollId){
    if(!confirm("Delete this poll? This removes its results and codes.")) return;
    const r = await fetch(API("/api/polls/delete"), {
      method:"POST",
      headers: {"Content-Type":"application/json","x-admin": ADMIN_ENV},
      body: JSON.stringify({ pollId })
    });
    if(!r.ok) return alert("Delete failed (commissioner only?)");
    setActivePollId("");
    loadPolls();
  }

  async function setClosed(pollId, closed){
    const r = await fetch(API("/api/polls/close"), {
      method:"POST",
      headers: {"Content-Type":"application/json","x-admin": ADMIN_ENV},
      body: JSON.stringify({ pollId, closed })
    });
    if(!r.ok) return alert("Failed to update poll.");
    loadPolls();
  }

  const [voteCode,setVoteCode]=useState(localStorage.getItem("ffl_vote_code")||"");
  const [voteChoice,setVoteChoice]=useState("");
  const [activePollId,setActivePollId]=useState("");
  useEffect(()=>{ if (polls.length>0 && !activePollId) setActivePollId(polls[0].id); }, [polls, activePollId]);
  async function castVote(){
    if(!activePollId) return alert("Choose a poll");
    if(!voteCode) return alert("Enter your code");
    if(!voteChoice) return alert("Select an option");
    const r = await fetch(API("/api/polls/vote"), {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ pollId: activePollId, code: voteCode, optionId: voteChoice })
    });
    if(r.status===409) return alert("That code was already used.");
    if(r.status===401) return alert("Invalid code.");
    if(r.status===423) return alert("This poll is closed.");
    if(!r.ok) return alert("Vote failed.");
    localStorage.setItem("ffl_vote_code", voteCode);
    alert("Vote recorded. Thanks!");
    loadPolls();
  }

  const [showClosed, setShowClosed] = useState(false);
  const visiblePolls = polls.length ? polls.filter(p => showClosed || !p.closed) : [];
  const poll = polls.find(p=>p.id===activePollId);

  return (
    <Section title="Polls" actions={
      isAdmin ? (
        <div className="card" style={{padding:8, display:"flex", gap:8, alignItems:"center"}}>
          <input className="input" placeholder="Question" value={createQ} onChange={e=>setCreateQ(e.target.value)} style={{width:260}}/>
          <textarea className="input" placeholder="One option per line" value={createOpts} onChange={e=>setCreateOpts(e.target.value)} style={{width:260, height:60}}/>
          <button className="btn" style={btnPri} onClick={createPoll}>Create Poll</button>
        </div>
      ) : <span className="badge">Enter your code to vote</span>
    }>
      {err && <p style={{color:"#dc2626"}}>{err}</p>}
      {loading && <p>Loading polls…</p>}
      {!loading && polls.length===0 && <p style={{color:"#64748b"}}>No polls yet.</p>}

      {polls.length>0 && (
        <div className="grid" style={{gridTemplateColumns:"240px 1fr", gap:16}}>
          <div className="card" style={{padding:12}}>
            <h3 style={{marginTop:0}}>Polls</h3>

            <div style={{margin:"6px 0 8px", fontSize:12, color:"#64748b"}}>
              <label>
                <input type="checkbox" checked={showClosed} onChange={e=>setShowClosed(e.target.checked)} /> Show closed polls
              </label>
            </div>

            <ul style={{listStyle:"none",padding:0,margin:0}}>
              {visiblePolls.map(p=>(
                <li key={p.id} style={{marginBottom:6}}>
                  <button className={`btn ${p.id===activePollId?"primary":""}`} style={p.id===activePollId?btnPri:btnSec} onClick={()=>setActivePollId(p.id)}>
                    {p.question} {p.closed? " (closed)":""}
                  </button>
                </li>
              ))}
              {visiblePolls.length===0 && <li style={{color:"#94a3b8"}}>No polls to show.</li>}
            </ul>
          </div>

          <div>
            {poll && (
              <div className="card" style={{padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <h3 style={{marginTop:0}}>{poll.question}</h3>
                  {isAdmin && (
                    <div style={{display:"flex", gap:8}}>
                      <button className="btn" style={btnSec} onClick={()=>generateCodes(poll.id)}>Generate Codes (CSV)</button>
                      {poll.closed
                        ? <button className="btn" style={btnSec} onClick={()=>setClosed(poll.id, false)}>Reopen</button>
                        : <button className="btn" style={btnSec} onClick={()=>setClosed(poll.id, true)}>Close</button>}
                      <button className="btn" style={{...btnSec, background:"#fee2e2", color:"#991b1b"}} onClick={()=>deletePoll(poll.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                <div className="card" style={{padding:12, background:"#f8fafc", marginBottom:12}}>
                  <div className="grid" style={{gridTemplateColumns:"1fr 1fr", gap:8}}>
                    <input className="input" placeholder="Enter your code" value={voteCode} onChange={e=>setVoteCode(e.target.value.toUpperCase())}/>
                    <select className="input" value={voteChoice} onChange={e=>setVoteChoice(e.target.value)}>
                      <option value="">Choose an option</option>
                      {poll.options.map(o=> <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                  <div style={{textAlign:"right", marginTop:8}}>
                    <button className="btn" style={btnPri} onClick={castVote} disabled={poll.closed}>Vote</button>
                  </div>
                </div>

                <h4>Results</h4>
                {poll.options.map(o=>{
                  const total = poll.options.reduce((s,x)=>s+x.votes,0) || 1;
                  const pct = Math.round(o.votes*100/total);
                  return (
                    <div key={o.id} style={{marginBottom:8}}>
                      <div style={{display:"flex", justifyContent:"space-between"}}>
                        <strong>{o.label}</strong>
                        <span>{o.votes} ({pct}%)</span>
                      </div>
                      <div style={{height:8, background:"#e5e7eb", borderRadius:999}}>
                        <div style={{width:`${pct}%`, height:8, borderRadius:999, background:"#0ea5e9"}} />
                      </div>
                    </div>
                  );
                })}
                <div style={{marginTop:8, fontSize:12, color:"#64748b"}}>
                  Codes used: {poll.codesUsed ?? "—"} / {poll.codesTotal ?? "—"}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ---- Editor pieces ---- */
function AnnouncementEditor({onPost}){
  const ref = React.useRef(null);
  const post = ()=>{ const html=ref.current?.innerHTML?.trim(); if(!html || html==="<br>") return alert("Type something first"); onPost(html); ref.current.innerHTML=""; };
  const exec = (cmd,val=null)=> document.execCommand(cmd,false,val);
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap", padding:8, border:"1px solid #e2e8f0", borderRadius:12, background:"#f8fafc"}}>
        <button onClick={()=>exec("bold")} className="btn" style={btnSec}>Bold</button>
        <button onClick={()=>exec("italic")} className="btn" style={btnSec}>Italic</button>
        <button onClick={()=>exec("insertUnorderedList")} className="btn" style={btnSec}>• List</button>
        <button onClick={()=>exec("formatBlock","h2")} className="btn" style={btnSec}>H2</button>
        <button onClick={()=>exec("createLink", prompt("Link URL:"))} className="btn" style={btnSec}>Link</button>
      </div>
      <div ref={ref} contentEditable className="card" style={{minHeight:120, padding:12, marginTop:8}}></div>
      <div style={{textAlign:"right", marginTop:8}}><button className="btn" style={btnPri} onClick={post}>Post Announcement</button></div>
    </div>
  );
}
function TradeForm({onSubmit}){
  const [player,setPlayer]=useState(""); const [position,setPosition]=useState(""); const [owner,setOwner]=useState(""); const [notes,setNotes]=useState("");
  return (
    <form onSubmit={(e)=>{e.preventDefault(); if(!player) return; onSubmit({player,position,owner,notes}); setPlayer(""); setPosition(""); setOwner(""); setNotes("");}} className="card" style={{padding:16, background:"#f8fafc", marginBottom:12}}>
      <div className="grid" style={{gridTemplateColumns:"1fr 1fr 1fr"}}>
        <input className="input" placeholder="Player" value={player} onChange={e=>setPlayer(e.target.value)}/>
        <input className="input" placeholder="Position (e.g., WR)" value={position} onChange={e=>setPosition(e.target.value)}/>
        <input className="input" placeholder="Owner" value={owner} onChange={e=>setOwner(e.target.value)}/>
      </div>
      <input className="input" placeholder="Notes" style={{marginTop:8}} value={notes} onChange={e=>setNotes(e.target.value)}/>
      <div style={{textAlign:"right", marginTop:8}}><button className="btn" style={btnPri}>Add to Block</button></div>
    </form>
  );
}
function WeeklyEditor({weekly,onChange,adminMode}){
  const [text,setText]=useState(weekly.text); const [weekLabel,setWeekLabel]=useState(weekly.weekLabel); const [deadline,setDeadline]=useState(weekly.deadline||"");
  useEffect(()=>{ setText(weekly.text); setWeekLabel(weekly.weekLabel); setDeadline(weekly.deadline||""); }, [weekly]);
  return (
    <div className="grid" style={{gap:12}}>
      {adminMode && (
        <div className="card" style={{padding:16, background:"#f8fafc"}}>
          <div className="grid" style={{gridTemplateColumns:"1fr 1fr", gap:12}}>
            <input className="input" placeholder="Week label (e.g., Week 3)" value={weekLabel} onChange={e=>setWeekLabel(e.target.value)}/>
            <input className="input" placeholder="Deadline (optional)" value={deadline} onChange={e=>setDeadline(e.target.value)}/>
          </div>
          <textarea className="input" style={{minHeight:120, marginTop:8}} placeholder="Describe this week's challenge..." value={text} onChange={e=>setText(e.target.value)}/>
          <div style={{textAlign:"right", marginTop:8}}><button className="btn" style={btnPri} onClick={()=> onChange({ text, weekLabel, deadline })}>Save</button></div>
        </div>
      )}
      <div className="card" style={{padding:16}}>
        <h3 style={{marginTop:0}}>{weekLabel || "Current Challenge"}</h3>
        {deadline && <p style={{fontSize:14, color:"#64748b"}}>Deadline: {deadline}</p>}
        {text ? <p style={{whiteSpace:"pre-wrap"}}>{text}</p> : <p style={{color:"#64748b"}}>No challenge posted yet.</p>}
      </div>
    </div>
  );
}
function AddMember({onAdd}){ const [name,setName]=useState(""); return (
  <form onSubmit={(e)=>{e.preventDefault(); if(!name) return; onAdd(name); setName("");}} style={{display:"flex", gap:8, margin:"8px 0 12px"}}>
    <input className="input" placeholder="Member name" value={name} onChange={e=>setName(e.target.value)}/>
    <button className="btn" style={btnPri}>Add</button>
  </form>
); }
function WaiverForm({members,onAdd,disabled}){ const [userId,setUserId]=useState(members[0]?.id||""); const [player,setPlayer]=useState(""); const [date,setDate]=useState(today());
  useEffect(()=>{ setUserId(members[0]?.id||""); }, [members]);
  return (
    <form onSubmit={(e)=>{e.preventDefault(); if(!userId||!player) return; onAdd(userId,player,date); setPlayer("");}} className="grid" style={{gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:8}}>
      <select className="input" value={userId} onChange={e=>setUserId(e.target.value)} disabled={disabled}>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <input className="input" placeholder="Player" value={player} onChange={e=>setPlayer(e.target.value)} disabled={disabled}/>
      <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={disabled}/>
      <div style={{gridColumn:"1 / -1", textAlign:"right"}}><button className="btn" style={btnPri} disabled={disabled}>Add Pickup</button></div>
    </form>
  );
}

/* ---- Dues view ---- */
function DuesView({ report, lastSynced, loadOfficialReport, updateOfficialSnapshot, isAdmin }){
  return (
    <Section title="Dues (Official Snapshot)" actions={
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <button className="btn" style={btnSec} onClick={()=>loadOfficialReport(false)}>Refresh Snapshot</button>
        {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
        <button className="btn" style={btnSec} onClick={()=>print()}>Print</button>
        {report && <>
          <button className="btn" style={btnSec} onClick={()=>{
            const rows=[["Team","Adds","Owes"], ...report.totalsRows.map(r=>[r.name,r.adds,`$${r.owes}`])];
            downloadCSV("dues_totals.csv", rows);
          }}>Download CSV (totals)</button>
          <button className="btn" style={btnSec} onClick={()=>{
            const rows=[["Week","Range","Team","Adds","Owes"]];
            report.weekRows.forEach(w=> w.entries.forEach(e=> rows.push([w.week,w.range,e.name,e.count,`$${e.owes}`])));
            downloadCSV("dues_by_week.csv", rows);
          }}>Download CSV (by week)</button>
          <button className="btn" style={btnSec} onClick={()=>{
            const rows=[["Date (PT)","Week","Range","Team","Player","Action","Method","Source","PlayerId"]];
            (report.rawMoves||[]).forEach(r=> rows.push([r.date, r.week, r.range, r.team, r.player, r.action, r.method, r.source, r.playerId]));
            downloadCSV("raw_events.csv", rows);
          }}>Download raw events</button>
        </>}
      </div>
    }>
      <p style={{marginTop:-8, color:"#64748b"}}>Last updated: <b>{lastSynced || "—"}</b>. Rule: first two transactions per Wed→Tue week are free, then $5 each.</p>
      {!report && <p style={{color:"#64748b"}}>No snapshot yet — Commissioner should click <b>Update Official Snapshot</b>.</p>}
      {report && (
        <div className="grid" style={{gridTemplateColumns:"1fr 1fr", gap:24}}>
          <div>
            <h3>Season to Date</h3>
            <table style={{width:"100%", borderCollapse:"collapse"}}>
              <thead><tr><th style={th}>Team</th><th style={th}>Adds</th><th style={th}>Owes</th></tr></thead>
              <tbody>
                {report.totalsRows.map(r=>(
                  <tr key={r.name}><td style={td}>{r.name}</td><td style={td}>{r.adds}</td><td style={td}>${r.owes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>By Week (Wed→Tue, cutoff Tue 11:59 PM PT)</h3>
            {report.weekRows.map(w=>(
              <div key={w.week} style={{marginBottom:12}}>
                <div style={{fontWeight:600, margin:"6px 0"}}>Week {w.week} — {w.range}</div>
                <table style={{width:"100%", borderCollapse:"collapse"}}>
                  <thead><tr><th style={th}>Team</th><th style={th}>Adds</th><th style={th}>Owes</th></tr></thead>
                  <tbody>
                    {w.entries.map(e=>(
                      <tr key={e.name}><td style={td}>{e.name}</td><td style={td}>{e.count}</td><td style={td}>${e.owes}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ---- Transactions ---- */
function TransactionsView({ report }){
  if (!report) {
    return (
      <Section title="Transactions">
        <p style={{color:"#64748b"}}>No snapshot yet — go to <b>Dues</b> and click <b>Refresh Snapshot</b> (or have the commissioner update it).</p>
      </Section>
    );
  }

  const SHOW_METHOD_COLUMN = true;
  const METHOD_FOR_ADDS_ONLY = true;

  const all = report.rawMoves || report.rawAdds || [];
  const teams = Array.from(new Set(all.map(r => r.team))).sort();

  const [team, setTeam] = useState("");
  const [method, setMethod] = useState(""); // WAIVER / FA
  const [action, setAction] = useState(""); // ADD / DROP
  const [q, setQ] = useState("");

  const filtered = all.filter(r =>
    (!team || r.team === team) &&
    (!action || r.action === action) &&
    (!method || r.method === method) &&
    (!q || (r.player?.toLowerCase().includes(q.toLowerCase()) || r.team.toLowerCase().includes(q.toLowerCase())))
  );

  const weeksSorted = Array.from(new Set(filtered.map(r => r.week))).sort((a, b) => a - b);
  const rangeByWeek = {};
  for (const r of filtered) if (!rangeByWeek[r.week]) rangeByWeek[r.week] = r.range;

  const byWeek = new Map();
  for(const r of filtered){
    if(!byWeek.has(r.week)) byWeek.set(r.week, []);
    byWeek.get(r.week).push(r);
  }

  const [openWeeks, setOpenWeeks] = useState(() => new Set(weeksSorted));
  useEffect(() => { setOpenWeeks(new Set(weeksSorted)); }, [q, team, method, action]);
  const toggleWeek = (w)=> setOpenWeeks(s => { const n=new Set(s); n.has(w)?n.delete(w):n.add(w); return n; });

  return (
    <Section title="Transactions" actions={
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <select className="input" value={team} onChange={e=>setTeam(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" value={action} onChange={e=>setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="ADD">ADD</option>
          <option value="DROP">DROP</option>
        </select>
        <select className="input" value={method} onChange={e=>setMethod(e.target.value)}>
          <option value="">All methods</option>
          <option value="WAIVER">WAIVER</option>
          <option value="FA">FA</option>
        </select>
        <input className="input" placeholder="Search player/team…" value={q} onChange={e=>setQ(e.target.value)} />
        <button className="btn" style={btnSec} onClick={()=>setOpenWeeks(new Set(weeksSorted))}>Expand all</button>
        <button className="btn" style={btnSec} onClick={()=>setOpenWeeks(new Set())}>Collapse all</button>
        <button className="btn" style={btnSec} onClick={()=>{
          const rows=[["Date (PT)","Week","Range","Team","Player","Action", ...(SHOW_METHOD_COLUMN?["Method"]:[]), "Source","PlayerId"]];
          filtered.forEach(r=> rows.push([
            r.date, r.week, r.range, r.team, r.player, r.action,
            ...(SHOW_METHOD_COLUMN ? [ (METHOD_FOR_ADDS_ONLY && r.action==="DROP") ? "" : r.method ] : []),
            r.source, r.playerId
          ]));
          downloadCSV("transactions_filtered.csv", rows);
        }}>Download CSV (filtered)</button>
      </div>
    }>
      {weeksSorted.length === 0 && (
        <p style={{color:"#64748b"}}>No transactions match your filters.</p>
      )}

      {weeksSorted.map(week => {
        const rows = byWeek.get(week) || [];
        const open = openWeeks.has(week);
        return (
          <div key={week} className="card" style={{padding:12, marginBottom:12}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer"}}
                 onClick={()=>toggleWeek(week)}>
              <div style={{display:"flex", alignItems:"center", gap:8}}>
                <span style={{fontWeight:700}}>Week {week}</span>
                <span style={{color:"#64748b"}}>{rangeByWeek[week] || ""}</span>
              </div>
              <span style={{color:"#64748b"}}>{open ? "Hide ▲" : "Show ▼"}</span>
            </div>
            {open && (
              <div style={{marginTop:8, overflowX:"auto"}}>
                <table style={{width:"100%", borderCollapse:"collapse"}}>
                  <thead>
                    <tr>
                      <th style={th}>Date (PT)</th>
                      <th style={th}>Team</th>
                      <th style={th}>Player</th>
                      <th style={th}>Action</th>
                      {SHOW_METHOD_COLUMN && <th style={th}>Method</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r,i)=>(
                      <tr key={i}>
                        <td style={td}>{r.date}</td>
                        <td style={td}>{r.team}</td>
                        <td style={{ ...td, color: r.action==="ADD" ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                          {r.player || (r.playerId ? `#${r.playerId}` : "—")}
                        </td>
                        <td style={td}>{r.action}</td>
                        {SHOW_METHOD_COLUMN && (
                          <td style={td}>
                            {(METHOD_FOR_ADDS_ONLY && r.action === "DROP") ? "" : (r.method || "")}
                          </td>
                        )}
                      </tr>
                    ))}
                    {rows.length===0 && (
                      <tr><td style={td} colSpan={SHOW_METHOD_COLUMN ? 5 : 4}>&nbsp;No transactions in this week.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

/* ---- Rosters ---- */
function Rosters({ leagueId, seasonId }){
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [teams,setTeams] = useState([]);
  useEffect(()=>{ if(!leagueId) return;
    (async ()=>{
      setLoading(true); setError("");
      try{
        const [teamJson, rosJson, setJson] = await Promise.all([
          fetchEspnJson({ leagueId, seasonId, view:"mTeam" }),
          fetchEspnJson({ leagueId, seasonId, view:"mRoster" }),
          fetchEspnJson({ leagueId, seasonId, view:"mSettings" }),
        ]);
        const teamsById = Object.fromEntries((teamJson?.teams||[]).map(t => [t.id, teamName(t)]));
        const slotMap = slotIdToName(setJson?.settings?.rosterSettings?.lineupSlotCounts || {});
        const items = (rosJson?.teams||[]).map(t => {
          const entries = (t.roster?.entries||[]).map(e => {
            const p = e.playerPoolEntry?.player;
            const fullName = p?.fullName || "Player";
            const pos = posIdToName(p?.defaultPositionId);
            const slot = slotMap[e.lineupSlotId] || "—";
            return { name: fullName, pos, slot };
          });
          return { teamName: teamsById[t.id] || `Team ${t.id}`, entries };
        }).sort((a,b)=> a.teamName.localeCompare(b.teamName));
        setTeams(items);
      }catch{ setError("Failed to load rosters."); }
      setLoading(false);
    })();
  }, [leagueId, seasonId]);

  return (
    <Section title="Rosters" actions={<span className="badge">View-only (ESPN live)</span>}>
      {!leagueId && <p style={{color:"#64748b"}}>Set your ESPN League ID & Season in <b>League Settings</b>.</p>}
      {loading && <p>Loading rosters…</p>}
      {error && <p style={{color:"#dc2626"}}>{error}</p>}
      <div className="grid" style={{gridTemplateColumns:"1fr 1fr"}}>
        {teams.map(team => (
          <div key={team.teamName} className="card" style={{padding:16}}>
            <h3 style={{marginTop:0}}>{team.teamName}</h3>
            <ul style={{margin:0,paddingLeft:16}}>
              {team.entries.map((e,i)=> <li key={i}><b>{e.slot}</b> — {e.name} ({e.pos})</li>)}
            </ul>
          </div>
        ))}
      </div>
      {!loading && teams.length===0 && leagueId && <p style={{color:"#64748b"}}>No roster data yet (pre-draft?).</p>}
    </Section>
  );
}

/* ---- Misc helpers ---- */
function posIdToName(id){ const map={0:"QB",1:"TQB",2:"RB",3:"RB",4:"WR",5:"WR/TE",6:"TE",7:"OP",8:"DT",9:"DE",10:"LB",11:"DE",12:"DB",13:"DB",14:"DP",15:"D/ST",16:"D/ST",17:"K"}; return map?.[id] || "—"; }
function slotIdToName(counts){ const map={0:"QB",2:"RB",3:"RB/WR",4:"WR",5:"WR/TE",6:"TE",7:"OP",16:"D/ST",17:"K",20:"Bench",21:"IR",23:"FLEX",24:"EDR",25:"RDP",26:"RDP",27:"RDP",28:"Head Coach"}; const res={}; Object.keys(counts).forEach(k=> res[k] = map[k] || `Slot ${k}`); return res; }
function WeekSelector({ selectedWeek, setSelectedWeek, seasonYear }) {
  const go = (delta)=> {
    const s = new Date(selectedWeek.start);
    s.setDate(s.getDate() + delta*7);
    setSelectedWeek(leagueWeekOf(s, seasonYear));
  };
  const nowJump = () => {
    const w = leagueWeekOf(new Date(), seasonYear);
    const anchor = leagueWeekOf(firstWednesdayOfSeptemberPT(seasonYear), seasonYear);
    setSelectedWeek(w.week > 0 ? w : anchor);
  };
  const label = selectedWeek.week>0 ? `Week ${selectedWeek.week} (Wed→Tue)` : `Preseason (Wed→Tue)`;
  return (
    <div style={{display:"flex", alignItems:"center", gap:8}}>
      <button type="button" className="btn" style={btnSec} aria-label="Previous week" onClick={()=>go(-1)}>◀</button>
      <span style={{fontSize:14,color:"#334155",minWidth:170,textAlign:"center"}}>{label}</span>
      <button type="button" className="btn" style={btnSec} aria-label="Next week" onClick={()=>go(1)}>▶</button>
      <button type="button" className="btn" style={btnSec} onClick={nowJump}>This Week</button>
    </div>
  );
}
function SettingsView({isAdmin,espn,setEspn,importEspnTeams,data,setData}){
  const actions = isAdmin ? (
    <div style={{display:"flex", gap:8, alignItems:"center"}}>
      <input className="input" placeholder="ESPN League ID"
             value={espn.leagueId} onChange={e=>setEspn({...espn, leagueId:e.target.value})} style={{width:160}}/>
      <input className="input" placeholder="Season"
             value={espn.seasonId} onChange={e=>setEspn({...espn, seasonId:e.target.value})} style={{width:120}}/>
      <button className="btn" style={btnPri} onClick={importEspnTeams}>Import ESPN Teams</button>
    </div>
  ) : (
    <span className="badge">Commissioner only</span>
  );
  return (
    <Section title="League Settings" actions={actions}>
      <RichEditor html={data.leagueSettingsHtml}
                  setHtml={html=> setData(d=>({...d, leagueSettingsHtml: html}))}
                  readOnly={!isAdmin}/>
    </Section>
  );
}
function TradingView({isAdmin,addTrade,deleteTrade,data}){
  return (
    <Section title="Trading Block">
      {isAdmin && <TradeForm onSubmit={addTrade}/>}
      <div className="grid">
        {data.tradeBlock.length===0 && <p style={{color:"#64748b"}}>Nothing on the block yet.</p>}
        {data.tradeBlock.map(t=>(
          <div key={t.id} className="card" style={{padding:16}}>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,fontSize:14,alignItems:"center"}}>
              <span style={{background:"#f1f5f9",padding:"2px 8px",borderRadius:999}}>{t.position||"PLAYER"}</span>
              <strong>{t.player}</strong>
              <span style={{color:"#64748b"}}>• Owner: {t.owner||"—"}</span>
              <span style={{marginLeft:"auto", color:"#94a3b8"}}>{new Date(t.createdAt).toLocaleDateString()}</span>
            </div>
            {t.notes && <p style={{marginTop:8, whiteSpace:"pre-wrap"}}>{t.notes}</p>}
            {isAdmin && <div style={{textAlign:"right", marginTop:8}}><button className="btn" style={{...btnSec, background:"#fee2e2", color:"#991b1b"}} onClick={()=>deleteTrade(t.id)}>Remove</button></div>}
          </div>
        ))}
      </div>
    </Section>
  );
}
function WeeklyView({isAdmin,data,updateWeekly,seasonYear}){
  return (
    <Section title="Weekly Challenges">
      <WeeklyEditor weekly={{
        ...data.weekly,
        weekLabel: data.weekly.weekLabel || currentWeekLabel(seasonYear)
      }} onChange={updateWeekly} adminMode={isAdmin}/>
    </Section>
  );
}
function RichEditor({ html, setHtml, readOnly }) {
  const [local, setLocal] = useState(html || "");
  useEffect(() => { setLocal(html || ""); }, [html]);
  if (readOnly) {
    return (
      <div className="card" style={{padding:16}}>
        <div className="prose" dangerouslySetInnerHTML={{ __html: local || "<p>No settings yet.</p>" }} />
      </div>
    );
  }
  return (
    <div className="card" style={{padding:16, background:"#f8fafc"}}>
      <textarea className="input" style={{minHeight:160}} value={local}
        onChange={e=>setLocal(e.target.value)} />
      <div style={{fontSize:12,color:"#64748b",marginTop:8}}>
        Tip: This box accepts HTML (e.g., &lt;ul&gt;...&lt;/ul&gt; for lists).
      </div>
      <div style={{textAlign:"right", marginTop:8}}>
        <button className="btn" style={btnPri} onClick={()=> setHtml(local)}>Save</button>
      </div>
    </div>
  );
}

/* ---- Splash ---- */
function IntroSplash(){
  const [show,setShow] = useState(true);
  useEffect(()=>{ const t=setTimeout(()=>setShow(false), 1600); return ()=>clearTimeout(t); }, []);
  if(!show) return null;
  return <div className="splash"><Logo size={160}/></div>;
}

/* ---- Sync overlay ---- */
function SyncOverlay({ open, pct, msg }) {
  if (!open) return null;
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(15,23,42,0.55)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
    }}>
      <div className="card" style={{ width:420, padding:16, background:"#0b1220", color:"#e2e8f0", border:"1px solid #1f2937" }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Working…</div>
        <div style={{ fontSize:12, color:"#93a3b8", minHeight:18 }}>{msg}</div>
        <div style={{ height:10, background:"#0f172a", borderRadius:999, marginTop:10, overflow:"hidden", border:"1px solid #1f2937" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:"#38bdf8" }} />
        </div>
        <div style={{ textAlign:"right", fontSize:12, marginTop:6 }}>{pct}%</div>
      </div>
    </div>
  );
}
