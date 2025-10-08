// src/App.jsx - Complete Server-Side Version
import React, { useEffect, useMemo, useState, useRef } from "react";
import Logo from "./Logo.jsx";

/* =========================
   Global Config
   ========================= */
const ADMIN_ENV = import.meta.env.VITE_ADMIN_PASSWORD || "changeme";
const DEFAULT_LEAGUE_ID = import.meta.env.VITE_ESPN_LEAGUE_ID || "";
const DEFAULT_SEASON = import.meta.env.VITE_ESPN_SEASON || new Date().getFullYear();
const LEAGUE_TZ = "America/Los_Angeles";
const WEEK_START_DAY = 3; // Wednesday

const API = (p) => (import.meta.env.DEV ? `http://localhost:8787${p}` : p);

/* ---- playful roasts for wrong commissioner password ---- */
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

/* =========================
   UI helpers
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
   Week math helpers
   ========================= */
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
function weekKeyFrom(w){ return w.key || localDateKey(w.start || new Date()) }
function localDateKey(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}` }
function fmtShort(d){ return toPT(d).toLocaleDateString(undefined,{month:"short", day:"numeric"}) }

/* =========================
   ESPN helpers
   ========================= */
function teamName(t){ return (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`); }

async function fetchEspnJson({ leagueId, seasonId, view, scoringPeriodId, auth = false }) {
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const au = auth ? `&auth=1` : "";
  const url = API(`/api/espn?leagueId=${leagueId}&seasonId=${seasonId}&view=${view}${sp}${au}`);
  
  console.log(`[ESPN API] Fetching: ${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}`);
  const startTime = Date.now();
  
  try {
    const r = await fetch(url);
    const text = await r.text();
    const elapsed = Date.now() - startTime;
    
    console.log(`[ESPN API] Response for ${view}: ${r.status} (${elapsed}ms)`);
    
    if (!r.ok) {
      console.error(`[ESPN API] HTTP ${r.status} for ${view}:`, text.slice(0, 200));
      throw new Error(`ESPN API HTTP ${r.status} for ${view}`);
    }
    
    try { 
      const json = JSON.parse(text);
      console.log(`[ESPN API] Success: ${view} - parsed JSON (${elapsed}ms)`);
      return json;
    } catch (parseError) {
      console.error(`[ESPN API] JSON parse error for ${view}:`, {
        error: parseError.message,
        snippet: text.slice(0, 300).replace(/\s+/g, " "),
        contentType: r.headers.get("content-type")
      });
      throw new Error(`ESPN returned non-JSON for ${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}. Snippet: ${text.slice(0,160).replace(/\s+/g," ")}`);
    }
  } catch (networkError) {
    const elapsed = Date.now() - startTime;
    console.error(`[ESPN API] Network error for ${view} (${elapsed}ms):`, networkError.message);
    throw networkError;
  }
}

/* =========================
   Server API helpers
   ========================= */
async function apiCall(endpoint, options = {}) {
  const url = API(endpoint);
  const config = {
    headers: { "Content-Type": "application/json" },
    ...options
  };
  
  if (config.method && config.method !== 'GET' && !config.headers["x-admin"]) {
    config.headers["x-admin"] = ADMIN_ENV;
  }
  
  const response = await fetch(url, config);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }
  return response.json();
}

/* =========================
   Local storage hook for non-server data
   ========================= */
function useStored(key, initial=""){
  const [v,setV] = React.useState(()=> localStorage.getItem(key) ?? initial);
  React.useEffect(()=> localStorage.setItem(key, v ?? ""), [key,v]);
  return [v,setV];
}

/* =========================
   App Root
   ========================= */
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

  // Server-side data state
  const [data, setData] = useState({
    announcements: [],
    weeklyList: [],
    members: [],
    waivers: [],
    buyins: {},
    tradeBlock: [],
    leagueSettingsHtml: "",
    lastUpdated: null
  });

  // Load data from server on mount
  useEffect(() => {
    loadServerData();
  loadDisplaySeason(); 
  }, []);

  async function loadServerData() {
    try {
      const serverData = await apiCall('/api/league-data');
      setData(serverData);
    } catch (error) {
      console.error('Failed to load server data:', error);
    }
  }


async function loadDisplaySeason() {
  try {
    const response = await apiCall('/api/report/default-season');
    const serverSeason = response.season || response.defaultSeason || DEFAULT_SEASON;
    setEspn(prev => ({ ...prev, seasonId: serverSeason }));
  } catch (error) {
    console.error('Failed to load display season:', error);
    setEspn(prev => ({ ...prev, seasonId: DEFAULT_SEASON }));
  }
}

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

  // ESPN config
  const [espn, setEspn] = useState({ leagueId: DEFAULT_LEAGUE_ID, seasonId: "" });
  const seasonYear = Number(espn.seasonId) || new Date().getFullYear();

  // Weeks
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

  // Server-side CRUD operations
  const addAnnouncement = async (html) => {
    try {
      await apiCall('/api/league-data/announcements', {
        method: 'POST',
        body: JSON.stringify({ html })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to add announcement: ' + error.message);
    }
  };

  const deleteAnnouncement = async (id) => {
    try {
      await apiCall('/api/league-data/announcements', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to delete announcement: ' + error.message);
    }
  };

  const addWeekly = async (entry) => {
    try {
      await apiCall('/api/league-data/weekly', {
        method: 'POST',
        body: JSON.stringify({ entry })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to add weekly challenge: ' + error.message);
    }
  };

  const deleteWeekly = async (id) => {
    if (!confirm("Delete this challenge?")) return;
    try {
      await apiCall('/api/league-data/weekly', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to delete weekly challenge: ' + error.message);
    }
  };

  const addMember = async (name) => {
    try {
      await apiCall('/api/league-data/members', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to add member: ' + error.message);
    }
  };

  const deleteMember = async (id) => {
    try {
      await apiCall('/api/league-data/members', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to delete member: ' + error.message);
    }
  };

  const addWaiver = async (userId, player, date) => {
    try {
      await apiCall('/api/league-data/waivers', {
        method: 'POST',
        body: JSON.stringify({ userId, player, date: date || today() })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to add waiver: ' + error.message);
    }
  };

  const deleteWaiver = async (id) => {
    try {
      await apiCall('/api/league-data/waivers', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to delete waiver: ' + error.message);
    }
  };

  const addTrade = async (trade) => {
    try {
      await apiCall('/api/league-data/trading', {
        method: 'POST',
        body: JSON.stringify({ trade })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to add trade: ' + error.message);
    }
  };

  const updateBuyIns = async (seasonKey, updates) => {
    try {
      await apiCall('/api/league-data/buyins', {
        method: 'POST',
        body: JSON.stringify({ seasonKey, updates })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to update buy-ins: ' + error.message);
    }
  };

  const deleteTrade = async (id) => {
    try {
      await apiCall('/api/league-data/trading', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to delete trade: ' + error.message);
    }
  };

  const saveLeagueSettings = async (html) => {
    try {
      await apiCall('/api/league-data/settings', {
        method: 'POST',
        body: JSON.stringify({ html })
      });
      await loadServerData();
      alert("League Settings Saved!");
    } catch (error) {
      alert('Failed to save settings: ' + error.message);
    }
  };

  const importEspnTeams = async () => {
    if(!espn.leagueId) return alert("Enter League ID");
    try{
      const json = await fetchEspnJson({ leagueId: espn.leagueId, seasonId: espn.seasonId, view: "mTeam" });
      const teams = json?.teams || [];
      if(!Array.isArray(teams) || teams.length===0) return alert("No teams found (check ID/season).");
      const names = [...new Set(teams.map(t => teamName(t)))];
      
      await apiCall('/api/league-data/import-teams', {
        method: 'POST',
        body: JSON.stringify({ teams: names })
      });
      await loadServerData();
      alert(`Imported ${names.length} teams.`);
    } catch(e){ alert(e.message || "ESPN fetch failed. Check League/Season."); }
  };

  // Sync overlay state
  const [syncing, setSyncing] = useState(false);
  const [syncPct, setSyncPct] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");

  // Official report
  const [espnReport, setEspnReport] = useState(null);
  const [lastSynced, setLastSynced] = useState("");

async function loadOfficialReport(silent=false){
  try{
    if(!silent){ setSyncing(true); setSyncPct(0); setSyncMsg("Loading official snapshot…"); }
    
    // Simply request the current season's report
    const r = await fetch(API(`/api/report?seasonId=${espn.seasonId}`));
    
    if (r.ok){
      const j = await r.json();
      setEspnReport(j || null);
      setLastSynced(j?.lastSynced || "");
      
      // Set this as server's display season
      if (!silent) {
        await apiCall('/api/report/set-display-season', {
          method: 'POST',
          body: JSON.stringify({ seasonId: espn.seasonId })
        });
      }
    } else {
      if(!silent) alert(`No snapshot found for ${espn.seasonId}. Update Official Snapshot to create one.`);
    }
  } catch(e){
    if(!silent) alert("Failed to load snapshot.");
    console.error('Load report error:', e);
  } finally{
    if(!silent) setTimeout(()=>setSyncing(false),200);
  }
}

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
    announcements: <AnnouncementsView {...{isAdmin,login,logout,data,addAnnouncement,deleteAnnouncement}} espn={espn} seasonYear={seasonYear} />,
    weekly: <WeeklyView {...{isAdmin,data,addWeekly,deleteWeekly,seasonYear}} />,
    activity: <RecentActivityView espn={espn} />,
    waivers: (
      <Section title="Waivers & Dues" actions={
        <div style={{display:"flex", gap:8}}>
          {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
          <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
          {isAdmin && <button className="btn" style={btnSec} onClick={async ()=>{ 
            if(confirm("Reset waivers and announcements?")) {
              try {
                await apiCall('/api/league-data/reset-waivers', { method: 'POST' });
                await loadServerData();
              } catch (error) {
                alert('Reset failed: ' + error.message);
              }
            }
          }}>Reset Season</button>}
        </div>
      }>
        <div className="grid" style={{gridTemplateColumns:"1fr 1fr"}}>
          <div className="card" style={{padding:16}}>
            <h3>League Members</h3>
            <ul style={{listStyle:"none",padding:0,margin:0}}>
              {data.members.map(m=>(
                <li key={m.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                  <span>{m.name}</span>
                  <span style={{fontSize:14,color:"#334155"}}>Adds (this week): {waiverCounts[m.id]||0} • Owes: ${waiverOwed[m.id]||0}</span>
                  {isAdmin && <button onClick={()=>deleteMember(m.id)} style={{color:"#dc2626",background:"transparent",border:"none",cursor:"pointer"}}>Remove</button>}
                </li>
              ))}
              {data.members.length===0 && <p style={{color:"#64748b"}}>Import teams via League Settings to populate members.</p>}
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
            <div>Official dues snapshot loaded. 
              <div style={{fontSize:12, color:"#64748b", marginTop:4}}>
                Last Updated: {new Date().toLocaleString()} 
              </div>
            </div>
            <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
          </div>
        )}
      </Section>
    ),
    dues: <DuesView
      report={espnReport}
      lastSynced={lastSynced}
      loadOfficialReport={loadOfficialReport}
      updateOfficialSnapshot={updateOfficialSnapshot}
      isAdmin={isAdmin}
      data={data}
      setData={setData}
      seasonYear={seasonYear}
      updateBuyIns={updateBuyIns}
    />,
    transactions: <TransactionsView report={espnReport} />,
    rosters: <Rosters leagueId={espn.leagueId} seasonId={espn.seasonId} />,
    settings: <SettingsView {...{isAdmin,espn,setEspn,importEspnTeams,data,saveLeagueSettings}}/>,
    trading: <TradingView {...{isAdmin,addTrade,deleteTrade,data}}/>,
    polls: <PollsView {...{isAdmin, members:data.members, espn}}/>
  };

  return (
    <>
      <IntroSplash/>
      <div className="container">
        <div className="card app-shell" style={{overflow:"auto"}}>
          <aside
            className="sidebar"
            style={{
              padding: 20,
              background: "linear-gradient(180deg, #0b2e4a 0%, #081a34 100%)",
              color: "#e2e8f0"
            }}
          >
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

/* =========================
   Components
   ========================= */
function NavBtn({ id, label, active, onClick }) {
  const is = active === id;
  return (
    <a
      href={`#${id}`}
      onClick={(e) => { e.preventDefault(); onClick(id); }}
      className={`navlink ${is ? "nav-active" : ""}`}
      style={{
        display: "block",
        width: "100%",
        textDecoration: "none",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 12,
        margin: "6px 0",
        color: "#e2e8f0",
        fontSize: 14,
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

function AnnouncementsView({isAdmin,login,logout,data,addAnnouncement,deleteAnnouncement, espn, seasonYear}){
  return (
    <Section title="Announcements" actions={
      <>
        {isAdmin ? <button className="btn" style={btnSec} onClick={logout}>Commissioner Log out</button> : <button className="btn" style={btnPri} onClick={login}>Commissioner Login</button>}
        <button className="btn" style={btnSec} onClick={()=>downloadCSV("league-data-backup.csv", [["Exported", new Date().toLocaleString()]],)}>Export</button>
      </>
    }>
      {isAdmin && <AnnouncementEditor onPost={(html) => addAnnouncement(html)} disabled={!isAdmin} />}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {data.announcements.map((a) => (
          <li key={a.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {new Date(a.createdAt || Date.now()).toLocaleString()}
              </div>
              {isAdmin && (
                <button
                  className="btn"
                  style={{ ...btnSec, color: "#dc2626" }}
                  onClick={() => deleteAnnouncement(a.id)}
                >
                  Delete
                </button>
              )}
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: a.html }} />
          </li>
        ))}
        {data.announcements.length === 0 && (
          <li className="card" style={{ padding: 16, color: "#64748b" }}>
            No announcements yet.
          </li>
        )}
      </ul>
    </Section>
  );
}

function RecentActivityView({ espn }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activities, setActivities] = useState([]);
  const [report, setReport] = useState(null);

async function loadReport() {
  setLoading(true);
  setError("");
  try {
    const r = await fetch(API(`/api/report?seasonId=${espn.seasonId}`));
    if (r.ok) {
      const reportData = await r.json();
      setReport(reportData);
      
      console.log("Full report data:", reportData);
      console.log("Raw moves:", reportData.rawMoves);
      console.log("Total raw moves:", reportData.rawMoves?.length || 0);
      
      // Check date distribution
      if (reportData.rawMoves) {
        const movesByWeek = {};
        reportData.rawMoves.forEach(move => {
          const week = move.week;
          movesByWeek[week] = (movesByWeek[week] || 0) + 1;
        });
        console.log("Moves by week:", movesByWeek);
        
        // Check recent dates
        const now = Date.now();
        const cutoffDate = now - 7 * 24 * 60 * 60 * 1000;
        console.log("Current timestamp:", now);
        console.log("7-day cutoff timestamp:", cutoffDate);
        console.log("Cutoff date:", new Date(cutoffDate).toLocaleString());
        
        const recentMoves = reportData.rawMoves.filter(move => {
          const moveDate = new Date(move.date).getTime();
          console.log(`Move: ${move.team} ${move.action} ${move.player} - Date: ${move.date} - Timestamp: ${moveDate} - Recent: ${moveDate > cutoffDate}`);
          return moveDate > cutoffDate;
        });
        
        console.log("Recent moves found:", recentMoves.length);
        
        const formattedActivities = recentMoves
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map(move => ({
            date: new Date(move.date).toLocaleDateString(),
            team: move.team,
            player: move.player,
            action: move.action === "ADD" ? "ADDED" : "DROPPED",
            week: move.week,
            isDraft: move.week <= 0
          }));
        
        setActivities(formattedActivities);
      }
    } else {
      setError("No recent transactions snapshot available. Update the official snapshot first.");
    }
  } catch (err) {
    console.error("Error loading report:", err);
    setError("Failed to load recent activity data.");
  }
  setLoading(false);
}

  useEffect(() => {
    if (espn.seasonId) {
      loadReport();
    }
  }, [espn.seasonId]);

  return (
    <Section title="Recent Activity (Last 7 Days)">
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Recent Transactions</strong>
          <button className="btn" style={btnSec} onClick={loadReport} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        
        {!espn.seasonId && <div style={{ color: "#64748b" }}>Set your ESPN season in League Settings.</div>}
        {error && <div style={{ color: "#dc2626" }}>{error}</div>}
        
        {activities.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {activities.map((activity, i) => (
              <div key={i} style={{ 
                padding: "8px 0", 
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                fontSize: 14,
                fontStyle: activity.isDraft ? "italic" : "normal",
                opacity: activity.isDraft ? 0.8 : 1
              }}>
                <span>
                  <b>{activity.team}</b> {activity.action} <b>{activity.player}</b>
                  {activity.isDraft && <span style={{ color: "#64748b", fontSize: 12 }}> (draft)</span>}
                </span>
                <span style={{ color: "#64748b" }}>{activity.date}</span>
              </div>
            ))}
          </div>
        ) : !loading && !error && (
          <div style={{ color: "#64748b", marginTop: 8 }}>
            No recent activity in the last 7 days.
          </div>
        )}

        {report && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
            Data from official snapshot: {report.lastSynced}
            <br />
            <span style={{ fontStyle: "italic" }}>Draft picks (Week 0)</span> shown but not billed
          </div>
        )}
      </div>
    </Section>
  );
}

function WeeklyView({ isAdmin, data, addWeekly, deleteWeekly, seasonYear }) {
  const nowWeek = leagueWeekOf(new Date(), seasonYear).week || 0;
  const list = Array.isArray(data.weeklyList) ? [...data.weeklyList] : [];

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
        {list.length === 0 && (
          <div className="card" style={{ padding: 16, color: "#64748b" }}>
            No weekly challenges yet.
          </div>
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
                  <button
                    className="btn"
                    style={{ ...btnSec, background: "#fee2e2", color: "#991b1b" }}
                    onClick={() => deleteWeekly(item.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  textDecoration: isPast ? "line-through" : "none",
                  color: isPast ? "#64748b" : "#0b1220"
                }}
              >
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}


function DuesView({ report, lastSynced, loadOfficialReport, updateOfficialSnapshot, isAdmin, data, setData, seasonYear, updateBuyIns }) {
  return (
    <Section title="Dues (Official Snapshot)" actions={
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" style={btnSec} onClick={() => loadOfficialReport(false)}>Refresh Snapshot</button>
        {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
        <button className="btn" style={btnSec} onClick={() => print()}>Print</button>
        {report && (
          <>
            <button className="btn" style={btnSec} onClick={() => {
              const rows = [["Team", "Adds", "Owes"], ...report.totalsRows.map(r => [r.name, r.adds, `${r.owes}`])];
              downloadCSV("dues_totals.csv", rows);
            }}>Download CSV (totals)</button>
            <button className="btn" style={btnSec} onClick={() => {
              const rows = [["Week", "Range", "Team", "Adds", "Owes"]];
              report.weekRows.forEach(w => w.entries.forEach(e => rows.push([w.week, w.range, e.name, e.count, `${e.owes}`])));
              downloadCSV("dues_by_week.csv", rows);
            }}>Download CSV (by week)</button>
          </>
        )}
      </div>
    }>
      <p style={{ marginTop: -8, color: "#64748b" }}>
  Last updated: <b>{lastSynced || "—"}</b>
  <br />
  Rule: first two transactions per Wed→Tue week are free, then $5 each.
</p>
      {!report && <p style={{ color: "#64748b" }}>No snapshot yet — Commissioner should click <b>Update Official Snapshot</b>.</p>}

      {report && (
        <div className="dues-grid dues-tight">
          <div className="dues-left">
            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ marginTop: 0 }}>League Owner Dues</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Team</th>
                    <th style={th}>Adds</th>
                    <th style={th}>Owes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.totalsRows.map(r => (
                    <tr key={r.name}>
                      <td style={td}>{r.name}</td>
                      <td style={td}>{r.adds}</td>
                      <td style={td}>${r.owes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <BuyInTracker
              isAdmin={isAdmin}
              members={data.members}
              seasonYear={seasonYear}
              data={data}
              setData={setData}
              updateBuyIns={updateBuyIns}
            />
          </div>
          <div className="card dues-week" style={{ padding: 12, minWidth: 0 }}>
            <h3 style={{ marginTop: 0 }}>By Week (Wed→Tue, cutoff Tue 11:59 PM PT)</h3>
            {report.weekRows.map(w => (
              <div key={w.week} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, margin: "6px 0" }}>Week {w.week} — {w.range}</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Team</th>
                      <th style={th}>Adds</th>
                      <th style={th}>Owes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.entries.map(e => (
                      <tr key={e.name}>
                        <td style={{ ...td, whiteSpace: "normal" }}>{e.name}</td>
                        <td style={td}>{e.count}</td>
                        <td style={td}>${e.owes}</td>
                      </tr>
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

function TransactionsView({ report }) {
  if (!report) {
    return (
      <Section title="Transactions">
        <p style={{ color: "#64748b" }}>No snapshot yet — go to <b>Dues</b> and click <b>Refresh Snapshot</b> (or have the commissioner update it).</p>
      </Section>
    );
  }

  const all = (report.rawMoves || []).map(r => ({
    ...r,
    week: Math.max(1, Number(r.week) || 1)
  }));

  const teams = Array.from(new Set(all.map(r => r.team))).sort();
  const [team, setTeam] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");

  const filtered = all.filter(r =>
    (!team || r.team === team) &&
    (!action || r.action === action) &&
    (!q || (r.player?.toLowerCase().includes(q.toLowerCase()) || r.team.toLowerCase().includes(q.toLowerCase())))
  );

  const weeksSorted = Array.from(new Set(filtered.map(r => Math.max(1, Number(r.week) || 1))))
    .sort((a, b) => a - b);

  const rangeByWeek = {};
  for (const r of filtered) {
    const w = Math.max(1, Number(r.week) || 1);
    if (!rangeByWeek[w]) rangeByWeek[w] = r.range;
  }

  const byWeek = new Map();
  for (const r of filtered) {
    const w = Math.max(1, Number(r.week) || 1);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push({ ...r, week: w });
  }

  const [openWeeks, setOpenWeeks] = useState(() => new Set(weeksSorted));
  useEffect(() => { setOpenWeeks(new Set(weeksSorted)); }, [q, team, action]);
  const toggleWeek = (w) => setOpenWeeks(s => { const n = new Set(s); n.has(w) ? n.delete(w) : n.add(w); return n; });

  return (
    <Section title="Transactions" actions={
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="input" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" value={action} onChange={e => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="ADD">ADD</option>
          <option value="DROP">DROP</option>
        </select>
        <input className="input" placeholder="Search player/team…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn" style={btnSec} onClick={() => setOpenWeeks(new Set(weeksSorted))}>Expand all</button>
        <button className="btn" style={btnSec} onClick={() => setOpenWeeks(new Set())}>Collapse all</button>
      </div>
    }>
      {weeksSorted.length === 0 && (
        <p style={{ color: "#64748b" }}>No transactions match your filters.</p>
      )}

      {weeksSorted.map(week => {
        const rows = byWeek.get(week) || [];
        const open = openWeeks.has(week);
        return (
          <div key={week} className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
              onClick={() => toggleWeek(week)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>Week {week}</span>
                <span style={{ color: "#64748b" }}>{rangeByWeek[week] || ""}</span>
              </div>
              <span style={{ color: "#64748b" }}>{open ? "Hide ▲" : "Show ▼"}</span>
            </div>
            {open && (
              <div style={{ marginTop: 8, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Date (PT)</th>
                      <th style={th}>Team</th>
                      <th style={th}>Player</th>
                      <th style={th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={td}>{r.date}</td>
                        <td style={td}>{r.team}</td>
                        <td style={{ ...td, color: r.action === "ADD" ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                          {r.player || (r.playerId ? `#${r.playerId}` : "—")}
                        </td>
                        <td style={td}>{r.action}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td style={td} colSpan={4}>&nbsp;No transactions in this week.</td></tr>
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

function Rosters({ leagueId, seasonId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [teams, setTeams] = useState([]);

  const positionOrder = ["QB", "RB", "RB/WR", "WR", "WR/TE", "TE", "FLEX", "OP", "D/ST", "K", "Bench"];
  
  const getPositionPriority = (slot) => {
    const index = positionOrder.findIndex(pos => slot.includes(pos));
    return index === -1 ? 999 : index;
  };

  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [teamJson, rosJson, setJson] = await Promise.all([
          fetchEspnJson({ leagueId, seasonId, view: "mTeam" }),
          fetchEspnJson({ leagueId, seasonId, view: "mRoster" }),
          fetchEspnJson({ leagueId, seasonId, view: "mSettings" }),
        ]);
        const teamsById = Object.fromEntries((teamJson?.teams || []).map(t => [t.id, teamName(t)]));
        const slotMap = slotIdToName(setJson?.settings?.rosterSettings?.lineupSlotCounts || {});
        const items = (rosJson?.teams || []).map(t => {
          const entries = (t.roster?.entries || []).map(e => {
            const p = e.playerPoolEntry?.player;
            const fullName = p?.fullName || "Player";
            const slot = slotMap[e.lineupSlotId] || "—";
            
            // ONLY remove parentheses from NON-bench players
            const displayName = slot === "Bench" 
              ? fullName  // Keep original name with parentheses for bench players
              : fullName.replace(/\s*\([^)]*\)\s*/g, '').trim(); // Remove parentheses for starters only
            
            return { name: displayName, slot };
          });
          
          entries.sort((a, b) => {
            const aPriority = getPositionPriority(a.slot);
            const bPriority = getPositionPriority(b.slot);
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.name.localeCompare(b.name);
          });
          
          return { teamName: teamsById[t.id] || `Team ${t.id}`, entries };
        }).sort((a, b) => a.teamName.localeCompare(b.teamName));
        setTeams(items);
      } catch {
        setError("Failed to load rosters.");
      }
      setLoading(false);
    })();
  }, [leagueId, seasonId]);

  return (
    <Section title="Rosters" actions={<span className="badge">View-only (ESPN live)</span>}>
      {!leagueId && <p style={{ color: "#64748b" }}>Set your ESPN League ID & Season in <b>League Settings</b>.</p>}
      {loading && <p>Loading rosters…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {teams.map(team => (
          <div key={team.teamName} className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>{team.teamName}</h3>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {team.entries.map((e, i) => <li key={i}><b>{e.slot}</b> — {e.name}</li>)}
            </ul>
          </div>
        ))}
      </div>
      {!loading && teams.length === 0 && leagueId && <p style={{ color: "#64748b" }}>No roster data yet (pre-draft?).</p>}
    </Section>
  );
}

function SettingsView({ isAdmin, espn, setEspn, importEspnTeams, data, saveLeagueSettings }) {
  const [editing, setEditing] = useState(false);

  const actions = isAdmin ? (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        className="input"
        placeholder="ESPN League ID"
        value={espn.leagueId}
        onChange={(e) => setEspn({ ...espn, leagueId: e.target.value })}
        style={{ width: 160 }}
      />
      <input
        className="input"
        placeholder="Season"
        value={espn.seasonId}
        onChange={(e) => setEspn({ ...espn, seasonId: e.target.value })}
        style={{ width: 120 }}
      />
      <button className="btn" style={btnPri} onClick={importEspnTeams}>Import ESPN Teams</button>
      {editing ? (
        <button className="btn" style={btnSec} onClick={() => setEditing(false)}>Cancel Edit</button>
      ) : (
        <button className="btn" style={btnPri} onClick={() => setEditing(true)}>Edit</button>
      )}
    </div>
  ) : (
    <span className="badge">View-only</span>
  );

  return (
    <Section title="League Settings" actions={actions}>
      {isAdmin && editing ? (
        <RichEditor
          html={data.leagueSettingsHtml || ""}
          readOnly={false}
          setHtml={(h) => {
            saveLeagueSettings(h);
            setEditing(false);
          }}
        />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div
            className="prose"
            dangerouslySetInnerHTML={{
              __html: data.leagueSettingsHtml || "<p>No settings yet.</p>",
            }}
          />
        </div>
      )}
    </Section>
  );
}

function TradingView({ isAdmin, addTrade, deleteTrade, data }) {
  return (
    <Section title="Trading Block">
      {isAdmin && <TradeForm onSubmit={addTrade} />}
      <div className="grid">
        {data.tradeBlock.length === 0 && <p style={{ color: "#64748b" }}>Nothing on the block yet.</p>}
        {data.tradeBlock.map(t => (
          <div key={t.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 14, alignItems: "center" }}>
              <span style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: 999 }}>{t.position || "PLAYER"}</span>
              <strong>{t.player}</strong>
              <span style={{ color: "#64748b" }}>• Owner: {t.owner || "—"}</span>
              <span style={{ marginLeft: "auto", color: "#94a3b8" }}>{new Date(t.createdAt).toLocaleDateString()}</span>
            </div>
            {t.notes && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{t.notes}</p>}
            {isAdmin && <div style={{ textAlign: "right", marginTop: 8 }}><button className="btn" style={{ ...btnSec, background: "#fee2e2", color: "#991b1b" }} onClick={() => deleteTrade(t.id)}>Remove</button></div>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function PollsView({ isAdmin, members, espn }) {
  const seasonKey = String(espn?.seasonId ?? "unknown");
  const [teamCode, setTeamCode] = useStored(`poll-teamcode:${seasonKey}`, "");

  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function loadPolls() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(API(`/api/polls?seasonId=${espn.seasonId}`));
      const j = await r.json();
      setPolls(j.polls || []);
    } catch (e) {
      setErr("Failed to load polls");
    }
    setLoading(false);
  }
  useEffect(() => { loadPolls(); }, []);

  const [createQ, setCreateQ] = useState("");
  const [createOpts, setCreateOpts] = useState("Yes\nNo");
  async function createPoll() {
    const opts = createOpts.split("\n").map(s => s.trim()).filter(Boolean);
    if (!createQ || opts.length < 2) return alert("Enter a question and at least two options.");
    const r = await fetch(API("/api/polls/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": ADMIN_ENV },
      body: JSON.stringify({ question: createQ, options: opts })
    });
    if (!r.ok) return alert("Create failed (commissioner only?)");
    setCreateQ("");
    setCreateOpts("Yes\nNo");
    loadPolls();
  }

  async function onIssueSeasonTeamCodes() {
    if (!isAdmin) return alert("Commissioner only.");
    if (!espn?.leagueId || !espn?.seasonId) {
      alert("Set League ID and Season in League Settings first.");
      return;
    }
    try {
      const r = await fetch(API(`/api/espn?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}&view=mTeam`));
      if (!r.ok) throw new Error(await r.text());
      const m = await r.json();
      const teams = (m?.teams || []).map(t => ({
        id: t.id,
        name: (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`)
      }));

      const k = await fetch(API("/api/polls/issue-team-codes"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": ADMIN_ENV },
        body: JSON.stringify({ seasonId: espn.seasonId, teams })
      });
      if (!k.ok) throw new Error(await k.text());
      const j = await k.json();
      alert(`Issued ${j.issued} team codes for season ${espn.seasonId}.`);
    } catch (e) {
      alert(e.message || "Failed issuing codes");
    }
  }

  async function onCopySeasonTeamCodes() {
    if (!isAdmin) return alert("Commissioner only.");
    if (!espn?.seasonId) return alert("Season not set.");
    try {
      const r = await fetch(API(`/api/polls/team-codes?seasonId=${espn.seasonId}`), {
        headers: { "x-admin": ADMIN_ENV }
      });
      if (!r.ok) throw new Error(await r.text());
      const { codes } = await r.json();

      const mTeam = await fetch(API(`/api/espn?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}&view=mTeam`)).then(x => x.json()).catch(() => ({}));
      const nameById = Object.fromEntries((mTeam?.teams || []).map(t => [t.id, (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`)]));

      const lines = (codes || []).map(c => `${nameById[c.teamId] || ("Team " + c.teamId)}: ${c.code}`).join("\n");
      if (!lines) return alert("No codes yet. Click 'Issue season team codes' first.");
      await navigator.clipboard.writeText(lines);
      alert("Copied team codes to clipboard.\n\n" + lines);
    } catch (e) {
      alert(e.message || "Failed fetching codes");
    }
  }

  async function deletePoll(pollId) {
    if (!confirm("Delete this poll? This removes its results and codes.")) return;
    const r = await fetch(API("/api/polls/delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": ADMIN_ENV },
      body: JSON.stringify({ pollId })
    });
    if (!r.ok) return alert("Delete failed (commissioner only?)");
    setActivePollId("");
    loadPolls();
  }

  async function setClosed(pollId, closed) {
    const r = await fetch(API("/api/polls/close"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": ADMIN_ENV },
      body: JSON.stringify({ pollId, closed })
    });
    if (!r.ok) return alert("Failed to update poll.");
    loadPolls();
  }

  const [voteChoice, setVoteChoice] = useState("");
  const [activePollId, setActivePollId] = useState("");
  useEffect(() => { if (polls.length > 0 && !activePollId) setActivePollId(polls[0].id); }, [polls, activePollId]);

  async function castVote() {
    if (!activePollId) return alert("Choose a poll");
    if (!teamCode) {
      return alert("Enter your Team Code first (button above).");
    }
    if (!voteChoice) return alert("Select an option");

    try {
      const resp = await fetch(API("/api/polls/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pollId: activePollId,
          optionId: voteChoice,
          seasonId: espn.seasonId,
          teamCode
        })
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
  const poll = polls.find(p => p.id === activePollId);

  return (
    <Section title="Polls" actions={
      isAdmin ? (
        <div className="card" style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" placeholder="Question" value={createQ} onChange={e => setCreateQ(e.target.value)} style={{ width: 260 }} />
          <textarea className="input" placeholder="One option per line" value={createOpts} onChange={e => setCreateOpts(e.target.value)} style={{ width: 260, height: 60 }} />
          <button className="btn" style={btnPri} onClick={createPoll}>Create Poll</button>
        </div>
      ) : <span className="badge">Enter your code to vote</span>
    }>
      {err && <p style={{ color: "#dc2626" }}>{err}</p>}
      {loading && <p>Loading polls…</p>}
      {!loading && polls.length === 0 && <p style={{ color: "#64748b" }}>No polls yet.</p>}

      {polls.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "240px 1fr", gap: 16 }}>
          <div className="card" style={{ padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Polls</h3>

            <div style={{ margin: "6px 0 8px", fontSize: 12, color: "#64748b" }}>
              <label>
                <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed polls
              </label>
            </div>

            {isAdmin && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                <button className="btn" style={{ fontSize: 12, padding: "4px 8px" }} onClick={onIssueSeasonTeamCodes}>
                  Issue Season Team Codes
                </button>
                <button className="btn" style={{ fontSize: 12, padding: "4px 8px" }} onClick={onCopySeasonTeamCodes}>
                  Copy Team Codes
                </button>
              </div>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visiblePolls.map(p => (
                <li key={p.id} style={{ marginBottom: 6 }}>
                  <button className={`btn ${p.id === activePollId ? "primary" : ""}`} style={p.id === activePollId ? btnPri : btnSec} onClick={() => setActivePollId(p.id)}>
                    {p.question} {p.closed ? " (closed)" : ""}
                  </button>
                </li>
              ))}
              {visiblePolls.length === 0 && <li style={{ color: "#94a3b8" }}>No polls to show.</li>}
            </ul>
          </div>

          <div>
            {poll && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ marginTop: 0 }}>{poll.question}</h3>
                  {isAdmin && (
                    <div style={{ display: "flex", gap: 8 }}>
                      {poll.closed
                        ? <button className="btn" style={btnSec} onClick={() => setClosed(poll.id, false)}>Reopen</button>
                        : <button className="btn" style={btnSec} onClick={() => setClosed(poll.id, true)}>Close</button>}
                      <button className="btn" style={{ ...btnSec, background: "#fee2e2", color: "#991b1b" }} onClick={() => deletePoll(poll.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>

<div className="card" style={{ padding: 12, background: "#f8fafc", marginBottom: 12 }}>
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Season Team Code</div>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span className="badge" style={{ background: "#e5e7eb", color: "#0b1220" }}>
        {teamCode || "— not set —"}
      </span>
      <button
        className="btn"
        style={{ fontSize: 12, padding: "4px 8px" }}
        onClick={() => {
          const c = prompt("Enter your Voting Password for this season:");
          if (c) setTeamCode(c.toUpperCase().trim());
        }}
      >
        {teamCode ? "Change" : "Enter Code"}
      </button>
    </div>
  </div>

  <div style={{ marginBottom: 12 }}>
    {poll.options.map(o => (
      <label key={o.id} style={{ display: "block", marginBottom: 6, cursor: "pointer" }}>
        <input
          type="radio"
          name="pollChoice"
          value={o.id}
          checked={voteChoice === o.id}
          onChange={(e) => setVoteChoice(e.target.value)}
          style={{ marginRight: 8 }}
        />
        {o.label}
      </label>
    ))}
  </div>

  <div style={{ textAlign: "center" }}>
    <button
      className="btn"
      style={btnPri}
      onClick={castVote}
      disabled={poll.closed}
    >
      Vote
    </button>
  </div>
</div>

                <h4>Results</h4>
                {poll.options.map(o => {
                  const total = poll.options.reduce((s, x) => s + x.votes, 0) || 1;
                  const pct = Math.round(o.votes * 100 / total);
                  return (
                    <div key={o.id} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{o.label}</strong>
                        <span>{o.votes} ({pct}%)</span>
                      </div>
                      <div style={{ height: 8, background: "#e5e7eb", borderRadius: 999 }}>
                        <div style={{ width: `${pct}%`, height: 8, borderRadius: 999, background: "#0ea5e9" }} />
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
                  Votes cast: {poll.options.reduce((s, x) => s + (x.votes || 0), 0)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

/* =========================
   Form Components
   ========================= */
function AnnouncementEditor({ onPost, disabled }) {
  const [local, setLocal] = React.useState("");
  const ref = React.useRef(null);

  const focus = () => { if (ref.current) ref.current.focus(); };

  const exec = (cmd, val = null) => {
    focus();
    document.execCommand(cmd, false, val);
    if (ref.current) setLocal(ref.current.innerHTML);
  };

  const headingCycle = (e) => {
    e.preventDefault();
    focus();
    const cur = document.queryCommandValue("formatBlock");
    const next = /h1/i.test(cur) ? "P" : /h2/i.test(cur) ? "H1" : /h3/i.test(cur) ? "H2" : "H3";
    document.execCommand("formatBlock", false, next);
    if (ref.current) setLocal(ref.current.innerHTML);
  };

  const resetNormal = (e) => {
    e.preventDefault();
    focus();
    document.execCommand("removeFormat", false, null);
    document.execCommand("unlink", false, null);
    document.execCommand("formatBlock", false, "P");
    if (ref.current) setLocal(ref.current.innerHTML);
  };

  const clearAll = (e) => {
    e.preventDefault();
    if (!ref.current) return;
    ref.current.innerHTML = "";
    setLocal("");
    focus();
  };

  const insertLink = (e) => {
    e.preventDefault();
    const url = prompt("Link URL:", "https://");
    if (url) exec("createLink", url);
  };

  return (
    <div className="card" style={{ padding: 16, background: "#f8fafc" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}><b>B</b></button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}><i>I</i></button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}><u>U</u></button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("strikeThrough"); }}><s>S</s></button>
        <span style={{ width: 8 }} />
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>• List</button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}>1. List</button>
        <button className="btn" style={btnSec} onMouseDown={headingCycle}>H+</button>
        <button className="btn" style={btnSec} onMouseDown={insertLink}>Link</button>
        <button className="btn" style={btnSec} onMouseDown={resetNormal}>Normal</button>
        <button className="btn" style={btnSec} onMouseDown={clearAll}>Clear</button>
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
        <button
          className="btn"
          style={btnPri}
          disabled={disabled}
          onClick={() => {
            const html = (local || "").trim();
            if (!html || html === "<br>") return alert("Type something first");
            onPost(html);
            if (ref.current) ref.current.innerHTML = "";
            setLocal("");
            focus();
          }}
        >
          Post
        </button>
      </div>
    </div>
  );
}

function TradeForm({ onSubmit }) {
  const [player, setPlayer] = useState("");
  const [position, setPosition] = useState("");
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!player) return;
      onSubmit({ player, position, owner, notes });
      setPlayer("");
      setPosition("");
      setOwner("");
      setNotes("");
    }} className="card" style={{ padding: 16, background: "#f8fafc", marginBottom: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <input className="input" placeholder="Player" value={player} onChange={e => setPlayer(e.target.value)} />
        <input className="input" placeholder="Position (e.g., WR)" value={position} onChange={e => setPosition(e.target.value)} />
        <input className="input" placeholder="Owner" value={owner} onChange={e => setOwner(e.target.value)} />
      </div>
      <input className="input" placeholder="Notes" style={{ marginTop: 8 }} value={notes} onChange={e => setNotes(e.target.value)} />
      <div style={{ textAlign: "right", marginTop: 8 }}><button className="btn" style={btnPri}>Add to Block</button></div>
    </form>
  );
}

function parseWeekNumber(weekLabel) {
  return parseInt(String(weekLabel || "").replace(/\D/g, ""), 10) || 0;
}

function WeeklyForm({ seasonYear, onAdd }) {
  const [weekLabel, setWeekLabel] = useState(() => {
    const now = leagueWeekOf(new Date(), seasonYear).week || 1;
    return `Week ${now}`;
  });
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    const now = leagueWeekOf(new Date(), seasonYear).week || 1;
    setWeekLabel(`Week ${now}`);
  }, [seasonYear]);

  return (
    <div className="card" style={{ padding: 16, background: "#f8fafc" }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <input
          className="input"
          placeholder="Week label (e.g., Week 1)"
          value={weekLabel}
          onChange={(e) => setWeekLabel(e.target.value)}
        />
        <input
          className="input"
          placeholder="Title of Challenge"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <textarea
        className="input"
        style={{ minHeight: 120, marginTop: 8 }}
        placeholder="Describe this week's challenge…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button
          className="btn"
          style={btnPri}
          onClick={() => {
            const wk = parseWeekNumber(weekLabel);
            const cleaned = String(weekLabel || "").trim();
            if (!cleaned) return alert("Enter a week label (e.g., Week 1)");
            if (!text.trim()) return alert("Enter a description");

            onAdd({
              id: Math.random().toString(36).slice(2),
              weekLabel: cleaned,
              week: wk,
              title: title.trim(),
              text: text.trim(),
              createdAt: Date.now()
            });

            setTitle("");
            setText("");
            if (wk > 0) setWeekLabel(`Week ${wk + 1}`);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function AddMember({ onAdd }) {
  const [name, setName] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!name) return; onAdd(name); setName(""); }} style={{ display: "flex", gap: 8, margin: "8px 0 12px" }}>
      <input className="input" placeholder="Member name" value={name} onChange={e => setName(e.target.value)} />
      <button className="btn" style={btnPri}>Add</button>
    </form>
  );
}

function WaiverForm({ members, onAdd, disabled }) {
  const [userId, setUserId] = useState(members[0]?.id || "");
  const [player, setPlayer] = useState("");
  const [date, setDate] = useState(today());
  
  useEffect(() => { setUserId(members[0]?.id || ""); }, [members]);
  
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!userId || !player) return; onAdd(userId, player, date); setPlayer(""); }} className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
      <select className="input" value={userId} onChange={e => setUserId(e.target.value)} disabled={disabled}>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <input className="input" placeholder="Player" value={player} onChange={e => setPlayer(e.target.value)} disabled={disabled} />
      <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={disabled} />
      <div style={{ gridColumn: "1 / -1", textAlign: "right" }}><button className="btn" style={btnPri} disabled={disabled}>Add Pickup</button></div>
    </form>
  );
}

function BuyInTracker({ isAdmin, members, seasonYear, data, setData, updateBuyIns }) {
  const BUYIN = 200;
  const displayYear = new Date().getFullYear();

  const seasonKey = "current"; // Always use current season, not year-specific
  const cur = (data.buyins && data.buyins[seasonKey]) || {
    paid: {},
    hidden: false,
    venmoLink: "",
    zelleEmail: "",
    venmoQR: ""
  };

  const patch = async (updates) => {
    if (!updateBuyIns) {
      console.error('updateBuyIns function not provided');
      return;
    }
    
    const newData = { ...cur, ...updates };
    
    // Optimistically update local state
    setData(d => {
      return { 
        ...d, 
        buyins: { 
          ...(d.buyins || {}), 
          [seasonKey]: newData 
        } 
      };
    });
    
    // Save to server
    try {
      await updateBuyIns(seasonKey, newData);
    } catch (error) {
      console.error('Failed to update buy-ins:', error);
      // Revert local state on failure
      setData(d => {
        return { 
          ...d, 
          buyins: { 
            ...(d.buyins || {}), 
            [seasonKey]: cur 
          } 
        };
      });
      alert('Failed to save buy-in changes: ' + error.message);
    }
  };

  const togglePaid = (id) => patch({ paid: { ...cur.paid, [id]: !cur.paid[id] } });
  const markAll = () => patch({ paid: Object.fromEntries(members.map(m => [m.id, true])) });
  const resetAll = () => patch({ paid: {} });

  const paidCount = members.filter(m => cur.paid[m.id]).length;
  const allPaid = members.length > 0 && paidCount === members.length;

  if (cur.hidden && !isAdmin) return null;

  const [venmo, setVenmo] = React.useState(cur.venmoLink || "https://venmo.com/u/");
  const [zelle, setZelle] = React.useState(cur.zelleEmail || "");
  
  React.useEffect(() => { 
    setVenmo(cur.venmoLink || "https://venmo.com/u/"); 
    setZelle(cur.zelleEmail || ""); 
  }, [seasonKey, data.buyins]);

  const saveMeta = async () => {
    const venmoLink = venmo.trim();
    const zelleEmail = zelle.trim();
    await patch({ venmoLink, zelleEmail });
  };

  const onUploadQR = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => patch({ venmoQR: r.result || "" });
    r.readAsDataURL(f);
  };

  const copyZelle = async () => {
    const email = (cur.zelleEmail || "").trim();
    if (!email) return alert("No Zelle email set yet.");
    try { 
      await navigator.clipboard.writeText(email); 
      alert("Zelle username/email copied to clipboard! Paste into your Zelle app to Pay via Zelle!"); 
    } catch { 
      alert("Could not copy. Long-press / right-click to copy instead: " + email); 
    }
  };

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ marginTop: 0 }}>${BUYIN} Season Buy-In — {displayYear}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">{paidCount} / {members.length} paid</span>
          {isAdmin && (
            cur.hidden
              ? <button className="btn" onClick={() => patch({ hidden: false })}>Show tracker</button>
              : allPaid
                ? <button className="btn" onClick={() => patch({ hidden: true })}>Hide (all paid)</button>
                : null
          )}
        </div>
      </div>

      {members.length === 0 && (
        <p style={{ color: "#64748b", marginTop: 0 }}>
          No members yet. Import teams in <b>League Settings</b> first.
        </p>
      )}

      {members.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 16 }}>
          <div className="card" style={{ padding: 12, background: "#f8fafc" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong>Buy-In Paid Checklist ✅</strong>
              {isAdmin && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={markAll}>Mark all paid</button>
                  <button className="btn" onClick={resetAll}>Reset</button>
                </div>
              )}
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {[...members].sort((a, b) => a.name.localeCompare(b.name)).map(m => (
                <li key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #e2e8f0" }}>
                  <input
                    type="checkbox"
                    checked={!!cur.paid[m.id]}
                    onChange={() => isAdmin && togglePaid(m.id)}
                    disabled={!isAdmin}
                  />
                  <span style={{ textDecoration: cur.paid[m.id] ? "line-through" : "none" }}>{m.name}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card buyin-pay" style={{ padding: 12 }}>
            <h4 style={{ marginTop: 0 }}>Pay Dues</h4>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cur.venmoLink && cur.venmoLink !== "https://venmo.com/u/" && (
                <a className="btn primary" href={cur.venmoLink} target="_blank" rel="noreferrer">
                  Pay with Venmo
                </a>
              )}
              {cur.zelleEmail && (
                <button type="button" className="btn" onClick={copyZelle}>
                  Pay with Zelle
                </button>
              )}
            </div>

            {(cur.venmoQR || (cur.venmoLink && cur.venmoLink !== "https://venmo.com/u/") || cur.zelleEmail) && (
              <div style={{ marginTop: 8 }}>
                <a
                  href={cur.venmoLink || `mailto:${encodeURIComponent(cur.zelleEmail)}`}
                  target="_blank"
                  rel="noreferrer"
                  title={cur.venmoLink ? "Open Venmo" : "Email for Zelle"}
                >
                  {cur.venmoQR && (
                    <img src={cur.venmoQR} alt="Venmo QR" style={{ maxWidth: "200px", height: "auto" }} />
                  )}
                </a>
              </div>
            )}

            {isAdmin && (
              <>
                <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                  <input 
                    className="input" 
                    placeholder="https://venmo.com/u/YourHandle" 
                    value={venmo} 
                    onChange={e => setVenmo(e.target.value)}
                  />
                  <input 
                    className="input" 
                    placeholder="Zelle email" 
                    value={zelle} 
                    onChange={e => setZelle(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <input type="file" accept="image/*" onChange={onUploadQR} />
                  {cur.venmoQR && <button className="btn" onClick={() => patch({ venmoQR: "" })}>Remove QR</button>}
                  <button className="btn primary" onClick={saveMeta}>Save links</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RichEditor({ html, setHtml, readOnly }) {
  const [local, setLocal] = React.useState(html || "");
  const ref = React.useRef(null);
  const lastTyped = React.useRef(null);

  React.useEffect(() => { setLocal(html || ""); }, [html]);

  React.useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (local || "")) {
      ref.current.innerHTML = local || "";
    }
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (local !== lastTyped.current && el.innerHTML !== (local || "")) {
      el.innerHTML = local || "";
    }
  }, [local]);

  if (readOnly) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="prose" dangerouslySetInnerHTML={{ __html: local || "<p>No settings yet.</p>" }} />
      </div>
    );
  }

  const focus = () => { if (ref.current) ref.current.focus(); };

  const exec = (cmd, val = null) => {
    focus();
    document.execCommand(cmd, false, val);
    const htmlNow = ref.current?.innerHTML || "";
    lastTyped.current = htmlNow;
    setLocal(htmlNow);
  };

  const toggleH2 = (e) => {
    e.preventDefault();
    focus();
    const block = document.queryCommandValue("formatBlock");
    document.execCommand("formatBlock", false, /h2/i.test(block) ? "P" : "H2");
    const htmlNow = ref.current?.innerHTML || "";
    lastTyped.current = htmlNow;
    setLocal(htmlNow);
  };

  const resetNormal = (e) => {
    e.preventDefault();
    focus();
    document.execCommand("removeFormat", false, null);
    document.execCommand("unlink", false, null);
    document.execCommand("formatBlock", false, "P");
    const htmlNow = ref.current?.innerHTML || "";
    lastTyped.current = htmlNow;
    setLocal(htmlNow);
  };

  const clearAll = (e) => {
    e.preventDefault();
    if (!ref.current) return;
    ref.current.innerHTML = "";
    lastTyped.current = "";
    setLocal("");
  };

  const insertLink = (e) => {
    e.preventDefault();
    const url = prompt("Link URL:", "https://");
    if (url) exec("createLink", url);
  };

  return (
    <div className="card" style={{ padding: 16, background: "#f8fafc" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}><b>B</b></button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}><i>I</i></button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}><u>U</u></button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("strikeThrough"); }}><s>S</s></button>
        <span style={{ width: 8 }} />
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>• List</button>
        <button className="btn" style={btnSec} onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}>1. List</button>
        <button className="btn" style={btnSec} onMouseDown={toggleH2}>H2</button>
        <button className="btn" style={btnSec} onMouseDown={insertLink}>Link</button>
        <button className="btn" style={btnSec} onMouseDown={resetNormal}>Normal</button>
        <button className="btn" style={btnSec} onMouseDown={clearAll}>Clear</button>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="input"
        style={{ minHeight: 160, whiteSpace: "pre-wrap" }}
        onInput={(e) => {
          const htmlNow = e.currentTarget.innerHTML;
          lastTyped.current = htmlNow;
          setLocal(htmlNow);
        }}
      />

      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button className="btn" style={btnPri} onClick={() => setHtml(local)}>Save</button>
      </div>
    </div>
  );
}

/* =========================
   Helper Components
   ========================= */
function WeekSelector({ selectedWeek, setSelectedWeek, seasonYear }) {
  const go = (delta) => {
    const s = new Date(selectedWeek.start);
    s.setDate(s.getDate() + delta * 7);
    setSelectedWeek(leagueWeekOf(s, seasonYear));
  };
  
  const nowJump = () => {
    const w = leagueWeekOf(new Date(), seasonYear);
    const anchor = leagueWeekOf(firstWednesdayOfSeptemberPT(seasonYear), seasonYear);
    setSelectedWeek(w.week > 0 ? w : anchor);
  };
  
  const label = selectedWeek.week > 0 ? `Week ${selectedWeek.week} (Wed→Tue)` : `Preseason (Wed→Tue)`;
  
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="btn" style={btnSec} aria-label="Previous week" onClick={() => go(-1)}>◀</button>
      <span style={{ fontSize: 14, color: "#334155", minWidth: 170, textAlign: "center" }}>{label}</span>
      <button type="button" className="btn" style={btnSec} aria-label="Next week" onClick={() => go(1)}>▶</button>
      <button type="button" className="btn" style={btnSec} onClick={nowJump}>This Week</button>
    </div>
  );
}

function posIdToName(id) {
  const map = { 0: "QB", 1: "TQB", 2: "RB", 3: "RB", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP", 8: "DT", 9: "DE", 10: "LB", 11: "DE", 12: "DB", 13: "DB", 14: "DP", 15: "D/ST", 16: "D/ST", 17: "K" };
  return map?.[id] || "—";
}

function slotIdToName(counts) {
  const map = { 0: "QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP", 16: "D/ST", 17: "K", 20: "Bench", 21: "IR", 23: "FLEX", 24: "EDR", 25: "RDP", 26: "RDP", 27: "RDP", 28: "Head Coach" };
  const res = {};
  Object.keys(counts).forEach(k => res[k] = map[k] || `Slot ${k}`);
  return res;
}

/* =========================
   Splash and Overlays
   ========================= */
function IntroSplash() {
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShow(false), 1600); return () => clearTimeout(t); }, []);
  if (!show) return null;
  return <div className="splash"><Logo size={160} /></div>;
}

function SyncOverlay({ open, pct, msg }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
    }}>
      <div className="card" style={{ width: 420, padding: 16, background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Working…</div>
        <div style={{ fontSize: 12, color: "#93a3b8", minHeight: 18 }}>{msg}</div>
        <div style={{ height: 10, background: "#0f172a", borderRadius: 999, marginTop: 10, overflow: "hidden", border: "1px solid #1f2937" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "#38bdf8" }} />
        </div>
        <div style={{ textAlign: "right", fontSize: 12, marginTop: 6 }}>{pct}%</div>
      </div>
    </div>
  );
}