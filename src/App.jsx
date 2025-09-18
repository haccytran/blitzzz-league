// src/App.jsx - Version 3.0 with Subdomain Support
import React, { useEffect, useMemo, useState, useRef } from "react";
import { LandingPage } from './components/LandingPage.jsx';
import { useLeagueConfig } from './hooks/useLeagueConfig.js';
import { createLeagueAPI, createLeagueStorageKey } from './utils/leagueStorage.js';

/* =========================
   Global Config
   ========================= */
const ADMIN_ENV = import.meta.env.VITE_ADMIN_PASSWORD || "changeme";
const DEFAULT_LEAGUE_ID = import.meta.env.VITE_ESPN_LEAGUE_ID || "";
const DEFAULT_SEASON = import.meta.env.VITE_ESPN_SEASON || new Date().getFullYear();
const LEAGUE_TZ = "America/Los_Angeles";
const WEEK_START_DAY = 4; // Thursday

// This will be updated per league - keeping as fallback
const API = (p) => (import.meta.env.DEV ? `http://localhost:8787${p}` : p);

// Function to detect league from subdomain
function getLeagueFromSubdomain() {
  const hostname = window.location.hostname;
  console.log('Current hostname:', hostname);
  
  // Check for subdomain patterns first
  if (hostname.includes('blitzzz.')) {
    return 'blitzzz';
  } else if (hostname.includes('sculpin.')) {
    return 'sculpin';
  }
  
  // Always check URL parameters as fallback (not just localhost)
  const urlParams = new URLSearchParams(window.location.search);
  const leagueParam = urlParams.get('league');
  if (leagueParam) {
    return leagueParam;
  }
  
  return null;
}
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
  const offset = (4 - d.getDay() + 7) % 7; // 4 = Thursday
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

async function fetchEspnJson({ leagueId, seasonId, view, scoringPeriodId, matchupPeriodId, auth = false }) {
  if (!leagueId || !seasonId || !view) throw new Error("Missing leagueId/seasonId/view");
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const mp = matchupPeriodId ? `&matchupPeriodId=${matchupPeriodId}` : "";
  const au = auth ? `&auth=1` : "";
  const url = API(`/api/espn?leagueId=${leagueId}&seasonId=${seasonId}&view=${view}${sp}${mp}${au}`);
  
  console.log(`[ESPN API] Fetching: ${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}${matchupPeriodId ? ` (MP ${matchupPeriodId})` : ""}`);
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
      throw new Error(`ESPN returned non-JSON for ${view}${scoringPeriodId ? ` (SP ${scoringPeriodId})` : ""}${matchupPeriodId ? ` (MP ${matchupPeriodId})` : ""}. Snippet: ${text.slice(0,160).replace(/\s+/g," ")}`);
    }
  } catch (networkError) {
    const elapsed = Date.now() - startTime;
    console.error(`[ESPN API] Network error for ${view} (${elapsed}ms):`, networkError.message);
    throw networkError;
  }
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
   App Root with Subdomain Detection
   ========================= */
export default function App() {
  const [selectedLeague, setSelectedLeague] = useState(null);

  // Check for subdomain or URL parameter on startup
  useEffect(() => {
    const leagueFromSubdomain = getLeagueFromSubdomain();
    console.log('Detected league from subdomain/URL:', leagueFromSubdomain);

    if (leagueFromSubdomain) {
      // Import the config to validate the league exists
      import('./config/leagueConfigs').then(({ leagueConfigs }) => {
        console.log('Available league configs:', Object.keys(leagueConfigs));
        console.log('Looking for config:', leagueFromSubdomain);

        if (leagueConfigs[leagueFromSubdomain]) {
          console.log('Setting selected league to:', { id: leagueFromSubdomain, ...leagueConfigs[leagueFromSubdomain] });
          setSelectedLeague({ id: leagueFromSubdomain, ...leagueConfigs[leagueFromSubdomain] });
        } else {
          console.log('League not found in configs');
          // Don't clear URL - let them see the landing page
        }
      });
    }
  }, []);


  // Handle league selection from landing page
  const handleLeagueSelect = (league) => {
  console.log('League selected from landing page:', league);
  setSelectedLeague(league);
  
  // Update URL parameter for both development and production
  const url = new URL(window.location);
  url.searchParams.set('league', league.id);
  window.history.pushState({}, '', url);
};

  // Handle going back to league selection
  const handleBackToSelection = () => {
    setSelectedLeague(null);
    
    // For development, remove URL parameter
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      const url = new URL(window.location);
      url.searchParams.delete('league');
      window.history.pushState({}, '', url);
    }
  };

  if (!selectedLeague) {
    return <LandingPage onLeagueSelect={handleLeagueSelect} />;
  }

  return <LeagueHub selectedLeague={selectedLeague} onBackToSelection={handleBackToSelection} />;
}


   function LeagueHub({ selectedLeague, onBackToSelection }){
  useEffect(()=>{ document.title = "Blitzzz Fantasy Football League"; }, []);
   const currentYear = new Date().getFullYear();
const config = useLeagueConfig(selectedLeague);

console.log('=== LEAGUE DEBUGGING ===');
console.log('selectedLeague object:', selectedLeague);
console.log('config returned:', config);
console.log('config.id:', config.id);
console.log('URL params:', window.location.search);

const btnPri = config?.id === 'sculpin' 
  ? { background:"#FFC425", color:"#2F241D" }
  : config?.id === 'blitzzz'
  ? { background:"#0080C6", color:"#FFFFFF" }
  : { background:"#0ea5e9", color:"#fff" };

const btnSec = config?.id === 'sculpin'
  ? { background:"#fff8e1", color:"#2F241D", border:"1px solid #FFC425" }
  : config?.id === 'blitzzz'
  ? { background:"#bce1fc", color:"#0080C6", border:"1px solid #0080C6" }
  : { background:"#e5e7eb", color:"#0b1220" };

/* =========================
   Server API helpers
   ========================= */
async function apiCallLeague(endpoint, options = {}) {
  const leagueAPI = createLeagueAPI(config.id);
  const url = leagueAPI.API(endpoint);

  console.log('League ID:', config.id);  // ← Add this
  console.log('Generated URL:', url);    // ← Add this

  const configObj = {
    headers: { "Content-Type": "application/json" },
    ...options
  };
  
  if (configObj.method && configObj.method !== 'GET' && !configObj.headers["x-admin"]) {
    configObj.headers["x-admin"] = ADMIN_ENV;
  }
  
  const response = await fetch(url, configObj);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }
  return response.json();
}
  const VALID_TABS = [
  "announcements","activity","weekly","highestscorer","waivers","dues",
   "transactions","drafts","rosters","powerrankings","settings","trading","polls" 
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
    duesPayments: {}, 
    tradeBlock: [],
    leagueSettingsHtml: "",
    lastUpdated: null
  });

// Load data from server on mount
  useEffect(() => {
    loadServerData();
  }, []);

async function loadServerData() {
  try {
    const serverData = await apiCallLeague('/data').catch(() => ({
      announcements: [],
      weeklyList: [],
      members: [],
      waivers: [],
      buyins: {},
      duesPayments: {}, 
      tradeBlock: [],
      leagueSettingsHtml: "",
      lastUpdated: null
    }));
    setData(serverData);
  } catch (error) {
    console.error('Failed to load server data:', error);
  }
}
  // Commissioner mode
  const adminKey = createLeagueStorageKey(config.id, 'is_admin');
   const [isAdmin,setIsAdmin] = useState(localStorage.getItem(adminKey)==="1");
  function nextRoast(){
    const idx = Number(localStorage.getItem("ffl_roast_idx")||"0");
    const msg = ROASTS[idx % ROASTS.length];
    localStorage.setItem("ffl_roast_idx", String(idx+1));
    return msg;
  }

     const login = ()=>{
     const pass = prompt("Enter Commissioner Password:");
     const correctPassword = config.adminPassword || ADMIN_ENV; // Use league-specific password if available
     if(pass === correctPassword){
       setIsAdmin(true);
       localStorage.setItem(adminKey,"1");
       alert("Commissioner mode enabled");
     } else {
       alert(nextRoast());
     }
   };
  const logout = ()=>{ setIsAdmin(false); localStorage.removeItem(adminKey); };

const switchLeague = () => {
  // Clear URL parameter when switching leagues
  const url = new URL(window.location);
  url.searchParams.delete('league');
  window.history.pushState({}, '', url);
  onBackToSelection();
};

// ESPN config (replace the old useState)

const [espn, setEspn] = useState({ 
  leagueId: "", 
  seasonId: "" 
});

// Add this useEffect right after the espn useState
useEffect(() => {
  if (config && config.espn) {
    setEspn({
      leagueId: config.espn.leagueId,
      seasonId: config.espn.defaultSeason
    });
  }
}, [config]);

// Define loadDisplaySeason AFTER espn state exists

async function loadDisplaySeason() {
  try {
    console.log('Loading display season from server...');
    const response = await fetch(API('/api/report/default-season'));
    console.log('Server default season response:', response);
    
    // More robust season extraction
    let serverSeason = response?.season || response?.defaultSeason;
    
    // Convert to string and validate
    if (serverSeason) {
      serverSeason = String(serverSeason).trim();
      console.log('Extracted server season:', serverSeason);
    }
    
    // Use server season if valid, otherwise fallback to DEFAULT_SEASON
    const finalSeason = serverSeason || DEFAULT_SEASON;
    console.log('Final season to use:', finalSeason);
    
    setEspn(prev => ({ ...prev, seasonId: finalSeason }));
  } catch (error) {
    console.error('Failed to load display season:', error);
    console.log('Using DEFAULT_SEASON fallback:', DEFAULT_SEASON);
    
    // Always set a season on error
    setEspn(prev => ({ ...prev, seasonId: DEFAULT_SEASON }));
  }
}

// Dynamic title, favicon, and body class for theming
useEffect(() => {
  document.title = config.displayName;
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = config.favicon;
  
  // Add league-specific body class for styling
  document.body.className = ''; // Clear existing classes
  if (config.id === 'sculpin') {
    document.body.classList.add('sculpin-league');
  } else if (config.id === 'blitzzz') {
    document.body.classList.add('blitzzz-league');
  }
}, [config]);

// Cleanup body class when component unmounts
useEffect(() => {
  return () => {
    document.body.className = ''; // Clear league classes on unmount
  };
}, []);

// Load default season after espn state is initialized - with debugging
useEffect(() => {
  console.log('useEffect triggered - loading display season...');
  console.log('Current espn state:', espn);
  console.log('DEFAULT_SEASON constant:', DEFAULT_SEASON);
  
  loadDisplaySeason().then(() => {
    console.log('loadDisplaySeason completed');
  }).catch((error) => {
    console.error('loadDisplaySeason failed:', error);
  });
}, []); // Empty dependency array - only run on mount

// Auto-load official report when season changes
useEffect(() => {
  if (espn.seasonId) {
    loadOfficialReport(true);
  }
}, [espn.seasonId]);


  const seasonYear = Number(espn.seasonId) || new Date().getFullYear();

  // Weeks
const [selectedWeek, setSelectedWeek] = useState(leagueWeekOf(new Date(), seasonYear));
useEffect(()=>{ setSelectedWeek(leagueWeekOf(new Date(), seasonYear)); }, [seasonYear]);

const membersById = useMemo(()=>Object.fromEntries(data.members.map(m=>[m.id,m])),[data.members]);

  // Server-side CRUD operations
  const addAnnouncement = async (html) => {
    try {
      await apiCallLeague('/announcements', {
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
      await apiCallLeague('/announcements', {
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
      await apiCallLeague('/weekly', {
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
      await apiCallLeague('/weekly', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      await loadServerData();
    } catch (error) {
      alert('Failed to delete weekly challenge: ' + error.message);
    }
  };

   const editWeekly = async (id, updatedEntry) => {
  try {
    // First, delete the existing entry
    await apiCallLeague('/weekly', {
      method: 'DELETE',
      body: JSON.stringify({ id })
    });
    
    // Then add it back with updated data
    const newEntry = {
      ...updatedEntry,
      id: Math.random().toString(36).slice(2), // New ID
      createdAt: Date.now()
    };
    
    await apiCallLeague('/weekly', {
      method: 'POST',
      body: JSON.stringify({ entry: newEntry })
    });
    
    await loadServerData();
  } catch (error) {
    alert('Failed to edit weekly challenge: ' + error.message);
  }
};

  const deleteMember = async (id) => {
    try {
      await apiCallLeague('/members', {
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
      await apiCallLeague('/waivers', {
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
      await apiCallLeague('/waivers', {
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
      await apiCallLeague('/trading', {
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
      await apiCallLeague('/buyins', {
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
      await apiCallLeague('/trading', {
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
      await apiCallLeague('/settings', {
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
    // Fetch team data AND roster data
    const [teamJson, rosJson, setJson] = await Promise.all([
      fetchEspnJson({ leagueId: espn.leagueId, seasonId: espn.seasonId, view: "mTeam" }),
      fetchEspnJson({ leagueId: espn.leagueId, seasonId: espn.seasonId, view: "mRoster" }),
      fetchEspnJson({ leagueId: espn.leagueId, seasonId: espn.seasonId, view: "mSettings" }),
    ]);
    
    const teams = teamJson?.teams || [];
    if(!Array.isArray(teams) || teams.length===0) return alert("No teams found (check ID/season).");
    
    const names = [...new Set(teams.map(t => teamName(t)))];
    const teamsById = Object.fromEntries(teams.map(t => [t.id, teamName(t)]));
    const slotMap = slotIdToName(setJson?.settings?.rosterSettings?.lineupSlotCounts || {});
    
    // Build roster data with proper ordering
    const rosterData = (rosJson?.teams || []).map(t => {
      const entries = (t.roster?.entries || []).map(e => {
        const p = e.playerPoolEntry?.player;
        const fullName = p?.fullName || "Player";
        const slot = slotMap[e.lineupSlotId] || "—";
        // Try multiple ESPN position sources for better accuracy
let position = "";
if (p?.defaultPositionId) {
  position = posIdToName(p.defaultPositionId);
}
// Also check if there's position info in other ESPN fields
if (!position && p?.eligibleSlots) {
  // Use the first eligible slot that's a real position
  const eligiblePos = p.eligibleSlots
    .map(slotId => posIdToName(slotId))
    .find(pos => pos && !pos.includes("FLEX") && pos !== "—");
  if (eligiblePos) position = eligiblePos;
}
        
        return { 
          name: fullName.replace(/\s*\([^)]*\)\s*/g, '').trim(), 
          slot, 
          position
        };
      });

      // Separate starters and bench
      const starters = entries.filter(e => e.slot !== "Bench");
      const bench = entries.filter(e => e.slot === "Bench");
      
      // Define exact starter order
      const starterOrder = ["QB", "RB", "RB/WR", "WR", "TE", "FLEX", "D/ST", "K"];
      
      // Sort starters by the exact order you want
const sortedStarters = [];
const starterOrderWithCounts = [
  { pos: "QB", max: 1 },
  { pos: "RB", max: 2 }, 
  { pos: "RB/WR", max: 1 },
  { pos: "WR", max: 2 },
  { pos: "TE", max: 1 },
  { pos: "FLEX", max: 1 },
  { pos: "D/ST", max: 1 },
  { pos: "K", max: 1 }
];

starterOrderWithCounts.forEach(({ pos, max }) => {
  const playersInPosition = starters.filter(p => p.slot === pos);
  for (let i = 0; i < max; i++) {
    if (playersInPosition[i]) {
      sortedStarters.push(playersInPosition[i]);
    }
  }
});

      // Sort bench players and add position in parentheses
      const sortedBench = bench
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({
          name: p.position ? `${p.name} (${p.position})` : p.name,
          slot: p.slot
        }));
      
      // Combine starters and bench
      const finalEntries = [
        ...sortedStarters.map(p => ({ name: p.name, slot: p.slot })),
        ...sortedBench
      ];
      
      return { 
        teamName: teamsById[t.id] || `Team ${t.id}`, 
        entries: finalEntries 
      };
    });
    
    // Save both member names and roster data to server
    await apiCallLeague('/import-teams', {
      method: 'POST',
      body: JSON.stringify({ 
        teams: names,
        seasonId: espn.seasonId,
        rosterData: rosterData
      })
    });
    
    await loadServerData();
    alert(`Imported ${names.length} teams with rosters for season ${espn.seasonId}.`);
  } catch(e){ 
    console.error('Import error:', e);
    alert(e.message || "ESPN fetch failed. Check League/Season."); 
  }
};

  // Sync overlay state
  const [syncing, setSyncing] = useState(false);
  const [syncPct, setSyncPct] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");

  // Official report
  const [espnReport, setEspnReport] = useState(null);
  const [lastSynced, setLastSynced] = useState("");

// Add this function to your App.jsx file with your other server API functions

const updateDuesPayments = async (seasonId, updates) => {
  try {
    await apiCallLeague('/dues-payments', {
      method: 'POST',
      body: JSON.stringify({ seasonId, updates })
    });
  } catch (error) {
    console.error('Failed to update dues payments:', error);
    throw error;
  }
};

async function loadOfficialReport(silent=false){
  try{
    if(!silent){ setSyncing(true); setSyncPct(0); setSyncMsg("Loading official snapshot…"); }
    
    // Load the snapshot for the current season
    const r = await fetch(API(`/api/report?seasonId=${espn.seasonId}&leagueId=${config.id}`));
    
    if (r.ok){
      const j = await r.json();
      setEspnReport(j || null);
      setLastSynced(j?.lastSynced || "");
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
      headers: { "Content-Type":"application/json", "x-admin": config.adminPassword },
      body: JSON.stringify({ 
        leagueId: espn.leagueId, 
        seasonId: espn.seasonId,
        currentLeagueId: config.id // Add this line - passes current league ID
      })
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
  announcements: <AnnouncementsView {...{isAdmin,login,logout,data,addAnnouncement,deleteAnnouncement}} espn={espn} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} />,
  ...(config.id !== 'sculpin' && { weekly: <WeeklyView {...{isAdmin,data,addWeekly,deleteWeekly, editWeekly, seasonYear}} espn={espn} btnPri={btnPri} btnSec={btnSec} /> }),
  ...(config.id === 'sculpin' && { highestscorer: <HighestScorerView espn={espn} config={config} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} /> }),
  activity: <RecentActivityView espn={espn} config={config} btnPri={btnPri} btnSec={btnSec} />,
  transactions: <TransactionsView report={espnReport} loadOfficialReport={loadOfficialReport} btnPri={btnPri} btnSec={btnSec} />,
  drafts: <DraftsView espn={espn} btnPri={btnPri} btnSec={btnSec} />,
  waivers: <WaiversView 
  espnReport={espnReport}
  isAdmin={isAdmin}
  data={data}
  selectedWeek={selectedWeek}
  setSelectedWeek={setSelectedWeek}
  seasonYear={seasonYear}
  membersById={membersById}
  updateOfficialSnapshot={updateOfficialSnapshot}
  setActive={setActive}
  loadServerData={loadServerData}
  addWaiver={addWaiver}
  deleteWaiver={deleteWaiver}
  deleteMember={deleteMember}
  btnPri={btnPri}
  btnSec={btnSec}
/>,
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
  updateDuesPayments={updateDuesPayments}
  btnPri={btnPri}
  btnSec={btnSec}
/>,
  rosters: <Rosters leagueId={espn.leagueId} seasonId="2025" apiCallLeague={apiCallLeague} btnPri={btnPri} btnSec={btnSec} />,
  powerrankings: <PowerRankingsView espn={espn} config={config} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} />,
  settings: <SettingsView {...{isAdmin,espn,setEspn,importEspnTeams,data,saveLeagueSettings}} btnPri={btnPri} btnSec={btnSec}/>,
  trading: <TradingView {...{isAdmin,addTrade,deleteTrade,data}} btnPri={btnPri} btnSec={btnSec}/>,
  polls: <PollsView {...{isAdmin, members:data.members, espn, config}} btnPri={btnPri} btnSec={btnSec}/>
};

  return (
  <>
    <IntroSplash selectedLeague={selectedLeague}/>
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
     <img src={config.logo} alt={`${config.name} Logo`} style={{width: 128, height: 128}} />
     <div className="brand-title">{config.name} <span>Fantasy Football League</span></div>
     
     <button 
       className="btn" 
       onClick={switchLeague}
       style={{
         marginTop: 8,
         fontSize: 12,
         padding: "4px 12px",
         background: "rgba(255, 255, 255, 0.1)",
         color: "#e2e8f0",
         border: "1px solid rgba(255, 255, 255, 0.2)",
         borderRadius: 6
       }}
     >
       ← Switch League
     </button>
   </div>
            <NavBtn id="announcements" label="📣 Announcements" active={active} onClick={setActive}/>
{config.id !== 'sculpin' && <NavBtn id="weekly" label="🗓️ Weekly Challenges" active={active} onClick={setActive}/>}
{config.id === 'sculpin' && <NavBtn id="highestscorer" label="🏆 Highest Scorer" active={active} onClick={setActive}/>}
<NavBtn id="activity" label="⏱️ Recent Activity" active={active} onClick={setActive}/> 
            <NavBtn id="waivers" label="💵 Waivers" active={active} onClick={setActive}/>
            <NavBtn id="dues" label="🧾 Dues" active={active} onClick={setActive}/>
            <NavBtn id="transactions" label="📜 Transactions" active={active} onClick={setActive}/>
            <NavBtn id="drafts" label="📋 Draft Recap" active={active} onClick={setActive}/>
            <NavBtn id="rosters" label="📋 Rosters" active={active} onClick={setActive}/>
            <NavBtn id="powerrankings" label="🏋️ Power Rankings" active={active} onClick={setActive}/>
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

function AnnouncementsView({isAdmin,login,logout,data,addAnnouncement,deleteAnnouncement, espn, seasonYear, btnPri, btnSec}){
  return (
    <Section title="Announcements" actions={
      <>
        {isAdmin ? <button className="btn" style={btnSec} onClick={logout}>Commissioner Log out</button> : <button className="btn" style={btnPri} onClick={login}>Commissioner Login</button>}
        <button className="btn" style={btnSec} onClick={()=>downloadCSV("league-data-backup.csv", [["Exported", new Date().toLocaleString()]],)}>Export</button>
      </>
    }>
      {isAdmin && <AnnouncementEditor onPost={(html) => addAnnouncement(html)} disabled={!isAdmin} btnPri={btnPri} btnSec={btnSec} />}

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

function RecentActivityView({ espn, config, btnPri, btnSec }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activities, setActivities] = useState([]);
  const [report, setReport] = useState(null);

async function loadReport() {
  setLoading(true);
  setError("");
  try {
    const r = await fetch(API(`/api/report?seasonId=${espn.seasonId}&leagueId=${config.id}`));
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
  opacity: activity.isDraft ? 0.8 : 1,
  color: activity.action === "ADDED" ? "#16a34a" : "#dc2626" // Green for adds, red for drops
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
                     </div>
        )}
      </div>
    </Section>
  );
}

function WeeklyView({ isAdmin, data, addWeekly, deleteWeekly, editWeekly, seasonYear, espn, btnPri, btnSec }) {
  const [editingId, setEditingId] = useState(null);
  const [weeklyWinners, setWeeklyWinners] = useState({});
  const [loading, setLoading] = useState(false);
  const [manualWinners, setManualWinners] = useState({});
  
  const currentYear = new Date().getFullYear();
  const nowWeek = leagueWeekOf(new Date(), seasonYear).week || 0;

  // Load weekly challenge winners
  const loadWeeklyChallengeWinners = async () => {
    if (!espn.leagueId || !espn.seasonId) return;
    
    setLoading(true);
    try {
      const winners = {};
      const now = new Date();
      const week1EndDate = new Date('2025-09-08T23:59:00-07:00'); // Adjust this to your league's Week 1 end
      
      // Process weeks 1-13
      for (let week = 1; week <= 13; week++) {
        const weekEnd = new Date(week1EndDate);
        weekEnd.setDate(week1EndDate.getDate() + ((week - 1) * 7));
        
        // Only process completed weeks
        if (now <= weekEnd) continue;
        
        try {
          const winner = await determineWeeklyWinner(week, espn.leagueId, espn.seasonId);
          if (winner) {
            winners[week] = winner;
          }
        } catch (error) {
          console.error(`Failed to determine Week ${week} winner:`, error);
        }
      }
      
      setWeeklyWinners(winners);
    } catch (error) {
      console.error('Failed to load weekly winners:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (espn.leagueId && espn.seasonId) {
      loadWeeklyChallengeWinners();
    }
  }, [espn.leagueId, espn.seasonId]);

  const list = Array.isArray(data.weeklyList) ? [...data.weeklyList] : [];
  
  // Keep chronological order, don't move completed weeks
  list.sort((a, b) => (a.week || 0) - (b.week || 0));

  return (
    <Section title="Weekly Challenges" actions={
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" style={btnSec} onClick={loadWeeklyChallengeWinners} disabled={loading}>
          {loading ? "Loading..." : "Refresh Winners"}
        </button>
      </div>
    }>
      {isAdmin && <WeeklyForm seasonYear={seasonYear} onAdd={addWeekly} btnPri={btnPri} btnSec={btnSec} />}
      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        {list.length === 0 && (
          <div className="card" style={{ padding: 16, color: "#64748b" }}>
            No weekly challenges yet.
          </div>
        )}
        {list.map(item => {
          const weekNumber = item.week || 0;
          const winner = weeklyWinners[weekNumber];
          const requiresManual = [6, 12].includes(weekNumber);
          const isEditing = editingId === item.id;
          
          return (
            <div key={item.id} className="card" style={{ padding: 16 }}>
              {isEditing ? (
                <WeeklyEditForm 
                  item={item} 
                  onSave={(updatedEntry) => {
                    editWeekly(item.id, updatedEntry);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                  btnPri={btnPri}
                  btnSec={btnSec}
                />
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <h3 style={{ margin: 0 }}>
                        {item.weekLabel || "Week"}
                        {item.title ? <span style={{ fontWeight: 400, color: "#64748b" }}> — {item.title}</span> : null}
                      </h3>
                    </div>
                    {isAdmin && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn"
                          style={btnSec}
                          onClick={() => setEditingId(item.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn"
                          style={{ ...btnSec, background: "#fee2e2", color: "#991b1b" }}
                          onClick={() => deleteWeekly(item.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                    {item.text}
                  </div>

                  {/* Winner Display */}
                  {winner && (
                    <div style={{ 
                      marginTop: 12, 
                      padding: 12, 
                      background: "#f0f9ff", 
                      borderRadius: 6,
                      border: "1px solid #0ea5e9"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: "18px" }}>🏆</span>
                        <span style={{ 
                          fontWeight: "bold", 
                          color: "#0066cc",
                          textShadow: "0 0 8px #ffff00, 0 0 12px #ffff00",
                          fontSize: "16px"
                        }}>
                          {winner.teamName}
                        </span>
                      </div>
                      {winner.details && (
                        <div style={{ marginTop: 4, fontSize: "14px", color: "#334155" }}>
                          {winner.details}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual Winner Selection for Weeks 6 & 12 */}
                  {requiresManual && isAdmin && !winner && (
                    <ManualWinnerSelector
                      weekNumber={weekNumber}
                      espn={espn}
                      onWinnerSelect={(winnerData) => {
                        setWeeklyWinners(prev => ({ ...prev, [weekNumber]: winnerData }));
                      }}
                      btnPri={btnPri}
                      btnSec={btnSec}
                    />
                  )}

                  {requiresManual && !winner && !isAdmin && (
                    <div style={{ 
                      marginTop: 12, 
                      padding: 12, 
                      background: "#fef3c7", 
                      borderRadius: 6
                    }}>
                      <div style={{ fontSize: "14px", color: "#92400e" }}>
                        Winner requires manual selection by commissioner.
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ManualWinnerSelector({ weekNumber, espn, onWinnerSelect, btnPri, btnSec }) {
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadTeams = async () => {
      try {
        const response = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${espn.seasonId}/segments/0/leagues/${espn.leagueId}?view=mTeam`, {
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          const teamList = (data.teams || []).map(team => ({
            id: team.id,
            name: (team.location && team.nickname) 
              ? `${team.location} ${team.nickname}` 
              : `Team ${team.id}`
          }));
          setTeams(teamList);
        }
      } catch (error) {
        console.error('Failed to load teams:', error);
      }
    };

    if (espn.leagueId && espn.seasonId) {
      loadTeams();
    }
  }, [espn.leagueId, espn.seasonId]);

  const handleSaveWinner = async () => {
    if (!selectedTeam) return;
    
    setLoading(true);
    const teamName = teams.find(t => t.id.toString() === selectedTeam)?.name || selectedTeam;
    
    const winnerData = {
      teamName: teamName,
      details: `Manually selected winner for Week ${weekNumber}`,
      manual: true
    };

    // Save to server (you'll need to implement this endpoint)
    try {
      // await apiCallLeague('/weekly-winners', {
      //   method: 'POST',
      //   body: JSON.stringify({ week: weekNumber, winner: winnerData })
      // });
      
      onWinnerSelect(winnerData);
    } catch (error) {
      console.error('Failed to save winner:', error);
    }
    
    setLoading(false);
  };

  return (
    <div style={{ 
      marginTop: 12, 
      padding: 12, 
      background: "#f8fafc", 
      borderRadius: 6,
      border: "1px solid #e2e8f0"
    }}>
      <div style={{ marginBottom: 8, fontWeight: "600" }}>Select Winner:</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select 
          className="input" 
          value={selectedTeam} 
          onChange={(e) => setSelectedTeam(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">Choose team...</option>
          {teams.map(team => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        <button 
          className="btn" 
          style={btnPri} 
          onClick={handleSaveWinner}
          disabled={!selectedTeam || loading}
        >
          {loading ? "Saving..." : "Save Winner"}
        </button>
      </div>
    </div>
  );
}

// DETERMINE WEEKLY WINNER
async function determineWeeklyWinner(weekNumber, leagueId, seasonId) {
  try {
    // Get team names with better error handling and data structure
    const teamResponse = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mTeam`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!teamResponse.ok) {
      throw new Error(`Team data fetch failed: ${teamResponse.status}`);
    }
    
    const teamData = await teamResponse.json();
    console.log('Team data for weekly challenges:', teamData); // Debug log
    
    const teamNames = {};
    if (teamData.teams) {
      teamData.teams.forEach(team => {
        let name = "";
        if (team.location && team.nickname) {
          name = `${team.location} ${team.nickname}`;
        } else if (team.name) {
          name = team.name;
        } else if (team.abbrev) {
          name = team.abbrev;
        } else {
          name = `Team ${team.id}`;
        }
        teamNames[team.id] = name;
        console.log(`Weekly challenge team mapping: ${team.id} -> ${name}`); // Debug log
      });
    }

    console.log('Final team names mapping:', teamNames); // Debug log

    // Get matchup data for team-level challenges
    const matchupResponse = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mMatchup`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const matchupData = await matchupResponse.json();

    // Get detailed player data for player-level challenges
    const boxscoreResponse = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mBoxscore&scoringPeriodId=${weekNumber}`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const boxscoreData = await boxscoreResponse.json();

    // Determine winner based on week number
    switch (weekNumber) {
      case 1: // Hot Start - Highest overall team score (starters)
        return determineHighestScoringTeam(matchupData, teamNames, weekNumber);
        
      case 2: // Photo Finish - Closest margin of victory
        return determineClosestMargin(matchupData, teamNames, weekNumber);
        
      case 3: // Biggest Blow out - Largest margin of victory
        return determineLargestMargin(matchupData, teamNames, weekNumber);
        
      case 4: // Dirty 30 - Player closest to 30 points
        return determineDirty30(boxscoreData, teamNames, weekNumber);
        
      case 5: // Highest Scoring WR/RB
        return determineHighestWRRB(boxscoreData, teamNames, weekNumber);
        
      case 7: // Hero to Zero - Biggest point drop from Week 6 to Week 7
        return determineHeroToZero(matchupData, teamNames, weekNumber, leagueId, seasonId);
        
      case 8: // Highest Scoring TE
        return determineHighestTE(boxscoreData, teamNames, weekNumber);
        
      case 9: // MVP - Highest scoring individual player
        return determineMVP(boxscoreData, teamNames, weekNumber);
        
      case 10: // Best Loser - Highest scoring losing team
        return determineBestLoser(matchupData, teamNames, weekNumber);
        
      case 11: // Bench Warmer - Highest scoring bench player
        return determineBenchWarmer(boxscoreData, teamNames, weekNumber);
        
      case 13: // Highest Scoring D/ST
        return determineHighestDST(boxscoreData, teamNames, weekNumber);
        
      case 6: // Over-Achiever - Manual selection required
      case 12: // Bulls-Eye - Manual selection required
        return null;
        
      default:
        return null;
    }
  } catch (error) {
    console.error(`Error determining Week ${weekNumber} winner:`, error);
    return null;
  }
}

// Helper function to get player position name
function getPositionName(positionId) {
  const positions = {
    0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 
    6: "TE", 7: "OP", 16: "D/ST", 17: "K", 20: "Bench"
  };
  return positions[positionId] || "Unknown";
}

// Helper function to get lineup slot name
function getLineupSlotName(slotId) {
  const slots = {
    0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST", 17: "K",
    20: "Bench", 21: "IR", 23: "FLEX"
  };
  return slots[slotId] || "Unknown";
}

// Week 1: Highest overall team score (starters)
function determineHighestScoringTeam(matchupData, teamNames, weekNumber) {
  let highestScore = 0;
  let winningTeam = null;
  
  if (matchupData.schedule) {
    matchupData.schedule.forEach(matchup => {
      if (matchup.matchupPeriodId === weekNumber) {
        const homeScore = matchup.home?.totalPoints || 0;
        const awayScore = matchup.away?.totalPoints || 0;
        
        if (homeScore > highestScore) {
          highestScore = homeScore;
          winningTeam = matchup.home.teamId;
        }
        if (awayScore > highestScore) {
          highestScore = awayScore;
          winningTeam = matchup.away.teamId;
        }
      }
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `Scored ${highestScore.toFixed(1)} points`
    };
  }
  return null;
}

// Week 2: Closest margin of victory
function determineClosestMargin(matchupData, teamNames, weekNumber) {
  let closestMargin = Infinity;
  let winningTeam = null;
  
  if (matchupData.schedule) {
    matchupData.schedule.forEach(matchup => {
      if (matchup.matchupPeriodId === weekNumber) {
        const homeScore = matchup.home?.totalPoints || 0;
        const awayScore = matchup.away?.totalPoints || 0;
        const margin = Math.abs(homeScore - awayScore);
        
        if (margin < closestMargin && margin > 0) {
          closestMargin = margin;
          winningTeam = homeScore > awayScore ? matchup.home.teamId : matchup.away.teamId;
        }
      }
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `Won by ${closestMargin.toFixed(1)} points`
    };
  }
  return null;
}

// Week 3: Largest margin of victory
function determineLargestMargin(matchupData, teamNames, weekNumber) {
  let largestMargin = 0;
  let winningTeam = null;
  
  if (matchupData.schedule) {
    matchupData.schedule.forEach(matchup => {
      if (matchup.matchupPeriodId === weekNumber) {
        const homeScore = matchup.home?.totalPoints || 0;
        const awayScore = matchup.away?.totalPoints || 0;
        const margin = Math.abs(homeScore - awayScore);
        
        if (margin > largestMargin) {
          largestMargin = margin;
          winningTeam = homeScore > awayScore ? matchup.home.teamId : matchup.away.teamId;
        }
      }
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `Won by ${largestMargin.toFixed(1)} points`
    };
  }
  return null;
}

// Week 4: Player closest to 30 points
function determineDirty30(boxscoreData, teamNames, weekNumber) {
  let closestTo30 = Infinity;
  let winningTeam = null;
  let playerName = "";
  let playerScore = 0;
  
  if (boxscoreData.schedule) {
    boxscoreData.schedule.forEach(matchup => {
      [matchup.home, matchup.away].forEach(team => {
        if (team?.rosterForCurrentScoringPeriod?.entries) {
          team.rosterForCurrentScoringPeriod.entries.forEach(entry => {
            if (entry.lineupSlotId !== 20) { // Not bench
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              
              if (stats && Array.isArray(stats)) {
                const weekStats = stats.find(s => s.scoringPeriodId === weekNumber);
                if (weekStats?.appliedTotal) {
                  const score = weekStats.appliedTotal;
                  const diff = Math.abs(score - 30);
                  
                  if (diff < closestTo30) {
                    closestTo30 = diff;
                    winningTeam = team.teamId;
                    playerName = player.fullName || "Unknown Player";
                    playerScore = score;
                  }
                }
              }
            }
          });
        }
      });
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `${playerName} scored ${playerScore.toFixed(1)} points (${closestTo30.toFixed(1)} from 30)`
    };
  }
  return null;
}

// Week 5: Highest Scoring WR/RB
function determineHighestWRRB(boxscoreData, teamNames, weekNumber) {
  let highestScore = 0;
  let winningTeam = null;
  let playerName = "";
  let position = "";
  
  if (boxscoreData.schedule) {
    boxscoreData.schedule.forEach(matchup => {
      [matchup.home, matchup.away].forEach(team => {
        if (team?.rosterForCurrentScoringPeriod?.entries) {
          team.rosterForCurrentScoringPeriod.entries.forEach(entry => {
            if (entry.lineupSlotId !== 20) { // Not bench
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              const playerPos = player?.defaultPositionId;
              
              // Check if WR (4) or RB (2)
              if (playerPos === 2 || playerPos === 4) {
                if (stats && Array.isArray(stats)) {
                  const weekStats = stats.find(s => s.scoringPeriodId === weekNumber);
                  if (weekStats?.appliedTotal) {
                    const score = weekStats.appliedTotal;
                    
                    if (score > highestScore) {
                      highestScore = score;
                      winningTeam = team.teamId;
                      playerName = player.fullName || "Unknown Player";
                      position = getPositionName(playerPos);
                    }
                  }
                }
              }
            }
          });
        }
      });
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `${playerName} (${position}) scored ${highestScore.toFixed(1)} points`
    };
  }
  return null;
}

// Week 7: Hero to Zero - Biggest point drop from Week 6 to Week 7
async function determineHeroToZero(matchupData, teamNames, weekNumber, leagueId, seasonId) {
  try {
    // Get Week 6 scores
    const week6Response = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mMatchup`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const week6Data = await week6Response.json();
    
    // Build Week 6 scores by team
    const week6Scores = {};
    if (week6Data.schedule) {
      week6Data.schedule.forEach(matchup => {
        if (matchup.matchupPeriodId === 6) {
          const homeScore = matchup.home?.totalPoints || 0;
          const awayScore = matchup.away?.totalPoints || 0;
          
          if (matchup.home?.teamId) week6Scores[matchup.home.teamId] = homeScore;
          if (matchup.away?.teamId) week6Scores[matchup.away.teamId] = awayScore;
        }
      });
    }
    
    // Build Week 7 scores and find biggest drop
    let biggestDrop = 0;
    let winningTeam = null;
    let week6Score = 0;
    let week7Score = 0;
    
    if (matchupData.schedule) {
      matchupData.schedule.forEach(matchup => {
        if (matchup.matchupPeriodId === 7) {
          [matchup.home, matchup.away].forEach(team => {
            const teamId = team.teamId;
            const week7TeamScore = team.totalPoints || 0;
            const week6TeamScore = week6Scores[teamId] || 0;
            
            // Only count if they scored LESS in Week 7
            if (week7TeamScore < week6TeamScore) {
              const drop = week6TeamScore - week7TeamScore;
              
              if (drop > biggestDrop) {
                biggestDrop = drop;
                winningTeam = teamId;
                week6Score = week6TeamScore;
                week7Score = week7TeamScore;
              }
            }
          });
        }
      });
    }
    
    if (winningTeam) {
      return {
        teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
        details: `Dropped ${biggestDrop.toFixed(1)} points (${week6Score.toFixed(1)} to ${week7Score.toFixed(1)})`
      };
    }
    return null;
  } catch (error) {
    console.error('Error in Hero to Zero calculation:', error);
    return null;
  }
}

// Week 8: Highest Scoring TE
function determineHighestTE(boxscoreData, teamNames, weekNumber) {
  let highestScore = 0;
  let winningTeam = null;
  let playerName = "";
  
  if (boxscoreData.schedule) {
    boxscoreData.schedule.forEach(matchup => {
      [matchup.home, matchup.away].forEach(team => {
        if (team?.rosterForCurrentScoringPeriod?.entries) {
          team.rosterForCurrentScoringPeriod.entries.forEach(entry => {
            if (entry.lineupSlotId !== 20) { // Not bench
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              const playerPos = player?.defaultPositionId;
              
              // Check if TE (6)
              if (playerPos === 6) {
                if (stats && Array.isArray(stats)) {
                  const weekStats = stats.find(s => s.scoringPeriodId === weekNumber);
                  if (weekStats?.appliedTotal) {
                    const score = weekStats.appliedTotal;
                    
                    if (score > highestScore) {
                      highestScore = score;
                      winningTeam = team.teamId;
                      playerName = player.fullName || "Unknown Player";
                    }
                  }
                }
              }
            }
          });
        }
      });
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `${playerName} (TE) scored ${highestScore.toFixed(1)} points`
    };
  }
  return null;
}

// Week 9: MVP - Highest scoring individual player
function determineMVP(boxscoreData, teamNames, weekNumber) {
  let highestScore = 0;
  let winningTeam = null;
  let playerName = "";
  let position = "";
  
  if (boxscoreData.schedule) {
    boxscoreData.schedule.forEach(matchup => {
      [matchup.home, matchup.away].forEach(team => {
        if (team?.rosterForCurrentScoringPeriod?.entries) {
          team.rosterForCurrentScoringPeriod.entries.forEach(entry => {
            if (entry.lineupSlotId !== 20) { // Not bench
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              
              if (stats && Array.isArray(stats)) {
                const weekStats = stats.find(s => s.scoringPeriodId === weekNumber);
                if (weekStats?.appliedTotal) {
                  const score = weekStats.appliedTotal;
                  
                  if (score > highestScore) {
                    highestScore = score;
                    winningTeam = team.teamId;
                    playerName = player.fullName || "Unknown Player";
                    position = getPositionName(player.defaultPositionId);
                  }
                }
              }
            }
          });
        }
      });
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `${playerName} (${position}) scored ${highestScore.toFixed(1)} points`
    };
  }
  return null;
}

// Week 10: Best Loser - Highest scoring losing team
function determineBestLoser(matchupData, teamNames, weekNumber) {
  let highestLosingScore = 0;
  let winningTeam = null;
  
  if (matchupData.schedule) {
    matchupData.schedule.forEach(matchup => {
      if (matchup.matchupPeriodId === weekNumber) {
        const homeScore = matchup.home?.totalPoints || 0;
        const awayScore = matchup.away?.totalPoints || 0;
        
        // Determine loser and check if they have highest losing score
        if (homeScore < awayScore && homeScore > highestLosingScore) {
          highestLosingScore = homeScore;
          winningTeam = matchup.home.teamId;
        } else if (awayScore < homeScore && awayScore > highestLosingScore) {
          highestLosingScore = awayScore;
          winningTeam = matchup.away.teamId;
        }
      }
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `Scored ${highestLosingScore.toFixed(1)} points in a loss`
    };
  }
  return null;
}

// Week 11: Bench Warmer - Highest scoring bench player
function determineBenchWarmer(boxscoreData, teamNames, weekNumber) {
  let highestScore = 0;
  let winningTeam = null;
  let playerName = "";
  let position = "";
  
  if (boxscoreData.schedule) {
    boxscoreData.schedule.forEach(matchup => {
      [matchup.home, matchup.away].forEach(team => {
        if (team?.rosterForCurrentScoringPeriod?.entries) {
          team.rosterForCurrentScoringPeriod.entries.forEach(entry => {
            if (entry.lineupSlotId === 20) { // Bench only
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              
              if (stats && Array.isArray(stats)) {
                const weekStats = stats.find(s => s.scoringPeriodId === weekNumber);
                if (weekStats?.appliedTotal) {
                  const score = weekStats.appliedTotal;
                  
                  if (score > highestScore) {
                    highestScore = score;
                    winningTeam = team.teamId;
                    playerName = player.fullName || "Unknown Player";
                    position = getPositionName(player.defaultPositionId);
                  }
                }
              }
            }
          });
        }
      });
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `${playerName} (${position}) scored ${highestScore.toFixed(1)} points on bench`
    };
  }
  return null;
}

// Week 13: Highest Scoring D/ST
function determineHighestDST(boxscoreData, teamNames, weekNumber) {
  let highestScore = 0;
  let winningTeam = null;
  let defenseTeam = "";
  
  if (boxscoreData.schedule) {
    boxscoreData.schedule.forEach(matchup => {
      [matchup.home, matchup.away].forEach(team => {
        if (team?.rosterForCurrentScoringPeriod?.entries) {
          team.rosterForCurrentScoringPeriod.entries.forEach(entry => {
            if (entry.lineupSlotId !== 20) { // Not bench
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              const playerPos = player?.defaultPositionId;
              
              // Check if D/ST (16)
              if (playerPos === 16) {
                if (stats && Array.isArray(stats)) {
                  const weekStats = stats.find(s => s.scoringPeriodId === weekNumber);
                  if (weekStats?.appliedTotal) {
                    const score = weekStats.appliedTotal;
                    
                    if (score > highestScore) {
                      highestScore = score;
                      winningTeam = team.teamId;
                      defenseTeam = player.fullName || "Unknown Defense";
                    }
                  }
                }
              }
            }
          });
        }
      });
    });
  }
  
  if (winningTeam) {
    return {
      teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
      details: `${defenseTeam} scored ${highestScore.toFixed(1)} points`
    };
  }
  return null;
}

function WeeklyEditForm({ item, onSave, onCancel, btnPri, btnSec }) {
  const [weekLabel, setWeekLabel] = useState(item.weekLabel || "");
  const [title, setTitle] = useState(item.title || "");
  const [text, setText] = useState(item.text || "");

  const handleSave = () => {
    if (!weekLabel.trim()) return alert("Enter a week label");
    if (!text.trim()) return alert("Enter a description");
    
    onSave({
      weekLabel: weekLabel.trim(),
      title: title.trim(),
      text: text.trim(),
      week: parseInt(String(weekLabel || "").replace(/\D/g, ""), 10) || 0
    });
  };

  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
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
        style={{ minHeight: 120, marginBottom: 8 }}
        placeholder="Describe this week's challenge..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" style={btnSec} onClick={onCancel}>Cancel</button>
        <button className="btn" style={btnPri} onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}

// DUES PAYMENT TRACKER

function DuesPaymentTracker({ isAdmin, data, setData, seasonId, report, updateDuesPayments, btnPri, btnSec }) {
 const displayYear = new Date().getFullYear();
  if (!report || !report.totalsRows) return null;

  const seasonKey = String(seasonId);
  const currentPayments = (data.duesPayments && data.duesPayments[seasonKey]) || {};

  const updatePayment = async (teamName, isPaid) => {
    if (!isAdmin) return;

    const updates = { ...currentPayments, [teamName]: isPaid };
    
    // Optimistically update local state
    setData(prevData => ({
      ...prevData,
      duesPayments: {
        ...(prevData.duesPayments || {}),
        [seasonKey]: updates
      }
    }));

    // Save to server
    try {
      await updateDuesPayments(seasonKey, updates);
    } catch (error) {
      console.error('Failed to update dues payment:', error);
      // Revert local state on failure
      setData(prevData => ({
        ...prevData,
        duesPayments: {
          ...(prevData.duesPayments || {}),
          [seasonKey]: currentPayments
        }
      }));
      alert('Failed to save payment status: ' + error.message);
    }
  };

  const markAllPaid = async () => {
    if (!isAdmin) return;
    const allPaid = Object.fromEntries(report.totalsRows.map(row => [row.name, true]));
    
    setData(prevData => ({
      ...prevData,
      duesPayments: {
        ...(prevData.duesPayments || {}),
        [seasonKey]: allPaid
      }
    }));

    try {
      await updateDuesPayments(seasonKey, allPaid);
    } catch (error) {
      console.error('Failed to mark all paid:', error);
      setData(prevData => ({
        ...prevData,
        duesPayments: {
          ...(prevData.duesPayments || {}),
          [seasonKey]: currentPayments
        }
      }));
      alert('Failed to save payment status: ' + error.message);
    }
  };

  const resetAll = async () => {
    if (!isAdmin) return;
    
    setData(prevData => ({
      ...prevData,
      duesPayments: {
        ...(prevData.duesPayments || {}),
        [seasonKey]: {}
      }
    }));

    try {
      await updateDuesPayments(seasonKey, {});
    } catch (error) {
      console.error('Failed to reset payments:', error);
      setData(prevData => ({
        ...prevData,
        duesPayments: {
          ...(prevData.duesPayments || {}),
          [seasonKey]: currentPayments
        }
      }));
      alert('Failed to reset payment status: ' + error.message);
    }
  };

  const paidCount = Object.values(currentPayments).filter(Boolean).length;
  const totalOwed = report.totalsRows.reduce((sum, row) => sum + row.owes, 0);
  const paidAmount = report.totalsRows
    .filter(row => currentPayments[row.name])
    .reduce((sum, row) => sum + row.owes, 0);

  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ marginTop: 0 }}>{seasonId} Waiver Dues Checklist{"\u2705"}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">
            ${paidAmount} / ${totalOwed} collected ({paidCount} / {report.totalsRows.length} paid)
          </span>
          {isAdmin && (
            <>
              <button className="btn" style={btnSec} onClick={markAllPaid}>Mark all paid</button>
              <button className="btn" style={btnSec} onClick={resetAll}>Reset all</button>
            </>
          )}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Paid</th>
            <th style={th}>Team</th>
            <th style={th}>Adds</th>
            <th style={th}>Owes</th>
          </tr>
        </thead>
        <tbody>
          {report.totalsRows.map(row => (
            <tr key={row.name} style={{ opacity: currentPayments[row.name] ? 0.6 : 1 }}>
              <td style={td}>
                <input
                  type="checkbox"
                  checked={!!currentPayments[row.name]}
                  onChange={(e) => updatePayment(row.name, e.target.checked)}
                  disabled={!isAdmin}
                />
              </td>
              <td style={{ 
                ...td, 
                textDecoration: currentPayments[row.name] ? "line-through" : "none" 
              }}>
                {row.name}
              </td>
              <td style={td}>{row.adds}</td>
              <td style={td}>${row.owes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuesView({ report, lastSynced, loadOfficialReport, updateOfficialSnapshot, isAdmin, data, setData, seasonYear, updateBuyIns, updateDuesPayments, btnPri, btnSec 
}) {

  useEffect(() => {
    if (!isAdmin && !report) {
      loadOfficialReport(true); // silent=true to avoid showing sync overlay
    }
  }, [isAdmin, report, loadOfficialReport]);

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
  Rule: first two transactions per Wednesday→Tuesday week are free, then $5 each.
</p>
      {!report && <p style={{ color: "#64748b" }}>No snapshot yet — Commissioner should click <b>Update Official Snapshot</b>.</p>}

{report && (

  <div className="dues-grid dues-tight">
    <div className="dues-left">
  <BuyInTracker
    isAdmin={isAdmin}
    members={data.members}
    seasonYear={seasonYear}
    data={data}
    setData={setData}
    updateBuyIns={updateBuyIns}
  />

  {/* New Dues Payment Tracker */}
  <DuesPaymentTracker
  isAdmin={isAdmin}
  data={data}
  setData={setData}
  seasonId={seasonYear}
  report={report}
  updateDuesPayments={updateDuesPayments}
  btnPri={btnPri}
  btnSec={btnSec}
/>

<PaymentSection
  isAdmin={isAdmin}
  data={data}
  setData={setData}
  updateBuyIns={updateBuyIns}
/>

</div>


    
    {/* Rest of your dues view stays the same */}
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

function TransactionsView({ report, loadOfficialReport, btnPri, btnSec }) {
  // MOVE ALL HOOKS TO THE VERY TOP - BEFORE ANY OTHER CODE
  const [team, setTeam] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [openWeeks, setOpenWeeks] = useState(() => new Set());

  // Auto-load snapshot when component mounts and no report exists
  useEffect(() => {
    if (!report && loadOfficialReport) {
      loadOfficialReport(true).catch(() => {
        console.log('Failed to load report on mount');
      });
    }
  }, [report, loadOfficialReport]);

  // Update openWeeks when data changes
  useEffect(() => {
    if (report) {
      const all = (report.rawMoves || []).map(r => ({
        ...r,
        week: r.week // Keep original week including 0 and negatives
      }));

      const filtered = all.filter(r =>
        (!team || r.team === team) &&
        (!action || r.action === action) &&
        (!method || r.method === method) &&
        (!q || (r.player?.toLowerCase().includes(q.toLowerCase()) || r.team.toLowerCase().includes(q.toLowerCase())))
      );

      // Include week 0 in the weeks list
      const weeksSorted = Array.from(new Set(filtered.map(r => r.week)))
        .sort((a, b) => a - b);

      setOpenWeeks(new Set(weeksSorted));
    }
  }, [report, q, team, action, method]);
  
  // NOW you can have conditional returns AFTER all hooks
  if (!report) {
    return (
      <Section title="Transactions">
        <p style={{ color: "#64748b" }}>Loading snapshot...</p>
      </Section>
    );
  }

  // Rest of the component logic...
  const all = (report.rawMoves || []).map(r => ({
    ...r,
    week: r.week // Keep original week including 0 and negatives
  }));

  const teams = Array.from(new Set(all.map(r => r.team))).sort();

  const filtered = all.filter(r =>
    (!team || r.team === team) &&
    (!action || r.action === action) &&
    (!method || r.method === method) &&
    (!q || (r.player?.toLowerCase().includes(q.toLowerCase()) || r.team.toLowerCase().includes(q.toLowerCase())))
  );

  // Include week 0 in the weeks list
  const weeksSorted = Array.from(new Set(filtered.map(r => r.week)))
    .sort((a, b) => a - b);

  const rangeByWeek = {};
  for (const r of filtered) {
    const w = r.week;
    if (!rangeByWeek[w]) {
      if (w <= 0) {
        rangeByWeek[w] = "All pre-season transactions are FREE";
      } else {
        rangeByWeek[w] = r.range;
      }
    }
  }

  const byWeek = new Map();
  for (const r of filtered) {
    const w = r.week;
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push({ ...r, week: w });
  }

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
        <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
  <option value="">All methods</option>
  <option value="Waivers">Waivers</option>
  <option value="Free Agent">Free Agents</option>
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
        const weekLabel = week <= 0 ? `Week ${week} (Pre-season)` : `Week ${week}`;
        
        return (
          <div key={week} className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
              onClick={() => toggleWeek(week)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{weekLabel}</span>
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
                      <th style={th}>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={td}>{r.date}</td>
                        <td style={td}>{r.team}</td>
                        <td style={{ ...td, color: r.action === "ADD" ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                          {r.action === "ADD" ? "+" : "-"}{r.player || (r.playerId ? `#${r.playerId}` : "—")}
                        </td>
                        <td style={td}>{r.method || "—"}</td>
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

function DraftsView({ espn, btnPri, btnSec }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draftData, setDraftData] = useState(null);

  const loadDraftData = async () => {
  if (!espn.leagueId || !espn.seasonId) {
    setError("Set League ID and Season in League Settings first.");
    return;
  }

  setLoading(true);
  setError("");
  
  try {
    // Get team names
    const teamJson = await fetchEspnJson({ 
      leagueId: espn.leagueId, 
      seasonId: espn.seasonId, 
      view: "mTeam" 
    });
    const teamNames = Object.fromEntries(
      (teamJson?.teams || []).map(t => [t.id, teamName(t)])
    );

    // Get draft data - use direct API call instead of apiCall
    const response = await fetch(API(`/api/draft?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}`));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    const picks = data.picks || [];

    // Group by team and add team names
    const draftsByTeam = picks.reduce((acc, pick) => {
      const team = teamNames[pick.teamId] || `Team ${pick.teamId}`;
      if (!acc[team]) acc[team] = [];
      acc[team].push({
        round: pick.round,
        pickNumber: pick.pickNumber,
        player: pick.playerName || `Player #${pick.playerId}`,
        playerId: pick.playerId
      });
      return acc;
    }, {});

    // Sort picks within each team by pick number
    Object.values(draftsByTeam).forEach(teamPicks => {
      teamPicks.sort((a, b) => (a.pickNumber || 0) - (b.pickNumber || 0));
    });

    setDraftData({ draftsByTeam, totalPicks: picks.length });

  } catch (err) {
    console.error('Failed to load draft data:', err);
    setError("Failed to load draft data: " + err.message);
  }
  
  setLoading(false);
};

  useEffect(() => {
    loadDraftData();
  }, [espn.leagueId, espn.seasonId]);

  const teamNames = draftData ? Object.keys(draftData.draftsByTeam).sort() : [];

  return (
    <Section title="Draft Results" actions={
      <div style={{ display: "flex", gap: 8 }}>
        {draftData && (
          <span className="badge">
            {draftData.totalPicks} picks across {teamNames.length} teams
          </span>
        )}
        <button className="btn" style={btnSec} onClick={loadDraftData}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
    }>
      {loading && <p>Loading draft data...</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      
      {!loading && !error && draftData && (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {teamNames.map(teamName => {
            const picks = draftData.draftsByTeam[teamName];
            
            return (
              <div key={teamName} className="card" style={{ padding: 16 }}>
                <h3 style={{ marginTop: 0 }}>
                  {teamName}
                  <span style={{ fontSize: 14, color: "#64748b", fontWeight: 400 }}>
                    ({picks.length} picks)
                  </span>
                </h3>
                <ul style={{ margin: 0, paddingLeft: 16, listStyle: "none" }}>
  {picks.map((pick, i) => (
    <li key={i} style={{ marginBottom: 4 }}>
      <span style={{ fontWeight: 600, color: "#0b1220" }}>
        Round {pick.round} - #{pick.pickNumber}
      </span>
      {" — "}
      <span>{pick.player}</span>
    </li>
  ))}
</ul>
              </div>
            );
          })}
        </div>
      )}
      
      {!loading && !error && !draftData && (
        <p style={{ color: "#64748b" }}>
          No draft data available. Check your League ID and Season settings.
        </p>
      )}
    </Section>
  );
}

function Rosters({ leagueId, seasonId, apiCallLeague, btnPri, btnSec }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [teams, setTeams] = useState([]);

  const positionOrder = ["QB", "RB", "RB/WR", "WR", "TE", "FLEX", "D/ST", "K", "Bench"];

const getPositionPriority = (slot) => {
  // Handle multiple RBs and WRs by giving them same priority
  if (slot === "RB") return 1;
  if (slot === "WR") return 4;
  if (slot === "Bench") return 999; // Always last
  
  const index = positionOrder.findIndex(pos => slot.includes(pos));
  return index === -1 ? 500 : index;
};

  // Load roster data from server
  // In the Rosters component, update the useEffect:
useEffect(() => {
  if (!seasonId) return;
  
  (async () => {
    setLoading(true);
    setError("");
    try {
      // First try to load server-cached roster data using league-specific API
      const response = await apiCallLeague(`/rosters?seasonId=${seasonId}`);
      if (response.rosterData && response.rosterData.length > 0) {
        // Use server-stored roster data
        setTeams(response.rosterData);
      } else if (leagueId && seasonId) {
        // If no server data and we have credentials, load from ESPN
        const [teamJson, rosJson, setJson] = await Promise.all([
          fetchEspnJson({ leagueId, seasonId, view: "mTeam" }),
          fetchEspnJson({ leagueId, seasonId, view: "mRoster" }),
          fetchEspnJson({ leagueId, seasonId, view: "mSettings" }),
        ]);
        
        // Rest of the ESPN processing code stays the same...
        const teamsById = Object.fromEntries((teamJson?.teams || []).map(t => [t.id, teamName(t)]));
        const slotMap = slotIdToName(setJson?.settings?.rosterSettings?.lineupSlotCounts || {});
        const items = (rosJson?.teams || []).map(t => {
          const entries = (t.roster?.entries || []).map(e => {
            const p = e.playerPoolEntry?.player;
            const fullName = p?.fullName || "Player";
            const slot = slotMap[e.lineupSlotId] || "—";
            
            const position = p?.defaultPositionId ? posIdToName(p.defaultPositionId) : "";
            const displayName = slot === "Bench" 
              ? (position ? `${fullName} (${position})` : fullName)
              : fullName.replace(/\s*\([^)]*\)\s*/g, '').trim();
            
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
      }
    } catch (err) {
      console.error('Roster load error:', err);
      setError("Failed to load rosters.");
    }
    setLoading(false);
  })();
}, [leagueId, seasonId]);
  return (
    <Section title="Rosters" actions={<span className="badge">Cached from Import</span>}>
      {!seasonId && <p style={{ color: "#64748b" }}>Set your ESPN Season in <b>League Settings</b>.</p>}
      {loading && <p>Loading rosters…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {teams.map(team => (
          <div key={team.teamName} className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>{team.teamName}</h3>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
  {team.entries.map((e, i) => {
    const isFirstBench = e.slot === "Bench" && (i === 0 || team.entries[i-1]?.slot !== "Bench");
    return (
      <React.Fragment key={i}>
        {isFirstBench && (
  <li style={{ margin: "8px 0", padding: 0, listStyle: "none" }}>
    <hr style={{ border: "none", borderTop: "2px solid #9ca3af", margin: "4px 0" }} />
  </li>
)}
        <li style={{ marginBottom: 4 }}>
          <b>{e.slot}</b> — {e.name}
        </li>
      </React.Fragment>
    );
  })}
</ul>
          </div>
        ))}
      </div>
      {!loading && teams.length === 0 && <p style={{ color: "#64748b" }}>No roster data. Use Import ESPN Teams in League Settings.</p>}
    </Section>
  );
}

function SettingsView({ isAdmin, espn, setEspn, importEspnTeams, data, saveLeagueSettings, btnPri, btnSec }) {

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
  btnPri={btnPri}
  btnSec={btnSec}
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

function TradingView({ isAdmin, addTrade, deleteTrade, data, btnPri, btnSec }) {
  return (
    <Section title="Trading Block">
      {isAdmin && <TradeForm onSubmit={addTrade} btnPri={btnPri} btnSec={btnSec} />}
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

function PollsView({ isAdmin, members, espn, config, btnPri, btnSec }) {
  const seasonKey = String(espn?.seasonId ?? "unknown");
  const [teamCode, setTeamCode] = useStored(`poll-teamcode:${seasonKey}`, "");

  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [voteChoice, setVoteChoice] = useState("");
  const [activePollId, setActivePollId] = useState("");
  const [createQ, setCreateQ] = useState("");
  const [createOpts, setCreateOpts] = useState("Yes\nNo");
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => { if (polls.length > 0 && !activePollId) setActivePollId(polls[0].id); }, [polls, activePollId]);


  async function loadPolls() {
  setLoading(true);
  setErr("");
  try {
    const r = await fetch(API(`/api/polls?seasonId=${espn.seasonId}&leagueId=${config.id}`));  // ← ADD &leagueId=${config.id}
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    }
    const j = await r.json();
    console.log('Raw API response:', j);
    console.log('Polls array:', j.polls);
    
    setPolls(j.polls || []);
    
    // If we have polls, make sure one is selected
    if ((j.polls || []).length > 0 && !activePollId) {
      setActivePollId(j.polls[0].id);
    }
    
  } catch (e) {
    console.error('Failed to load polls:', e);
    setErr("Failed to load polls: " + e.message);
  }
  setLoading(false);
}

  useEffect(() => { loadPolls(); }, []);

 

async function createPoll() {
  console.log('Creating poll with:', { question: createQ, options: createOpts });
  const opts = createOpts.split("\n").map(s => s.trim()).filter(Boolean);
  console.log('Parsed options:', opts);
  
  if (!createQ || opts.length < 2) {
    console.log('Validation failed:', { hasQuestion: !!createQ, optionsCount: opts.length });
    return alert("Enter a question and at least two options.");
  }
  
  try {
    const r = await fetch(API("/api/polls/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": config.adminPassword },
      body: JSON.stringify({ question: createQ, options: opts,  leagueId: config.id })
    });
    
    console.log('Poll create response:', r.status, r.ok);
    
    if (!r.ok) {
      const errorText = await r.text();
      console.log('Poll create error:', errorText);
      return alert("Create failed: " + errorText);
    }
    
    // Success feedback
    alert("Poll created successfully!");
    
    // Clear form
    setCreateQ("");
    setCreateOpts("Yes\nNo");
    
    // Force reload polls
    console.log('Forcing poll reload...');
    await loadPolls();
    
    // Small delay to ensure state updates
    setTimeout(() => {
      console.log('Current polls state after reload:', polls);
    }, 100);
    
  } catch (error) {
    console.error('Poll creation error:', error);
    alert("Failed to create poll: " + error.message);
  }
}

async function editPoll(pollId) {
  const poll = polls.find(p => p.id === pollId);
  if (!poll) return;
  
  const newQuestion = prompt("Edit question:", poll.question);
  if (!newQuestion) return;
  
  const newOptionsText = prompt("Add new options (one per line):", "");
  if (newOptionsText === null) return;
  
  const newOptions = newOptionsText.split("\n").map(s => s.trim()).filter(Boolean);
  
  try {
    const r = await fetch(API("/api/polls/edit"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": config.adminPassword },
      body: JSON.stringify({ pollId, question: newQuestion, newOptions })
    });
    
    if (!r.ok) return alert("Edit failed");
    await loadPolls();
  } catch (error) {
    alert("Edit failed: " + error.message);
  }
}

  async function onIssueSeasonTeamCodes() {
  if (!isAdmin) return alert("Commissioner only.");
  if (!espn?.leagueId || !espn?.seasonId) {
    alert("Set League ID and Season in League Settings first.");
    return;
  }
  
  console.log('=== ISSUE TEAM CODES DEBUG ===');
  console.log('League ID:', espn.leagueId);
  console.log('Season ID:', espn.seasonId);
  console.log('Admin password:', config.adminPassword);
  
  try {
    console.log('Fetching teams from ESPN...');
    const r = await fetch(API(`/api/espn?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}&view=mTeam`));
    console.log('ESPN API response status:', r.status, r.ok);
    
    if (!r.ok) throw new Error(await r.text());
    const m = await r.json();
    console.log('ESPN teams data:', m);
    
    const teams = (m?.teams || []).map(t => ({
      id: t.id,
      name: (t.location && t.nickname) ? `${t.location} ${t.nickname}` : (t.name || `Team ${t.id}`)
    }));
    console.log('Processed teams:', teams);

    console.log('Calling issue-team-codes API...');
    const k = await fetch(API("/api/polls/issue-team-codes"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": config.adminPassword },
      body: JSON.stringify({ seasonId: espn.seasonId, teams })
    });
    console.log('Issue codes response status:', k.status, k.ok);
    
    if (!k.ok) {
      const errorText = await k.text();
      console.log('Issue codes error:', errorText);
      throw new Error(errorText);
    }
    
    const j = await k.json();
    console.log('Issue codes success:', j);
    alert(`Issued ${j.issued} team codes for season ${espn.seasonId}.`);
  } catch (e) {
    console.error('Issue team codes failed:', e);
    alert(e.message || "Failed issuing codes");
  }
  console.log('=== END ISSUE TEAM CODES DEBUG ===');
}

  async function onCopySeasonTeamCodes() {
    if (!isAdmin) return alert("Commissioner only.");
    if (!espn?.seasonId) return alert("Season not set.");
    try {
      const r = await fetch(API(`/api/polls/team-codes?seasonId=${espn.seasonId}`), {
        headers: { "x-admin": config.adminPassword }
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
      headers: { "Content-Type": "application/json", "x-admin": config.adminPassword },
      body: JSON.stringify({ pollId })
    });
    if (!r.ok) return alert("Delete failed (commissioner only?)");
    setActivePollId("");
    loadPolls();
  }

  async function setClosed(pollId, closed) {
    const r = await fetch(API("/api/polls/close"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": config.adminPassword },
      body: JSON.stringify({ pollId, closed })
    });
    if (!r.ok) return alert("Failed to update poll.");
    loadPolls();
  }

  
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
    <button className="btn" style={btnSec} onClick={() => editPoll(poll.id)}>Edit</button>
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


function WaiversView({ 
  espnReport, isAdmin, data, selectedWeek, setSelectedWeek, seasonYear, membersById,
  updateOfficialSnapshot, setActive, loadServerData, addWaiver, deleteWaiver, deleteMember, btnPri, btnSec 
}) {

  // Calculate waiver data from ESPN report if available
  const espnWaiverData = useMemo(() => {
    if (!espnReport?.rawMoves) return { waiversThisWeek: [], waiverCounts: {}, waiverOwed: {} };
    
    const weekKey = weekKeyFrom(selectedWeek);
    
// Filter adds from the current week using server's Wed→Tue calculation
const waiversThisWeek = espnReport.rawMoves.filter(move => {
  if (move.action !== "ADD" || move.week <= 0) return false;
  // Use the server's week calculation (already stored in move.week)
  // and compare against selected week
  const selectedServerWeek = selectedWeek.week;
  return move.week === selectedServerWeek;
});
    
    // Count adds by team
    const waiverCounts = {};
    waiversThisWeek.forEach(move => {
      waiverCounts[move.team] = (waiverCounts[move.team] || 0) + 1;
    });
    
    // Calculate what each team owes
    const waiverOwed = {};
    Object.keys(waiverCounts).forEach(team => {
      const count = waiverCounts[team] || 0;
      waiverOwed[team] = Math.max(0, count - 2) * 5;
    });
    
    return { waiversThisWeek, waiverCounts, waiverOwed };
  }, [espnReport, selectedWeek, seasonYear]);

  const { waiversThisWeek, waiverCounts, waiverOwed } = espnWaiverData;

  return (
    <Section title="Waivers & Dues" actions={
      <div style={{display:"flex", gap:8}}>
        {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
        <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
        {isAdmin && <button className="btn" style={btnSec} onClick={async ()=>{ 
          if(confirm("Reset waivers and announcements?")) {
            try {
              await apiCallLeague('/reset-waivers', { method: 'POST' });
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
          <h3>League Members (from ESPN data)</h3>
          <ul style={{listStyle:"none",padding:0,margin:0}}>
            {espnReport?.totalsRows ? (
              espnReport.totalsRows.map(row => (
                <li key={row.name} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                  <span>{row.name}</span>
                  <span style={{fontSize:14,color:"#334155"}}>
                    Adds (this week): {waiverCounts[row.name] || 0} • Owes: ${waiverOwed[row.name] || 0}
                  </span>
                </li>
              ))
            ) : (
              data.members.map(m => (
                <li key={m.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                  <span>{m.name}</span>
                  <span style={{fontSize:14,color:"#334155"}}>No ESPN data available</span>
                  {isAdmin && <button onClick={()=>deleteMember(m.id)} style={{color:"#dc2626",background:"transparent",border:"none",cursor:"pointer"}}>Remove</button>}
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="card" style={{padding:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <h3>Activity (Wed→Tue) - ESPN Data</h3>
            <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec}/>
          </div>

          <h4>Transactions (selected week)</h4>
          <ul style={{listStyle:"none",padding:0,margin:0}}>
            {waiversThisWeek.length > 0 ? waiversThisWeek.map((move, index) => (
              <li key={index} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #e2e8f0",fontSize:14}}>
                <span>
                  <b>{move.team}</b> picked up <b>{move.player}</b> 
                  <span style={{color:"#64748b", fontSize:12}}> ({move.method})</span>
                </span>
                <span style={{color:"#64748b"}}>{move.date}</span>
              </li>
            )) : (
              <p style={{color:"#64748b"}}>No activity this week.</p>
            )}
          </ul>

          {!espnReport && (
            <div style={{marginTop:16, padding:12, background:"#fef3c7", borderRadius:6}}>
              <p style={{margin:0, color:"#92400e"}}>
                <strong>No ESPN data loaded.</strong> Click "Update Official Snapshot" to load transaction data.
              </p>
            </div>
          )}
        </div>
      </div>

      {espnReport && (
        <div className="card" style={{padding:12, marginTop:12, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>ESPN transaction data loaded. 
            <div style={{fontSize:12, color:"#64748b", marginTop:4}}>
              Last Updated: {espnReport.lastSynced} 
            </div>
          </div>
          <button className="btn" style={btnSec} onClick={()=>setActive("dues")}>Open Dues</button>
        </div>
      )}
    </Section>
  );
}


function HighestScorerView({ espn, config, seasonYear, btnPri, btnSec }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [weeklyWinners, setWeeklyWinners] = useState([]);
  const [lastUpdated, setLastUpdated] = useState("");

  const loadHighestScorers = async () => {
    if (!espn.leagueId || !espn.seasonId) {
      setError("Set League ID and Season in League Settings first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Fetch both matchup data AND team data to get proper team names
      const [matchupResponse, teamResponse] = await Promise.all([
        fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${espn.seasonId}/segments/0/leagues/${espn.leagueId}?view=mMatchup`, {
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }),
        fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${espn.seasonId}/segments/0/leagues/${espn.leagueId}?view=mTeam`, {
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })
      ]);

      if (!matchupResponse.ok || !teamResponse.ok) {
        throw new Error(`ESPN API error: ${matchupResponse.status} / ${teamResponse.status}`);
      }

      const [matchupData, teamData] = await Promise.all([
        matchupResponse.json(),
        teamResponse.json()
      ]);

      console.log("Team data:", teamData); // Debug log to see team structure

      // Build team names mapping with better fallback logic
      const teamNames = {};
      if (teamData.teams) {
        teamData.teams.forEach(team => {
          // Try multiple ways to get team name
          let name = "";
          if (team.location && team.nickname) {
            name = `${team.location} ${team.nickname}`;
          } else if (team.name) {
            name = team.name;
          } else if (team.abbrev) {
            name = team.abbrev;
          } else {
            name = `Team ${team.id}`;
          }
          teamNames[team.id] = name;
          console.log(`Team ${team.id}: ${name}`); // Debug log
        });
      }

      const winners = [];
      const now = new Date();
      const week1EndDate = new Date('2025-09-08T23:59:00-07:00');

      // Group schedule by matchup period
      const byPeriod = {};
      if (matchupData.schedule) {
        matchupData.schedule.forEach(matchup => {
          const period = matchup.matchupPeriodId;
          if (period && period > 0) {
            if (!byPeriod[period]) byPeriod[period] = [];
            byPeriod[period].push(matchup);
          }
        });
      }

      // Process each period (week)
      Object.keys(byPeriod).sort((a, b) => Number(a) - Number(b)).forEach(period => {
        const weekNum = Number(period);
        
        // Check if this week should show results
        const weekEnd = new Date(week1EndDate);
        weekEnd.setDate(week1EndDate.getDate() + ((weekNum - 1) * 7));
        
        if (now <= weekEnd) {
          return; // Skip if deadline hasn't passed
        }

        const matchups = byPeriod[period];
        let highestScore = 0;
        let winningTeam = "";
        let winningTeamId = null;

        // Find highest scorer for this week
        matchups.forEach(matchup => {
          const homeScore = matchup.home?.totalPoints || 0;
          const awayScore = matchup.away?.totalPoints || 0;
          const homeTeamId = matchup.home?.teamId;
          const awayTeamId = matchup.away?.teamId;

          if (homeScore > highestScore) {
            highestScore = homeScore;
            winningTeamId = homeTeamId;
            winningTeam = teamNames[homeTeamId] || `Team ${homeTeamId}`;
          }
          if (awayScore > highestScore) {
            highestScore = awayScore;
            winningTeamId = awayTeamId;
            winningTeam = teamNames[awayTeamId] || `Team ${awayTeamId}`;
          }
        });

        console.log(`Week ${weekNum}: Team ${winningTeamId} (${winningTeam}) - ${highestScore} points`); // Debug log

        if (winningTeam && highestScore > 0) {
          winners.push({
            week: weekNum,
            team: winningTeam,
            score: highestScore.toFixed(1)
          });
        }
      });

      setWeeklyWinners(winners);
      setLastUpdated(new Date().toLocaleString());
      setError("");

    } catch (err) {
      console.error('Failed to load highest scorers:', err);
      setError("Failed to load highest scorer data: " + err.message);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    if (espn.seasonId && espn.leagueId) {
      loadHighestScorers();
    }
  }, [espn.seasonId, espn.leagueId]);

  return (
    <Section title="🏆 Highest Scorer Awards" actions={
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" style={btnSec} onClick={loadHighestScorers} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
    }>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <strong>Weekly Highest Scorer Winners</strong>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Updated automatically each Monday at 11:59 PM PT
          </div>
        </div>

        {error && <div style={{ color: "#dc2626" }}>{error}</div>}
        
        {weeklyWinners.length > 0 ? (
          <div>
            {weeklyWinners.map((winner, i) => (
              <div key={i} style={{ 
                padding: "12px 0", 
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div>
                  <span style={{ fontWeight: "bold", color: "#0b1220" }}>
                    Week {winner.week}
                  </span>
                  <span style={{ marginLeft: 12, fontSize: 16 }}>
                    🏆 <strong>{winner.team}</strong>
                  </span>
                </div>
                <span style={{ color: "#16a34a", fontWeight: "bold" }}>
                  {winner.score} pts
                </span>
              </div>
            ))}
          </div>
        ) : !loading && !error && (
          <div style={{ color: "#64748b", marginTop: 8 }}>
            No completed weeks yet. Winners will appear after each week is finished.
          </div>
        )}

        {lastUpdated && (
          <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
            Last updated: {lastUpdated}
          </div>
        )}
      </div>
    </Section>
  );
}

/* =========================
   Power Rankings
   ========================= */

function PowerRankingsView({ espn, config, seasonYear, btnPri, btnSec }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rankings, setRankings] = useState([]);
  const [lastUpdated, setLastUpdated] = useState("");

  const loadPowerRankings = async () => {
    if (!espn.leagueId || !espn.seasonId) {
      setError("Set League ID and Season in League Settings first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
  // Fetch both matchup data AND team data to get proper team names
  const [matchupResponse, teamResponse] = await Promise.all([
    fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${espn.seasonId}/segments/0/leagues/${espn.leagueId}?view=mMatchup`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }),
    fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${espn.seasonId}/segments/0/leagues/${espn.leagueId}?view=mTeam`, {
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
  ]);

  if (!matchupResponse.ok || !teamResponse.ok) {
    throw new Error(`ESPN API error: ${matchupResponse.status} / ${teamResponse.status}`);
  }

  const [data, teamData] = await Promise.all([
    matchupResponse.json(),
    teamResponse.json()
  ]);

      // Get team names from the dedicated team data
const teamNames = {};
if (teamData.teams) {
  teamData.teams.forEach(team => {
    let name = "";
    if (team.location && team.nickname) {
      name = `${team.location} ${team.nickname}`;
    } else if (team.name) {
      name = team.name;
    } else if (team.abbrev) {
      name = team.abbrev;
    } else {
      name = `Team ${team.id}`;
    }
    teamNames[team.id] = name;
  });
}

      // Initialize team stats
      const teamStats = {};
      Object.keys(teamNames).forEach(teamId => {
        teamStats[teamId] = {
          name: teamNames[teamId],
          totalPoints: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          games: 0,
          medianWins: 0
        };
      });

      // Group matchups by period and calculate stats
      const byPeriod = {};
      if (data.schedule) {
        data.schedule.forEach(matchup => {
          const period = matchup.matchupPeriodId;
          if (period && period > 0) {
            if (!byPeriod[period]) byPeriod[period] = [];
            byPeriod[period].push(matchup);
          }
        });
      }

      // Process each completed week
      Object.keys(byPeriod).forEach(period => {
        const matchups = byPeriod[period];
        const weekScores = [];
        
        // Collect all scores for median calculation
        matchups.forEach(matchup => {
          const homeScore = matchup.home?.totalPoints || 0;
          const awayScore = matchup.away?.totalPoints || 0;
          
          if (homeScore > 0) weekScores.push(homeScore);
          if (awayScore > 0) weekScores.push(awayScore);
        });
        
        // Skip weeks with no scores
        if (weekScores.length === 0) return;
        
        // Calculate median score for the week
        weekScores.sort((a, b) => a - b);
        const medianScore = weekScores.length % 2 === 0 
          ? (weekScores[weekScores.length / 2 - 1] + weekScores[weekScores.length / 2]) / 2
          : weekScores[Math.floor(weekScores.length / 2)];

        // Update team stats
        matchups.forEach(matchup => {
          const homeId = matchup.home?.teamId;
          const awayId = matchup.away?.teamId;
          const homeScore = matchup.home?.totalPoints || 0;
          const awayScore = matchup.away?.totalPoints || 0;
          
          if (homeId && homeScore > 0) {
            teamStats[homeId].totalPoints += homeScore;
            teamStats[homeId].games++;
            
            // Win/loss/tie
            if (homeScore > awayScore) {
              teamStats[homeId].wins++;
            } else if (homeScore < awayScore) {
              teamStats[homeId].losses++;
            } else {
              teamStats[homeId].ties++;
            }
            
            // Median comparison
            if (homeScore > medianScore) {
              teamStats[homeId].medianWins++;
            }
          }
          
          if (awayId && awayScore > 0) {
            teamStats[awayId].totalPoints += awayScore;
            teamStats[awayId].games++;
            
            // Win/loss/tie
            if (awayScore > homeScore) {
              teamStats[awayId].wins++;
            } else if (awayScore < homeScore) {
              teamStats[awayId].losses++;
            } else {
              teamStats[awayId].ties++;
            }
            
            // Median comparison
            if (awayScore > medianScore) {
              teamStats[awayId].medianWins++;
            }
          }
        });
      });

      // Calculate power rankings
      const powerRankings = Object.values(teamStats)
        .filter(team => team.games > 0)
        .map(team => {
          const winningPct = team.games > 0 ? team.wins / team.games : 0;
          const medianWinningPct = team.games > 0 ? team.medianWins / team.games : 0;
          
          const powerScore = (team.totalPoints * 2) + 
                           (team.totalPoints * winningPct) + 
                           (team.totalPoints * medianWinningPct);
          
          return {
            name: team.name,
            powerScore: Math.round(powerScore * 100) / 100,
            totalPoints: Math.round(team.totalPoints * 100) / 100,
            wins: team.wins,
            losses: team.losses,
            ties: team.ties,
            winningPct: Math.round(winningPct * 1000) / 10,
            medianWins: team.medianWins,
            medianWinningPct: Math.round(medianWinningPct * 1000) / 10
          };
        })
        .sort((a, b) => b.powerScore - a.powerScore);

      setRankings(powerRankings);
      setLastUpdated(new Date().toLocaleString());
      setError("");

    } catch (err) {
      console.error('Failed to load power rankings:', err);
      setError("Failed to load power rankings: " + err.message);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    if (espn.seasonId && espn.leagueId) {
      loadPowerRankings();
    }
  }, [espn.seasonId, espn.leagueId]);

  return (
    <Section title="Power Rankings" actions={
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" style={btnSec} onClick={loadPowerRankings} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
    }>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            Formula: (Points Scored × 2) + (Points Scored × Winning %) + (Points Scored × Winning % if played vs median)
          </div>
        </div>

        {error && <div style={{ color: "#dc2626" }}>{error}</div>}
        
        {rankings.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>Rank</th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>Team Name</th>
                  <th style={{ padding: "12px 8px", textAlign: "right" }}>Power Score</th>
                  <th style={{ padding: "12px 8px", textAlign: "center" }}>Wins</th>
                  <th style={{ padding: "12px 8px", textAlign: "center" }}>Losses</th>
                  <th style={{ padding: "12px 8px", textAlign: "center" }}>Ties</th>
                  <th style={{ padding: "12px 8px", textAlign: "right" }}>Total Points</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((team, index) => (
                  <tr key={team.name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 8px", fontWeight: "bold" }}>{index + 1}</td>
                    <td style={{ padding: "12px 8px" }}>{team.name}</td>
                    <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: "bold", color: "#16a34a" }}>
                      {team.powerScore}
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "center" }}>{team.wins}</td>
                    <td style={{ padding: "12px 8px", textAlign: "center" }}>{team.losses}</td>
                    <td style={{ padding: "12px 8px", textAlign: "center" }}>{team.ties}</td>
                    <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.totalPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && !error && (
          <div style={{ color: "#64748b", marginTop: 8 }}>
            No data available yet.
          </div>
        )}

        {lastUpdated && (
          <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
            Last updated: {lastUpdated}
          </div>
        )}
      </div>
    </Section>
  );
}

/* =========================
   Form Components
   ========================= */
function AnnouncementEditor({ onPost, disabled, btnPri, btnSec }) {
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

function TradeForm({ onSubmit, btnPri, btnSec }) {
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

function WeeklyForm({ seasonYear, onAdd, btnPri, btnSec }) {
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

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ marginTop: 0 }}>${BUYIN} Buy-in Checklist ✅</h3>
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
        <div className="card" style={{ padding: 12, background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
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
      )}
    </div>
  );
}


function PaymentSection({ isAdmin, data, setData, updateBuyIns }) {
  const seasonKey = "current";
  const cur = (data.buyins && data.buyins[seasonKey]) || {
    paid: {},
    hidden: false,
    venmoLink: "",
    zelleEmail: "",
    venmoQR: ""
  };

  const [venmo, setVenmo] = React.useState(cur.venmoLink || "https://venmo.com/u/");
  const [zelle, setZelle] = React.useState(cur.zelleEmail || "");
  
  React.useEffect(() => { 
    setVenmo(cur.venmoLink || "https://venmo.com/u/"); 
    setZelle(cur.zelleEmail || ""); 
  }, [seasonKey, data.buyins]);

  const patch = async (updates) => {
    const newData = { ...cur, ...updates };
    setData(d => ({ ...d, buyins: { ...(d.buyins || {}), [seasonKey]: newData } }));
    try {
      await updateBuyIns(seasonKey, newData);
    } catch (error) {
      console.error('Failed to update buy-ins:', error);
      setData(d => ({ ...d, buyins: { ...(d.buyins || {}), [seasonKey]: cur } }));
      alert('Failed to save buy-in changes: ' + error.message);
    }
  };

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
    <div className="card" style={{ padding: 12, marginTop: 16 }}>
      <h4 style={{ marginTop: 0 }}>Pay Dues</h4>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cur.venmoLink && cur.venmoLink !== "https://venmo.com/u/" && (
          <a className="btn" style={{ background: "#3D95CE", color: "#fff", padding: "10px 12px", textAlign: "center", textDecoration: "none", borderRadius: "6px", fontWeight: "600" }} href={cur.venmoLink} target="_blank" rel="noreferrer">
            Pay with Venmo
          </a>
        )}
        {cur.zelleEmail && (
  <button type="button" className="btn" style={{ background: "#6D1ED4", color: "#fff", padding: "10px 12px", fontWeight: "600", fontSize: "15px", border: "none", borderRadius: "6px", cursor: "pointer" }} onClick={copyZelle}>
    Pay with Zelle
  </button>
)}
      </div>

      {(cur.venmoQR || (cur.venmoLink && cur.venmoLink !== "https://venmo.com/u/") || cur.zelleEmail) && (
        <div style={{ marginTop: 8 }}>
          
            <a href={cur.venmoLink || (cur.zelleEmail ? `mailto:${encodeURIComponent(cur.zelleEmail)}` : "#")}
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
  );
}
function RichEditor({ html, setHtml, readOnly, btnPri, btnSec }) {
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
function WeekSelector({ selectedWeek, setSelectedWeek, seasonYear, btnPri, btnSec }) {
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

// put near other helpers
const methodLabel = (m) => {
  switch ((m || "").toUpperCase()) {
    case "PROCESS":
    case "WAIVER":      return "Waivers";
    case "EXECUTE":
    case "FA":          return "Free Agent";
    case "DRAFT":       return "Draft";
    case "CANCEL":      return "Canceled";
    default:            return m || "—";
  }
};


/* =========================
   Splash and Overlays
   ========================= */
function IntroSplash({ selectedLeague }) {
  const [show, setShow] = useState(true);
  useEffect(() => { 
    const t = setTimeout(() => setShow(false), 3000); // Reduced from 6 seconds to 3 seconds
    return () => clearTimeout(t); 
  }, []);
  
  if (!show) return null;
  
  // Choose which logo to show based on selected league
  const logoSrc = selectedLeague?.logo || "/Blitzzz-logo-transparent.png";
  const logoAlt = selectedLeague ? `${selectedLeague.name} Logo` : "Blitzzz Logo";
  
  return (
    <div className="splash">
      <img src={logoSrc} alt={logoAlt} />
    </div>
  );
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
