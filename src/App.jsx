// src/App.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import Logo from "./Logo.jsx";

function useStored(key, initial=""){
  const [v,setV] = React.useState(()=> localStorage.getItem(key) ?? initial);
  React.useEffect(()=> localStorage.setItem(key, v ?? ""), [key,v]);
  return [v,setV];
}

/* =========================
   Global Config
   ========================= */
const ADMIN_ENV = import.meta.env.VITE_ADMIN_PASSWORD || "changeme";
const DEFAULT_LEAGUE_ID = import.meta.env.VITE_ESPN_LEAGUE_ID || "";
const DEFAULT_SEASON   = import.meta.env.VITE_ESPN_SEASON || new Date().getFullYear();
const LEAGUE_TZ = "America/Los_Angeles";
const WEEK_START_DAY = 3;

const API = (p) => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `http://localhost:8787${p}`;
  }
  return p;
};

const ROASTS = [
  "Wrong again, champ. Try reading the group chat for once.",
  "Nope. That password works as well as your draft strategy.",
  "Access denied. Maybe ask your QB for a hint.",
  "Incorrect. Bench that attempt and try a new play.",
  "That wasn't it. You've fumbled the bag, my friend.",
  "Denied. Consider a timeout for reflection.",
  "Close… in the same way you were close to making playoffs.",
  "Negative, ghost rider. Pattern not approved.",
  "Nah. That password is as washed as last year's team.",
  "Still wrong. Maybe trade for a brain cell?",
  "Nope. You're tilting and it shows.",
  "That's a miss. Like your waiver claims at 12:02 AM.",
  "False start. Five-yard penalty. Try again.",
  "No dice. Respectfully, touch grass and refocus.",
  "Incorrect. Even auto-draft does better than this.",
  "Denied. Did you try caps lock, coach?",
  "Buddy… no. That password couldn't beat a bye week.",
  "You whiffed. Like a kicker in a hurricane.",
  "Nah. Your attempt got vetoed by the league.",
  "Wrong. This ain't daily fantasy—no mulligans here.",
  "That's a brick. Free throws might be more your sport.",
  "Out of bounds. Re-enter with something sensible.",
  "Nope. Your intel source is clearly that one guy.",
  "Denied. That guess belongs on the waiver wire.",
  "Wrong. You're running the kneel-down offense.",
  "Not even close. Did your cat type that?",
  "Flag on the play: illegal password formation.",
  "Interception. Defense takes it the other way.",
  "You've been sacked. 3rd and long—try again.",
  "Still wrong. This isn't the Hail Mary you hoped for."
];

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

const SHOW_PER_POLL_CODES = false;

function toPT(d){ return new Date(d.toLocaleString("en-US", { timeZone: LEAGUE_TZ })); }
function startOfLeagueWeekPT(date){
  const z = toPT(date);
  const base = new Date(z); base.setHours(0,0,0,0);
  const dow = base.getDay();
  const back = (dow - WEEK_START_DAY + 7) % 7;
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

export default function App(){ return <LeagueHub/> }

function LeagueHub(){
  useEffect(()=>{ document.title = "Blitzzz Fantasy Football League"; }, []);

  const VALID_TABS = [
    "announcements","activity","weekly","waivers","dues",
    "transactions","rosters","settings","trading","polls"
  ];

  const initialTabFromHash = () => {
    const h = (window.location.hash || "").replace("#","").trim();
    return VALID_TABS.includes(h) ? h : "activity";
  };

  const [active, setActive] = useState(initialTabFromHash);

  useEffect(() => {
    const onHash = () => {
      const h = (window.location.hash || "").replace("#","").trim();
      setActive(VALID_TABS.includes(h) ? h : "activity");
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const want = `#${active}`;
    if (window.location.hash !== want) window.location.hash = want;
  }, [active]);

  const STORAGE_KEY = "ffl_hub_data_v1";
  
  function load(){
    const defaultData = {};
    try {
      const raw = localStorage.getItem("ffl_hub_data_v1");
      const data = raw ? { ...defaultData, ...JSON.parse(raw) } : defaultData;
      return data;
    } catch {
      return defaultData;
    }
  }

  const [data,setData]=useState(load);

  // Server-side state
  const [members, setMembers] = useState([]);
  const [waivers, setWaivers] = useState([]);
  const [buyins, setBuyins] = useState({});
  const [leagueSettingsHtml, setLeagueSettingsHtml] = useState("");

  // Load server-side data
  const loadServerData = async () => {
    try {
      const response = await fetch(API('/api/league-data'));
      if (response.ok) {
        const serverData = await response.json();
        setMembers(serverData.members || []);
        setWaivers(serverData.waivers || []);
        setBuyins(serverData.buyins || {});
        setLeagueSettingsHtml(serverData.leagueSettingsHtml || "<h2>League Settings</h2><ul><li>Scoring: Standard</li><li>Transactions counted from <b>Wed 12:00 AM PT → Tue 11:59 PM PT</b>; first two are free, then $5 each.</li></ul>");
      }
    } catch (err) {
      console.error("Failed to load server data:", err);
    }
  };

  useEffect(() => { loadServerData(); }, []);

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

  const membersById = useMemo(()=>Object.fromEntries(members.map(m=>[m.id,m])),[members]);

  // Manual waivers (count within Wed→Tue)
  const weekKey = weekKeyFrom(selectedWeek);
  const waiversThisWeek = useMemo(
    () => waivers.filter(w => weekKeyFrom(leagueWeekOf(new Date(w.date), seasonYear)) === weekKey),
    [waivers, weekKey, seasonYear]
  );
  const waiverCounts = useMemo(()=>{ const c={}; waiversThisWeek.forEach(w=>{ c[w.userId]=(c[w.userId]||0)+1 }); return c; }, [waiversThisWeek]);
  const waiverOwed = useMemo(()=>{ const owed={}; for(const m of members){ const count=waiverCounts[m.id]||0; owed[m.id]=Math.max(0,count-2)*5 } return owed; }, [members, waiverCounts]);

  // Server-side CRUD operations
  const addMember = async (name) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/members'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ name })
      });
      if (response.ok) await loadServerData();
    } catch (err) {
      alert("Failed to add member: " + err.message);
    }
  };
  
  const deleteMember = async (id) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/members'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ id })
      });
      if (response.ok) await loadServerData();
    } catch (err) {
      alert("Failed to delete member: " + err.message);
    }
  };

  const addWaiver = async (userId, player, date) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/waivers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ userId, player, date: date || today() })
      });
      if (response.ok) await loadServerData();
    } catch (err) {
      alert("Failed to add waiver: " + err.message);
    }
  };

  const deleteWaiver = async (id) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/waivers'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ id })
      });
      if (response.ok) await loadServerData();
    } catch (err) {
      alert("Failed to delete waiver: " + err.message);
    }
  };

  // Import ESPN teams (server-side)
  const importEspnTeams = async ()=>{
    if(!espn.leagueId) return alert("Enter League ID");
    if (!isAdmin) return alert("Admin access required");
    
    try{
      const json = await fetchEspnJson({ leagueId: espn.leagueId, seasonId: espn.seasonId, view: "mTeam" });
      const teams = json?.teams || [];
      if(!Array.isArray(teams) || teams.length===0) return alert("No teams found (check ID/season).");
      
      const names = [...new Set(teams.map(t => teamName(t)))];
      
      const response = await fetch(API('/api/league-data/import-teams'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ teams: names })
      });
      
      if (response.ok) {
        await loadServerData();
        alert(`Imported ${names.length} teams.`);
      } else {
        throw new Error('Failed to import teams');
      }
    } catch(e){ 
      alert(e.message || "ESPN fetch failed. Check League/Season."); 
    }
  };

  // Trading block server-side operations
  const addTrade = async (t) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/trading'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ trade: t })
      });
      if (!response.ok) throw new Error('Failed to add trade');
    } catch (err) {
      alert("Failed to add trade: " + err.message);
    }
  };

  const deleteTrade = async (id) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/trading'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ id })
      });
      if (!response.ok) throw new Error('Failed to delete trade');
    } catch (err) {
      alert("Failed to delete trade: " + err.message);
    }
  };

  // Update buy-ins server-side
  const updateBuyins = async (seasonKey, updates) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/buyins'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ seasonKey, updates })
      });
      if (response.ok) await loadServerData();
    } catch (err) {
      alert("Failed to update buy-ins: " + err.message);
    }
  };

  // League settings server-side
  const updateLeagueSettings = async (html) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ html })
      });
      if (response.ok) {
        setLeagueSettingsHtml(html);
        alert("League Settings Saved!");
      }
    } catch (err) {
      alert("Failed to save league settings: " + err.message);
    }
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
      const r = await fetch(API(`/api/report?seasonId=${espn.seasonId}`));

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

 async function updateOfficialSnapshot(){
  if(!espn.leagueId) return alert("Enter league & season first in League Settings.");

  const jobId = `job_${Date.now()}`;
  setSyncing(true); setSyncPct(1); setSyncMsg("Starting…");

  let alive = true;
  const tick = async () => {
    try{
      const r = await fetch(API(`/api/progress?jobId=${jobId}`));
      const j = await r.json();
      if (j && typeof j.pct === "number") {
        setSyncPct(j.pct);
        if (j.msg) setSyncMsg(j.msg);
      }
    }catch{}
    if (alive) setTimeout(tick, 400);
  };
  tick();

  try{
    const r = await fetch(API(`/api/report/update?jobId=${jobId}`), {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-admin": ADMIN_ENV },
      body: JSON.stringify({ leagueId: espn.leagueId, seasonId: espn.seasonId })
    });
    if(!r.ok){
      const t = await r.text().catch(()=> "");
      throw new Error(t || "Server rejected update");
    }
    await loadOfficialReport(true);
    setSyncPct(100); setSyncMsg("Snapshot ready");
  } catch(e){
    alert(e.message || "Update failed.");
  } finally{
    alive = false;
    setTimeout(()=>setSyncing(false), 300);
  }
}

  /* ---- Views ---- */
  const views = {
    announcements: <AnnouncementsView {...{isAdmin,login,logout}} espn={espn} seasonYear={seasonYear} />,
    weekly: <WeeklyView {...{isAdmin,seasonYear}} />,
    activity: <RecentActivityView espn={espn} />,
    waivers: (
      <WaiversView 
        isAdmin={isAdmin}
        members={members}
        waivers={waivers}
        waiversThisWeek={waiversThisWeek}
        waiverCounts={waiverCounts}
        waiverOwed={waiverOwed}
        membersById={membersById}
        selectedWeek={selectedWeek}
        setSelectedWeek={setSelectedWeek}
        seasonYear={seasonYear}
        addMember={addMember}
        deleteMember={deleteMember}
        addWaiver={addWaiver}
        deleteWaiver={deleteWaiver}
        updateOfficialSnapshot={updateOfficialSnapshot}
        setActive={setActive}
        espnReport={espnReport}
        lastSynced={lastSynced}
        loadServerData={loadServerData}
      />
    ),
    dues: <DuesView
      report={espnReport}
      lastSynced={lastSynced}
      loadOfficialReport={loadOfficialReport}
      updateOfficialSnapshot={updateOfficialSnapshot}
      isAdmin={isAdmin}
      members={members}
      buyins={buyins}
      updateBuyins={updateBuyins}
      seasonYear={seasonYear}
    />,
    transactions: <TransactionsView report={espnReport} />,
    rosters: <Rosters leagueId={espn.leagueId} seasonId={espn.seasonId} />,
    settings: <SettingsView {...{isAdmin,espn,setEspn,importEspnTeams,leagueSettingsHtml,updateLeagueSettings}}/>,
    trading: <TradingView {...{isAdmin,addTrade,deleteTrade}}/>,
    polls: <PollsView {...{isAdmin, members, espn}}/>
  };

  return (
    <>
      <IntroSplash/>
      <div className="container">
        <div className="card app-shell" style={{overflow:"auto"}}>
          <aside className="sidebar" style={{ padding: 20, background: "linear-gradient(180deg, #0b2e4a 0%, #081a34 100%)", color: "#e2e8f0" }}>
            <div className="brand">
              <Logo size={96}/>
              <div className="brand-title">Blitzzz <span>Fantasy Football League</span></div>
            </div>
            <NavBtn id="announcements" label="📣 Announcements" active={active} onClick={setActive}/>
            <NavBtn id="weekly" label="🗓 Weekly Challenges" active={active} onClick={setActive}/>
            <NavBtn id="activity" label="⏱️ Recent Activity" active={active} onClick={setActive}/> 
            <NavBtn id="waivers" label="💵 Waivers" active={active} onClick={setActive}/>
            <NavBtn id="dues" label="🧾 Dues" active={active} onClick={setActive}/>
            <NavBtn id="transactions" label="📜 Transactions" active={active} onClick={setActive}/>
            <NavBtn id="rosters" label="📋 Rosters" active={active} onClick={setActive}/>
            <NavBtn id="settings" label="⚙️ League Settings" active={active} onClick={setActive}/>
            <NavBtn id="trading" label="🔁 Trading Block" active={active} onClick={setActive}/>
            <NavBtn id="polls" label="🗳️ Polls" active={active} onClick={setActive}/>
            <div style={{marginTop:12}}>
              {isAdmin
                 ? <button className="btn btn-commish" onClick={logout}>Commissioner Log out</button>
                 : <button className="btn btn-commish" onClick={login}>Commissioner Login</button>}
            </div>
          </aside>
          <main style={{padding:24}}>
            {views[active]}
          </main>
        </div>
      </div>
      <SyncOverlay open={syncing} pct={syncPct} msg={syncMsg} />
    </>
  );
}

function NavBtn({ id, label, active, onClick }) {
  const is = active === id;
  return (
    <a
      href={`#${id}`}
      onClick={(e) => { e.preventDefault(); onClick(id); }}
      className={`navlink ${is ? "nav-active" : ""}`}
      style={{
        display: "block", width: "100%", textDecoration: "none", textAlign: "left",
        padding: "10px 12px", borderRadius: 12, margin: "6px 0", color: "#e2e8f0", fontSize: 14
      }}
    >
      {label}
    </a>
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

function AnnouncementsView({isAdmin,login,logout, espn, seasonYear}){
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadAnnouncements = async () => {
    try {
      setLoading(true);
      const response = await fetch(API('/api/league-data/announcements'));
      if (!response.ok) throw new Error('Failed to load announcements');
      const data = await response.json();
      setAnnouncements(data.announcements || []);
      setError("");
    } catch (err) {
      setError("Failed to load announcements");
      console.error("Load announcements error:", err);
    } finally {
      setLoading(false);
    }
  };

  const addAnnouncement = async (html) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/announcements'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ html })
      });
      if (response.status === 401) return alert("Unauthorized - check admin password");
      if (!response.ok) throw new Error('Failed to create announcement');
      await loadAnnouncements();
    } catch (err) {
      alert("Failed to create announcement: " + err.message);
    }
  };

  const deleteAnnouncement = async (id) => {
    if (!isAdmin) return alert("Admin access required");
    if (!confirm("Delete this announcement?")) return;
    try {
      const response = await fetch(API('/api/league-data/announcements'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ id })
      });
      if (response.status === 401) return alert("Unauthorized - check admin password");
      if (!response.ok) throw new Error('Failed to delete announcement');
      await loadAnnouncements();
    } catch (err) {
      alert("Failed to delete announcement: " + err.message);
    }
  };

  useEffect(() => { loadAnnouncements(); }, []);
  
  return (
    <Section title="Announcements" actions={
      <>
        {isAdmin ? <button className="btn" style={btnSec} onClick={logout}>Commissioner Log out</button> : <button className="btn" style={btnPri} onClick={login}>Commissioner Login</button>}
        <button className="btn" style={btnSec} onClick={()=>downloadCSV("league-data-backup.csv", [["Exported", new Date().toLocaleString()]],)}>Export</button>
      </>
    }>
      
      {isAdmin && <AnnouncementEditor onPost={addAnnouncement} disabled={!isAdmin} />}
      
      {loading && <div className="card" style={{ padding: 16, color: "#64748b" }}>Loading announcements...</div>}
      {error && <div className="card" style={{ padding: 16, color: "#dc2626" }}>{error} - <button className="btn" style={btnSec} onClick={loadAnnouncements}>Retry</button></div>}
      
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {announcements.map((a) => (
          <li key={a.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {new Date(a.createdAt || Date.now()).toLocaleString()}
              </div>
              {isAdmin && (
                <button className="btn" style={{ ...btnSec, color: "#dc2626" }} onClick={() => deleteAnnouncement(a.id)}>Delete</button>
              )}
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: a.html }} />
          </li>
        ))}
        {!loading && announcements.length === 0 && (
          <li className="card" style={{ padding: 16, color: "#64748b" }}>No announcements yet.</li>
        )}
      </ul>
    </Section>
  );
}

function WeeklyView({ isAdmin, seasonYear }) {
  const [weeklyList, setWeeklyList] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const loadWeekly = async () => {
    try {
      setLoading(true);
      const response = await fetch(API('/api/league-data/weekly'));
      if (response.ok) {
        const data = await response.json();
        setWeeklyList(data.weeklyList || []);
      }
    } catch (err) {
      console.error("Load weekly error:", err);
    } finally {
      setLoading(false);
    }
  };

  const addWeekly = async (entry) => {
    if (!isAdmin) return alert("Admin access required");
    try {
      const response = await fetch(API('/api/league-data/weekly'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ entry })
      });
      if (response.ok) await loadWeekly();
    } catch (err) {
      alert("Failed to add weekly challenge: " + err.message);
    }
  };

  const deleteWeekly = async (id) => {
    if (!isAdmin) return alert("Admin access required");
    if (!confirm("Delete this challenge?")) return;
    try {
      const response = await fetch(API('/api/league-data/weekly'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ id })
      });
      if (response.ok) await loadWeekly();
    } catch (err) {
      alert("Failed to delete weekly challenge: " + err.message);
    }
  };

  useEffect(() => { loadWeekly(); }, []);

  const nowWeek = leagueWeekOf(new Date(), seasonYear).week || 0;
  const list = [...weeklyList];
  list.sort((a, b) => {
    const wa = a.week || 0, wb = b.week || 0, cur = nowWeek;
    const aIsCur = wa === cur, bIsCur = wb === cur;
    if (aIsCur && !bIsCur) return -1;
    if (bIsCur && !aIsCur) return 1;
    const aFuture = wa > cur, bFuture = wb > cur;
    if (aFuture && !bFuture) return -1;
    if (bFuture && !aFuture) return 1;
    if (aFuture && bFuture) return wa - wb;
    const aPast = wa < cur, bPast = wb < cur;
    if (aPast && bPast) return wb - wa;
    return 0;
  });

  return (
    <Section title="Weekly Challenges">
      {isAdmin && <WeeklyForm seasonYear={seasonYear} onAdd={addWeekly} />}
      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        {loading && <div className="card" style={{ padding: 16, color: "#64748b" }}>Loading challenges...</div>}
        {list.length === 0 && !loading && (
          <div className="card" style={{ padding: 16, color: "#64748b" }}>No weekly challenges yet.</div>
        )}
        {list.map(item => {
          const isPast = (item.week || 0) > 0 && (item.week || 0) < nowWeek;
          return (
            <div key={item.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ margin: 0 }}>
                    {item.weekLabel || "Week"}
                    {item.title ? <span style={{ fontWeight: 400, color: "#64748b" }}> — {item.title}</span> : null}
                  </h3>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                    Added {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
                {isAdmin && (
                  <button className="btn" style={{ ...btnSec, background: "#fee2e2", color: "#991b1b" }} onClick={() => deleteWeekly(item.id)}>Delete</button>
                )}
              </div>
              <div style={{
                marginTop: 8, whiteSpace: "pre-wrap",
                textDecoration: isPast ? "line-through" : "none",
                color: isPast ? "#64748b" : "#0b1220"
              }}>
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function RecentActivityView({ espn }) {
  return (
    <Section title="Recent Activity">
      <div className="card" style={{padding:12, marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <strong>Last 7 Days — Transactions</strong>
        </div>
        {!espn.leagueId && <div style={{color:"#64748b"}}>Set your ESPN details to see activity.</div>}
      </div>
    </Section>
  );
}

function WaiversView({ 
  isAdmin, members, waivers, waiversThisWeek, waiverCounts, waiverOwed, membersById, 
  selectedWeek, setSelectedWeek, seasonYear, addMember, deleteMember, addWaiver, deleteWaiver,
  updateOfficialSnapshot, setActive, espnReport, lastSynced, loadServerData 
}) {
  return (
    <Section title="Waivers & Dues" actions={
      <div style={{display:"flex", gap:8}}>
        {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
        <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
        {isAdmin && <button className="btn" style={btnSec} onClick={()=>{ if(confirm("Reset waivers?")) { 
          fetch(API('/api/league-data/reset-waivers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV }
          }).then(() => loadServerData());
        }}}>Reset Season</button>}
      </div>
    }>
      <div className="grid" style={{gridTemplateColumns:"1fr 1fr"}}>
        <div className="card" style={{padding:16}}>
          <h3>League Members</h3>
          {isAdmin && <AddMember onAdd={addMember}/>}
          <ul style={{listStyle:"none",padding:0,margin:0}}>
            {members.map(m=>(
              <li key={m.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                <span>{m.name}</span>
                <span style={{fontSize:14,color:"#334155"}}>Adds (this week): {waiverCounts[m.id]||0} • Owes: ${waiverOwed[m.id]||0}</span>
                {isAdmin && <button onClick={()=>deleteMember(m.id)} style={{color:"#dc2626",background:"transparent",border:"none",cursor:"pointer"}}>Remove</button>}
              </li>
            ))}
            {members.length===0 && <p style={{color:"#64748b"}}>Add members or import via ESPN.</p>}
          </ul>
        </div>

        <div className="card" style={{padding:16}}>
          {isAdmin ? (
            <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <h3>Log a Pickup</h3>
                <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} seasonYear={seasonYear}/>
              </div>
              <WaiverForm members={members} onAdd={addWaiver} disabled={members.length===0} />
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
  );
}

function PollsView({ isAdmin, members, espn }) {
  const seasonKey = String(espn?.seasonId ?? "unknown");
  const [teamCode, setTeamCode] = useStored(`poll-teamcode:${seasonKey}`, "");
  const [polls,setPolls]=useState([]);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");

  async function loadPolls(){
    setLoading(true); setErr("");
    try{
      const r = await fetch(API(`/api/polls?seasonId=${espn.seasonId}`));
      const j = await r.json();
      setPolls(j.polls || []);
    }catch(e){ setErr("Failed to load polls"); }
    setLoading(false);
  }
  useEffect(()=>{ loadPolls(); }, []);

  const [createQ,setCreateQ]=useState(""); 
  const [createOpts,setCreateOpts]=useState("Yes\nNo");
  
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

  const [activePollId,setActivePollId]=useState("");
  const [voteChoice,setVoteChoice]=useState("");
  
  useEffect(()=>{ 
    if (polls.length>0 && !activePollId) setActivePollId(polls[0].id); 
  }, [polls, activePollId]);

  async function castVote(){
    if (!activePollId) return alert("Choose a poll");
    if (!teamCode) return alert("Enter your Team Code first (button above).");
    if (!voteChoice) return alert("Select an option");

    try {
      const resp = await fetch(API("/api/polls/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollId: activePollId, optionId: voteChoice, seasonId: espn.seasonId, teamCode })
      });
      if (resp.status === 423) return alert("This poll is closed.");
      if (!resp.ok) throw new Error(await resp.text());

      alert("Vote recorded!");
      setVoteChoice("");
      await loadPolls();
    } catch (e) {
      alert(e.message || "Vote failed");
    }
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
      {loading && <p>Loading polls...</p>}
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
                <h3 style={{marginTop:0}}>{poll.question}</h3>
                <div className="card" style={{padding:12, background:"#f8fafc", marginBottom:12}}>
                  <div style={{fontSize:12, color:"#64748b", marginBottom:4}}>Season Team Code</div>
                  <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:8}}>
                    <span className="badge">{teamCode || "— not set —"}</span>
                    <button className="btn" onClick={()=>{
                      const c = prompt("Enter your Voting Password for this season:");
                      if (c) setTeamCode(c.toUpperCase().trim());
                    }}>
                      {teamCode ? "Change" : "Enter"} Code
                    </button>
                  </div>
                  <select className="input" value={voteChoice} onChange={e=>setVoteChoice(e.target.value)} style={{marginBottom:8}}>
                    <option value="">Choose an option</option>
                    {poll.options.map(o=> <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <button className="btn" style={btnPri} onClick={castVote} disabled={poll.closed}>Vote</button>
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
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// Helper Components
function AnnouncementEditor({ onPost, disabled }) {
  const [local, setLocal] = useState("");
  const ref = useRef(null);

  const focus = () => { if (ref.current) ref.current.focus(); };
  const exec = (cmd, val = null) => {
    focus();
    document.execCommand(cmd, false, val);
    if (ref.current) setLocal(ref.current.innerHTML);
  };

  return (
    <div className="card" style={{ padding: 16, background: "#f8fafc" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("bold");}}><b>B</b></button>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("italic");}}><i>I</i></button>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("underline");}}><u>U</u></button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="input"
        style={{ minHeight: 120, whiteSpace: "pre-wrap" }}
        onInput={(e) => setLocal(e.currentTarget.innerHTML)}
      />
      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button className="btn" style={btnPri} disabled={disabled} onClick={() => {
          const html = (local || "").trim();
          if (!html || html === "<br>") return alert("Type something first");
          onPost(html);
          if (ref.current) ref.current.innerHTML = "";
          setLocal("");
          focus();
        }}>
          Post
        </button>
      </div>
    </div>
  );
}

function WeeklyForm({ seasonYear, onAdd }) {
  const [weekLabel, setWeekLabel] = useState(() => {
    const now = leagueWeekOf(new Date(), seasonYear).week || 1;
    return `Week ${now}`;
  });
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  return (
    <div className="card" style={{ padding: 16, background: "#f8fafc" }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <input className="input" placeholder="Week label" value={weekLabel} onChange={(e) => setWeekLabel(e.target.value)} />
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <textarea className="input" style={{ minHeight: 120, marginTop: 8 }} placeholder="Challenge description" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button className="btn" style={btnPri} onClick={() => {
          const wk = parseInt(String(weekLabel || "").replace(/\D/g, ""), 10) || 0;
          if (!weekLabel.trim() || !text.trim()) return alert("Fill all fields");
          onAdd({
            id: Math.random().toString(36).slice(2),
            weekLabel: weekLabel.trim(),
            week: wk,
            title: title.trim(),
            text: text.trim(),
            createdAt: Date.now()
          });
          setTitle(""); setText("");
          if (wk > 0) setWeekLabel(`Week ${wk + 1}`);
        }}>Save</button>
      </div>
    </div>
  );
}

function AddMember({onAdd}){ 
  const [name,setName]=useState(""); 
  return (
    <form onSubmit={(e)=>{e.preventDefault(); if(!name) return; onAdd(name); setName("");}} style={{display:"flex", gap:8, margin:"8px 0 12px"}}>
      <input className="input" placeholder="Member name" value={name} onChange={e=>setName(e.target.value)}/>
      <button className="btn" style={btnPri}>Add</button>
    </form>
  ); 
}

function WaiverForm({members,onAdd,disabled}){ 
  const [userId,setUserId]=useState(members[0]?.id||""); 
  const [player,setPlayer]=useState(""); 
  const [date,setDate]=useState(today());
  
  useEffect(()=>{ setUserId(members[0]?.id||""); }, [members]);
  
  return (
    <form onSubmit={(e)=>{e.preventDefault(); if(!userId||!player) return; onAdd(userId,player,date); setPlayer("");}} className="grid" style={{gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:8}}>
      <select className="input" value={userId} onChange={e=>setUserId(e.target.value)} disabled={disabled}>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <input className="input" placeholder="Player" value={player} onChange={e=>setPlayer(e.target.value)} disabled={disabled}/>
      <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={disabled}/>
      <div style={{gridColumn:"1 / -1", textAlign:"right"}}>
        <button className="btn" style={btnPri} disabled={disabled}>Add Pickup</button>
      </div>
    </form>
  );
}

function WeekSelector({ selectedWeek, setSelectedWeek, seasonYear }) {
  const go = (delta)=> {
    const s = new Date(selectedWeek.start);
    s.setDate(s.getDate() + delta*7);
    setSelectedWeek(leagueWeekOf(s, seasonYear));
  };
  const label = selectedWeek.week>0 ? `Week ${selectedWeek.week} (Wed→Tue)` : `Preseason (Wed→Tue)`;
  return (
    <div style={{display:"flex", alignItems:"center", gap:8}}>
      <button type="button" className="btn" style={btnSec} onClick={()=>go(-1)}>◀</button>
      <span style={{fontSize:14,color:"#334155",minWidth:170,textAlign:"center"}}>{label}</span>
      <button type="button" className="btn" style={btnSec} onClick={()=>go(1)}>▶</button>
    </div>
  );
}

function DuesView({ report, lastSynced, loadOfficialReport, updateOfficialSnapshot, isAdmin, members, buyins, updateBuyins, seasonYear }) {
  return (
    <Section title="Dues (Official Snapshot)">
      <p style={{marginTop:-8, color:"#64748b"}}>
        Last updated: <b>{lastSynced || "—"}</b>. Rule: first two transactions per Wed→Tue week are free, then $5 each.
      </p>
      {!report && <p style={{color:"#64748b"}}>No snapshot yet — Commissioner should click <b>Update Official Snapshot</b>.</p>}
    </Section>
  );
}

function TransactionsView({ report }) {
  return (
    <Section title="Transactions">
      <p style={{color:"#64748b"}}>No snapshot yet — go to <b>Dues</b> and refresh snapshot.</p>
    </Section>
  );
}

function Rosters({ leagueId, seasonId }) {
  return (
    <Section title="Rosters" actions={<span className="badge">View-only (ESPN live)</span>}>
      {!leagueId && <p style={{color:"#64748b"}}>Set your ESPN League ID & Season in <b>League Settings</b>.</p>}
    </Section>
  );
}

function SettingsView({ isAdmin, espn, setEspn, importEspnTeams, leagueSettingsHtml, updateLeagueSettings }) {
  const [editing, setEditing] = useState(false);

  return (
    <Section title="League Settings" actions={
      isAdmin ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" placeholder="ESPN League ID" value={espn.leagueId} onChange={(e) => setEspn({ ...espn, leagueId: e.target.value })} style={{ width: 160 }} />
          <input className="input" placeholder="Season" value={espn.seasonId} onChange={(e) => setEspn({ ...espn, seasonId: e.target.value })} style={{ width: 120 }} />
          <button className="btn" style={btnPri} onClick={importEspnTeams}>Import ESPN Teams</button>
          <button className="btn" style={editing ? btnSec : btnPri} onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button>
        </div>
      ) : <span className="badge">View-only</span>
    }>
      <div className="card" style={{ padding: 16 }}>
        <div className="prose" dangerouslySetInnerHTML={{ __html: leagueSettingsHtml || "<p>No settings yet.</p>" }} />
      </div>
    </Section>
  );
}

function TradingView({isAdmin,addTrade,deleteTrade}) {
  return (
    <Section title="Trading Block">
      <div className="grid">
        <p style={{color:"#64748b"}}>No trades on the block yet.</p>
      </div>
    </Section>
  );
}

function IntroSplash(){
  const [show,setShow] = useState(true);
  useEffect(()=>{ const t=setTimeout(()=>setShow(false), 1600); return ()=>clearTimeout(t); }, []);
  if(!show) return null;
  return <div className="splash"><Logo size={160}/></div>;
}

function SyncOverlay({ open, pct, msg }) {
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
      <div className="card" style={{ width:420, padding:16, background:"#0b1220", color:"#e2e8f0", border:"1px solid #1f2937" }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Working...</div>
        <div style={{ fontSize:12, color:"#93a3b8", minHeight:18 }}>{msg}</div>
        <div style={{ height:10, background:"#0f172a", borderRadius:999, marginTop:10, overflow:"hidden", border:"1px solid #1f2937" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:"#38bdf8" }} />
        </div>
        <div style={{ textAlign:"right", fontSize:12, marginTop:6 }}>{pct}%</div>
      </div>
    </div>
  );
}