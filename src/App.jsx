// src/App.jsx - Version 3.0 with Subdomain Support
import React, { useEffect, useMemo, useState, useRef } from "react";
import { LandingPage } from './components/LandingPage.jsx';
import { useLeagueConfig } from './hooks/useLeagueConfig.js';
import { createLeagueAPI, createLeagueStorageKey } from './utils/leagueStorage.js';
import { leagueConfigs } from './config/leagueConfigs.js';

/* =========================
   Global Config
   ========================= */
const ADMIN_ENV = import.meta.env.VITE_ADMIN_PASSWORD || "changeme";
const DEFAULT_LEAGUE_ID = import.meta.env.VITE_ESPN_LEAGUE_ID || "";
const DEFAULT_SEASON = import.meta.env.VITE_ESPN_SEASON || new Date().getFullYear();
const LEAGUE_TZ = "America/Los_Angeles";
const WEEK_START_DAY = 3; // Wednesday

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
  const offset = (3 - d.getDay() + 7) % 7; // 3 = Wednesday
  d.setDate(d.getDate() + offset);
  d.setHours(0,0,0,0);
  return d;
}

// 2026-08-25: this used to be the ONLY way the site knew "when is week 1" -
// it just assumed week 1 always starts the first Wednesday of September.
// That's wrong (2026's actual Week 1 kickoff is Sept 9, the SECOND
// Wednesday of September, not the first). Instead of guessing, we now ask
// ESPN directly what week it currently thinks the season is on, and use
// that as an anchor point to count every other week from - accurate every
// year automatically, no hardcoded date needed. This cache holds that
// answer once it's been fetched; loadEspnWeekAnchor() below fills it in.
const __espnWeekAnchor = {}; // { [seasonYear]: { week, start } }

async function loadEspnWeekAnchor(leagueId, seasonId){
  if (!leagueId || !seasonId) return;
  try {
    const res = await fetch(API(`/api/espn?leagueId=${leagueId}&seasonId=${seasonId}&view=mSettings&auth=1`));
    if (!res.ok) return;
    const data = await res.json();
    const currentMatchupPeriod = data?.status?.currentMatchupPeriod;
    const scoringPeriodId = data?.scoringPeriodId;
    // 2026-08-26: only trust this as a real anchor once the season has
    // actually started. ESPN reports currentMatchupPeriod=1 for the WHOLE
    // pre-season gap (confirmed by directly checking the still-not-started
    // 2026 season), so setting the anchor during that gap would "anchor"
    // week 1 to whatever week we happened to check - a moving target that
    // drifts forward every time this refreshes, not a stable real date.
    // scoringPeriodId, on the other hand, stays 0 for the entire pre-season
    // gap and only becomes real once games are actually being played -
    // that's the signal that currentMatchupPeriod is finally meaningful.
    // Until then, this intentionally leaves the old date-estimate fallback
    // in place (see leagueWeekOf below) rather than anchoring on a guess.
    if (typeof currentMatchupPeriod === "number" && currentMatchupPeriod > 0 && scoringPeriodId > 0) {
      const isTuesdayPT = toPT(new Date()).getDay() === 2;
      __espnWeekAnchor[seasonId] = {
        week: currentMatchupPeriod,
        txWeek: isTuesdayPT ? currentMatchupPeriod - 1 : currentMatchupPeriod,
        start: startOfLeagueWeekPT(new Date()),
      };
    }
  } catch (err) {
    console.error("Failed to load ESPN's current week - falling back to date estimate:", err);
  }
}

function leagueWeekOf(date, seasonYear){
  const start = startOfLeagueWeekPT(date);
  const anchor = __espnWeekAnchor[seasonYear];
  if (anchor) {
    // Trusted path: count forward/backward from ESPN's own "current week",
    // in whole-week steps, instead of guessing where week 1 falls.
    const weeksOffset = Math.round((start - anchor.start) / (7*24*60*60*1000));
    let week = (typeof anchor.txWeek === "number" ? anchor.txWeek : anchor.week) + weeksOffset;
    if (week < 1) week = 0;
    return { week, start, key: localDateKey(start) };
  }
  // Fallback (only used before ESPN's answer has loaded, or if that
  // request failed) - the old first-Wednesday-of-September estimate.
  const week1 = startOfLeagueWeekPT(firstWednesdayOfSeptemberPT(seasonYear));
  let week = Math.floor((start - week1) / (7*24*60*60*1000)) + 1;
  if (start < week1) week = 0;
  return { week, start, key: localDateKey(start) };
}

// 2026-09-22: like leagueWeekOf, but always uses ESPN's raw currentMatchupPeriod
// (anchor.week) instead of the Tuesday-shifted anchor.txWeek. That shift exists
// so a transaction made late Monday night/early Tuesday still counts toward the
// PRIOR week for dues purposes - correct for transactions/waivers, but wrong for
// "how many weeks of games are complete": by Tuesday, last week's games have been
// over for a day, so that count should NOT be shifted back. Power Rankings and
// Luck Index were both calling leagueWeekOf for this and silently under-counting
// by one week every Tuesday (e.g. showing only 1 week of games played when 2
// weeks had actually finished) - this is what to use for that instead.
function completedGamesWeekOf(date, seasonYear){
  const start = startOfLeagueWeekPT(date);
  const anchor = __espnWeekAnchor[seasonYear];
  if (anchor) {
    const weeksOffset = Math.round((start - anchor.start) / (7*24*60*60*1000));
    let week = anchor.week + weeksOffset;
    if (week < 1) week = 0;
    return { week, start, key: localDateKey(start) };
  }
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

async function fetchEspnJson({ leagueId, seasonId, view, scoringPeriodId, matchupPeriodId, auth = false, permanent = false }) {
  if (!leagueId || !seasonId || !view) throw new Error("Missing leagueId/seasonId/view");
  const sp = scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "";
  const mp = matchupPeriodId ? `&matchupPeriodId=${matchupPeriodId}` : "";
  const au = auth ? `&auth=1` : "";
  // "view" can be a single view name or (2026-08-25) an array of several,
  // e.g. ["mTeam","mRoster","mMatchup","mSettings","mStandings"] - ESPN
  // wants several views requested together for some data (particularly
  // older, completed seasons), not one at a time.
  const viewParam = (Array.isArray(view) ? view : [view]).map(v => `view=${v}`).join("&");
  // 2026-09-22: `permanent: true` (only ever passed for Hall of Fame's past,
  // completed seasons) routes through /api/espn-cached instead of /api/espn -
  // the server computes it once from ESPN and stores it forever, since a
  // finished season's data can never change. Current/in-progress seasons
  // never pass this flag, so their live behavior is untouched.
  const endpoint = permanent ? "/api/espn-cached" : "/api/espn";
  const permParam = permanent ? "&permanent=1" : "";
  const url = API(`${endpoint}?leagueId=${leagueId}&seasonId=${seasonId}&${viewParam}${sp}${mp}${au}${permParam}`);
  
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
  // Sculpin league is inactive for now (2026-08-25). Unless someone explicitly asks
  // for it - via a "sculpin" subdomain or a "?league=sculpin" URL parameter - the site
  // goes straight into Blitzzz and skips the two-league selection screen entirely.
  // Nothing about Sculpin was deleted: its config (src/config/leagueConfigs.js), the
  // LandingPage selector, and the "Switch League" button in the sidebar all still work
  // exactly as before, in case the league gets reactivated later.
  const [selectedLeague, setSelectedLeague] = useState(() => {
    const leagueFromSubdomain = getLeagueFromSubdomain();
    const targetLeague = (leagueFromSubdomain === 'sculpin') ? 'sculpin' : 'blitzzz';
    console.log('Defaulting into league (Sculpin inactive):', targetLeague);
    return { id: targetLeague, ...leagueConfigs[targetLeague] };
  });

  // Handle league selection from landing page
  const handleLeagueSelect = (league) => {
  console.log('League selected from landing page:', league);
  setSelectedLeague(league);
  
  // Update URL parameter for both development and production
  const url = new URL(window.location);
  url.searchParams.set('league', league.id);
  url.hash = '#hoodtrophies'; // Always go to Hood Trophies for all leagues
  
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

  // selectedLeague is now always set on first load (see the useState above), so this
  // landing-page selector normally never shows. It's kept working so the sidebar's
  // "Switch League" button (which calls handleBackToSelection) still has somewhere to go.
  if (!selectedLeague) {
    return <LandingPage onLeagueSelect={handleLeagueSelect} />;
  }

  return <LeagueHub selectedLeague={selectedLeague} onBackToSelection={handleBackToSelection} />;
}

function MobileHeader({ config, onMenuToggle }) {
  return (
    <div className="mobile-header">
      <div className="mobile-logo">
        <img src={config.logo} alt={`${config.name} Logo`} />
        <div className="mobile-league-name">
  {config.id === 'blitzzz' ? 'Blitzzz Fantasy Football' : 
   config.id === 'sculpin' ? 'Sculpin That Ass Fantasy Football' : 
   `${config.name} Fantasy Football`}
</div>
      </div>
      <button className="hamburger-btn" onClick={onMenuToggle}>
  ☰ MENU
</button>
    </div>
  );
}

   function LeagueHub({ selectedLeague, onBackToSelection }) {
  useEffect(() => { document.title = "Blitzzz Fantasy Football League"; }, []);
  const currentYear = new Date().getFullYear();
  const config = useLeagueConfig(selectedLeague);
  
  // Add mobile menu state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const closeSidebar = () => setSidebarOpen(false);

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


const switchLeague = () => {
  // Clear URL parameter when switching leagues
  const url = new URL(window.location);
  url.searchParams.delete('league');
  url.hash = '#announcements'; // Reset to default view
  window.history.pushState({}, '', url);
  onBackToSelection();
};

const VALID_TABS = [
  "announcements","hoodtrophies","halloffame","activity","weekly","highestscorer","waivers","dues",
  "transactions","drafts","rosters","powerrankings","nerddata","settings","trading","paydues","polls"
];

// 2026-08-26: homepage auto-routing. When someone just types the domain
// name (no #hash at all), the site used to always default to Trophy Case.
// Hac wants that to depend on where the season actually is: Hall of Fame
// during the preseason AND all of Week 1 (Trophy Case wouldn't have
// anything from the new season to show until Week 1's games are actually
// final), then Trophy Case from Week 2 onward. This can't wait for ESPN's
// real week-anchor answer (that's an async fetch - see loadEspnWeekAnchor
// - and this needs a same-render guess), so it uses the synchronous
// date-estimate fallback first (leagueWeekOf already falls back to this
// automatically when no anchor is cached yet) and gets corrected below,
// in LeagueHub, once the real answer loads.
const homepageDefaultTab = () => {
  const guessedWeek = leagueWeekOf(new Date(), new Date().getFullYear()).week;
  return guessedWeek >= 2 ? "hoodtrophies" : "halloffame";
};

  const initialTabFromHash = () => {
  const h = (window.location.hash || "").replace("#","").trim();
  return VALID_TABS.includes(h) ? h : homepageDefaultTab();
};

  const [active, setActive] = useState(initialTabFromHash);

  // Remembers whether this was a bare "typed the domain name" landing (no
  // explicit #hash) - only that case should ever get auto-routed between
  // Hall of Fame and Trophy Case. Anyone who followed or bookmarked a
  // specific #hash keeps landing exactly where they asked to go, and this
  // never touches it. Captured once, on mount.
  const wasBareLandingRef = useRef(
    !VALID_TABS.includes((window.location.hash || "").replace("#","").trim())
  );

    useEffect(() => {
  const onHash = () => {
    const h = (window.location.hash || "").replace("#","").trim();
    setActive(VALID_TABS.includes(h) ? h : "activity");
  };
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}, []);

  useEffect(() => {
    const want = `#${active}`;
    if (window.location.hash !== want) window.location.hash = want;
  }, [active]);

  // Update your return statement:
  
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
    // 2026-08-26: this was reading `response.season` straight off the raw
    // fetch() Response object, which never has a `.season` property (that
    // lives in the response BODY, only available after calling .json()).
    // So serverSeason was ALWAYS undefined here, and this always silently
    // fell through to DEFAULT_SEASON below - the hardcoded VITE_ESPN_SEASON
    // build-time value (2025) - no matter what was actually saved via
    // "Update Official Snapshot". This is why the site kept snapping back
    // to 2025 on every fresh page load (Hac noticed it after local
    // restarts, but the same thing would happen for any visitor's very
    // first page load too - restarting just forces a full reload, which is
    // what actually triggers this code path). Fixed by awaiting .json().
    const res = await fetch(API('/api/report/default-season'));
    const response = await res.json();
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
document.body.classList.add('theme-chargers'); // <-- ADD THIS LINE TO TEST
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

// 2026-08-25: ask ESPN what week it currently thinks the season is on
// (see loadEspnWeekAnchor near the top of this file), then recompute the
// default selected week using that real answer instead of the
// September-guess fallback.
useEffect(() => {
  if (!espn.leagueId || !espn.seasonId) return;
  loadEspnWeekAnchor(espn.leagueId, espn.seasonId).then(() => {
    const w = leagueWeekOf(new Date(), seasonYear);
    setSelectedWeek(w);

    // Homepage auto-routing (see homepageDefaultTab/wasBareLandingRef
    // above): now that ESPN's real week-anchor answer has loaded, correct
    // the initial synchronous guess if needed. Only applies to a bare
    // "typed the domain name" landing, and only if the visitor is still
    // sitting on one of the two auto-routed tabs (hasn't since clicked
    // somewhere else themselves, which this must never override).
    if (wasBareLandingRef.current) {
      const correctDefault = w.week >= 2 ? "hoodtrophies" : "halloffame";
      setActive(prev => (prev === "halloffame" || prev === "hoodtrophies") ? correctDefault : prev);
    }
  });
}, [espn.leagueId, espn.seasonId]);

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

const updatePayment = async (teamName, isPaid) => {
  const seasonKey = String(espn.seasonId || seasonYear);
  const currentPayments = (data.duesPayments && data.duesPayments[seasonKey]) || {};
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
    console.error('Failed to update payment:', error);
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
    
    const rosterData = (rosJson?.teams || []).map(t => {
      const entries = (t.roster?.entries || []).map(e => {
        const p = e.playerPoolEntry?.player;
        const fullName = p?.fullName || "Player";
        const slot = slotMap[e.lineupSlotId] || "—";
        // ADD THE CONSOLE.LOG HERE:
  if (fullName.includes("Kraft") || fullName.includes("Goedert")) {
    console.log(`${fullName}:`, {
      defaultPositionId: p?.defaultPositionId,
      eligibleSlots: p?.eligibleSlots,
      slotId: e.lineupSlotId
    });
  }
        // KEY FIX: Use lineupSlotId to determine position, NOT defaultPositionId
        let position = "";
const slotId = e.lineupSlotId;

if (slotId === 20 || slotId === 21) { // Bench or IR (2026-09-24: leagues added
  // an IR slot this season - IR players need the same "figure out their real
  // position from eligibleSlots" treatment bench players already got, or
  // they'd get dropped/mislabeled entirely. This is the client-side "Import
  // ESPN Teams" path in League Settings - separate code from the server's
  // own background refresh, which got this same fix earlier but doesn't run
  // when an admin clicks Import ESPN Teams directly.
  const eligible = p?.eligibleSlots || [];

  // Check for pure TE first (has slot 6 but NOT slots 3 or 4)
  if (eligible.includes(6) && !eligible.includes(3) && !eligible.includes(4)) {
    position = "TE";
  }
  // WR check
  else if (eligible.includes(3) || eligible.includes(4)) {
    position = "WR";
  }
  // RB check
  else if (eligible.includes(2)) {
    position = "RB";
  }
  // QB check
  else if (eligible.includes(0)) {
    position = "QB";
  }
  // D/ST check
  else if (eligible.includes(16)) {
    position = "D/ST";
  }
  // K check
  else if (eligible.includes(17)) {
    position = "K";
  }
  // Fallback
  else if (p?.defaultPositionId) {
    position = posIdToName(p.defaultPositionId);
  }
} else {
  position = slot;
}

        return {
          name: fullName.replace(/\s*\([^)]*\)\s*/g, '').trim(),
          slot,
          position
        };
      });

      // Separate starters, bench, and IR.
      // 2026-09-24: IR players used to fall through the cracks here too -
      // same bug as the server-side refresh had. IR is now split into its
      // own group and appended after the bench.
      const starters = entries.filter(e => e.slot !== "Bench" && e.slot !== "IR");
      const bench = entries.filter(e => e.slot === "Bench");
      const ir = entries.filter(e => e.slot === "IR");

      // Define exact starter order
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

      const sortedStarters = [];
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

      // Sort IR players and add position in parentheses, same as bench
      const sortedIr = ir
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({
          name: p.position ? `${p.name} (${p.position})` : p.name,
          slot: p.slot
        }));

      const finalEntries = [
        ...sortedStarters.map(p => ({ name: p.name, slot: p.slot })),
        ...sortedBench,
        ...sortedIr
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

    // 2026-08-26: also make this the season everyone else's browser loads
    // by default. Without this, only the browser that clicked this button
    // ever sees the new season - everyone else (a phone, a teammate, a
    // fresh visit) still gets whatever season was set last, since that's
    // read from the server on page load, not from this browser's own
    // League Settings. Wrapped so that if this part fails, the snapshot
    // that was just successfully built still isn't lost.
    try {
      await fetch(API('/api/report/set-display-season'), {
        method: "POST",
        headers: { "Content-Type":"application/json", "x-admin": config.adminPassword },
        body: JSON.stringify({ seasonId: espn.seasonId })
      });
    } catch (displaySeasonErr) {
      console.error('Failed to set display season (snapshot itself still succeeded):', displaySeasonErr);
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
  hoodtrophies: <TrophyCaseView espn={espn} config={config} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} />,
  halloffame: <HallOfFameView config={config} apiCallLeague={apiCallLeague} btnPri={btnPri} btnSec={btnSec} />,

  ...(config.id !== 'sculpin' && { weekly: <WeeklyView {...{isAdmin,data,addWeekly,deleteWeekly, editWeekly, seasonYear}} espn={espn} config={config} btnPri={btnPri} btnSec={btnSec} /> }),
  ...(config.id === 'sculpin' && { highestscorer: <HighestScorerView espn={espn} config={config} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} /> }),
  activity: <RecentActivityView espn={espn} config={config} btnPri={btnPri} btnSec={btnSec} isAdmin={isAdmin} />,
  transactions: <TransactionsView report={espnReport} loadOfficialReport={loadOfficialReport} espn={espn} btnPri={btnPri} btnSec={btnSec} />,
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
  rosters: <Rosters leagueId={espn.leagueId} seasonId={espn.seasonId} apiCallLeague={apiCallLeague} btnPri={btnPri} btnSec={btnSec} />,
  powerrankings: <PowerRankingsView espn={espn} config={config} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} />,
  nerddata: <NerdDataView espn={espn} config={config} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec} />,
  settings: <SettingsView {...{isAdmin,espn,setEspn,importEspnTeams,data,saveLeagueSettings}} btnPri={btnPri} btnSec={btnSec}/>,
  trading: <TradingView {...{isAdmin,addTrade,deleteTrade,data}} btnPri={btnPri} btnSec={btnSec}/>,
  polls: <PollsView {...{isAdmin, members:data.members, espn, config}} btnPri={btnPri} btnSec={btnSec}/>,
paydues: <PayDuesView data={data} updateBuyIns={updateBuyIns} setData={setData} isAdmin={isAdmin} btnPri={btnPri} btnSec={btnSec} />,
};

  return (
  <>
    <IntroSplash selectedLeague={selectedLeague}/>
    <div className="container">
      <div className="card app-shell" style={{overflow:"auto"}}>
        <MobileHeader config={config} onMenuToggle={toggleSidebar} />
        
        {/* Sidebar overlay for mobile */}
        <div 
          className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} 
          onClick={closeSidebar}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 999,
            display: sidebarOpen ? 'block' : 'none'
          }}
        />
        
        <aside
          className={`sidebar ${sidebarOpen ? 'open' : ''}`}
     >
          {/* Close button for mobile */}
          <button 
            className="sidebar-close" 
            onClick={closeSidebar}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: 'transparent',
              border: 'none',
              color: '#e2e8f0',
              fontSize: 24,
              cursor: 'pointer',
              display: sidebarOpen ? 'block' : 'none'
            }}
          >
            ×
          </button>
          
          <div className="brand">
            <img src={config.logo} alt={`${config.name} Logo`} style={{width: 128, height: 128}} />
            <div className="brand-title">{config.name} <span>Fantasy Football League</span></div>

            {/* "Switch League" button hidden while Sculpin is inactive (2026-08-25) -
                there's only one league to switch to right now. The button and the
                switchLeague() function are untouched below, so re-enabling this later
                is just a matter of removing the "false &&" line. */}
            {false && (
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
            )}
          </div>
          
          {/* Navigation with mobile close functionality */}
          {/* 2026-09-23: Announcements hidden from the menu at Hac's request.
              Nothing was deleted - the page and its data still work exactly
              like before. To bring it back: delete the two comment-marker
              lines directly above and below the NavBtn line right below
              this note (leave the NavBtn line itself alone). */}
          {/* HIDDEN-START */}
          {/* <NavBtn id="announcements" label="📣 Announcements" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/> */}
          {/* HIDDEN-END */}
          <NavBtn id="hoodtrophies" label="🏆 Trophy Case" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="halloffame" label="🏛️ Hall of Fame" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          {config.id !== 'sculpin' && <NavBtn id="weekly" label="🗓️ Weekly Challenges" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>}
          {config.id === 'sculpin' && <NavBtn id="highestscorer" label="👑 Highest Scorer" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>}
          <NavBtn id="activity" label="⏱️ Recent Activity" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/> 
          <NavBtn id="waivers" label="💵 Waivers" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="dues" label="🧾 Dues" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="transactions" label="📜 Transactions" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="drafts" label="📋 Draft Recap" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="rosters" label="📋 Rosters" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="powerrankings" label="🏋️ Power Rankings" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="nerddata" label="🤓 Nerd Data" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          <NavBtn id="settings" label="⚙️ League Settings" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          {/* 2026-09-23: Trading Block hidden from the menu at Hac's request
              (same as Announcements above - nothing deleted, just remove
              the two HIDDEN-START/HIDDEN-END comment lines to bring it
              back). */}
          {/* HIDDEN-START */}
          {/* <NavBtn id="trading" label="🔁 Trading Block" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/> */}
          {/* HIDDEN-END */}
          <NavBtn id="paydues" label="💰 Pay Dues" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/>
          {/* 2026-09-23: Polls hidden from the menu at Hac's request (same
              deal - remove the two HIDDEN-START/HIDDEN-END comment lines to
              bring it back). */}
          {/* HIDDEN-START */}
          {/* <NavBtn id="polls" label="🗳️ Polls" active={active} onClick={(id) => { setActive(id); closeSidebar(); }}/> */}
          {/* HIDDEN-END */}
          
          <div style={{marginTop:12}}>
            {isAdmin
               ? <button className="btn btn-commish" onClick={logout}>Commissioner Log out</button>
               : <button className="btn btn-commish" onClick={login}>Commissioner Login</button>}
          </div>
        </aside>
        
        <main style={{padding: 24, paddingTop: 47}}>
  {console.log('Active view:', active, 'View exists:', !!views[active])}
          {views[active]}
        </main>
      </div>
    </div>
    <SyncOverlay open={syncing} pct={syncPct} msg={syncMsg} />
  </>
);
}

function posIdToName(id) {
  const map = { 
    0: "QB",    // Quarterback
    1: "TQB",   // Team QB
    2: "RB",    // Running Back
    3: "WR",    // Wide Receiver (THIS WAS WRONG - was "RB")
    4: "WR",    // Wide Receiver  
    5: "WR/TE", // Wide Receiver/Tight End
    6: "TE",    // Tight End
    7: "OP",    // Offensive Player
    8: "DT",    // Defensive Tackle
    9: "DE",    // Defensive End
    10: "LB",   // Linebacker
    11: "DL",   // Defensive Line (THIS WAS WRONG - was "DE")
    12: "CB",   // Cornerback (THIS WAS WRONG - was "DB")
    13: "S",    // Safety (THIS WAS WRONG - was "DB")
    14: "DB",   // Defensive Back
    15: "DP",   // Defensive Player
    16: "D/ST", // Defense/Special Teams
    17: "K",    // Kicker
    18: "P",    // Punter
    19: "HC"    // Head Coach
  };
  return map?.[id] || "—";
}

function slotIdToName(counts) {
  const map = { 0: "QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP", 16: "D/ST", 17: "K", 20: "Bench", 21: "IR", 23: "FLEX", 24: "EDR", 25: "RDP", 26: "RDP", 27: "RDP", 28: "Head Coach" };
  const res = {};
  Object.keys(counts).forEach(k => res[k] = map[k] || `Slot ${k}`);
  return res;
}

// ADD THESE THREE FUNCTIONS HERE (GLOBAL SCOPE) ↓↓↓

// Helper to check if a lineup slot is bench/IR
const ht_isBenchSlot = (slotId) => slotId === 20 || slotId === 21;

// Get projected points for a specific player in a specific week
const ht_projectedForWeek = (playerObj, week) => {
  const stats = playerObj?.stats;
  if (!Array.isArray(stats)) return 0;
  const row = stats.find(
    s => s?.scoringPeriodId === week && s?.statSourceId === 1 && s?.statSplitTypeId === 1
  );
  return Number(row?.appliedTotal ?? 0);
};

// Get team's total projected points.
//
// IMPORTANT: this must be the projection ESPN had BEFORE the games started
// that week, not a number that keeps changing while games are being played.
// ESPN's "totalProjectedPointsLive" field is a LIVE number: once a game
// kicks off, it starts blending in players' real, already-scored points, so
// it drifts away from the original pre-game projection as the week
// progresses and is a different number depending on when we happen to check
// it. That's no good for "how far did this team beat/miss their projection"
// style trophies (Overachiever/Underachiever/Bullseye/etc.) - we want the
// one true pre-game number every time, whether we check mid-game, right
// after the week ends, or a year later.
//
// The fix: build the team's projection ourselves by summing each starting
// player's individual PROJECTED stat line (statSourceId === 1, see
// ht_projectedForWeek above). ESPN freezes that per-player projected number
// at kickoff and does not overwrite it as the game plays out, so it stays
// stable no matter when we fetch it. We only fall back to ESPN's team-level
// fields if, for some reason, we don't have roster/player data to sum (e.g.
// an odd API response), since a rough number is better than none.
const ht_teamProjection = (teamSideObj, week) => {
  const entries =
    teamSideObj?.rosterForCurrentScoringPeriod?.entries ||
    teamSideObj?.roster?.entries ||
    [];

  if (entries.length > 0) {
    let sum = 0;
    let counted = 0;
    for (const e of entries) {
      if (ht_isBenchSlot(e?.lineupSlotId)) continue;
      const player = e?.playerPoolEntry?.player;
      sum += ht_projectedForWeek(player, week);
      counted++;
    }
    if (counted > 0) return sum;
  }

  // Fallback only: no per-player data available to sum, so use whatever
  // team-level projection ESPN provided (frozen "totalProjectedPoints"
  // preferred over the live-updating "totalProjectedPointsLive" one).
  const teamLevel =
    teamSideObj?.totalProjectedPoints ??
    teamSideObj?.totalProjectedPointsLive ??
    null;
  if (teamLevel != null && isFinite(teamLevel)) return Number(teamLevel);

  return 0;
};
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

// 2026-09-24: real Pacific-time date+time for a Recent Activity row, at
// Hac's request - the server already tags every move with a raw epoch
// (move.ts) alongside its PT-formatted display string, so this just
// re-renders that epoch with an explicit America/Los_Angeles timezone and
// the time included, instead of the date-only string used before.
function formatActivityDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "numeric",
    day: "numeric",
    year: "numeric"
  });
}
function formatActivityTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit"
  });
}
// 2026-09-24: date and time as separate pieces (no comma between them, no
// "PT" suffix - Hac's request) so styles.css's .activity-time rule can put
// the time on its own, smaller line on mobile only, without touching
// desktop at all.
function ActivityTimestamp({ ts }) {
  if (!ts) return null;
  return (
    <span className="activity-timestamp">
      <span className="activity-date">{formatActivityDate(ts)}</span>
      {" "}
      <span className="activity-time">{formatActivityTime(ts)}</span>
    </span>
  );
}

// 2026-09-24: Free Agent adds in white, Waiver adds in orange - Hac's
// request, so a glance at Recent Activity shows which pickups actually
// went through the waiver process vs a same-day free-agent grab.
function MethodBadge({ method, bidAmount }) {
  if (!method) return null;
  const isWaiver = /waiver/i.test(method);
  // 2026-09-24: show the FAAB bid alongside a waiver add, at Hac's request -
  // bidAmount is only ever populated (non-null/undefined) for waiver moves
  // in a FAAB league to begin with (see rawMoves in server.mjs), so this
  // naturally stays blank for Free Agent adds and for non-FAAB leagues.
  const showBid = isWaiver && bidAmount !== null && bidAmount !== undefined;
  return (
    <span style={{ color: isWaiver ? "#f97316" : "#ffffff", fontWeight: 600, fontSize: 12 }}>
      {method}{showBid ? ` ($${bidAmount})` : ""}
    </span>
  );
}

function RecentActivityView({ espn, config, btnPri, btnSec, isAdmin }) {
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
        
        // Simple chronological sort with pairing
const pairedActivities = [];
const paired = new Set();

// Sort original moves by timestamp descending (newest first)
const sortedMoves = [...recentMoves].sort((a, b) => 
  new Date(b.date).getTime() - new Date(a.date).getTime()
);

for (let i = 0; i < sortedMoves.length; i++) {
  if (paired.has(i)) continue;
  
  const move = sortedMoves[i];
  
  if (move.action === "ADD") {
    // Look for matching DROP from same team on same date
    const matchIdx = sortedMoves.findIndex((m, idx) => 
      idx > i && 
      !paired.has(idx) &&
      m.action === "DROP" && 
      m.team === move.team && 
      m.date === move.date
    );
    
    if (matchIdx !== -1) {
      paired.add(matchIdx);
      pairedActivities.push({
        date: new Date(move.date).toLocaleDateString(),
        ts: move.ts ?? new Date(move.date).getTime(),
        method: move.method,
        bidAmount: move.bidAmount,
        team: move.team,
        player: move.player,
        action: "ADDED",
        week: move.week,
        isDraft: move.week <= 0,
        isPaired: true,
        pairWith: sortedMoves[matchIdx].player
      });
      pairedActivities.push({
        date: new Date(move.date).toLocaleDateString(),
        ts: sortedMoves[matchIdx].ts ?? new Date(move.date).getTime(),
        method: sortedMoves[matchIdx].method,
        team: move.team,
        player: sortedMoves[matchIdx].player,
        action: "DROPPED",
        week: move.week,
        isDraft: move.week <= 0,
        isPaired: true,
        pairWith: move.player
      });
    } else {
      pairedActivities.push({
        date: new Date(move.date).toLocaleDateString(),
        ts: move.ts ?? new Date(move.date).getTime(),
        method: move.method,
        bidAmount: move.bidAmount,
        team: move.team,
        player: move.player,
        action: "ADDED",
        week: move.week,
        isDraft: move.week <= 0,
        isPaired: false
      });
    }
  } else {
    pairedActivities.push({
      date: new Date(move.date).toLocaleDateString(),
      ts: move.ts ?? new Date(move.date).getTime(),
      method: move.method,
      team: move.team,
      player: move.player,
      action: "DROPPED",
      week: move.week,
      isDraft: move.week <= 0,
      isPaired: false
    });
  }
}

setActivities(pairedActivities);
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
          {/* 2026-09-24: limited to admins at Hac's request - this page's
              own useEffect above already reloads on mount/season change, so
              a regular visitor gets fresh data just by opening the page.
              The only time re-clicking this actually matters is right after
              an admin updates the official snapshot elsewhere while this
              page is still open - so it stays, admin-only. */}
          {isAdmin && (
            <button className="btn" style={btnSec} onClick={loadReport} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
        
        {!espn.seasonId && <div style={{ color: "#64748b" }}>Set your ESPN season in League Settings.</div>}
        {error && <div style={{ color: "#dc2626" }}>{error}</div>}
        
        {activities.length > 0 ? (
  <div style={{ marginTop: 12 }}>
    {(() => {
      // 2026-09-25: normalize activities into one flat list of "items"
      // (either a genuine same-moment ADD+DROP pair, or a solo ADD/DROP)
      // ONCE, then render that same list twice below - once in the
      // existing desktop layout, once in a new mobile-card layout that
      // matches the Transactions page's mobile cards (Hac's request:
      // "let's just use similar formatting as the transactions page").
      // Only one of the two ever shows at a time - see
      // .recent-activity-desktop / .recent-activity-mobile in styles.css.
      const items = [];
      for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        const nextActivity = activities[i + 1];

        // Check whether this ADD/DROP is a genuine same-moment swap using
        // isPaired/pairWith (set earlier from an exact timestamp match,
        // see matchIdx above).
        if (activity.action === "ADDED" &&
            activity.isPaired &&
            nextActivity &&
            nextActivity.action === "DROPPED" &&
            nextActivity.isPaired &&
            nextActivity.team === activity.team &&
            nextActivity.pairWith === activity.player &&
            activity.pairWith === nextActivity.player) {
          items.push({
            key: i,
            isPair: true,
            team: activity.team,
            ts: activity.ts,
            method: activity.method,
            bidAmount: activity.bidAmount,
            addPlayer: activity.player,
            dropPlayer: nextActivity.player
          });
          i++; // Skip next since we processed it as the drop half of this pair
        } else {
          items.push({
            key: i,
            isPair: false,
            team: activity.team,
            ts: activity.ts,
            method: activity.method,
            bidAmount: activity.bidAmount,
            player: activity.player,
            action: activity.action
          });
        }
      }

      return (
        <>
          {/* Desktop layout - unchanged from before */}
          <div className="recent-activity-desktop">
            {items.map((item, idx) => {
              const isShaded = idx % 2 === 0;
              const backgroundColor = isShaded ? "#fffbeb" : "transparent";

              if (item.isPair) {
                return (
                  <div key={item.key} style={{ padding: "8px", borderBottom: "1px solid #e2e8f0", backgroundColor }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <b style={{ color: "#FFC20E", fontSize: 14 }}>{item.team}</b>
                      <span style={{ color: "#64748b", textAlign: "right", flexShrink: 0 }}><ActivityTimestamp ts={item.ts} /></span>
                    </div>
                    <div style={{ fontSize: 14, color: "#16a34a" }}>ADDED <b>{item.addPlayer}</b> <MethodBadge method={item.method} bidAmount={item.bidAmount} /></div>
                    <div style={{ fontSize: 14, color: "#dc2626" }}>DROPPED <b>{item.dropPlayer}</b></div>
                  </div>
                );
              }
              return (
                <div key={item.key} style={{
                  padding: "8px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  fontSize: 14,
                  color: item.action === "ADDED" ? "#16a34a" : "#dc2626",
                  backgroundColor
                }}>
                  <span><b style={{ color: "#FFC20E" }}>{item.team}</b> {item.action} <b>{item.player}</b> {item.action === "ADDED" && <MethodBadge method={item.method} bidAmount={item.bidAmount} />}</span>
                  <span style={{ color: "#64748b", textAlign: "right", flexShrink: 0 }}><ActivityTimestamp ts={item.ts} /></span>
                </div>
              );
            })}
          </div>

          {/* Mobile layout - card style matching the Transactions page's mobile cards */}
          <div className="recent-activity-mobile">
            {items.map((item, idx) => {
              const isShaded = idx % 2 === 0;
              const backgroundColor = isShaded ? "#fffbeb" : "transparent";

              return (
                <div key={item.key} className="card" style={{ padding: 8, marginBottom: 6, backgroundColor }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, color: "#FFC20E" }}>{item.team}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}><ActivityTimestamp ts={item.ts} /></div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>
                      {item.isPair ? (
                        <div>
                          <div style={{ color: "#16a34a" }}>+{item.addPlayer}</div>
                          <div style={{ color: "#dc2626" }}>-{item.dropPlayer}</div>
                        </div>
                      ) : (
                        <span style={{ color: item.action === "ADDED" ? "#16a34a" : "#dc2626" }}>
                          {item.action === "ADDED" ? "+" : "-"}{item.player}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {(item.isPair || item.action === "ADDED") && <MethodBadge method={item.method} bidAmount={item.bidAmount} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      );
    })()}
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

// ============================================================
// WEEKLY CHALLENGES — locked in for the 2026 season (2026-08-25)
// This is the single source of truth for the weekly challenge order,
// names, and descriptions. Editing is no longer available on the site
// (by Hac's request, so this list and the winner-calculation logic can
// never drift out of sync with each other like they briefly did during
// the 2026 reorder). To change the order or wording in a future season,
// edit this list AND the matching week numbers in the
// determineWeeklyWinner() switch statement and the
// loadWeeklyChallengeWinners() special-casing further down this file.
// ============================================================
const WEEKLY_CHALLENGES = [
  { week: 1, title: "Hot Start", text: "Highest overall team score (starters)" },
  { week: 2, title: "MVP", text: "Highest scoring individual player, team defense included. (starters)" },
  { week: 3, title: "Bulls-Eye", text: "Team closest to their projected point total" },
  { week: 4, title: "Highest Scoring WR/RB", text: "Highest Scoring WR/RB (in starting lineup)" },
  { week: 5, title: "Photo Finish", text: "Team with closest margin of victory" },
  { week: 6, title: "Highest Scoring TE", text: "Highest Scoring TE (in starting lineup)" },
  { week: 7, title: "Biggest Blow out", text: "Largest margin of victory" },
  { week: 8, title: "Best Loser", text: "Highest scoring losing team" },
  { week: 9, title: "Highest Scoring D/ST", text: "Highest Scoring D/ST (in starting lineup)" },
  { week: 10, title: "Over-Achiever", text: "Team with most points over their weekly projection" },
  { week: 11, title: "Dirty 30", text: "Team with the starting player closest to 30 points (under OR over)" },
  { week: 12, title: "Bench Warmer", text: "Team with highest scoring bench player" },
  { week: 13, title: "Hero to Zero", text: "Biggest NEGATIVE team points differential from the prior week to this week" },
];

function WeeklyView({ isAdmin, data, addWeekly, deleteWeekly, editWeekly, seasonYear, espn, config, btnPri, btnSec }) {
  const [weeklyWinners, setWeeklyWinners] = useState({});
  const [loading, setLoading] = useState(false);
  const [manualWinners, setManualWinners] = useState({});

  const currentYear = new Date().getFullYear();
  const nowWeek = leagueWeekOf(new Date(), seasonYear).week || 0;

  // Load weekly challenge winners
  const loadWeeklyChallengeWinners = async (forceRecompute) => {
  if (!espn.leagueId || !espn.seasonId) return;

  setLoading(true);
  try {
    // 2026-08-25: reveal a week's winner starting Tuesday at midnight PT
    // (one minute after Monday 11:59pm) - Monday Night Football is
    // historically the last game of the fantasy week, so by Tuesday we
    // should know who won. Anchored off ESPN's real "current week" answer
    // (loadEspnWeekAnchor, near the top of this file) instead of the old
    // hardcoded-2025-date guess, which broke every year the season didn't
    // start on the exact date it assumed.
    await loadEspnWeekAnchor(espn.leagueId, espn.seasonId);
    const anchor = __espnWeekAnchor[espn.seasonId];
    const revealedThroughWeek = anchor ? anchor.week - 1 : 0; // last week that's safe to show

    // 2026-09-22: try the server's saved Weekly Challenges cache first, so
    // we don't recompute from the ESPN API (and re-run ~1300 lines of
    // winner-determination logic) on every single page load. Skipped when
    // the user hits "Refresh Winners" (forceRecompute), or if the cache
    // doesn't yet cover every week that's currently revealed - either way
    // we fall straight through to the exact same live computation as
    // before, so nothing about who wins what ever changes.
    if (!forceRecompute && config?.id) {
      try {
        const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
        const cacheResp = await fetch(`${baseURL}/api/leagues/${config.id}/weekly-challenges-cache/${espn.seasonId}`);
        if (cacheResp.ok) {
          const cached = await cacheResp.json();
          if (cached && cached.winners && cached.throughWeek >= revealedThroughWeek) {
            setWeeklyWinners(cached.winners);
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        // cache fetch failed - fall through to live computation below
      }
    }

    const winners = {};

    // Process weeks 1-13
    for (let week = 1; week <= 13; week++) {
      try {
        if (!anchor) continue; // ESPN's real anchor isn't loaded - don't guess with a stale date on a money feature

        // 2026-09-22: reveal a week's winner once ESPN has moved PAST it.
        // anchor.week is ESPN's real currentMatchupPeriod (the week that's
        // still in progress) - so any week strictly before it is done and
        // safe to reveal, while anchor.week itself (and anything after it)
        // is still being played and must stay hidden.
        if (week >= anchor.week) continue;

        let winner = null;

        // Week 10 (Over-Achiever) - use projection API
        if (week === 10) {
  winner = await determineOverachiever(week, espn.leagueId, espn.seasonId, ht_projectedForWeek, ht_teamProjection);
        }

        // Week 3 (Bulls-Eye) - use projection API
else if (week === 3) {
  winner = await determineBullseye(week, espn.leagueId, espn.seasonId, ht_projectedForWeek, ht_teamProjection);
}
        // Other weeks use existing logic
        else {
          winner = await determineWeeklyWinner(week, espn.leagueId, espn.seasonId);
        }

        if (winner) {
          winners[week] = winner;
        }
      } catch (error) {
        console.error(`Failed to determine Week ${week} winner:`, error);
      }
    }

    setWeeklyWinners(winners);

    // 2026-09-22: now that we just computed these live, save them to the
    // server so the next visitor (or our own next page load) can skip
    // straight to the cache above instead of redoing all this work.
    if (config?.id && Object.keys(winners).length > 0) {
      try {
        const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
        fetch(`${baseURL}/api/leagues/${config.id}/weekly-challenges-cache/${espn.seasonId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ winners, throughWeek: revealedThroughWeek })
        }).catch(() => {});
      } catch (e) {
        // best-effort - a failed cache save should never break the page
      }
    }
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

  // The list is now fixed (see WEEKLY_CHALLENGES above) - no longer editable from the site.
  const list = WEEKLY_CHALLENGES.map(c => ({
    id: `week-${c.week}`,
    week: c.week,
    weekLabel: `Week ${c.week}`,
    title: c.title,
    text: c.text
  }));

  return (
    <div id="weekly-challenges-root" data-loaded={loading ? "false" : "true"}>
    <Section title="Weekly Challenges" actions={
      // 2026-09-24: "Refresh Winners" limited to admins at Hac's request -
      // winners already reveal themselves automatically once a week (see
      // the cache-staleness check above, keyed off revealedThroughWeek), so
      // a regular visitor never needs to force this. Kept for admins only,
      // as a manual override in case a winner-determination fix needs to
      // overwrite an already-cached (and now wrong) result without waiting
      // a week for the cache to naturally roll over.
      isAdmin ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={btnSec} onClick={() => loadWeeklyChallengeWinners(true)} disabled={loading}>
            {loading ? "Loading..." : "Refresh Winners"}
          </button>
        </div>
      ) : null
    }>
      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        {list.map(item => {
          const weekNumber = item.week || 0;
          const winner = weeklyWinners[weekNumber];

          return (
            <div key={item.id} id={`weekly-challenge-card-${item.week}`} className="card" style={{ padding: 16 }}>              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ margin: 0 }}>
  {item.weekLabel || "Week"}
  {item.title ? <span style={{ fontWeight: "bold", color: "#ffb612" }}> — {item.title}</span> : null}
</h3>
                </div>
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
                      textShadow: "0 0 4px rgba(255,194,14,0.5)",
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
            </div>
          );
        })}
      </div>
    </Section>
    </div>
  );
}

// DETERMINE WEEKLY WINNER

// DETERMINE WEEKLY WINNER
async function determineWeeklyWinner(weekNumber, leagueId, seasonId, permanent = false) {
  try {
    // Get team names with better error handling and data structure
    // 2026-09-22: routed through fetchEspnJson (our own server) instead of a
    // direct browser->ESPN fetch. When `permanent` is true (Hall of Fame,
    // viewing a past completed season) that goes through the server's
    // permanent cache instead of hitting ESPN live every page load - see
    // fetchEspnJson's comment above. Live/current-season callers don't pass
    // `permanent`, so their behavior (and ESPN calls) is unchanged.
    const teamData = await fetchEspnJson({ leagueId, seasonId, view: "mTeam", permanent });

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
    const matchupData = await fetchEspnJson({ leagueId, seasonId, view: "mMatchup", permanent });

    // Get detailed player data for player-level challenges
    const boxscoreData = await fetchEspnJson({ leagueId, seasonId, view: "mBoxscore", scoringPeriodId: weekNumber, permanent });

    // Determine winner based on week number
    switch (weekNumber) {
      case 1: // Hot Start - Highest overall team score (starters)
        return determineHighestScoringTeam(matchupData, teamNames, weekNumber);

      case 2: // MVP - Highest scoring individual player
        return determineMVP(boxscoreData, teamNames, weekNumber);

      case 4: // Highest Scoring WR/RB
        return determineHighestWRRB(boxscoreData, teamNames, weekNumber);

      case 5: // Photo Finish - Closest margin of victory
        return determineClosestMargin(matchupData, teamNames, weekNumber);

      case 6: // Highest Scoring TE
        return determineHighestTE(boxscoreData, teamNames, weekNumber);

      case 7: // Biggest Blow out - Largest margin of victory
        return determineLargestMargin(matchupData, teamNames, weekNumber);

      case 8: // Best Loser - Highest scoring losing team
        return determineBestLoser(matchupData, teamNames, weekNumber);

      case 9: // Highest Scoring D/ST
        return determineHighestDST(boxscoreData, teamNames, weekNumber);

      case 11: // Dirty 30 - Player closest to 30 points
        return determineDirty30(boxscoreData, teamNames, weekNumber);

      case 12: // Bench Warmer - Highest scoring bench player
        return determineBenchWarmer(boxscoreData, teamNames, weekNumber);

      case 13: // Hero to Zero - Biggest point drop from the prior week to this week
        return determineHeroToZero(matchupData, teamNames, weekNumber, leagueId, seasonId, permanent);

      case 3: // Bulls-Eye - Manual selection required (uses projection API - see loadWeeklyChallengeWinners)
      case 10: // Over-Achiever - Manual selection required (uses projection API - see loadWeeklyChallengeWinners)
        return null;

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error determining Week ${weekNumber} winner:`, error);
    return null;
  }
}


// Week 10: Over-Achiever - biggest positive difference from projection
async function determineOverachiever(weekNumber, leagueId, seasonId, ht_projectedForWeek, ht_teamProjection, permanent = false) {
  try {
    console.log(`[OVERACHIEVER] Starting calculation for Week ${weekNumber}`);

    const [teamData, boxscoreData] = await Promise.all([
      fetchEspnJson({ leagueId, seasonId, view: "mTeam", permanent }),
      fetchEspnJson({ leagueId, seasonId, view: ["mMatchup", "mBoxscore"], scoringPeriodId: weekNumber, permanent })
    ]);

    console.log(`[OVERACHIEVER] Fetched data for week ${weekNumber}`);
    console.log(`[OVERACHIEVER] Schedule length: ${boxscoreData?.schedule?.length || 0}`);
    
    // Build team name mapping
    const teamNames = {};
    if (teamData.teams) {
      teamData.teams.forEach(team => {
        teamNames[team.id] = team.location && team.nickname 
          ? `${team.location} ${team.nickname}` 
          : team.name || `Team ${team.id}`;
      });
    }
    
    let biggestOverachieve = { team: "", delta: -Infinity, actual: 0, proj: 0 };
    
    // Process each matchup for the specified week
    if (boxscoreData.schedule) {
      boxscoreData.schedule.forEach((matchup, idx) => {
        // Verify this matchup is for the correct week
        if (matchup.matchupPeriodId !== weekNumber) {
          console.warn(`[OVERACHIEVER] Skipping matchup ${idx} - wrong week (${matchup.matchupPeriodId} vs ${weekNumber})`);
          return;
        }
        
        [matchup.home, matchup.away].forEach((team, sideIdx) => {
          if (!team) return;
          
          const actual = team.totalPoints || 0;
          const proj = ht_teamProjection(team, weekNumber);
          const delta = actual - proj;
          
          const teamName = teamNames[team.teamId] || `Team ${team.teamId}`;
          
          console.log(`[OVERACHIEVER] Week ${weekNumber}, Matchup ${idx}, ${sideIdx === 0 ? 'Home' : 'Away'}: ${teamName}`);
          console.log(`  Actual: ${actual.toFixed(2)}, Projected: ${proj.toFixed(2)}, Delta: ${delta.toFixed(2)}`);
          
          if (delta > biggestOverachieve.delta) {
            console.log(`  ^ NEW LEADER!`);
            biggestOverachieve = {
              team: teamName,
              delta: delta,
              actual: actual,
              proj: proj
            };
          }
        });
      });
    } else {
      console.error(`[OVERACHIEVER] No schedule data found for week ${weekNumber}`);
    }
    
    console.log(`[OVERACHIEVER] Final winner: ${biggestOverachieve.team}`);
    console.log(`[OVERACHIEVER] Delta: ${biggestOverachieve.delta.toFixed(2)}, Actual: ${biggestOverachieve.actual.toFixed(2)}, Proj: ${biggestOverachieve.proj.toFixed(2)}`);
    
    if (biggestOverachieve.team && biggestOverachieve.delta > -Infinity) {
      return {
        teamName: biggestOverachieve.team,
        details: `Outperformed projection by ${biggestOverachieve.delta.toFixed(2)} points (${biggestOverachieve.actual.toFixed(2)} vs ${biggestOverachieve.proj.toFixed(2)})`
      };
    }
    
    console.log(`[OVERACHIEVER] No valid winner found`);
    return null;
  } catch (error) {
    console.error(`[OVERACHIEVER] Error determining Week ${weekNumber} Overachiever:`, error);
    return null;
  }
}

// Week 3: Bulls-Eye - Team closest to their projected point total
async function determineBullseye(weekNumber, leagueId, seasonId, ht_projectedForWeek, ht_teamProjection, permanent = false) {
  try {
    console.log(`[BULLS-EYE] Starting calculation for Week ${weekNumber}`);

    const [teamData, boxscoreData] = await Promise.all([
      fetchEspnJson({ leagueId, seasonId, view: "mTeam", permanent }),
      fetchEspnJson({ leagueId, seasonId, view: ["mMatchup", "mBoxscore"], scoringPeriodId: weekNumber, permanent })
    ]);

    console.log(`[BULLS-EYE] Fetched data for week ${weekNumber}`);
    console.log(`[BULLS-EYE] Schedule length: ${boxscoreData?.schedule?.length || 0}`);
    
    const teamNames = {};
    if (teamData.teams) {
      teamData.teams.forEach(team => {
        teamNames[team.id] = team.location && team.nickname 
          ? `${team.location} ${team.nickname}` 
          : team.name || `Team ${team.id}`;
      });
    }
    
    let closestToProjection = { team: "", diff: Infinity, actual: 0, proj: 0 };
    
    if (boxscoreData.schedule) {
      boxscoreData.schedule.forEach((matchup, idx) => {
        // Verify this matchup is for the correct week
        if (matchup.matchupPeriodId !== weekNumber) {
          console.warn(`[BULLS-EYE] Skipping matchup ${idx} - wrong week (${matchup.matchupPeriodId} vs ${weekNumber})`);
          return;
        }
        
        [matchup.home, matchup.away].forEach((team, sideIdx) => {
          if (!team) return;
          
          const actual = team.totalPoints || 0;
          const proj = ht_teamProjection(team, weekNumber);
          const diff = Math.abs(actual - proj);
          
          const teamName = teamNames[team.teamId] || `Team ${team.teamId}`;
          
          console.log(`[BULLS-EYE] Week ${weekNumber}, Matchup ${idx}, ${sideIdx === 0 ? 'Home' : 'Away'}: ${teamName}`);
          console.log(`  Actual: ${actual.toFixed(2)}, Projected: ${proj.toFixed(2)}, Diff: ${diff.toFixed(2)}`);
          
          if (diff < closestToProjection.diff) {
            console.log(`  ^ NEW LEADER!`);
            closestToProjection = {
              team: teamName,
              diff: diff,
              actual: actual,
              proj: proj
            };
          }
        });
      });
    }
    
    console.log(`[BULLS-EYE] Final winner: ${closestToProjection.team}`);
    console.log(`[BULLS-EYE] Diff: ${closestToProjection.diff.toFixed(2)}, Actual: ${closestToProjection.actual.toFixed(2)}, Proj: ${closestToProjection.proj.toFixed(2)}`);
    
    if (closestToProjection.team && closestToProjection.diff < Infinity) {
      return {
        teamName: closestToProjection.team,
        details: `Scored ${closestToProjection.actual.toFixed(2)} points (${closestToProjection.diff.toFixed(2)} from projection of ${closestToProjection.proj.toFixed(2)})`
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error determining Week ${weekNumber} Bulls-eye:`, error);
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

// Week 4: Highest Scoring WR/RB
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

// Hero to Zero - Biggest point drop from the prior week to this week (now week 13 - was hard-coded
// to Week 6 -> Week 7 before the 2026 reorder; fixed to use weekNumber so it works on any week)
async function determineHeroToZero(matchupData, teamNames, weekNumber, leagueId, seasonId, permanent = false) {
  try {
    const prevWeekNumber = weekNumber - 1;

    // Get the prior week's scores
    const prevWeekData = await fetchEspnJson({ leagueId, seasonId, view: "mMatchup", permanent });

    // Build the prior week's scores by team
    const prevWeekScores = {};
    if (prevWeekData.schedule) {
      prevWeekData.schedule.forEach(matchup => {
        if (matchup.matchupPeriodId === prevWeekNumber) {
          const homeScore = matchup.home?.totalPoints || 0;
          const awayScore = matchup.away?.totalPoints || 0;

          if (matchup.home?.teamId) prevWeekScores[matchup.home.teamId] = homeScore;
          if (matchup.away?.teamId) prevWeekScores[matchup.away.teamId] = awayScore;
        }
      });
    }

    // Build this week's scores and find biggest drop
    let biggestDrop = 0;
    let winningTeam = null;
    let prevScore = 0;
    let thisScore = 0;

    if (matchupData.schedule) {
      matchupData.schedule.forEach(matchup => {
        if (matchup.matchupPeriodId === weekNumber) {
          [matchup.home, matchup.away].forEach(team => {
            const teamId = team.teamId;
            const thisWeekTeamScore = team.totalPoints || 0;
            const prevWeekTeamScore = prevWeekScores[teamId] || 0;

            // Only count if they scored LESS this week than the prior week
            if (thisWeekTeamScore < prevWeekTeamScore) {
              const drop = prevWeekTeamScore - thisWeekTeamScore;

              if (drop > biggestDrop) {
                biggestDrop = drop;
                winningTeam = teamId;
                prevScore = prevWeekTeamScore;
                thisScore = thisWeekTeamScore;
              }
            }
          });
        }
      });
    }

    if (winningTeam) {
      return {
        teamName: teamNames[winningTeam] || `Team ${winningTeam}`,
        details: `Dropped ${biggestDrop.toFixed(1)} points (${prevScore.toFixed(1)} to ${thisScore.toFixed(1)})`
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
            // CHECK THE LINEUP SLOT - Slot 6 is the TE position
            if (entry.lineupSlotId === 6) {
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              
              if (stats && Array.isArray(stats)) {
                // Find ACTUAL stats (statSourceId: 0), not projections (statSourceId: 1)
                const weekStats = stats.find(s => 
                  s.scoringPeriodId === weekNumber && 
                  s.statSourceId === 0 &&  // ← ACTUAL STATS
                  s.statSplitTypeId === 1  // ← GAME STATS (not season totals)
                );
                
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

// Week 2: MVP
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
            if (entry.lineupSlotId !== 20) {  // Exclude bench
              const player = entry.playerPoolEntry?.player;
              const stats = player?.stats;
              
              if (stats && Array.isArray(stats)) {
                // Find ACTUAL stats (statSourceId: 0), not projections (statSourceId: 1)
                const weekStats = stats.find(s => 
                  s.scoringPeriodId === weekNumber && 
                  s.statSourceId === 0 &&  // ← ACTUAL STATS
                  s.statSplitTypeId === 1  // ← GAME STATS
                );
                
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

// Week 8: Best Loser - Highest scoring losing team
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

// Week 12: Bench Warmer - Highest scoring bench player
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

// Week 9: Highest Scoring D/ST
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
                  // Find ACTUAL stats (statSourceId: 0), not projections (statSourceId: 1)
                  const weekStats = stats.find(s => 
                    s.scoringPeriodId === weekNumber && 
                    s.statSourceId === 0 &&  // ← ACTUAL STATS
                    s.statSplitTypeId === 1  // ← GAME STATS (not season totals)
                  );
                  
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

// WeeklyEditForm and WeeklyForm (the old add/edit UI for Weekly Challenges) were removed
// 2026-08-25 when the challenge list was hardcoded into WEEKLY_CHALLENGES above - see the
// comment above that constant for why and how to make changes in a future season.

// 2026-09-24: a plain, in-app confirmation popup - used in place of the
// browser's own window.confirm() on the two dues checklists below. A
// browser confirm() dialog offers a "Don't allow this page to prompt
// again" checkbox after it's been triggered a few times, which would let
// someone silently turn off the whole safety check Hac asked for. This
// component looks similar but is just normal page content, so that
// browser opt-out checkbox can never appear.
function ConfirmModal({ open, message, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal-box" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={onConfirm}>OK</button>
        </div>
      </div>
    </div>
  );
}

// DUES PAYMENT TRACKER

function DuesPaymentTracker({ isAdmin, data, setData, seasonId, report, updateDuesPayments, btnPri, btnSec }) {
 const displayYear = new Date().getFullYear();
  // 2026-09-24: holds the pending toggle {teamName, isPaid} while the
  // ConfirmModal is up - null means no modal showing. Declared before the
  // early return below since hooks can't be conditional.
  const [pendingToggle, setPendingToggle] = useState(null);
  if (!report || !report.totalsRows) return null;

  const seasonKey = String(seasonId);
  const currentPayments = (data.duesPayments && data.duesPayments[seasonKey]) || {};

  const requestToggle = (teamName, isPaid) => {
    if (!isAdmin) return;
    setPendingToggle({ teamName, isPaid });
  };

  const applyPayment = async (teamName, isPaid) => {
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
<div className="card dues-payment-tracker" style={{ padding: 12, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ marginTop: 0 }}>{seasonId} Waiver Dues Checklist{"\u2705"}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge dues-collected-badge">
            ${paidAmount} / ${totalOwed} COLLECTED<br />
            ({paidCount} / {report.totalsRows.length} paid)
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
            <th style={{...th, color: "#dc2626"}}>Billable Adds</th>
<th style={th}>Total Adds</th>
<th style={{...th, color: "#16a34a"}}>Owes</th>
          </tr>
        </thead>
        <tbody>
          {report.totalsRows
  .sort((a, b) => b.owes - a.owes)
  .map(row => (
  <tr key={row.name} style={{ opacity: currentPayments[row.name] ? 0.6 : 1 }}>
              <td style={td}>
                <input
                  type="checkbox"
                  checked={!!currentPayments[row.name]}
                  onChange={(e) => requestToggle(row.name, e.target.checked)}
                  disabled={!isAdmin}
                />
              </td>
              <td style={{
                ...td,
                textDecoration: currentPayments[row.name] ? "line-through" : "none"
              }}>
                {row.name}
              </td>
              {/* 2026-09-24: "Billable Adds" is the adds that actually cost
                  $5 each (owes / 5) - row.adds is the TOTAL add count
                  (free + billable), which is now its own "Total Adds"
                  column instead of being mislabeled as billable. */}
              <td style={td}>{row.billable ?? 0}</td>
              <td style={td}>{row.adds}</td>
              <td style={{...td, color: row.owes > 0 ? "#16a34a" : "#000000", fontWeight: row.owes > 0 ? "bold" : "normal"}}>${row.owes}</td>
            </tr>
          ))}
        </tbody>
      </table>
{/* Mobile-friendly card layout.
    2026-09-23: redesigned at Hac's request - non-commissioners were
    seeing a disabled (but still checkbox-shaped) checkbox next to every
    team, which looked broken/editable even though tapping it did
    nothing. Non-admins now get a plain paid/unpaid status pill instead
    of any checkbox at all - nothing on the card looks tappable unless
    you're actually the commissioner. */}
<div className="mobile-list dues-mobile-list">
  {report.totalsRows.map(row => {
    const isPaid = !!currentPayments[row.name];
    return (
      <div key={row.name} className={`card dues-mobile-card${isPaid ? " dues-mobile-card-paid" : ""}`}>
        <div className="dues-mobile-row">
          <div className="dues-mobile-team">
            {isAdmin ? (
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => requestToggle(row.name, e.target.checked)}
                className="dues-mobile-checkbox"
              />
            ) : (
              <span className={`dues-status-pill${isPaid ? " dues-status-pill-paid" : ""}`}>
                {isPaid ? "Paid" : "Unpaid"}
              </span>
            )}
            <span className="dues-mobile-team-name" style={{ textDecoration: isPaid ? "line-through" : "none" }}>
              {row.name}
            </span>
          </div>
          <div className="dues-mobile-amount">
            <span className="dues-mobile-owes" style={{ color: row.owes > 0 ? "#16a34a" : "#64748b" }}>
              ${row.owes}
            </span>
          </div>
        </div>
        <div className="dues-mobile-adds">
          {row.billable ?? 0} billable add{(row.billable ?? 0) === 1 ? "" : "s"}, {row.adds} total add{row.adds === 1 ? "" : "s"}
        </div>
      </div>
    );
  })}
</div>
      <ConfirmModal
        open={!!pendingToggle}
        message={pendingToggle ? `Mark ${pendingToggle.teamName} as ${pendingToggle.isPaid ? "PAID" : "NOT PAID"}?` : ""}
        onCancel={() => setPendingToggle(null)}
        onConfirm={() => {
          const { teamName, isPaid } = pendingToggle;
          setPendingToggle(null);
          applyPayment(teamName, isPaid);
        }}
      />
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
        {/* 2026-09-24: "Refresh Snapshot" removed for non-admins at Hac's
            request. It never pulled anything new from ESPN (that's what
            "Update Official Snapshot" does, and that's already
            admin-only) - it just re-fetched the same already-saved report
            the page loads automatically anyway (see the useEffect right
            above this). For a non-admin it looked like a "get the latest
            numbers" button but was actually a no-op, which was confusing
            without any real benefit - so it's now admin-only too, where
            it's still occasionally useful for re-pulling the snapshot
            without triggering a full ESPN re-sync. */}
        {isAdmin && <button className="btn" style={btnSec} onClick={() => loadOfficialReport(false)}>Refresh Snapshot</button>}
        {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}

        {report && (
          <>
{isAdmin && (
            <button className="btn" style={btnSec} onClick={() => {
              const rows = [["Team", "Billable Adds", "Total Adds", "Owes"], ...report.totalsRows.map(r => [r.name, r.billable ?? 0, r.adds, `${r.owes}`])];
              downloadCSV("dues_totals.csv", rows);
            }}>Download CSV (totals)</button>
)}
{isAdmin && (
            <button className="btn" style={btnSec} onClick={() => {
              const rows = [["Week", "Range", "Team", "Adds", "Owes"]];
              report.weekRows.forEach(w => w.entries.forEach(e => rows.push([w.week === 0 ? "Preseason" : w.week, w.range, e.name, e.count, `${e.owes}`])));
              downloadCSV("dues_by_week.csv", rows);
            }}>Download CSV (by week)</button>
)}
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

</div>

    
    {/* Rest of your dues view stays the same */}
    <div className="card dues-week" style={{ padding: 12, minWidth: 0 }}>
      <h3 style={{ marginTop: 0 }}>Weekly Adds Log</h3>
      {report.weekRows
  .sort((a, b) => b.week - a.week)
  .map(w => {
    // Playoff weeks (15, 16, 17) are free
    const playoffWeeks = [15, 16, 17];
    const isPlayoffWeek = playoffWeeks.includes(w.week);
    
    return (
      <div key={w.week} style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, margin: "6px 0" }}>{w.week === 0 ? 'Preseason' : `Week ${w.week}`} - {w.range.split(' (')[0].replace(/—/g, '→')}{w.week > 0 ? ' (Wednesday→Tuesday)' : ''}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Team</th>
              <th style={th}>Adds</th>
              <th style={th}>Owes</th>
            </tr>
          </thead>
          <tbody>
            {w.entries
              .sort((a, b) => b.count - a.count)
              .map(e => {
                const displayOwes = isPlayoffWeek ? 0 : e.owes;
                return (
                  <tr key={e.name}>
                    <td style={{ ...td, whiteSpace: "normal" }}>{e.name}</td>
                    <td style={{...td, color: e.count >= 3 ? "#dc2626" : "#000000", fontWeight: e.count >= 3 ? "bold" : "normal"}}>{e.count}</td>
                    <td style={{...td, color: displayOwes > 0 ? "#16a34a" : "#000000", fontWeight: displayOwes > 0 ? "bold" : "normal"}}>${displayOwes}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    );
  })}
    </div>
  </div>
)}
    </Section>
  );
}

function TransactionsView({ report, loadOfficialReport, espn, btnPri, btnSec }) {
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


  const rangeByWeek = {};
for (const r of filtered) {
  const w = r.week;
  if (!rangeByWeek[w]) {
    if (w <= 0) {
      rangeByWeek[w] = "All pre-season transactions are FREE";
    } else {
      // Just use the range that came from the server
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

// Include week 0 in the weeks list
   const weeksSorted = Array.from(new Set(filtered.map(r => r.week)))
  .sort((a, b) => {
    // Put Week 0 and negative weeks at the end
    if (a <= 0 && b > 0) return 1;
    if (b <= 0 && a > 0) return -1;
    // For normal weeks (1, 2, 3, etc.), sort highest first
    return b - a;
  });

// Sort transactions within each week by oldest first
byWeek.forEach((transactions, week) => {
  transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
});

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
                <div>
  <div style={{ fontWeight: 700 }}>{weekLabel}</div>
  <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{rangeByWeek[week] || ""}</div>
</div>
              </div>
              <span style={{ color: "#64748b" }}>{open ? "Hide ▲" : "Show ▼"}</span>
            </div>
            {open && (
              <div style={{ marginTop: 8, overflowX: "auto" }}>
                {/* Desktop table */}
                <div className="transactions-table">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={th}>Timestamp</th>
                        <th style={th}>Team</th>
                        <th style={th}>Player</th>
                        <th style={th}>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      
  {(() => {
  const combinedRows = [];
const paired = new Set(); // Track which indices we've already paired

for (let i = 0; i < rows.length; i++) {
  if (paired.has(i)) continue; // Skip if already paired
  
  const row = rows[i];
  
  if (row.action === "ADD") {
    const matchingDropIndex = rows.findIndex((r, idx) => 
      idx > i && 
      !paired.has(idx) && // Don't pair with already-paired items
      r.action === "DROP" && 
      r.team === row.team && 
      r.date === row.date
    );
    
    if (matchingDropIndex !== -1) {
      paired.add(matchingDropIndex); // Mark as paired
      combinedRows.push({
        ...row,
        isPair: true,
        dropPlayer: rows[matchingDropIndex].player,
        pairNumber: Math.floor(combinedRows.length / 2)
      });
    } else {
      combinedRows.push({...row, isPair: false});
    }
  } else {
    combinedRows.push({...row, isPair: false});
  }
}
  
  return combinedRows.map((r, index) => {
    const isShaded = index % 2 === 0;
    const backgroundColor = isShaded ? "#fffbeb" : "transparent";

    return (
      <tr key={index} style={{ backgroundColor }}>
        <td style={{...td, fontSize: "12px"}}>
          {(() => {
            const date = new Date(r.date);
            const timeString = date.toLocaleTimeString('en-US', { 
              hour12: true, 
              hour: 'numeric', 
              minute: '2-digit', 
              second: '2-digit' 
            });
            const dateString = date.toLocaleDateString('en-US', {
              month: 'numeric',
              day: 'numeric',
              year: '2-digit'
            });
            const formattedTime = timeString.replace(/\s?(AM|PM)/i, (match) => match.toLowerCase().trim());
            return `${dateString} ${formattedTime}`;
          })()}
        </td>
        <td style={{ ...td, color: "#FFC20E", fontWeight: 600 }}>{r.team}</td>
        <td style={{ ...td, fontWeight: 600 }}>
          {r.isPair ? (
            <div>
              <div style={{ color: "#16a34a" }}>+{r.player || (r.playerId ? `#${r.playerId}` : "—")}</div>
              <div style={{ color: "#dc2626" }}>-{r.dropPlayer}</div>
            </div>
          ) : (
            <span style={{ color: r.action === "ADD" ? "#16a34a" : "#dc2626" }}>
              {r.action === "ADD" ? "+" : "-"}{r.player || (r.playerId ? `#${r.playerId}` : "—")}
            </span>
          )}
        </td>
        <td style={td}>
  {r.method === "Free Agent" ? (
    r.isPaired ? (
      <span>
        <span style={{ color: "#22c55e" }}>Free</span>
        {" "}
        <span style={{ color: "#dc2626" }}>Agent</span>
      </span>
    ) : (
      <span style={{ color: r.action === "ADD" ? "#22c55e" : "#dc2626" }}>
        {r.method}
      </span>
    )
  ) : r.method === "Waivers" ? (
    <span>
      <span style={{ color: "#f97316" }}>Waivers</span>
      {r.bidAmount !== null && r.bidAmount !== undefined && (
        <span style={{ color: r.bidAmount > 0 ? "#22c55e" : "#dc2626" }}>
          {" ($" + r.bidAmount + ")"}
        </span>
      )}
    </span>
  ) : (
    <span style={{ color: "#000000" }}>
      {r.method || "—"}
    </span>
  )}
</td>
      </tr>
    );
  });
})()}
  {rows.length === 0 && (
    <tr><td style={td} colSpan={4}>&nbsp;No transactions in this week.</td></tr>
  )}
</tbody>
                  </table>
                </div>

                {/* Mobile cards */}
<div className="transactions-mobile">
  {(() => {
    const combinedRows = [];
const paired = new Set(); // Track which indices we've already paired

for (let i = 0; i < rows.length; i++) {
  if (paired.has(i)) continue; // Skip if already paired
  
  const row = rows[i];
  
  if (row.action === "ADD") {
    const matchingDropIndex = rows.findIndex((r, idx) => 
      idx > i && 
      !paired.has(idx) && // Don't pair with already-paired items
      r.action === "DROP" && 
      r.team === row.team && 
      r.date === row.date
    );
    
    if (matchingDropIndex !== -1) {
      paired.add(matchingDropIndex); // Mark as paired
      combinedRows.push({
        ...row,
        isPair: true,
        dropPlayer: rows[matchingDropIndex].player,
        pairNumber: Math.floor(combinedRows.length / 2)
      });
    } else {
      combinedRows.push({...row, isPair: false});
    }
  } else {
    combinedRows.push({...row, isPair: false});
  }
}
    
    return combinedRows.map((r, i) => {
      const isShaded = i % 2 === 0;
      const backgroundColor = isShaded ? "#fffbeb" : "transparent";
      
      return (
        <div key={i} className="card" style={{ padding: 8, marginBottom: 6, backgroundColor }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontWeight: "bold", fontSize: 14, color: "#FFC20E" }}>{r.team}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {(() => {
                const date = new Date(r.date);
                const timeString = date.toLocaleTimeString('en-US', { 
                  hour12: true, 
                  hour: 'numeric', 
                  minute: '2-digit', 
                  second: '2-digit' 
                });
                const dateString = date.toLocaleDateString('en-US', {
                  month: 'numeric',
                  day: 'numeric',
                  year: '2-digit'
                });
                const formattedTime = timeString.replace(/\s?(AM|PM)/i, (match) => match.toLowerCase().trim());
                return `${dateString} ${formattedTime}`;
              })()}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>
              {r.isPair ? (
                <div>
                  <div style={{ color: "#16a34a" }}>+{r.player || (r.playerId ? `#${r.playerId}` : "—")}</div>
                  <div style={{ color: "#dc2626" }}>-{r.dropPlayer}</div>
                </div>
              ) : (
                <span style={{ color: r.action === "ADD" ? "#16a34a" : "#dc2626" }}>
                  {r.action === "ADD" ? "+" : "-"}{r.player || (r.playerId ? `#${r.playerId}` : "—")}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12 }}>
   {r.method === "Free Agent" ? (
    r.isPaired ? (
      <span>
        <span style={{ color: "#22c55e" }}>Free</span>
        {" "}
        <span style={{ color: "#dc2626" }}>Agent</span>
      </span>
    ) : (
      <span style={{ color: r.action === "ADD" ? "#22c55e" : "#dc2626" }}>
        {r.method}
      </span>
    )
  ) : r.method === "Waivers" ? (
    <span>
      <span style={{ color: "#f97316" }}>Waivers</span>
      {r.bidAmount !== null && r.bidAmount !== undefined && (
        <span style={{ color: r.bidAmount > 0 ? "#22c55e" : "#dc2626" }}>
          {" ($" + r.bidAmount + ")"}
        </span>
      )}
    </span>
  ) : (
    <span style={{ color: "#000000" }}>
      {r.method || "—"}
    </span>
  )}</div>
          </div>
        </div>
      );
    });
  })()}
  {rows.length === 0 && (
    <div className="card" style={{ padding: 12, color: "#64748b" }}>
      No transactions in this week.
    </div>
  )}
</div>
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

  const loadDraftData = async (forceRefresh) => {
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

    // 2026-09-23: the server now caches the whole draft-with-resolved-
    // player-names response (see saveDraftCache/getDraftCache in
    // server.mjs) - a completed draft never changes, so there's no reason
    // to re-fetch and re-resolve every player's name on every page load.
    // The "Refresh" button passes forceRefresh=true to bypass that cache.
    const response = await fetch(API(`/api/draft?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}${forceRefresh ? '&refresh=1' : ''}`));
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
        <button className="btn" style={btnSec} onClick={() => loadDraftData(true)}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
    }>
      {loading && <p>Loading draft data...</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      
      {!loading && !error && draftData && teamNames.length === 0 && (
        <p style={{ color: "#64748b" }}>
          No draft picks yet — this season's draft hasn't happened. Check back after draft day!
        </p>
      )}

      {!loading && !error && draftData && teamNames.length > 0 && (
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
  // 2026-09-23: mobile team picker (item 10 of Hac's batch) - "" means
  // "BLITZZZ LEAGUE" / show every team, exactly like before this was
  // added. Picking a team name from the dropdown filters the list below
  // to just that one team. Desktop is untouched (the dropdown is hidden
  // above 767px via .rosters-team-picker in styles.css - it always shows
  // every team there, same as before).
  const [selectedTeam, setSelectedTeam] = useState("");

  const positionOrder = ["QB", "RB", "RB/WR", "WR", "TE", "FLEX", "D/ST", "K", "Bench"];

const getPositionPriority = (slot) => {
  // Handle multiple RBs and WRs by giving them same priority
  if (slot === "RB") return 1;
  if (slot === "WR") return 4;
  if (slot === "Bench") return 999; // Always last...
  if (slot === "IR") return 1000; // ...except IR, which goes below the bench (2026-09-24: this league added an IR slot this season)

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
        // If no server data and we have credentials, load from ESPN.
        // Changed 2026-08-25: this used to be 3 separate single-view
        // requests (mTeam, mRoster, mSettings). ESPN merges every view you
        // ask for into ONE team object, so asking for them all together in
        // one request - the same view combo espn_api's own League() class
        // uses, which is proven to work for older/completed seasons and
        // not just the current one - returns everything this needs in one
        // shot, and is also just fewer round trips.
        const combined = await fetchEspnJson({
          leagueId, seasonId,
          view: ["mTeam", "mRoster", "mSettings", "mMatchup", "mStandings"],
          auth: true
        });

        const teamsById = Object.fromEntries((combined?.teams || []).map(t => [t.id, teamName(t)]));
        const slotMap = slotIdToName(combined?.settings?.rosterSettings?.lineupSlotCounts || {});
        const items = (combined?.teams || []).map(t => {
          const entries = (t.roster?.entries || []).map(e => {
            const p = e.playerPoolEntry?.player;
            const fullName = p?.fullName || "Player";
            const slot = slotMap[e.lineupSlotId] || "—";
            
            const position = p?.defaultPositionId ? posIdToName(p.defaultPositionId) : "";
            // 2026-09-24: IR players get the same "(position)" suffix bench
            // players get - IR (like the bench) doesn't already say what
            // position the player is, so it needs to be added the same way.
            const displayName = (slot === "Bench" || slot === "IR")
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

  // Reset back to "show everyone" whenever the roster list itself changes
  // (new season loaded, etc.) so the dropdown never gets stuck pointed at
  // a team that's no longer in the list.
  useEffect(() => {
    setSelectedTeam("");
  }, [teams]);

  const visibleTeams = selectedTeam ? teams.filter(t => t.teamName === selectedTeam) : teams;

  return (
    <Section title="Rosters" actions={<span className="badge">Cached from Import</span>}>
      {!seasonId && <p style={{ color: "#64748b" }}>Set your ESPN Season in <b>League Settings</b>.</p>}
      {loading && <p>Loading rosters…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      {!loading && teams.length > 0 && (
        <select
          className="input rosters-team-picker"
          value={selectedTeam}
          onChange={(e) => setSelectedTeam(e.target.value)}
        >
          <option value="">BLITZZZ LEAGUE</option>
          {teams.map(team => (
            <option key={team.teamName} value={team.teamName}>{team.teamName}</option>
          ))}
        </select>
      )}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {visibleTeams.map(team => (
          <div key={team.teamName} className="card" style={{ padding: 16 }}>
            {/* 2026-09-24: team name in Chargers gold, at Hac's request. */}
            <h3 style={{ marginTop: 0, color: "#FFC20E" }}>{team.teamName}</h3>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
  {team.entries.map((e, i) => {
    const isFirstBench = e.slot === "Bench" && (i === 0 || team.entries[i-1]?.slot !== "Bench");
    // 2026-09-24: this league added an IR slot this season - IR players
    // now render underneath the bench, with their own divider/label
    // (same pattern as the bench divider right above) instead of the
    // plain hairline the bench uses, so it's clear IR is a separate group.
    const isFirstIR = e.slot === "IR" && (i === 0 || team.entries[i-1]?.slot !== "IR");
    return (
      <React.Fragment key={i}>
        {isFirstBench && (
  <li style={{ margin: "8px 0", padding: 0, listStyle: "none" }}>
    <hr style={{ border: "none", borderTop: "2px solid #9ca3af", margin: "4px 0" }} />
  </li>
)}
        {isFirstIR && (
  <li style={{ margin: "8px 0", padding: 0, listStyle: "none" }}>
    {/* 2026-09-24: "INJURED RESERVE" label text removed at Hac's request -
        the red divider line above the IR players stays as the visual cue. */}
    <hr style={{ border: "none", borderTop: "2px solid #dc2626", margin: "4px 0 2px" }} />
  </li>
)}
        <li style={{ marginBottom: 4 }}>
          {/* 2026-09-24: position label white (red for IR specifically),
              player name powder blue - Hac's request. */}
          <b style={{ color: e.slot === "IR" ? "#dc2626" : "#ffffff" }}>{e.slot}</b> — <span style={{ color: "#0080C6" }}>{e.name}</span>
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
  
  // Make sure we're using the correct password for the current league
  const adminPassword = config.adminPassword || ADMIN_ENV;
  
  const r = await fetch(API("/api/polls/delete"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin": adminPassword },
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

function PayDuesView({ data, updateBuyIns, setData, isAdmin, btnPri, btnSec }) {
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
  }, [data.buyins]);

  const patch = async (updates) => {
  const newData = { ...cur, ...updates };
  setData(d => ({ ...d, buyins: { ...(d.buyins || {}), [seasonKey]: newData } }));
  try {
    await updateBuyIns(seasonKey, newData);
  } catch (error) {
    console.error('Failed to update buy-ins:', error);
    setData(d => ({ ...d, buyins: { ...(d.buyins || {}), [seasonKey]: cur } }));
    alert('Failed to save payment info: ' + error.message);
  }
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

  const onUploadQR = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => patch({ venmoQR: r.result || "" });
    r.readAsDataURL(f);
  };

  const saveMeta = async () => {
    const venmoLink = venmo.trim();
    const zelleEmail = zelle.trim();
    await patch({ venmoLink, zelleEmail });
  };

  return (
    <Section title="💰 Pay Dues">
      <div className="card" style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <strong>Payment Methods</strong>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Choose your preferred payment method below
          </div>
        </div>

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

        {cur.venmoQR && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <a href={cur.venmoLink || "#"} target="_blank" rel="noreferrer" title="Open Venmo">
              <img src={cur.venmoQR} alt="Venmo QR" style={{ maxWidth: "200px", height: "auto" }} />
            </a>
          </div>
        )}

        {isAdmin && (
          <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 6 }}>
            <h4 style={{ marginTop: 0 }}>Admin: Setup Payment Methods</h4>
            <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 8 }}>
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
              <button className="btn" style={btnPri} onClick={saveMeta}>Save Payment Info</button>
            </div>
          </div>
        )}
      </div>
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
    
// Filter adds from the current week using server's Wed→Tue calculation.
// Week 0 (move.week === 0) is the "Preseason" bucket - adds made after
// the draft but before Week 1 officially kicks off. Those are NOT free;
// they count toward the same "2 free, then $5 each" rule, just tracked
// separately from Week 1+. So week 0 is allowed through here same as
// any other week - selecting "Preseason" in the week selector (which is
// selectedWeek.week === 0) will correctly show/count those adds.
const waiversThisWeek = espnReport.rawMoves.filter(move => {
  if (move.action !== "ADD") return false;
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
          <div style={{textAlign: "center", marginBottom: 16}}>
      <WeekSelector selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} seasonYear={seasonYear} btnPri={btnPri} btnSec={btnSec}/>
    </div>
<div>
  <h3 style={{margin: 0, marginBottom: 2}}>Weekly Adds Counter</h3>
  <div style={{fontSize: 14, color: "#64748b"}}>
  Week <span className="week-number-highlight">{(__espnWeekAnchor[seasonYear] && selectedWeek.week > 0) ? selectedWeek.week : 'Pre-season'}</span>
</div>
</div>
          <ul style={{listStyle:"none",padding:0,margin:0}}>
  {espnReport?.totalsRows ? (
    espnReport.totalsRows
      .sort((a, b) => (waiverCounts[b.name] || 0) - (waiverCounts[a.name] || 0))
      .map(row => {
        // Playoff weeks (15, 16, 17) are free
        const playoffWeeks = [15, 16, 17];
        const displayOwes = playoffWeeks.includes(selectedWeek.week) ? 0 : (waiverOwed[row.name] || 0);
        return (
          <li key={row.name} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
            <span className="weekly-adds-team" style={{whiteSpace: "nowrap", fontSize: "13px"}}>{row.name}</span>
            <span style={{fontSize:14,color:"#334155", whiteSpace: "nowrap"}}>
              <b>Adds:</b> <span style={{color: (waiverCounts[row.name] || 0) >= 3 ? "#dc2626" : "#000000"}}>{waiverCounts[row.name] || 0}</span> • <b>Owes:</b> <span style={{color: displayOwes >= 5 ? "#16a34a" : "#000000"}}>${displayOwes}</span>
            </span>
          </li>
        );
      })
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
          <div style={{marginBottom:8, textAlign:"center"}}>
  <h3 style={{marginBottom:8}}>
    Week {(__espnWeekAnchor[seasonYear] && selectedWeek.week > 0) ? selectedWeek.week : 'Pre-season'} Activity (Wed→Tue)
  </h3>
  
</div>

          <h4>Week {(__espnWeekAnchor[seasonYear] && selectedWeek.week > 0) ? selectedWeek.week : 'Pre-season'} Adds</h4>
          <ul style={{listStyle:"none",padding:0,margin:0}}>
            {waiversThisWeek.length > 0 ? waiversThisWeek
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .map((move, index) => (
  <li key={index} style={{padding:"8px 0",borderBottom:"1px solid #e2e8f0",fontSize:13}}>
  <div style={{marginBottom:"4px"}}>
  <b className="activity-team-name">{move.team}</b> added <b className="activity-player-name">{move.player}</b>
</div>
  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, color:"#64748b"}}>
  <span style={{color: move.method === "Waivers" ? "#f97316" : move.method === "Free Agent" ? "#22c55e" : "#64748b"}}>
    {move.method}
  </span>
  <span>
      {(() => {
        const date = new Date(move.date);
        const timeString = date.toLocaleTimeString('en-US', { 
          hour12: true, 
          hour: 'numeric', 
          minute: '2-digit', 
          second: '2-digit' 
        });
        const dateString = date.toLocaleDateString('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: '2-digit'
        });
        const formattedTime = timeString.replace(/\s?(AM|PM)/i, (match) => match.toLowerCase().trim());
        return `${dateString} ${formattedTime}`;
      })()}
    </span>
  </div>
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

      // 2026-08-25: reveal a week's highest scorer starting Tuesday at
      // midnight PT (one minute after Monday 11:59pm) - Monday Night
      // Football is historically the last game of the fantasy week, so
      // by Tuesday we should know who won. Anchored off ESPN's real
      // "current week" answer instead of the old hardcoded-2025-date
      // guess, which broke every year the season didn't start on the
      // exact date it assumed.
      await loadEspnWeekAnchor(espn.leagueId, espn.seasonId);
      const anchor = __espnWeekAnchor[espn.seasonId];

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
        const matchups = byPeriod[period];

        if (!anchor) return; // ESPN's real anchor isn't loaded - don't guess with a stale date

        // 2026-09-22: reveal a week's highest scorer once ESPN has moved
        // PAST it. Same fix as the weekly-challenge loader above.
        if (weekNum >= anchor.week) return;

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
  🏆 <strong style={{ 
    color: "#8B4513",
    textShadow: "0 0 8px #FFD700, 0 0 12px #FFD700, 0 0 16px #FFD700"
  }}>
    {winner.team}
  </strong>
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
   HALL OF FAME (added 2026-08-25)

   Shows read-only, past-season data: League Champion, Final Standings,
   Trophy Case (all weeks), Weekly Challenge winners (2026 season onward
   only — the site's first year, 2025, has no recorded challenge order, so
   that section is simply hidden when 2025 is selected), and Rosters.

   IMPORTANT: this has its OWN independent year picker (the "year" state
   below). It does NOT read or write the global "espn" state that every
   other page (Rosters/Dues/Transactions/League Settings/etc.) uses, and it
   never touches League Settings' "Import ESPN Teams" flow either. Picking
   a year in here can never change what any other page on the site shows —
   that was the whole point of building it this way instead of reusing the
   old "change the season in League Settings" approach.

   It reuses the existing TrophyCaseView and Rosters components as-is
   (they were already written to accept whatever league/season they're
   given as props, so no changes were needed there), and reuses the same
   determineWeeklyWinner() / determineOverachiever() / determineBullseye()
   functions the live Weekly Challenges page uses — just called for a past,
   already-completed season instead of live-gated by today's date.

   Earliest year (2026-08-25): confirmed via the historical Postgres tables
   that ESPN has returned league/team data for Blitzzz (226912) back to
   2015. Full week-by-week matchup/boxscore data (needed for Trophy Case)
   was only successfully pulled from 2019 onward during that same check —
   2015-2018 may show Champion & Final Standings fine but an empty Trophy
   Case / Rosters section if ESPN doesn't have boxscore-level data for
   those years either. Both sections already fail gracefully (they show a
   "no data" message instead of erroring) if that happens, so there's no
   real downside to offering all the way back to 2015 — worth clicking
   through an old year to see what actually shows up.
   ========================= */
const HALL_OF_FAME_FIRST_YEAR = 2015;

function HallOfFameView({ config, apiCallLeague, btnPri, btnSec }) {
  const currentCalendarYear = new Date().getFullYear();
  // The current calendar year is left OUT of the picker entirely (2026-08-25,
  // by Hac's request) - a season in progress has no Champion/Final Standings
  // to show yet, so offering it just leads to a "not posted yet" message.
  // It appears automatically once the calendar rolls over to the next year -
  // fantasy seasons wrap up by mid-to-late December, so in practice this is
  // only "wrong" for the ~2 weeks between a season finishing and Dec 31, a
  // small enough gap not to be worth an extra live ESPN check just to detect
  // "has this season actually finished." (If that gap ever bothers Hac, the
  // fix would be to check whether ESPN has posted final ranks yet - exactly
  // the same "hasFinalRanks" check the standings loader below already does -
  // before deciding whether to list the current year at all.)
  const mostRecentCompletedYear = currentCalendarYear - 1;
  const defaultYear = Math.max(HALL_OF_FAME_FIRST_YEAR, mostRecentCompletedYear);

  const [year, setYear] = useState(defaultYear);
  const [section, setSection] = useState('champion');

  const yearOptions = [];
  for (let y = mostRecentCompletedYear; y >= HALL_OF_FAME_FIRST_YEAR; y--) yearOptions.push(y);

  const leagueId = config?.espn?.leagueId || "";
  const seasonId = String(year);
  const localEspn = { leagueId, seasonId }; // shaped just like the global "espn" state, but local-only

  // ---- Champion / Final Standings ----
  const [standings, setStandings] = useState([]);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsError, setStandingsError] = useState("");
  // 2026-09-23: on a narrow phone screen this table is wider than the card
  // and has to scroll sideways to see Points For/Against - it already could
  // scroll, but nothing told the viewer that, so it just looked cut off.
  // This ref lets us nudge the table right and back once the data shows up,
  // as a little "hey, there's more over here" hint (see the useEffect
  // right below where standings gets set).
  const standingsScrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (!leagueId || !seasonId) return;
    (async () => {
      setStandingsLoading(true);
      setStandingsError("");
      setStandings([]);
      try {
        // Requesting the full view combo (see the Rosters component note
        // above) instead of just "mTeam" alone - a bare mTeam request was
        // still failing for older completed seasons even with auth: true.
        const teamJson = await fetchEspnJson({
          leagueId, seasonId,
          view: ["mTeam", "mRoster", "mSettings", "mMatchup", "mStandings"],
          auth: true,
          permanent: true
        });
        const teams = (teamJson?.teams || []).map(t => ({
          id: t.id,
          name: teamName(t),
          finalRank: t.rankCalculatedFinal || null,
          playoffSeed: t.playoffSeed || null,
          wins: t.record?.overall?.wins ?? 0,
          losses: t.record?.overall?.losses ?? 0,
          ties: t.record?.overall?.ties ?? 0,
          pointsFor: t.record?.overall?.pointsFor ?? 0,
          pointsAgainst: t.record?.overall?.pointsAgainst ?? 0,
        }));
        const hasFinalRanks = teams.some(t => t.finalRank);
        teams.sort((a, b) => hasFinalRanks
          ? (a.finalRank || 999) - (b.finalRank || 999)
          : (b.wins - a.wins) || (b.pointsFor - a.pointsFor));
        if (alive) {
          setStandings(teams);
          if (!hasFinalRanks && teams.length) {
            setStandingsError(`ESPN hasn't posted final standings for ${seasonId} yet (the season may still be in progress). Showing current record instead.`);
          }
        }
      } catch (err) {
        console.error('Hall of Fame standings load error:', err);
        if (alive) setStandingsError(`Could not load standings for ${seasonId}.`);
      }
      if (alive) setStandingsLoading(false);
    })();
    return () => { alive = false; };
  }, [leagueId, seasonId]);

  // 2026-09-23: once the Final Standings table has data, auto-peek it to
  // the right and back on mobile so it's obvious there are more columns to
  // scroll to (Points For/Against) instead of it just looking cut off.
  // Desktop never triggers this since the table isn't scrollable there in
  // the first place (window.innerWidth check below).
  useEffect(() => {
    if (!standings.length) return;
    if (typeof window === "undefined" || window.innerWidth > 767) return;
    const el = standingsScrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return; // nothing to scroll - table already fits
      el.scrollTo({ left: maxScroll, behavior: "smooth" });
      const backTimer = setTimeout(() => {
        el.scrollTo({ left: 0, behavior: "smooth" });
      }, 700);
      return () => clearTimeout(backTimer);
    }, 400);
    return () => clearTimeout(timer);
  }, [standings]);

  const champion = standings.find(t => t.finalRank === 1);

  // ---- Weekly Challenge winners (2026 season onward only, see comment above) ----
  const showChallenges = year >= 2026;
  const [challengeWinners, setChallengeWinners] = useState({});
  const [challengesLoading, setChallengesLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!showChallenges || !leagueId || !seasonId) {
      setChallengeWinners({});
      return;
    }
    (async () => {
      setChallengesLoading(true);

      // 2026-09-22: a Hall of Fame season is always fully in the past, so
      // ALL 13 weeks are permanently settled the first time anyone computes
      // them - try the server's saved cache first and skip recalculating
      // from ESPN entirely when it's already there.
      if (config?.id) {
        try {
          const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
          const cacheResp = await fetch(`${baseURL}/api/leagues/${config.id}/weekly-challenges-cache/${seasonId}`);
          if (cacheResp.ok) {
            const cached = await cacheResp.json();
            if (cached && cached.winners && cached.throughWeek >= 13) {
              if (alive) { setChallengeWinners(cached.winners); setChallengesLoading(false); }
              return;
            }
          }
        } catch (e) {
          // cache fetch failed - fall through to live computation below
        }
      }

      const winners = {};
      for (let week = 1; week <= 13; week++) {
        try {
          let winner = null;
          // permanent: true - this is Hall of Fame, always a past completed
          // season, so the server caches this ESPN data forever instead of
          // re-fetching it every time this tab is opened.
          if (week === 10) {
            winner = await determineOverachiever(week, leagueId, seasonId, ht_projectedForWeek, ht_teamProjection, true);
          } else if (week === 3) {
            winner = await determineBullseye(week, leagueId, seasonId, ht_projectedForWeek, ht_teamProjection, true);
          } else {
            winner = await determineWeeklyWinner(week, leagueId, seasonId, true);
          }
          if (winner) winners[week] = winner;
        } catch (err) {
          console.error(`Hall of Fame: failed to determine Week ${week} winner for ${seasonId}:`, err);
        }
      }
      if (alive) { setChallengeWinners(winners); setChallengesLoading(false); }

      // Save what we just computed so the next time anyone opens this
      // season's Weekly Challenges tab, it's read from the cache above
      // instead of being recalculated from scratch.
      if (config?.id && Object.keys(winners).length > 0) {
        try {
          const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
          fetch(`${baseURL}/api/leagues/${config.id}/weekly-challenges-cache/${seasonId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winners, throughWeek: 13 })
          }).catch(() => {});
        } catch (e) {
          // best-effort
        }
      }
    })();
    return () => { alive = false; };
  }, [leagueId, seasonId, showChallenges]);

  const sections = [
    { id: 'champion', label: '🏆 Champion & Standings' },
    { id: 'trophies', label: '🎖️ Trophy Case' },
    ...(showChallenges ? [{ id: 'challenges', label: '🗓️ Weekly Challenges' }] : []),
    { id: 'rosters', label: '📋 Rosters' },
  ];

  return (
    <Section
      title="🏛️ Hall of Fame"
      actions={
        <select
          className="input"
          value={year}
          onChange={(e) => { setYear(Number(e.target.value)); setSection('champion'); }}
          style={{ width: 130 }}
        >
          {yearOptions.map(y => <option key={y} value={y}>{y} Season</option>)}
        </select>
      }
    >
      {/* Internal sub-navigation, so a viewer can jump between sections easily */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
        {sections.map(s => (
          <button
            key={s.id}
            className="btn"
            style={section === s.id ? btnPri : btnSec}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'champion' && (
        <div>
          {standingsLoading && <p>Loading {seasonId} final standings…</p>}
          {standingsError && <p style={{ color: "#dc2626" }}>{standingsError}</p>}

          {champion && (
            <div className="card" style={{ padding: 24, marginBottom: 20, textAlign: "center", background: "#fff8e1", border: "2px solid #ffb612" }}>
              <div style={{ fontSize: 48 }}>🏆</div>
              <div style={{ fontSize: 12, letterSpacing: 1, color: "#92400e", fontWeight: "bold" }}>{seasonId} LEAGUE CHAMPION</div>
              <div style={{ fontSize: 28, fontWeight: "bold", marginTop: 4 }}>{champion.name}</div>
              <div style={{ marginTop: 8, color: "#334155" }}>
                {champion.wins}-{champion.losses}{champion.ties ? `-${champion.ties}` : ""} · {champion.pointsFor.toFixed(1)} PF
              </div>
            </div>
          )}
          {!standingsLoading && !champion && standings.length === 0 && !standingsError && (
            <p style={{ color: "#64748b" }}>No standings on record for {seasonId} yet.</p>
          )}

          {standings.length > 0 && (
            <>
              <h3>Final Standings</h3>
              <div className="hof-standings-scroll-hint">Points For and Points Against are off to the right - swipe to see them →</div>
              <div className="hof-standings-scroll-wrap">
                <div style={{ overflowX: "auto" }} ref={standingsScrollRef}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                      <th style={{ padding: 8 }}>Rank</th>
                      <th style={{ padding: 8 }}>Team</th>
                      <th style={{ padding: 8 }}>Record</th>
                      <th style={{ padding: 8 }}>Points For</th>
                      <th style={{ padding: 8 }}>Points Against</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((t, i) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: 8, fontWeight: t.finalRank === 1 ? "bold" : "normal" }}>{t.finalRank || (i + 1)}</td>
                        <td style={{ padding: 8 }}>{t.finalRank === 1 ? "🏆 " : ""}{t.name}</td>
                        <td style={{ padding: 8 }}>{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ""}</td>
                        <td style={{ padding: 8 }}>{t.pointsFor.toFixed(1)}</td>
                        <td style={{ padding: 8 }}>{t.pointsAgainst.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {section === 'trophies' && (
        <TrophyCaseView espn={localEspn} config={config} seasonYear={seasonId} btnPri={btnPri} btnSec={btnSec} />
      )}

      {section === 'challenges' && showChallenges && (
        <div>
          {challengesLoading && <p>Loading {seasonId} weekly challenge winners…</p>}
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            {WEEKLY_CHALLENGES.map(c => {
              const winner = challengeWinners[c.week];
              return (
                <div key={c.week} className="card" style={{ padding: 16 }}>
                  <h3 style={{ margin: 0 }}>
                    Week {c.week}
                    <span style={{ fontWeight: "bold", color: "#ffb612" }}> — {c.title}</span>
                  </h3>
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{c.text}</div>
                  {winner && (
                    <div style={{ marginTop: 12, padding: 12, background: "#f0f9ff", borderRadius: 6, border: "1px solid #0ea5e9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: "18px" }}>🏆</span>
                        <span style={{ fontWeight: "bold", color: "#0066cc" }}>{winner.teamName}</span>
                      </div>
                      {winner.details && <div style={{ marginTop: 4, fontSize: "14px", color: "#334155" }}>{winner.details}</div>}
                    </div>
                  )}
                  {!winner && !challengesLoading && <p style={{ color: "#64748b", marginTop: 8 }}>No winner on record.</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'rosters' && (
        <Rosters leagueId={leagueId} seasonId={seasonId} apiCallLeague={apiCallLeague} btnPri={btnPri} btnSec={btnSec} />
      )}
    </Section>
  );
}

// Bolds the team name(s) inside a trophy's plain-text `value` string.
// Trophy values are always stored as plain strings now (not JSX) so they
// can be saved as JSON in the server-side Trophy Case cache - this is the
// one place, at render time, where the team name gets wrapped for the
// "pop more" styling, whether the trophy came from that cache or was just
// computed live from ESPN.
function renderTrophyValue(trophy) {
  const text = trophy?.value || "";
  const names = Array.isArray(trophy?.team) ? trophy.team : (trophy?.team ? [trophy.team] : []);
  if (names.length === 0 || !text) return text;

  // Build one regex that matches any of the team name(s), longest first so
  // a name that's a substring of another doesn't get matched partially.
  const escaped = [...names].sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = text.split(re);

  return parts.map((part, i) =>
    names.includes(part)
      ? <span key={i} className="trophy-team-name">{part}</span>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

// 2026-09-23: tiny text-color helpers for the Season Leaders section below -
// "Award" wraps a trophy/award name (e.g. "Highest Scorer") in orange, and
// "Team" wraps a team name in bold white so it actually pops off the dark
// card background instead of blending in with the rest of the sentence.
function Award({ children }) {
  return <strong style={{ color: "#ffb612" }}>{children}</strong>;
}
function Team({ children }) {
  return <strong style={{ color: "#ffffff" }}>{children}</strong>;
}
// 2026-09-24: wraps a Season Leaders row's leading emoji so it can be sized
// up on desktop only via .season-leader-emoji in styles.css, while staying
// the same size it already was on mobile - Hac's request.
function Emoji({ children }) {
  return <span className="season-leader-emoji">{children}</span>;
}

function TrophyCaseView({ espn, config, seasonYear, btnPri, btnSec }) {
// === ADD: tiny helpers for projections (safe names to avoid collisions) ===

// ESPN per-player projections live in player.stats rows where:
//  - statSourceId === 1 (projected)
//  - statSplitTypeId === 1 (weekly split)
//  - scoringPeriodId === <week>

  const [naughtyLists, setNaughtyLists] = useState({}); // Store naughty lists by week
  const [allNaughtyEntries, setAllNaughtyEntries] = useState([]); // Flattened list
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [weeklyTrophies, setWeeklyTrophies] = useState([]);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [trophyCounts, setTrophyCounts] = useState({});
  const [seasonStats, setSeasonStats] = useState({});
  // 2026-09-23: which column the Trophy Leaderboard is currently sorted by.
  // 'total' (the default) means "most trophies overall"; anything else is
  // one of the trophy emojis, meaning "click a trophy, see who's won that
  // one most". Shared between the desktop table and the mobile grid below
  // so clicking either one keeps them in sync.
  const [trophySortKey, setTrophySortKey] = useState('total');
  // 2026-09-22: loadTrophies gets called more than once in quick succession
  // (once when this view first mounts, again once the real league/season
  // finishes loading a moment later) and each call is its own independent
  // trip through this whole async function. Without anything to say "this
  // one's stale, ignore it", whichever call happens to finish LAST wins and
  // overwrites the screen - even if an earlier call already had the fully
  // correct, faster (cached) answer. That race is what was randomly wiping
  // out the Naughty List: the fast cache-based call would set it correctly,
  // then a slower, in-flight older call would finish afterward and stomp it
  // back to empty. requestIdRef is a simple ticket system: every call grabs
  // the next number, and right before it's about to update the screen it
  // checks whether it's still holding the LATEST ticket. If a newer call
  // has already started, this older one just quietly stops instead of
  // overwriting the newer call's results.
  const requestIdRef = useRef(0);
  const loadTrophies = async () => {
    if (!espn.leagueId || !espn.seasonId) {
      setError("Set League ID and Season in League Settings first.");
      return;
    }

    const myRequestId = ++requestIdRef.current;
    const isStale = () => myRequestId !== requestIdRef.current;

    setLoading(true);
    setError("");

    try {
      // 2026-09-22: try the server's pre-computed Trophy Case cache first.
      // The server rebuilds this automatically in the background once a
      // week's games are all final (see refreshTrophyCaseCacheIfNeeded in
      // server.mjs) - so on a normal page load we can usually skip the
      // whole "fetch every week from ESPN and recalculate every trophy"
      // process below entirely and just use this saved copy. If nothing's
      // cached yet (brand new season, or the very first refresh hasn't run)
      // this 404s and we fall straight through to the live computation
      // exactly as before, so nothing breaks either way.
      try {
        const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
        const cacheResp = await fetch(`${baseURL}/api/leagues/${config.id}/trophy-case-cache/${espn.seasonId}`);
        if (cacheResp.ok) {
          const cached = await cacheResp.json();
          if (isStale()) return; // a newer loadTrophies call has since started - drop this result
          if (cached && Array.isArray(cached.trophiesData)) {
            // 2026-09-22: the server stores weeks in the order it computed
            // them (oldest first). The live-computation path below always
            // sorts newest-week-first before displaying (see
            // trophiesData.sort((a, b) => b.week - a.week) further down) -
            // this cache path was skipping that same sort, so the cached
            // version showed Week 1 at the top instead of the most recent
            // week. Sorting here too makes the cached and live paths match.
            const sortedTrophies = [...cached.trophiesData].sort((a, b) => b.week - a.week);
            setWeeklyTrophies(sortedTrophies);
            if (sortedTrophies.length > 0) {
              setExpandedWeeks(new Set([sortedTrophies[0].week]));
            }
            setSeasonStats(cached.seasonStats || {});
            setTrophyCounts(cached.trophyCounts || {});
            setError("");
            setLoading(false);

            // 2026-09-22: the Naughty List (inactive/benched starters) is
            // now computed server-side too (see buildNaughtyList in
            // server.mjs) and saved right alongside each cached week's
            // trophies - so it's read straight out of the same cache
            // response above instead of a separate live per-week fetch.
            // Older cached seasons without a naughtyList field yet (from
            // before this was added) just get an empty list here until
            // their cache is next rebuilt - see TROPHY_CASE_CACHE_VERSION
            // in server.mjs, which forces exactly that rebuild once.
            const newNaughtyLists = {};
            const newNaughtyEntries = [];
            for (const wk of sortedTrophies) {
              const list = wk.naughtyList || [];
              newNaughtyLists[wk.week] = list;
              if (list.length > 0) {
                newNaughtyEntries.push(...list.map(entry => ({ ...entry, week: wk.week })));
              }
            }
            setNaughtyLists(newNaughtyLists);
            setAllNaughtyEntries(newNaughtyEntries);

            return; // done - no ESPN calls needed at all
          }
        }
      } catch (cacheErr) {
        // Cache lookup failing (network hiccup, etc.) is not fatal - just
        // fall through to computing live from ESPN like before.
        console.warn('Trophy Case cache lookup failed, computing live instead:', cacheErr);
      }

      // First get team names
      // Routed through our own server (with auth=1, so it attaches your ESPN
      // login cookies) instead of hitting ESPN directly from the browser.
      // Fixed 2026-08-25: a direct, cookie-less browser request like this
      // one only worked for recent seasons - ESPN returned a 401 for older
      // completed seasons (found while testing Hall of Fame against 2023).
      // Also 2026-08-25: a bare view=mTeam was still failing (502) for 2023
      // even with cookies attached - switched to the full view combo (see
      // the Rosters component note) that's proven to work for old seasons.
      const teamsResponse = await fetch(API(`/api/espn?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}&view=mTeam&view=mRoster&view=mSettings&view=mMatchup&view=mStandings&auth=1`));

      if (!teamsResponse.ok) throw new Error(`ESPN API error: ${teamsResponse.status}`);
      const teamsData = await teamsResponse.json();
      
      const teamNames = {};
      if (teamsData.teams) {
        teamsData.teams.forEach(team => {
          teamNames[team.id] = team.location && team.nickname 
            ? `${team.location} ${team.nickname}` 
            : team.name || `Team ${team.id}`;
        });
      }

      const trophiesData = [];

      // 2026-09-22: this used to always loop weekNum 1..14 in sequence,
      // awaiting each week's fetch (plus a naughty-list fetch per completed
      // week) one at a time before starting the next - up to ~19 sequential
      // ESPN/server round trips on every single page open, most of them for
      // weeks that haven't been played yet and get thrown away as soon as
      // "allGamesComplete" comes back false. Two fixes:
      //   1) Only try weeks up through ESPN's own currentMatchupPeriod
      //      (already sitting in teamsData.status from the fetch above - no
      //      extra request needed) instead of blindly trying all the way to
      //      14. For an old, fully-completed season this is still its final
      //      week, so nothing is lost there either.
      //   2) Fetch every week's data at the same time (Promise.all) instead
      //      of one at a time - order doesn't matter since trophiesData gets
      //      sorted by week right after this loop anyway.
      // processWeek below is the exact same per-week logic that used to live
      // directly in the for-loop, just wrapped as a function so it can be
      // called once per week and run in parallel; every `continue` became a
      // `return null` (skip this week) and the final push became a return.
      const maxWeekToTry = Math.min(14, teamsData?.status?.currentMatchupPeriod || 14);

      // 2026-09-22: this loop's own weekResponse fetch above already asks
      // for view=mBoxscore alongside mMatchup/mMatchupScore/mScoreboard, so
      // its weekData.schedule already carries the same
      // rosterForCurrentScoringPeriod data the season-stats loop further
      // below used to go fetch a SECOND time (one more ESPN request per
      // completed week, for data already sitting right here). Stash each
      // week's schedule here as it comes in so that second loop can reuse it
      // instead of re-fetching - see rawScheduleByWeek.get(...) there.
      const rawScheduleByWeek = new Map();

      const processWeek = async (weekNum) => {
// Reset trackers for each week
let __overT = { team: "", delta: -Infinity, actual: 0, proj: 0 };
let __underT = { team: "", delta: Infinity,  actual: 0, proj: 0 };

        // Same server-proxy + auth=1 fix as the team-names fetch above, PLUS
        // (2026-08-25) also asking for mMatchupScore/mScoreboard alongside the
        // original mMatchup/mBoxscore. Found by reading the espn_api Python
        // library's source (the same one behind the working historical-data
        // import scripts): its box_scores() function - the proven way to get
        // this same roster/points data for a COMPLETED past season - asks
        // ESPN for view=mMatchupScore + view=mScoreboard, not mMatchup/
        // mBoxscore. Requesting all four together is a safe superset: ESPN
        // merges whatever fields each view contributes into one response, so
        // this can't remove anything the current season's view was already
        // providing, only add the data path that (per that library) is the
        // one actually meant for older, completed seasons.
        const weekResponse = await fetch(API(`/api/espn?leagueId=${espn.leagueId}&seasonId=${espn.seasonId}&view=mMatchup&view=mBoxscore&view=mMatchupScore&view=mScoreboard&scoringPeriodId=${weekNum}&auth=1`));

        if (!weekResponse.ok) return null;
        const weekData = await weekResponse.json();

        if (!weekData.schedule) return null;

        rawScheduleByWeek.set(weekNum, weekData.schedule);

        const matchups = weekData.schedule.filter(m => m.matchupPeriodId === weekNum);
        
        // Check if week is complete
        const allGamesComplete = matchups.every(m => 
          m.home?.totalPoints > 0 && 
          m.away?.totalPoints > 0 && 
          m.winner !== 'UNDECIDED'
        );
        
        if (!allGamesComplete) return null;

// Fetch naughty list for this week
try {
  const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
  const naughtyResponse = await fetch(
    `${baseURL}/api/leagues/${config.id}/weekly-awards/${espn.seasonId}?week=${weekNum}`
  );
  const naughtyData = await naughtyResponse.json();
  if (isStale()) return; // a newer loadTrophies call has since started - drop this result

  setNaughtyLists(prev => ({
    ...prev,
    [weekNum]: naughtyData.naughtyList || []
  }));
  
  // Add to flattened list if there are entries
  if (naughtyData.naughtyList && naughtyData.naughtyList.length > 0) {
    setAllNaughtyEntries(prev => [
      ...prev,
      ...naughtyData.naughtyList.map(entry => ({
        ...entry,
        week: weekNum
      }))
    ]);
  }
} catch (err) {
  console.error(`Failed to load naughty list for week ${weekNum}:`, err);
}
 
        const weekTrophies = {
          week: weekNum,
          matchups: [],
          trophies: []
        };

        // Initialize tracking
        let highScore = { team: "", score: 0 };
        let lowScore = { team: "", score: Infinity };
        let biggestBlowout = { winner: "", loser: "", margin: 0 };
        let closestWin = { winner: "", loser: "", margin: Infinity };
	let bestManager = { teams: [], percentage: -1 };  // ← Changed from { team: "", percentage: 0 }
	let worstManager = { teams: [], percentage: 100, benchPoints: 0 };  // ← Changed from { team: "", ... }
        let luckiestWin = null;
        let unluckyLoss = null;

        const teamScores = [];
        const teamOptimalScores = {};

        // Process each matchup
        matchups.forEach(matchup => {
          if (!matchup.home || !matchup.away) return;
          
          const homeScore = matchup.home.totalPoints || 0;
          const awayScore = matchup.away.totalPoints || 0;
          const homeTeam = teamNames[matchup.home.teamId];
          const awayTeam = teamNames[matchup.away.teamId];

          // Calculate optimal scores from boxscore
          const homeOptimal = calculateOptimalScore(matchup.home);
          const awayOptimal = calculateOptimalScore(matchup.away);
          
          teamOptimalScores[matchup.home.teamId] = homeOptimal;
          teamOptimalScores[matchup.away.teamId] = awayOptimal;

          teamScores.push({ 
            team: homeTeam,
            teamId: matchup.home.teamId,
            score: homeScore,
            optimal: homeOptimal,
            won: homeScore > awayScore
          });
          
          teamScores.push({ 
            team: awayTeam,
            teamId: matchup.away.teamId,
            score: awayScore,
            optimal: awayOptimal,
            won: awayScore > homeScore
          });

          // Track matchup results
          weekTrophies.matchups.push({
            home: homeTeam,
            away: awayTeam,
            homeScore: homeScore.toFixed(2),
            awayScore: awayScore.toFixed(2)
          });

// === ADD: compute projections & deltas for Over/Underachiever ===
const mb = matchup;

const homeProj = ht_teamProjection(mb.home || matchup.home, weekNum);
const awayProj = ht_teamProjection(mb.away || matchup.away, weekNum);

const homeDelta = homeScore - homeProj;
const awayDelta = awayScore - awayProj;

if (homeDelta > __overT.delta) {
  __overT = { team: homeTeam, delta: homeDelta, actual: homeScore, proj: homeProj };
}
if (awayDelta > __overT.delta) {
  __overT = { team: awayTeam, delta: awayDelta, actual: awayScore, proj: awayProj };
}

if (homeDelta < __underT.delta) {
  __underT = { team: homeTeam, delta: homeDelta, actual: homeScore, proj: homeProj };
}
if (awayDelta < __underT.delta) {
  __underT = { team: awayTeam, delta: awayDelta, actual: awayScore, proj: awayProj };
}


          // High/Low scores
          [
            { team: homeTeam, score: homeScore },
            { team: awayTeam, score: awayScore }
          ].forEach(({ team, score }) => {
            if (score > highScore.score) highScore = { team, score };
            if (score < lowScore.score && score > 0) lowScore = { team, score };
          });

          // Blowout and close win
          const margin = Math.abs(homeScore - awayScore);
          if (margin > 0) {
            const winner = homeScore > awayScore ? homeTeam : awayTeam;
            const loser = homeScore > awayScore ? awayTeam : homeTeam;
            
            if (margin > biggestBlowout.margin) {
              biggestBlowout = { winner, loser, margin };
            }
            if (margin < closestWin.margin) {
              closestWin = { winner, loser, margin };
            }
          }

          // Best/Worst Manager calculations
[
  { team: homeTeam, actual: homeScore, optimal: homeOptimal },
  { team: awayTeam, actual: awayScore, optimal: awayOptimal }
].forEach(({ team, actual, optimal }) => {
  if (optimal > 0) {
    const percentage = (actual / optimal) * 100;
    const benchPoints = optimal - actual;
    
    // Best Manager - handle ties with tolerance for floating point errors
    const TOLERANCE = 0.01; // Within 0.01% is considered a tie
    
    if (bestManager.teams.length === 0 || percentage > bestManager.percentage + TOLERANCE) {
      // New leader
      bestManager = { teams: [team], percentage };
    } else if (Math.abs(percentage - bestManager.percentage) <= TOLERANCE) {
      // Tied (within tolerance)
      bestManager.teams.push(team);
    }
    
    // Worst Manager - handle ties with tolerance
    if ((percentage < worstManager.percentage - TOLERANCE && benchPoints > 0) || worstManager.percentage === 100) {
      worstManager = { teams: [team], percentage, benchPoints };
    } else if (Math.abs(percentage - worstManager.percentage) <= TOLERANCE && worstManager.percentage < 100 && benchPoints > 0) {
      worstManager.teams.push(team);
    }
  }
});
        });

        // Lucky/Unlucky calculation with edge cases
const sortedByScore = [...teamScores].sort((a, b) => b.score - a.score);

// Find all winners and losers with their records
const winners = sortedByScore.filter(t => t.won).map(t => ({
  ...t,
  wouldBeat: sortedByScore.length - 1 - sortedByScore.indexOf(t),
  wouldLose: sortedByScore.indexOf(t)
}));

const losers = sortedByScore.filter(t => !t.won).map(t => ({
  ...t,
  wouldBeat: sortedByScore.length - 1 - sortedByScore.indexOf(t),
  wouldLose: sortedByScore.indexOf(t)
}));

// Lucky logic
const luckyWinners = winners.filter(w => w.wouldLose > w.wouldBeat);
if (luckyWinners.length > 0) {
  // Normal lucky winner exists
  const luckiest = luckyWinners.sort((a, b) => b.wouldLose - a.wouldLose)[0];
  luckiestWin = { 
    team: luckiest.team, 
    wouldBeat: luckiest.wouldBeat, 
    wouldLose: luckiest.wouldLose 
  };
} else if (winners.length > 0) {
  // All winners have winning records - find worst winner
  const worstWinner = winners.sort((a, b) => {
    if (a.wouldBeat !== b.wouldBeat) return a.wouldBeat - b.wouldBeat;
    return a.score - b.score; // Tiebreaker: lower score
  })[0];
  luckiestWin = { 
    team: worstWinner.team, 
    wouldBeat: worstWinner.wouldBeat, 
    wouldLose: worstWinner.wouldLose,
    score: worstWinner.score,
    allWinning: true
  };
}

// Unlucky logic
const unluckyLosers = losers.filter(l => l.wouldBeat > l.wouldLose);
if (unluckyLosers.length > 0) {
  // Normal unlucky loser exists
  const unluckiest = unluckyLosers.sort((a, b) => b.wouldBeat - a.wouldBeat)[0];
  unluckyLoss = { 
    team: unluckiest.team, 
    wouldBeat: unluckiest.wouldBeat, 
    wouldLose: unluckiest.wouldLose 
  };
} else if (losers.length > 0) {
  // All losers have losing records - find best loser
  const bestLoser = losers.sort((a, b) => {
    if (b.wouldBeat !== a.wouldBeat) return b.wouldBeat - a.wouldBeat;
    return b.score - a.score; // Tiebreaker: higher score
  })[0];
  unluckyLoss = { 
    team: bestLoser.team, 
    wouldBeat: bestLoser.wouldBeat, 
    wouldLose: bestLoser.wouldLose,
    score: bestLoser.score,
    allLosing: true
  };
}

        // Build trophies. IMPORTANT (2026-09-22): values are stored as plain
        // strings, not JSX, on purpose - this same data now also gets saved
        // as JSON in the server-side Trophy Case cache (see
        // renderTrophyValue below for how team names still get bolded when
        // this is displayed, whether it just came from ESPN live or from
        // that cache).
        if (highScore.team) {
          weekTrophies.trophies.push({
            emoji: "👑",
            title: "High score",
            team: highScore.team,
            value: `${highScore.team} with ${highScore.score.toFixed(2)} points`
          });
        }

        if (lowScore.score < Infinity) {
          weekTrophies.trophies.push({
            emoji: "💩",
            title: "Low score",
            team: lowScore.team,
            value: `${lowScore.team} with ${lowScore.score.toFixed(2)} points`
          });
        }

        if (biggestBlowout.margin > 0) {
          weekTrophies.trophies.push({
            emoji: "😱",
            title: "Blow out",
            team: biggestBlowout.winner,
            value: `${biggestBlowout.winner} blew out ${biggestBlowout.loser} by ${biggestBlowout.margin.toFixed(2)} points`
          });
        }

        if (closestWin.margin < Infinity) {
          weekTrophies.trophies.push({
            emoji: "😅",
            title: "Close win",
            team: closestWin.winner,
            value: `${closestWin.winner} barely beat ${closestWin.loser} by ${closestWin.margin.toFixed(2)} points`
          });
        }

        if (luckiestWin) {
  const value = luckiestWin.allWinning
    ? `All winning teams had a winning record vs the league, but ${luckiestWin.team} had the worst record (${luckiestWin.wouldBeat}-${luckiestWin.wouldLose}) and scored only ${luckiestWin.score.toFixed(2)} points`
    : `${luckiestWin.team} was ${luckiestWin.wouldBeat}-${luckiestWin.wouldLose} against the league, but still got the win`;

  weekTrophies.trophies.push({
    emoji: "🍀",
    title: "Lucky",
    team: luckiestWin.team,
    value
  });
}

if (unluckyLoss) {
  const value = unluckyLoss.allLosing
    ? `All losing teams had a losing record vs the league, but ${unluckyLoss.team} had the best record (${unluckyLoss.wouldBeat}-${unluckyLoss.wouldLose}) and scored ${unluckyLoss.score.toFixed(2)} points`
    : `${unluckyLoss.team} was ${unluckyLoss.wouldBeat}-${unluckyLoss.wouldLose} against the league, but still took an L`;

  weekTrophies.trophies.push({
    emoji: "😡",
    title: "Unlucky",
    team: unluckyLoss.team,
    value
  });
}

// === ADD: Overachiever / Underachiever trophy rows ===
if (__overT.team) {
  weekTrophies.trophies.push({
    emoji: "📈",
    title: "Overachiever",
    team: __overT.team,
    value: `${__overT.team} was ${__overT.delta.toFixed(2)} points over their projection (${__overT.actual.toFixed(2)} vs ${__overT.proj.toFixed(2)})`
  });
}
if (__underT.team) {
  weekTrophies.trophies.push({
    emoji: "📉",
    title: "Underachiever",
    team: __underT.team,
    value: `${__underT.team} was ${Math.abs(__underT.delta).toFixed(2)} points under their projection (${__underT.actual.toFixed(2)} vs ${__underT.proj.toFixed(2)})`
  });
}


        if (bestManager.percentage > 0 && bestManager.teams.length > 0) {
  const teamList = bestManager.teams.length === 1
    ? bestManager.teams[0]
    : bestManager.teams.slice(0, -1).join(', ') + ' and ' + bestManager.teams[bestManager.teams.length - 1];

  weekTrophies.trophies.push({
    emoji: "🤖",
    title: "Best Manager",
    team: bestManager.teams,
    value: `${teamList} scored ${bestManager.percentage.toFixed(1)}% of their optimal score!`
  });
}

if (worstManager.benchPoints > 0 && worstManager.teams.length > 0) {
  const teamList = worstManager.teams.length === 1
    ? worstManager.teams[0]
    : worstManager.teams.slice(0, -1).join(', ') + ' and ' + worstManager.teams[worstManager.teams.length - 1];

  weekTrophies.trophies.push({
    emoji: "🤡",
    title: "Worst Manager",
    team: worstManager.teams,
    value: `${teamList} left ${worstManager.benchPoints.toFixed(2)} points on their bench. Only scoring ${worstManager.percentage.toFixed(1)}% of their optimal score.`
  });
}

        // ADD THIS DEBUG LINE RIGHT HERE ↓↓↓
        console.log('[WEEK', weekNum, 'BEST MANAGER FINAL]', bestManager);
        console.log('[WEEK', weekNum, 'WORST MANAGER FINAL]', worstManager);

        return weekTrophies;
      };

      const weeksToTry = [];
      for (let w = 1; w <= maxWeekToTry; w++) weeksToTry.push(w);
      const weekResults = await Promise.all(weeksToTry.map(processWeek));
      if (isStale()) return; // a newer loadTrophies call has since started - drop this result
      for (const wt of weekResults) {
        if (wt) trophiesData.push(wt);
      }

      // Sort newest first and auto-expand most recent
      trophiesData.sort((a, b) => b.week - a.week);
      if (trophiesData.length > 0) {
        setExpandedWeeks(new Set([trophiesData[0].week]));
      }

      setWeeklyTrophies(trophiesData);
      setError("");

// Calculate trophy counts and season leaders
const trophyCounts = {};
const seasonStats = {
  totalPoints: {},
  blowoutMargins: {},
  closeWinMargins: {},
  luckyUnluckyRecords: {},
  managerStats: {},
  overTotals: {},
  underTotals: {},
  overCounts: {},      // <-- ADD
  underCounts: {}
};

// Build team list (from the names map you already created earlier in loadTrophies)
Object.values(teamNames).forEach(team => {
  trophyCounts[team] = {
    "👑": 0, "💩": 0, "😱": 0, "😅": 0,
    "🍀": 0, "😡": 0, "📈": 0, "📉": 0,
    "🤖": 0, "🤡": 0
  };
  seasonStats.totalPoints[team] = 0;
  seasonStats.blowoutMargins[team] = [];
  seasonStats.closeWinMargins[team] = [];
  seasonStats.luckyUnluckyRecords[team] = { wins: 0, losses: 0, vsW: 0, vsL: 0 };
  seasonStats.managerStats[team] = { benchPoints: 0, percentages: [] };
  seasonStats.overTotals[team] = 0;
  seasonStats.underTotals[team] = 0;
  seasonStats.overCounts[team] = 0;   // <-- ADD
  seasonStats.underCounts[team] = 0; 
});

// Walk every week we just computed
for (const week of trophiesData) {
  // 1) Count trophies you award in week.trophies (if you already do this elsewhere, keep it)
  for (const t of (week.trophies || [])) {
    // bump per-team trophy counts using the plain-text team name(s) stored
    // alongside the JSX value (the JSX itself can't be read back as a string)
    const names = Array.isArray(t.team) ? t.team : (t.team ? [t.team] : []);
    for (const name of names) {
      if (name && trophyCounts[name] && t.emoji) {
        if (t.emoji in trophyCounts[name]) trophyCounts[name][t.emoji] += 1;
      }
    }
  }

  // 2) Per-matchup: add season totals for points & winning margins (you already had this logic)
  for (const mu of (week.matchups || [])) {
    const home = mu.home, away = mu.away;
    const hs = parseFloat(mu.homeScore || 0);
    const as = parseFloat(mu.awayScore || 0);

    // season total team points
    seasonStats.totalPoints[home] += hs;
    seasonStats.totalPoints[away] += as;

    // winner’s margin into both “blowout” and “close win” lists; we’ll average later
    const margin = Math.abs(hs - as);
    if (hs > as) {
      seasonStats.blowoutMargins[home].push(margin);
      seasonStats.closeWinMargins[home].push(margin);
    } else if (as > hs) {
      seasonStats.blowoutMargins[away].push(margin);
      seasonStats.closeWinMargins[away].push(margin);
    }
  }

  // 3) === ADD HERE: All-play (Lucky/Unlucky) for THIS week ===
  // Build a plain score list for the week
  const weekScores = [];
  for (const mu of (week.matchups || [])) {
    const hs = parseFloat(mu.homeScore || 0);
    const as = parseFloat(mu.awayScore || 0);
    weekScores.push({ team: mu.home, points: hs, won: hs > as });
    weekScores.push({ team: mu.away, points: as, won: as > hs });
  }
  const teamsThisWeek = weekScores.length;
  for (const t of weekScores) {
    const wouldBeat = weekScores.reduce((acc, o) => acc + (t.points > o.points ? 1 : 0), 0);
    const wouldLose = (teamsThisWeek - 1) - wouldBeat;
    const rec = seasonStats.luckyUnluckyRecords[t.team];
    rec.vsW += wouldBeat;
    rec.vsL += wouldLose;
    if (t.won) rec.wins += 1; else rec.losses += 1;
  }

  // 4) === ADD HERE: Over/Under totals + Manager stats for THIS week ===
  // Pull ESPN boxscore for this week to read projections & optimal lineup.
  // 2026-09-22: reuse the schedule the week-processing loop above already
  // fetched (it asked for view=mBoxscore too) instead of re-fetching the
  // same data from ESPN a second time. Falls back to a fresh fetch only if
  // that cache is somehow missing this week, so this can't break anything
  // that worked before - it just skips a redundant request when it can.
  try {
    const cachedSchedule = rawScheduleByWeek.get(week.week);
    const boxResp = cachedSchedule
      ? { schedule: cachedSchedule }
      : await fetchEspnJson({
          leagueId: espn.leagueId,
          seasonId: espn.seasonId,
          view: "mBoxscore",
          scoringPeriodId: week.week
        });

  // ADD DEBUG CODE HERE FOR FIRST WEEK ONLY
  if (week.week === 1) {
    console.log('=== PROJECTION DEBUG FOR WEEK 1 ===');
    const firstTeam = boxResp.schedule?.[0]?.home;
    if (firstTeam?.rosterForCurrentScoringPeriod?.entries?.[0]) {
      const firstPlayer = firstTeam.rosterForCurrentScoringPeriod.entries[0];
      const player = firstPlayer?.playerPoolEntry?.player;
      console.log('Player name:', player?.fullName);
      console.log('Full stats array:', JSON.stringify(player?.stats, null, 2));
    }
    console.log('=== END DEBUG ===');
  }

    const rows = Array.isArray(boxResp?.schedule) ? boxResp.schedule : [];
    for (const r of rows) {
      if (r?.matchupPeriodId !== week.week) continue;

      // process both sides
      for (const side of ["home", "away"]) {
        const s = r[side];
        if (!s) continue;
        const teamName = teamNames[s.teamId] || `Team ${s.teamId}`;
        const actual = Number(s.totalPoints || 0);

        // Over / Under: sum only the positive side each week
        const proj = ht_teamProjection(s, week.week);
        const delta = actual - proj;
if (delta > 0) { 
  seasonStats.overTotals[teamName] += delta;
  seasonStats.overCounts[teamName] += 1;     // <-- ADD
}
if (delta < 0) { 
  seasonStats.underTotals[teamName] += (-delta);
  seasonStats.underCounts[teamName] += 1;    // <-- ADD
}


        // Manager stats: add bench points and % of optimal
        const optimal = calculateOptimalScore(s); // your existing helper in this file
        const bench = Math.max(0, optimal - actual);
        seasonStats.managerStats[teamName].benchPoints += bench;
        if (optimal > 0) {
          seasonStats.managerStats[teamName].percentages.push((actual / optimal) * 100);
        }
      }
    }
  } catch (_) {
    // If boxscore isn’t available for this week, skip manager/over/under for this week.
  }
}

// At this point seasonStats is fully populated; keep your rendering as-is
setSeasonStats(seasonStats);
setTrophyCounts(trophyCounts);

// 2026-09-22: we just fell through to a full live ESPN computation because
// nothing was cached yet for this league+season (common for a Hall of Fame
// season, since past years never had a chance to be cached until now).
// Fire off a background "build the cache" request so the NEXT time this
// season's Trophy Case is opened, it's instant instead of doing this same
// slow live computation all over again. This is safe to call any time -
// it's a no-op if a cache already exists and is current, and for the live
// current season it just does the same thing the scheduled background job
// already does periodically anyway. Deliberately not awaited: the page
// already has what it needs and shouldn't wait on this.
try {
  const bgBaseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
  fetch(`${bgBaseURL}/api/leagues/${config.id}/trophy-case-cache/${espn.seasonId}/rebuild`).catch(() => {});
} catch (_) { /* best-effort only */ }
    } catch (err) {
      console.error('Failed to load trophies:', err);
      setError("Failed to load trophy data: " + err.message);
    }
    
    setLoading(false);
  };

  // Calculate optimal lineup helper
  const calculateOptimalScore = (teamData) => {
  if (!teamData?.rosterForCurrentScoringPeriod?.entries) return teamData.totalPoints || 0;
  
  const entries = teamData.rosterForCurrentScoringPeriod.entries;
  const playersByPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  
  entries.forEach(entry => {
    const pos = entry.playerPoolEntry?.player?.defaultPositionId;
    const score = entry.playerPoolEntry?.appliedStatTotal || 0;
    const playerId = entry.playerPoolEntry?.player?.id || Math.random();
    const playerName = entry.playerPoolEntry?.player?.fullName || 'Unknown';
    
    let position;
    switch(pos) {
      case 1: position = 'QB'; break;
      case 2: position = 'RB'; break;
      case 3: position = 'WR'; break;
      case 4: position = 'TE'; break;
      case 6: position = 'TE'; break;
      case 5: position = 'K'; break;
      case 16: position = 'DEF'; break;
      default: return;
    }
    
    playersByPosition[position].push({ score, playerId, playerName });
  });
  
  Object.keys(playersByPosition).forEach(pos => {
    playersByPosition[pos].sort((a, b) => b.score - a.score);
  });
  
  let optimal = 0;
  const usedPlayerIds = new Set();
  const selections = [];
  
  const takeNext = (list, slotName) => {
    for (const player of list) {
      if (!usedPlayerIds.has(player.playerId)) {
        usedPlayerIds.add(player.playerId);
        selections.push(`${slotName}: ${player.playerName} (${player.score.toFixed(1)})`);
        return player.score;
      }
    }
    selections.push(`${slotName}: EMPTY (0)`);
    return 0;
  };
  
  optimal += takeNext(playersByPosition.QB, 'QB');
  optimal += takeNext(playersByPosition.K, 'K');
  optimal += takeNext(playersByPosition.DEF, 'DEF');
  optimal += takeNext(playersByPosition.TE, 'TE');
  optimal += takeNext(playersByPosition.RB, 'RB1');
  optimal += takeNext(playersByPosition.RB, 'RB2');
  optimal += takeNext(playersByPosition.WR, 'WR1');
  optimal += takeNext(playersByPosition.WR, 'WR2');
  
  const rbWrCombined = [
    ...playersByPosition.RB,
    ...playersByPosition.WR
  ].sort((a, b) => b.score - a.score);
  optimal += takeNext(rbWrCombined, 'RB/WR');
  
  const flexCombined = [
    ...playersByPosition.RB,
    ...playersByPosition.WR,
    ...playersByPosition.TE
  ].sort((a, b) => b.score - a.score);
  optimal += takeNext(flexCombined, 'FLEX');
  
  console.log('Optimal lineup for team', teamData.teamId, ':', selections);
  console.log('Optimal calculation:', {
    teamId: teamData.teamId,
    actual: teamData.totalPoints,
    optimal: optimal,
    percentage: ((teamData.totalPoints / optimal) * 100).toFixed(1) + '%',
    usedPlayers: usedPlayerIds.size
  });
  
  return optimal;
};

  useEffect(() => {
    if (espn.seasonId && espn.leagueId) {
      loadTrophies();
    }
  }, [espn.seasonId, espn.leagueId]);

  const toggleWeek = (week) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(week)) {
      newExpanded.delete(week);
    } else {
      newExpanded.add(week);
    }
    setExpandedWeeks(newExpanded);
  };

  return (
    <div id="trophy-case-root" data-loaded={loading ? "false" : "true"}>
    {/* 2026-09-24: Refresh button removed at Hac's request - this always
        reads the server's pre-computed cache first (see loadTrophies above)
        and that cache rebuilds itself automatically in the background, so
        clicking Refresh just re-fetched the exact same cached data every
        time. Nothing was actually being refreshed. */}
    <Section title="🏆 Trophy Case">
      {error && <div style={{ color: "#dc2626", marginBottom: 16 }}>{error}</div>}
      
      {weeklyTrophies.length === 0 && !loading && !error && (
        <div style={{ color: "#64748b" }}>No completed weeks yet.</div>
      )}

      {weeklyTrophies.map(weekData => (
        <React.Fragment key={weekData.week}>
        <div id={`trophy-week-card-${weekData.week}`} className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div 
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => toggleWeek(weekData.week)}
          >
            <h3 style={{ margin: 0 }}>Week {weekData.week} Trophies</h3>
            <button className="btn" style={btnSec}>
              {expandedWeeks.has(weekData.week) ? "Hide ▲" : "Show ▼"}
            </button>
          </div>

          {expandedWeeks.has(weekData.week) && (
            <div style={{ marginTop: 16 }}>
              {/* Final Scores (aligned names/scores, mobile-safe) */}
<div className="final-scores-card" style={{ marginBottom: 16, padding: 12, background: "#f8fafc", borderRadius: 6 }}>
  <h4 style={{ marginTop: 0, marginBottom: 12, textAlign: "center" }}>Final Scores</h4>

  <style>{`
    .ht-fs-grid {
      display: grid;
      /* [away name] [away score] [vs] [home score] [home name] */
      grid-template-columns: minmax(0,1fr) auto auto auto minmax(0,1fr);
      column-gap: 0;     /* no gap; we control spacing with padding so scores sit tight to "vs" */
      row-gap: 6px;
      align-items: center;
      width: 100%;
    }
    .ht-fs-team {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ht-fs-team.left  { text-align: right;  padding-right: 1ch; } /* name␠score */
    .ht-fs-team.right { text-align: left;   padding-left:  1ch; } /* score␠name */
    .ht-fs-score.away { text-align: left;  }
    .ht-fs-score.home { text-align: right; }
    .ht-fs-vs { text-align: center; padding: 0 6px; opacity: 0.6; } /* equal buffer to both scores */

    @media (max-width: 480px) {
      .ht-fs-team, .ht-fs-score { font-size: 12px; }
      .ht-fs-vs { padding: 0 4px; }
    }
  `}</style>

  <div style={{ display: "grid", rowGap: 6 }}>
    {weekData.matchups.map((m, i) => {
  const homeWon = parseFloat(m.homeScore) > parseFloat(m.awayScore);
  const awayWon = !homeWon;

  // Colors
  const NAME_WIN  = "#111827"; // black
  const NAME_LOSE = "#6b7280"; // gray
  const SCORE_WIN = "#059669"; // green
  const SCORE_LOSE= "#6b7280"; // gray

  // Names: winner = bold black, loser = normal gray
  const homeNameStyle = { fontWeight: homeWon ? "bold" : "normal", color: homeWon ? NAME_WIN : NAME_LOSE };
  const awayNameStyle = { fontWeight: awayWon ? "bold" : "normal", color: awayWon ? NAME_WIN : NAME_LOSE };

  // Scores: winner = green, loser = gray
  const homeScoreStyle = { fontWeight: homeWon ? "bold" : "normal", color: homeWon ? SCORE_WIN : SCORE_LOSE };
  const awayScoreStyle = { fontWeight: awayWon ? "bold" : "normal", color: awayWon ? SCORE_WIN : SCORE_LOSE };

  return (
    <div key={i} className="ht-fs-grid">
      <div className="ht-fs-team left"  style={awayNameStyle}  title={m.away}>{m.away}</div>
      <div className="ht-fs-score away" style={awayScoreStyle}>{m.awayScore}</div>
      <div className="ht-fs-vs">vs</div>
      <div className="ht-fs-score home" style={homeScoreStyle}>{m.homeScore}</div>
      <div className="ht-fs-team right" style={homeNameStyle}  title={m.home}>{m.home}</div>
    </div>
  );
})}

  </div>
</div>



              <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 8 }}>
                {weekData.trophies.map((trophy, i) => (
                  <div key={i} style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 12,
                    padding: 12,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6
                  }}>
                    <span style={{ fontSize: 24 }}>{trophy.emoji}</span>
                    <div>
      <div className="trophy-title" style={{ fontWeight: 600, marginBottom: 2 }}>{trophy.title}</div>
                      <div className="trophy-value" style={{ fontSize: 14, color: "#64748b" }}>{renderTrophyValue(trophy)}</div>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          )}
        </div>

        {/* 2026-09-22: with 13 weeks of trophies possibly collapsed below,
            jump straight to the season-long leaderboard instead of scrolling
            past all of them. Given its own card (rather than living inside
            the week's card) so it's easier to spot. Only shown once the
            leaderboard actually has data to jump to, and only under
            whichever week is currently expanded. Works the same way on the
            live current-season Trophy Case and every Hall of Fame season's
            Trophy Case, since both reuse this same component and both
            render the leaderboard section below with
            id="trophy-leaderboard". */}
        {expandedWeeks.has(weekData.week) && Object.keys(trophyCounts).length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 16 }}>
            <button
              className="btn"
              style={{ ...btnSec, width: "100%" }}
              onClick={() => document.getElementById('trophy-leaderboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              🏆 See Trophy Leaderboard ▼
            </button>
          </div>
        )}
        </React.Fragment>
      ))}
{/* Trophy Count Table */}
{Object.keys(trophyCounts).length > 0 && (() => {
  const TROPHY_EMOJIS = ["👑", "💩", "😱", "😅", "🍀", "😡", "📈", "📉", "🤖", "🤡"];
  const totalFor = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0);
  // 2026-09-23: sortable Trophy Leaderboard - click "Team" to go back to
  // "most trophies overall", or click any trophy emoji to see who's won
  // THAT specific trophy the most, most to least. trophySortKey (state,
  // declared near the top of this component) remembers which column is
  // active so the desktop table and mobile grid below always agree.
  const sortedEntries = Object.entries(trophyCounts).sort(([teamA, countsA], [teamB, countsB]) => {
    const valA = trophySortKey === 'total' ? totalFor(countsA) : (countsA[trophySortKey] || 0);
    const valB = trophySortKey === 'total' ? totalFor(countsB) : (countsB[trophySortKey] || 0);
    if (valB !== valA) return valB - valA; // most first
    return totalFor(countsB) - totalFor(countsA); // tie-break on overall total
  });
  const headerStyle = (key) => ({
    cursor: 'pointer',
    userSelect: 'none',
    ...(trophySortKey === key ? { color: '#ffb612', textDecoration: 'underline' } : {})
  });

  return (
  <div id="trophy-leaderboard" className="card" style={{ padding: 16, marginTop: 16 }}>
    <h3 style={{ marginBottom: 4 }}>🏆 Trophy Leaderboard</h3>
    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Click a trophy to sort by who's won it the most</div>
    <div style={{ overflowX: 'auto' }}>
      {/* Desktop Table */}
      <table className="trophy-table-desktop">
        <thead>
          <tr>
            <th style={headerStyle('total')} onClick={() => setTrophySortKey('total')} title="Sort by most trophies overall">Team</th>
            {TROPHY_EMOJIS.map(emoji => (
              <th key={emoji} className="trophy-header-emoji-desktop" style={headerStyle(emoji)} onClick={() => setTrophySortKey(emoji)} title="Sort by this trophy">{emoji}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map(([team, counts]) => (
            <tr key={team}>
              <td>{team}</td>
              {TROPHY_EMOJIS.map(emoji => (
                <td key={emoji} style={trophySortKey === emoji ? { fontWeight: 'bold', color: '#ffb612' } : undefined}>{counts[emoji] || 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile Grid */}
<div className="trophy-grid-mobile">
  {/* Header row - emojis only, also clickable */}
  <div className="trophy-header">
    {TROPHY_EMOJIS.map(emoji => (
      <div key={emoji} style={headerStyle(emoji)} onClick={() => setTrophySortKey(emoji)}>{emoji}</div>
    ))}
  </div>

  {/* Data rows with background team names */}
  {sortedEntries.map(([team, counts]) => (
    <div key={team} className="trophy-row">
      <div className="trophy-row-bg">{team}</div>
      {TROPHY_EMOJIS.map(emoji => (
        <div key={emoji} className="trophy-cell" style={trophySortKey === emoji ? { fontWeight: 'bold', color: '#ffb612' } : undefined}>{counts[emoji] || 0}</div>
      ))}
    </div>
  ))}
</div>
    </div>
    {trophySortKey !== 'total' && (
      <button className="btn" style={{ ...btnSec, marginTop: 12 }} onClick={() => setTrophySortKey('total')}>Reset sort (most trophies overall)</button>
    )}
  </div>
  );
})()}
{/* Season Leaders */}
{Object.keys(seasonStats?.totalPoints ?? {}).length > 0 && (
  <div className="card" style={{ padding: 16, marginTop: 16 }}>
    <h3 style={{ marginBottom: 16 }}>📊 Season Leaders</h3>

{(() => {
  // ---------- helpers ----------
  const teams = Object.keys(trophyCounts || {});
  if (!teams.length) return null;

  const totalPts = seasonStats.totalPoints || {};
  const blow = seasonStats.blowoutMargins || {};
  const close = seasonStats.closeWinMargins || {};
  const luck = seasonStats.luckyUnluckyRecords || {};
  const mgr  = seasonStats.managerStats || {};
  const overTotals = seasonStats.overTotals || {};
  const underTotals = seasonStats.underTotals || {};

  const avg = (arr) => (Array.isArray(arr) && arr.length ? arr.reduce((s,x)=>s+x,0)/arr.length : 0);

  // For Over/Under averages “per game when over/under” we prefer explicit counters if you added them
  // (seasonStats.overCounts / seasonStats.underCounts). If not present, we FALL BACK to the number of
  // 📈 / 📉 trophies as a proxy count so the section still renders.
  const overCounts = seasonStats.overCounts || {};
  const underCounts = seasonStats.underCounts || {};

  const getCount = (team, emoji) => (trophyCounts?.[team]?.[emoji] ?? 0);

  // Pick leader by trophy count, then break ties with a comparator.
  // `better` should return true if a beats b under the tiebreak rule.
  const pickLeader = (emoji, better) => {
    // 1) find max count for this emoji
    let maxCount = -Infinity;
    for (const t of teams) maxCount = Math.max(maxCount, getCount(t, emoji));
    const contenders = teams.filter(t => getCount(t, emoji) === maxCount);
    if (!contenders.length) return null;
    if (contenders.length === 1) return contenders[0];

    // 2) tie-break among contenders
    let best = contenders[0];
    for (let i = 1; i < contenders.length; i++) {
      const t = contenders[i];
      if (better(t, best)) best = t;
    }
    return best;
  };

  // ---------- compute each leader using counts + tie-breakers ----------
  // 👑 High score: tie-break = MOST total season points
  const highLeader = pickLeader("👑", (a,b) => (totalPts[a]||0) > (totalPts[b]||0));

  // 💩 Low score: tie-break = LEAST total season points
  const lowLeader  = pickLeader("💩", (a,b) => (totalPts[a]||0) < (totalPts[b]||0));

  // 😱 Blow out: tie-break = HIGHEST average winning margin (wins only)
  const blowLeader = pickLeader("😱", (a,b) => avg(blow[a]||[]) > avg(blow[b]||[]));

  // 😅 Close win: tie-break = SMALLEST average winning margin (wins only)
  const closeLeader = pickLeader("😅", (a,b) => {
    const avga = avg(close[a]||[]);
    const avgb = avg(close[b]||[]);
    // smaller wins; if one has 0 wins and the other >0, treat the one with wins as better
    if (avga === 0 && avgb > 0) return false;
    if (avgb === 0 && avga > 0) return true;
    return avga < avgb;
  });

  // 🍀 Lucky: tie-break = WORST all-play record (lowest vsW - vsL; if tie, lowest vsW%)
  const luckyLeader = pickLeader("🍀", (a,b) => {
    const A = luck[a]||{vsW:0,vsL:0}; const B = luck[b]||{vsW:0,vsL:0};
    const diffA = (A.vsW - A.vsL), diffB = (B.vsW - B.vsL);
    if (diffA !== diffB) return diffA < diffB; // more "unlucky" = worse all-play record
    // tie: lower win%
    const wa = A.vsW + A.vsL ? A.vsW / (A.vsW + A.vsL) : 0;
    const wb = B.vsW + B.vsL ? B.vsW / (B.vsW + B.vsL) : 0;
    return wa < wb;
  });

  // 😡 Unlucky: tie-break = BEST all-play record (highest vsW - vsL; then highest vsW%)
  const unluckyLeader = pickLeader("😡", (a,b) => {
    const A = luck[a]||{vsW:0,vsL:0}; const B = luck[b]||{vsW:0,vsL:0};
    const diffA = (A.vsW - A.vsL), diffB = (B.vsW - B.vsL);
    if (diffA !== diffB) return diffA > diffB;
    const wa = A.vsW + A.vsL ? A.vsW / (A.vsW + A.vsL) : 0;
    const wb = B.vsW + B.vsL ? B.vsW / (B.vsW + B.vsL) : 0;
    return wa > wb;
  });

  // 📈 Overachiever: tie-break = HIGHEST average (overTotals / games with delta>0)
  const overLeader = pickLeader("📈", (a,b) => {
    const ca = overCounts[a] ?? getCount(a,"📈");  // fallback to 📈 count if you didn’t store overCounts
    const cb = overCounts[b] ?? getCount(b,"📈");
    const avga = ca ? (overTotals[a]||0) / ca : 0;
    const avgb = cb ? (overTotals[b]||0) / cb : 0;
    return avga > avgb;
  });

  // 📉 Underachiever: tie-break = LOWEST average (underTotals / games with delta<0)
  const underLeader = pickLeader("📉", (a,b) => {
    const ca = underCounts[a] ?? getCount(a,"📉"); // fallback to 📉 count if you didn’t store underCounts
    const cb = underCounts[b] ?? getCount(b,"📉");
    const avga = ca ? (underTotals[a]||0) / ca : 0;
    const avgb = cb ? (underTotals[b]||0) / cb : 0;
    return avga < avgb;
  });

  // 🤖 Best Manager: tie-break = HIGHEST average % of optimal
  const bestMgrLeader = pickLeader("🤖", (a,b) => {
    const pa = mgr[a]?.percentages||[], pb = mgr[b]?.percentages||[];
    const avga = pa.length ? pa.reduce((s,x)=>s+x,0)/pa.length : 0;
    const avgb = pb.length ? pb.reduce((s,x)=>s+x,0)/pb.length : 0;
    return avga > avgb;
  });

  // 🤡 Worst Manager: tie-break = LOWEST average % of optimal
  const worstMgrLeader = pickLeader("🤡", (a,b) => {
    const pa = mgr[a]?.percentages||[], pb = mgr[b]?.percentages||[];
    const avga = pa.length ? pa.reduce((s,x)=>s+x,0)/pa.length : 0;
    const avgb = pb.length ? pb.reduce((s,x)=>s+x,0)/pb.length : 0;
    return avga < avgb;
  });

  // ---------- rows (with your requested wording) ----------
  // 2026-09-23: award/trophy name in orange, team name in white (bolder pop
  // against the dark cards) - Award and Team are two little helper
  // components so every row below just wraps its text the same simple way
  // instead of repeating this style object everywhere.
  const rows = [];

  if (highLeader) rows.push(
    <div key="hi"><Emoji>👑</Emoji> The current <Award>Highest Scorer</Award> king is <Team>{highLeader}</Team> with a total of {Number(totalPts[highLeader]||0).toFixed(2)} points</div>
  );

  if (lowLeader) rows.push(
    <div key="lo"><Emoji>💩</Emoji> The current <Award>Lowest Scorer</Award> peasant is <Team>{lowLeader}</Team> with a total of {Number(totalPts[lowLeader]||0).toFixed(2)} points</div>
  );

  if (blowLeader) rows.push(
    <div key="bl"><Emoji>😱</Emoji> The current <Award>Blow Out</Award> leader is <Team>{blowLeader}</Team> who has blown out their opponents by an average of {avg(blow[blowLeader]||[]).toFixed(2)} points</div>
  );

  if (closeLeader) rows.push(
    <div key="cw"><Emoji>😅</Emoji> The current <Award>Close Wins</Award> title holder is <Team>{closeLeader}</Team> who has won by an average of {avg(close[closeLeader]||[]).toFixed(2)} points</div>
  );

  if (luckyLeader) {
    const r = luck[luckyLeader]||{vsW:0,vsL:0,wins:0,losses:0};
    rows.push(
      <div key="lc"><Emoji>🍀</Emoji> <Team>{luckyLeader}</Team> should buy lotto tickets, they are currently {r.vsW}-{r.vsL} against the league yet won {r.wins} of {r.wins + r.losses} matchups</div>
    );
  }

  if (unluckyLeader) {
    const r = luck[unluckyLeader]||{vsW:0,vsL:0,wins:0,losses:0};
    rows.push(
      <div key="ul"><Emoji>😡</Emoji> <Team>{unluckyLeader}</Team> should file a complaint with the schedule maker, they are currently {r.vsW}-{r.vsL} against the league but lost {r.losses} of {r.wins + r.losses} matchups</div>
    );
  }

  if (overLeader) {
    const total = Number(overTotals[overLeader]||0);
    const count = (overCounts[overLeader] ?? getCount(overLeader,"📈")) || 0;
    const average = count ? (total / count) : 0;
    rows.push(
      <div key="ov"><Emoji>📈</Emoji> The biggest <Award>Overachiever</Award> is <Team>{overLeader}</Team> scoring a total of {total.toFixed(2)} points over their projections and averaging {average.toFixed(2)} points over their projection each game</div>
    );
  }

  if (underLeader) {
    const total = Number(underTotals[underLeader]||0);
    const count = (underCounts[underLeader] ?? getCount(underLeader,"📉")) || 0;
    const average = count ? (total / count) : 0;
    rows.push(
      <div key="un"><Emoji>📉</Emoji> The biggest <Award>Underachiever</Award> is <Team>{underLeader}</Team> scoring a total of {total.toFixed(2)} points under their projections and averaging {average.toFixed(2)} points under their projection each game</div>
    );
  }

  if (bestMgrLeader) {
    const m = mgr[bestMgrLeader]||{benchPoints:0,percentages:[]};
    const avgPct = m.percentages.length ? (m.percentages.reduce((s,x)=>s+x,0)/m.percentages.length) : 0;
    rows.push(
      <div key="bm"><Emoji>🤖</Emoji> The <Award>Best Manager</Award> so far is <Team>{bestMgrLeader}</Team>, they've left a total of {Number(m.benchPoints||0).toFixed(2)} points on their bench this season, and have scored an average of {avgPct.toFixed(1)}% of their optimal score every week</div>
    );
  }

  if (worstMgrLeader) {
    const m = mgr[worstMgrLeader]||{benchPoints:0,percentages:[]};
    const avgPct = m.percentages.length ? (m.percentages.reduce((s,x)=>s+x,0)/m.percentages.length) : 0;
    rows.push(
      <div key="wm"><Emoji>🤡</Emoji> The <Award>Worst Manager</Award> so far is <Team>{worstMgrLeader}</Team>, they've left a total of {Number(m.benchPoints||0).toFixed(2)} points on their bench this season, and scored an average of {avgPct.toFixed(1)}% of their optimal score every week</div>
    );
  }

// --- Separator before the last two meta awards ---
rows.push(<br key="sep-br" />);

// --- Positive/Negative meta awards -----------------------------------------
const POSITIVE_EMOJIS = ["👑","😱","😅","🍀","🤖","📈"]; // High, Blowout, Close Win, Lucky, Best Mgr, Overachiever
const NEGATIVE_EMOJIS = ["💩","😡","🤡","📉"];         // Low, Unlucky, Worst Mgr, Underachiever
const sumByEmojiSet = (team, set) =>
  set.reduce((s, e) => s + (trophyCounts?.[team]?.[e] || 0), 0);

// Build winners by most trophies; tie-breakers use season total points
// Positive: tie -> MOST total points
let posMax = -1, posContenders = [];
teams.forEach(t => {
  const v = sumByEmojiSet(t, POSITIVE_EMOJIS);
  if (v > posMax) { posMax = v; posContenders = [t]; }
  else if (v === posMax) posContenders.push(t);
});
let posLeader = posContenders[0] || null;
for (let i = 1; i < posContenders.length; i++) {
  if ((totalPts[posContenders[i]] || 0) > (totalPts[posLeader] || 0)) posLeader = posContenders[i];
}

// Negative: tie -> LEAST total points
let negMax = -1, negContenders = [];
teams.forEach(t => {
  const v = sumByEmojiSet(t, NEGATIVE_EMOJIS);
  if (v > negMax) { negMax = v; negContenders = [t]; }
  else if (v === negMax) negContenders.push(t);
});
let negLeader = negContenders[0] || null;
for (let i = 1; i < negContenders.length; i++) {
  if ((totalPts[negContenders[i]] || 0) < (totalPts[negLeader] || 0)) negLeader = negContenders[i];
}

// Render the new awards
if (posLeader && posMax > 0) {
  rows.push(
    <div key="meta-positive">
      <div style={{ fontSize: "1.1em" }}>
          <div style={{ textAlign: "center" }}><Emoji>🧲</Emoji> The <Award>Trophy Magnet</Award> award goes to <Team>{posLeader}</Team>
      </div></div>

      <div style={{ fontSize: "1.1em", marginTop: 3, lineHeight: 1.4 }}>
        <div><div style={{ textAlign: "center" }}><strong>{posMax}</strong> positive trophies</div></div>
        <div><div style={{ fontSize: "0.75em" }}><div style={{ textAlign: "center" }}>(High Score👑, Blow Out😱, Close Win😅, Lucky🍀, Best Manager🤖, and Overachiever📈)</div></div></div>
        <div style={{ fontSize: "1.1em", marginTop: 8, lineHeight: 1.4 }}><div style={{ textAlign: "center" }}>That’s a fantasy GM clinic.. skills so good it looks suspiciously like luck!</div></div>
      </div>
    </div>
  );
}

if (negLeader && negMax > 0) {
  rows.push(
    <div key="meta-negative">
<br />
      <div style={{ fontSize: "1.1em" }}>
  <div style={{ textAlign: "center" }}>
        <Emoji>🥄</Emoji> The <Award>Wooden Spoon</Award> award goes to <Team>{negLeader}</Team>
      </div></div>

      <div style={{ fontSize: "1.1em", marginTop: 3, lineHeight: 1.4 }}>

        <div><div style={{ textAlign: "center" }}><strong>{negMax}</strong> negative trophies</div></div>
        <div><div style={{ fontSize: "0.75em" }}><div style={{ textAlign: "center" }}>(Low Score💩, Unlucky😡, Worst Manager🤡, and Underachiever📉)</div></div></div>
        <div style={{ fontSize: "1.1em", marginTop: 8, lineHeight: 1.4 }}><div style={{ textAlign: "center" }}>Not the hardware you want… might be time to retire the franchise and focus on pickleball!🏓</div></div>
      </div>
    </div>
  );
}


  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{rows}</div>;
})()}


  </div>
)}

{/* Naughty List Section - Single consolidated table */}
      {allNaughtyEntries.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>🎅 Naughty List (Started Inactive Players)</h2>
          
          <div className="card" style={{ padding: 16 }}>
            <div style={{ overflowX: "auto" }}>
              {/* Desktop table */}
              <table className="naughty-table-desktop" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Week</th>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Team</th>
                    <th style={{ padding: "12px 8px", textAlign: "center" }}>Inactive Count</th>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Players</th>
                  </tr>
                </thead>
                <tbody>
                  {allNaughtyEntries
                    .sort((a, b) => {
                      // Sort by week descending, then by inactive count descending
                      if (b.week !== a.week) return b.week - a.week;
                      return b.inactiveCount - a.inactiveCount;
                    })
                    .map((entry, idx) => (
                      <tr key={`${entry.week}-${idx}`} style={{ 
                        borderBottom: "1px solid #f1f5f9",
                        backgroundColor: entry.inactiveCount > 2 ? "#fef2f2" : "transparent"
                      }}>
                        <td style={{ padding: "12px 8px", fontWeight: "bold" }}>{entry.week}</td>
                        <td style={{ padding: "12px 8px" }}>{entry.teamName}</td>
                        <td style={{ 
                          padding: "12px 8px", 
                          textAlign: "center",
                          fontWeight: "bold",
                          color: entry.inactiveCount > 2 ? "#dc2626" : "#ea580c"
                        }}>
                          {entry.inactiveCount}
                        </td>
                        <td style={{ padding: "12px 8px", fontSize: "12px", color: "#64748b" }}>
                          {entry.inactivePlayers.map(p => p.name).join(', ')}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {/* Mobile grid */}
              <div className="naughty-grid-mobile">
                {allNaughtyEntries
                  .sort((a, b) => {
                    if (b.week !== a.week) return b.week - a.week;
                    return b.inactiveCount - a.inactiveCount;
                  })
                  .map((entry, idx) => (
                    <div key={`${entry.week}-${idx}`} className="card" style={{ 
                      padding: 12, 
                      marginBottom: 8,
                      backgroundColor: entry.inactiveCount > 2 ? "#fef2f2" : "transparent"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ fontWeight: "bold" }}>Week {entry.week} - {entry.teamName}</div>
                        <div style={{ 
                          fontWeight: "bold",
                          color: entry.inactiveCount > 2 ? "#dc2626" : "#ea580c"
                        }}>
                          {entry.inactiveCount} inactive
                        </div>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>
                        {entry.inactivePlayers.map(p => p.name).join(', ')}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Section>
    </div>
  );
}

function NerdDataView({ espn, config, seasonYear, btnPri, btnSec }) {
  console.log('NerdDataView - espn:', espn);
  console.log('NerdDataView - config:', config);
  
  const [loading, setLoading] = useState(false);
  const [weeklyLuck, setWeeklyLuck] = useState({});
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [currentWeek, setCurrentWeek] = useState(4);
  const [seasonRecords, setSeasonRecords] = useState(null);
  const [positionalRecords, setPositionalRecords] = useState(null);

  const toggleWeek = (week) => {
    setExpandedWeeks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(week)) {
        newSet.delete(week);
      } else {
        newSet.add(week);
      }
      return newSet;
    });
  };

  useEffect(() => {
  if (espn.seasonId && espn.leagueId) {
    loadLuckIndex();
    loadSeasonRecords();
    loadPositionalRecords();
  }
}, [espn.seasonId, espn.leagueId]);

  const loadLuckIndex = async () => {
  console.log('loadLuckIndex called!');
  setLoading(true);
  try {
    // Calculate the current completed week
    // 2026-09-22: deliberately still leagueWeekOf here, not
    // completedGamesWeekOf - unlike Power Rankings below, this doesn't
    // subtract 1 from the in-progress week, so it was already relying on
    // leagueWeekOf's Tuesday shift to land on the right "completed" week on
    // Tuesdays specifically. Changing it without separately fixing that -1
    // would make this wrong on the other six days instead. Leaving as-is
    // since nothing was reported broken here - revisit together if that
    // changes.
    const now = new Date();
    const weekCalc = leagueWeekOf(now, seasonYear);
    const currentInProgressWeek = weekCalc.week || 1;
    const completedWeek = Math.max(1, currentInProgressWeek);
    
    console.log('[LUCK INDEX] Using week:', completedWeek);
    
    const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
    const response = await fetch(
      `${baseURL}/api/leagues/${config.id}/luck-index/${espn.seasonId}?currentWeek=${completedWeek}`,
      { method: 'POST' }
    );
    
    console.log('Response status:', response.status);
    const data = await response.json();
    console.log('Parsed data:', data);
    console.log('weeklyLuck from data:', data.weeklyLuck);
    
    setWeeklyLuck(data.weeklyLuck || {});
    setCurrentWeek(completedWeek);
    
    // Auto-expand the most recent completed week
    if (data.weeklyLuck && Object.keys(data.weeklyLuck).length > 0) {
      const weeks = Object.keys(data.weeklyLuck).map(w => parseInt(w));
      const mostRecentWeek = Math.max(...weeks);
      console.log('[LUCK INDEX] Auto-expanding week:', mostRecentWeek);
      setExpandedWeeks(new Set([mostRecentWeek]));
    }
    
    console.log('State should be updated now');
  } catch (err) {
    console.error('Failed to load luck index:', err);
  }
  setLoading(false);
};

const loadSeasonRecords = async () => {
  try {
    const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
    const response = await fetch(
      `${baseURL}/api/leagues/${config.id}/season-records/${espn.seasonId}`
    );
    const data = await response.json();
    setSeasonRecords(data.seasonRecords || null);
  } catch (err) {
    console.error('Failed to load season records:', err);
  }
};

const loadPositionalRecords = async () => {
  try {
    const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
    const response = await fetch(
      `${baseURL}/api/leagues/${config.id}/positional-records/${espn.seasonId}`
    );
    const data = await response.json();
    setPositionalRecords(data.positionalRecords || null);
  } catch (err) {
    console.error('Failed to load positional records:', err);
  }
};

  return (
  <Section title="🤓 Nerd Data">
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ marginBottom: 16 }}>Weekly Luck Index</h2>
      
      {loading && <div style={{ padding: 32, textAlign: 'center' }}>Loading...</div>}
      
      {!loading && Object.keys(weeklyLuck).length > 0 && (
        <div>
          {Object.entries(weeklyLuck)
            .sort(([a], [b]) => parseInt(b) - parseInt(a))
            .map(([week, teams]) => (
              <div key={week} className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}
                  onClick={() => toggleWeek(parseInt(week))}
                >
                  <h3 style={{ margin: 0 }}>Week {week}</h3>
                  <button className="btn" style={btnSec}>
                    {expandedWeeks.has(parseInt(week)) ? 'Hide ▲' : 'Show ▼'}
                  </button>
                </div>

                {expandedWeeks.has(parseInt(week)) && (
                  <div style={{ marginTop: 16, overflowX: 'auto' }}>
                    {/* Desktop table */}
                    <table className="luck-table-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                          <th style={{ padding: '12px 8px', textAlign: 'left' }}>Team</th>
                          <th style={{ padding: '12px 8px', textAlign: 'center' }}>Result</th>
                          <th style={{ padding: '12px 8px', textAlign: 'center' }}>All-Play</th>
                          <th style={{ padding: '12px 8px', textAlign: 'center' }}>Expected Win %</th>
                          <th style={{ padding: '12px 8px', textAlign: 'center' }}>Luck Index</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teams
                          .sort((a, b) => b.luckIndex - a.luckIndex)
                          .map((team, idx) => (
                            <tr key={team.teamId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '12px 8px' }}>{team.teamName}</td>
                              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                                {team.actualWin ? 'W' : 'L'}
                              </td>
                              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                                {team.allPlayWins}-{team.allPlayLosses}
                              </td>
                              <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                                {team.expectedWinPct}%
                              </td>
                              <td style={{ 
                                padding: '12px 8px', 
                                textAlign: 'center',
                                color: team.luckIndex > 0 ? '#16a34a' : team.luckIndex < 0 ? '#dc2626' : '#64748b',
                                fontWeight: 'bold'
                              }}>
                                {team.luckIndex > 0 ? '+' : ''}{team.luckIndex}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>

                    {/* Mobile grid */}
                    <div className="luck-grid-mobile">
                      <div className="luck-header">
                        <div>Result</div>
                        <div>All-Play</div>
                        <div>Expected Win %</div>
                        <div>Luck Index</div>
                      </div>
                      
                      {teams
                        .sort((a, b) => b.luckIndex - a.luckIndex)
                        .map((team, idx) => (
                          <div key={team.teamId} className="luck-row">
                            <div className="luck-row-bg">{team.teamName}</div>
                            <div className="luck-cell">
                              {team.actualWin ? 'W' : 'L'}
                            </div>
                            <div className="luck-cell">
                              {team.allPlayWins}-{team.allPlayLosses}
                            </div>
                            <div className="luck-cell">
                              {team.expectedWinPct}%
                            </div>
                            <div className="luck-cell" style={{
                              color: team.luckIndex > 0 ? '#16a34a' : team.luckIndex < 0 ? '#dc2626' : '#64748b',
                              fontWeight: 'bold'
                            }}>
                              {team.luckIndex > 0 ? '+' : ''}{team.luckIndex}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                
              </div>
            ))}
        </div>
      )}
    </div>

{/* Season Team Records Table */}
{seasonRecords && (() => {
  // 2026-09-23: the original three records (Most Wins / Highest Score /
  // Most Points For) were "pretty boring" on their own (Hac's words) -
  // this adds seven more fun/extreme ones, all computed server-side in
  // stats_service.py's /season-records route. Built as one array so the
  // desktop table and the mobile grid below are both just a .map() over
  // it, instead of hand-writing ~20 near-identical blocks.
  const sr = seasonRecords;
  const na = (v) => (v === null || v === undefined ? 'N/A' : v);
  const streakSpan = (s) => (s?.startWeek && s?.endWeek)
    ? (s.startWeek === s.endWeek ? `Wk ${s.startWeek}` : `Wk ${s.startWeek}-${s.endWeek}`)
    : 'N/A';

  const rows = [
    { label: 'Most Wins', team: sr.mostWins?.teamName, valueLabel: 'Wins', value: na(sr.mostWins?.wins ?? 0), year: `${na(sr.mostWins?.year)}` },
    { label: 'Highest Score', team: sr.highestScore?.teamName, valueLabel: 'Points', value: (sr.highestScore?.score ?? 0).toFixed(2), year: `${na(sr.highestScore?.year)} (Wk ${na(sr.highestScore?.week)})` },
    { label: 'Most Points For (Season)', team: sr.mostPointsFor?.teamName, valueLabel: 'Points', value: (sr.mostPointsFor?.points ?? 0).toFixed(2), year: `${na(sr.mostPointsFor?.year)}` },
    { label: 'Biggest Blowout Ever', team: sr.biggestBlowout?.teamName, valueLabel: 'Margin', value: `+${(sr.biggestBlowout?.margin ?? 0).toFixed(2)}`, year: `${na(sr.biggestBlowout?.year)} (Wk ${na(sr.biggestBlowout?.week)})`, opponent: sr.biggestBlowout?.opponentName ? `beat ${sr.biggestBlowout.opponentName} ${(sr.biggestBlowout?.score ?? 0).toFixed(2)} - ${(sr.biggestBlowout?.opponentScore ?? 0).toFixed(2)}` : null },
    { label: 'Ultimate Unlucky Loss', team: sr.luckyLoss?.teamName, valueLabel: 'Points (still lost)', value: (sr.luckyLoss?.score ?? 0).toFixed(2), year: `${na(sr.luckyLoss?.year)} (Wk ${na(sr.luckyLoss?.week)})`, opponent: sr.luckyLoss?.opponentName ? `lost to ${sr.luckyLoss.opponentName} ${(sr.luckyLoss?.score ?? 0).toFixed(2)} - ${(sr.luckyLoss?.opponentScore ?? 0).toFixed(2)}` : null },
    { label: 'Worst Bench Week Ever', team: sr.worstBenchWeek?.teamName, valueLabel: 'Bench Pts', value: (sr.worstBenchWeek?.benchPoints ?? 0).toFixed(2), year: `${na(sr.worstBenchWeek?.year)} (Wk ${na(sr.worstBenchWeek?.week)})` },
    { label: 'Most Waiver Adds (Season)', team: sr.mostWaiverAdds?.teamName, valueLabel: 'Adds', value: na(sr.mostWaiverAdds?.adds ?? 0), year: `${na(sr.mostWaiverAdds?.year)}` },
    { label: 'Longest Win Streak', team: sr.longestWinStreak?.teamName, valueLabel: 'Games', value: na(sr.longestWinStreak?.length ?? 0), year: `${na(sr.longestWinStreak?.year)} (${streakSpan(sr.longestWinStreak)})` },
    { label: 'Longest Losing Streak', team: sr.longestLoseStreak?.teamName, valueLabel: 'Games', value: na(sr.longestLoseStreak?.length ?? 0), year: `${na(sr.longestLoseStreak?.year)} (${streakSpan(sr.longestLoseStreak)})` },
    { label: 'Best All-Play Season', team: sr.bestAllPlaySeason?.teamName, valueLabel: 'All-Play %', value: `${sr.bestAllPlaySeason?.pct ?? 0}%`, year: `${na(sr.bestAllPlaySeason?.year)} (${na(sr.bestAllPlaySeason?.wins)}-${na((sr.bestAllPlaySeason?.games ?? 0) - (sr.bestAllPlaySeason?.wins ?? 0))})` },
  ];

  return (
  <div className="card" style={{ padding: 16, marginTop: 24 }}>
    <h2 style={{ marginBottom: 16 }}>Season Team Records</h2>

    {/* Desktop table */}
    <table className="records-table-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
          <th style={{ padding: '12px 8px', textAlign: 'left' }}>Record</th>
          <th style={{ padding: '12px 8px', textAlign: 'left' }}>Team</th>
          <th style={{ padding: '12px 8px', textAlign: 'right' }}>Value</th>
          <th style={{ padding: '12px 8px', textAlign: 'center' }}>Year</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.label} style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '12px 8px' }}>{r.label}</td>
            <td style={{ padding: '12px 8px' }}>
              {r.team || 'N/A'}
              {r.opponent && <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 400 }}>{r.opponent}</div>}
            </td>
            <td style={{ padding: '12px 8px', textAlign: 'right' }}>{r.value}</td>
            <td style={{ padding: '12px 8px', textAlign: 'center' }}>{r.year}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {/* Mobile grid - team name shown as its own line instead of its own
        column, so the Value/Year numbers always have room to fit on
        screen without spilling past the card edge. */}
    <div className="records-grid-mobile">
      {rows.map(r => (
        <div className="records-row" key={r.label}>
          <div className="records-label">{r.label}</div>
          <div className="records-row-bg">
            {r.team || 'N/A'}
            {r.opponent && <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>{r.opponent}</div>}
          </div>
          <div className="records-cells">
            <div className="records-cell"><span className="records-cell-label">{r.valueLabel}</span>{r.value}</div>
            <div className="records-cell"><span className="records-cell-label">Year</span>{r.year}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
  );
})()}

{/* Season Positional Records Table */}
{positionalRecords && (
  <div className="card" style={{ padding: 16, marginTop: 24 }}>
    <h2 style={{ marginBottom: 16 }}>Season Positional Records</h2>

    {/* Desktop table */}
    <table className="positional-table-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
          <th style={{ padding: '12px 8px', textAlign: 'left' }}>Position</th>
          <th style={{ padding: '12px 8px', textAlign: 'left' }}>Player</th>
          <th style={{ padding: '12px 8px', textAlign: 'right' }}>Points</th>
          <th style={{ padding: '12px 8px', textAlign: 'center' }}>Year</th>
          <th style={{ padding: '12px 8px', textAlign: 'center' }}>Week</th>
        </tr>
      </thead>
      <tbody>
        {['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map(pos => (
          <tr key={pos} style={{ borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>{pos}</td>
            <td style={{ padding: '12px 8px' }}>{positionalRecords[pos]?.player || 'N/A'}</td>
            <td style={{ padding: '12px 8px', textAlign: 'right' }}>{positionalRecords[pos]?.points?.toFixed(2) || 0}</td>
            <td style={{ padding: '12px 8px', textAlign: 'center' }}>{positionalRecords[pos]?.year || 'N/A'}</td>
            <td style={{ padding: '12px 8px', textAlign: 'center' }}>{positionalRecords[pos]?.week || 'N/A'}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {/* Mobile grid - same "player name as watermark" treatment as above */}
    <div className="positional-grid-mobile">
      {['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map(pos => (
        <div className="positional-row" key={pos}>
          <div className="positional-label">{pos}</div>
          <div className="positional-row-bg">{positionalRecords[pos]?.player || 'N/A'}</div>
          <div className="positional-cells">
            <div className="positional-cell"><span className="positional-cell-label">Points</span>{positionalRecords[pos]?.points?.toFixed(2) || 0}</div>
            <div className="positional-cell"><span className="positional-cell-label">Year</span>{positionalRecords[pos]?.year || 'N/A'}</div>
            <div className="positional-cell"><span className="positional-cell-label">Week</span>{positionalRecords[pos]?.week || 'N/A'}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}

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
  const [playoffOdds, setPlayoffOdds] = useState([]);
  const [finalStandingsOdds, setFinalStandingsOdds] = useState([]);
  const [strengthOfSchedule, setStrengthOfSchedule] = useState([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [currentWeek, setCurrentWeek] = useState(4);

const [sortConfig, setSortConfig] = useState({ key: 'comprehensivePowerScore', direction: 'desc' });

const handleSort = (key) => {
  setSortConfig(prev => ({
    key,
    direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
  }));
};

const sortedRankings = [...rankings].sort((a, b) => {
  if (sortConfig.key === 'record') {
    const winsA = a.wins;
    const winsB = b.wins;
    if (winsA !== winsB) {
      return sortConfig.direction === 'desc' ? winsB - winsA : winsA - winsB;
    }
    return sortConfig.direction === 'desc' ? b.totalPointsFor - a.totalPointsFor : a.totalPointsFor - b.totalPointsFor;
  }
  
  const aVal = a[sortConfig.key];
  const bVal = b[sortConfig.key];
  
  if (sortConfig.direction === 'desc') {
    return bVal - aVal;
  }
  return aVal - bVal;
});

  const loadPowerRankings = async () => {
    if (!espn.leagueId || !espn.seasonId) {
      setError("Set League ID and Season in League Settings first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 2026-09-22: try the server's pre-computed cache first - same idea
      // as Trophy Case's cache (see loadTrophies above). The server
      // rebuilds this automatically in the background once a week's games
      // are all final, so most page loads can skip calling the Python
      // service (including its 10,000-simulation Monte Carlo run)
      // entirely. Falls straight through to the live calculation below if
      // nothing's cached yet.
      try {
        const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
        const cacheResp = await fetch(`${baseURL}/api/leagues/${config.id}/power-rankings-cache/${espn.seasonId}`);
        if (cacheResp.ok) {
          const cached = await cacheResp.json();
          if (cached && Array.isArray(cached.rankings)) {
            setCurrentWeek(cached.throughWeek || 1);
            setRankings(cached.rankings);
            setPlayoffOdds(cached.playoffOdds || []);
            setFinalStandingsOdds(cached.finalStandingsOdds || []);
            setStrengthOfSchedule(cached.strengthOfSchedule || []);
            setLastUpdated(cached.computedAt ? new Date(cached.computedAt).toLocaleString() : new Date().toLocaleString());
            setError("");
            setLoading(false);
            return; // done - no Python/ESPN calls needed
          }
        }
      } catch (cacheErr) {
        console.warn('Power Rankings cache lookup failed, computing live instead:', cacheErr);
      }

      // Calculate current week - use last COMPLETED week.
      // 2026-09-22: completedGamesWeekOf, not leagueWeekOf - leagueWeekOf
      // shifts the week back by one on Tuesdays (for transaction/dues
      // bucketing, where that's correct), which made this under-count by
      // one on Tuesdays: e.g. right now ESPN's real current matchup period
      // is 3 (2 weeks of games actually finished), but leagueWeekOf reported
      // 2 on a Tuesday, so this subtracted 1 again and showed only 1 week of
      // games played instead of 2. See completedGamesWeekOf's comment near
      // the top of this file.
      const now = new Date();
      const weekCalc = completedGamesWeekOf(now, seasonYear);
      const currentInProgressWeek = weekCalc.week || 1;
      const completedWeek = Math.max(1, currentInProgressWeek - 1);
      setCurrentWeek(completedWeek);

      // Fetch all data from Python backend
      const baseURL = import.meta.env.DEV ? 'http://localhost:8787' : '';
      const [rankingsRes, playoffRes, sosRes] = await Promise.all([
        fetch(`${baseURL}/api/leagues/${config.id}/power-rankings/${espn.seasonId}?currentWeek=${completedWeek}`).then(r => r.json()),
        fetch(`${baseURL}/api/leagues/${config.id}/playoff-odds/${espn.seasonId}?currentWeek=${completedWeek}&simulations=10,000`).then(r => r.json()),
        fetch(`${baseURL}/api/leagues/${config.id}/strength-of-schedule/${espn.seasonId}?currentWeek=${completedWeek}`).then(r => r.json())
      ]);

      if (rankingsRes.error) {
        throw new Error(rankingsRes.error);
      }

      const rankedData = (rankingsRes.rankings || []).map((team, index) => ({
        ...team,
        rank: index + 1
      }));
      setRankings(rankedData);
      
      if (playoffRes.playoffOdds) {
        setPlayoffOdds(playoffRes.playoffOdds);
        setFinalStandingsOdds(playoffRes.playoffOdds.map(team => ({
          name: team.teamName,
          positions: team.positions
        })));
      }

      setStrengthOfSchedule(sosRes.strengthOfSchedule || []);
      setLastUpdated(new Date().toLocaleString());
      setError("");

    } catch (err) {
      console.error('Failed to load power rankings:', err);
      setError(err.message || "Failed to load power rankings");
    }
    
    setLoading(false);
  };

  useEffect(() => {
    if (espn.seasonId && espn.leagueId) {
      loadPowerRankings();
    }
  }, [espn.seasonId, espn.leagueId]);

  const remainingWeeks = Math.max(0, 14 - currentWeek);

  // 2026-09-24: Refresh button removed at Hac's request - same reason as
  // Trophy Case (see there): this always hits the server's own
  // auto-rebuilding cache first, so it never actually refreshed anything live.
  return (
    <Section title="Power Rankings">
      <div className="card" style={{ padding: 16 }}>
        <div className="mb-4 text-sm text-gray-600"><div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
  <p><strong>Comprehensive Power Score:</strong> (Dominance × 0.8) + (Avg Score × 0.15) + (Avg Margin of Victory × 0.05), with each ingredient put on the same 0–100 scale first so the weights are meaningful</p>
  <p><strong>Simple Power Score:</strong> (Avg Points Per Game × 0.5) + (Win % × 0.25) + (All-Play Win % × 0.25), with Avg Points Per Game put on a 0–100 scale first so it's comparable to the percentages</p></div>
</div>

        {error && <div style={{ color: "#dc2626", marginBottom: 16 }}>{error}</div>}
        
        {loading && <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>Loading power rankings...</div>}
        
        {!loading && rankings.length > 0 && (
          <>
            {/* Power Rankings Table */}
            <div className="power-rankings-table" style={{ overflowX: "auto", marginBottom: 32 }}>
              {/* Desktop table */}
              <table className="rankings-table-desktop">
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Rank #</th>
                    <th style={{ padding: "12px 8px", textAlign: "left" }}>Team</th>
                    <th className="cursor-pointer hover:bg-gray-100" onClick={() => handleSort('comprehensivePowerScore')}>
                      Comprehensive Score{sortConfig.key === 'comprehensivePowerScore' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="cursor-pointer hover:bg-gray-100" onClick={() => handleSort('simplePowerScore')}>
                      Simple Score{sortConfig.key === 'simplePowerScore' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="cursor-pointer hover:bg-gray-100" onClick={() => handleSort('record')}>
                     Team Record {sortConfig.key === 'record' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="cursor-pointer hover:bg-gray-100" onClick={() => handleSort('totalPointsFor')}>
                      Points For {sortConfig.key === 'totalPointsFor' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                    </th>
                    <th className="cursor-pointer hover:bg-gray-100" onClick={() => handleSort('totalPointsAgainst')}>
                      Points Allowed {sortConfig.key === 'totalPointsAgainst' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRankings.map((team) => (
                    <tr key={team.teamName} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "12px 8px", fontWeight: "bold" }}>{team.rank}</td>
                      <td className="power-team-name-gold" style={{ padding: "12px 8px" }}>{team.teamName}</td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: "bold", color: "#16a34a" }}>
                        {team.comprehensivePowerScore}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", color: "#64748b" }}>
                        {team.simplePowerScore}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "center" }}>
                        {team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.totalPointsFor}</td>
                      <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.totalPointsAgainst}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile grid */}
              <div className="rankings-grid-mobile">
                {/* Header row */}
                <div className="rankings-header">
                  <div>Rank #</div>
                  <div onClick={() => handleSort('comprehensivePowerScore')}>Comprehensive Score</div>
                  <div onClick={() => handleSort('simplePowerScore')}>Simple Score</div>
                  <div onClick={() => handleSort('record')}>Team Record</div>
                  <div onClick={() => handleSort('totalPointsFor')}>Points For</div>
                  <div onClick={() => handleSort('totalPointsAgainst')}>Points Allowed</div>
                </div>
                
                {/* Data rows */}
                {sortedRankings.map((team) => (
                  <div key={team.teamName} className="rankings-row">
                    <div className="rankings-row-bg">{team.teamName}</div>
                    <div className="rankings-cell">{team.rank}</div>
                    <div className="rankings-cell" style={{ fontWeight: "bold", color: "#16a34a" }}>
                      {team.comprehensivePowerScore}
                    </div>
                    <div className="rankings-cell">{team.simplePowerScore}</div>
                    <div className="rankings-cell">
                      {team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}
                    </div>
                    <div className="rankings-cell">{team.totalPointsFor}</div>
                    <div className="rankings-cell">{team.totalPointsAgainst}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Playoff Odds Table */}
            <div style={{ marginTop: 32 }}>
              <h3 style={{ marginBottom: 12 }}>Playoff Odds (prior to Week {currentWeek + 1} matchups)</h3>
              <div style={{ overflowX: "auto" }}>
                {/* Desktop table */}
                <table className="playoff-odds-desktop" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                      <th style={{ padding: "12px 8px", textAlign: "left" }}>Team</th>
                      <th style={{ padding: "12px 8px", textAlign: "right" }}>Playoff %</th>
                      <th style={{ padding: "12px 8px", textAlign: "center" }}>Current Record</th>
                      <th style={{ padding: "12px 8px", textAlign: "center" }}>Proj. Wins</th>
                      <th style={{ padding: "12px 8px", textAlign: "center" }}>Proj. Losses</th>
                      <th style={{ padding: "12px 8px", textAlign: "right" }}>Proj. Points Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playoffOdds.map(team => (
                      <tr key={team.teamName} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td className="power-team-name-gold" style={{ padding: "12px 8px" }}>{team.teamName}</td>
                        <td style={{
                          padding: "12px 8px",
                          textAlign: "right",
                          fontWeight: "bold",
                          color: team.playoffOdds > 75 ? "#16a34a" : team.playoffOdds > 25 ? "#f59e0b" : "#dc2626"
                        }}>
                          {team.playoffOdds}%
                        </td>
                        <td style={{ padding: "12px 8px", textAlign: "center" }}>{team.currentRecord}</td>
                        <td style={{ padding: "12px 8px", textAlign: "center" }}>{team.projectedWins}</td>
                        <td style={{ padding: "12px 8px", textAlign: "center" }}>{team.projectedLosses}</td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.projectedPointsFor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile grid */}
                <div className="playoff-grid-mobile">
                  <div className="playoff-header">
                    <div>Odds %</div>
                    <div>Current Record</div>
                    <div>Proj. Wins</div>
                    <div>Proj. Losses</div>
                    <div>Proj. Points Total</div>
                  </div>
                  
                  {playoffOdds.map(team => (
                    <div key={team.teamName} className="playoff-row">
                      <div className="playoff-row-bg">{team.teamName}</div>
                      <div className="playoff-cell" style={{
                        fontWeight: "bold",
                        color: team.playoffOdds > 75 ? "#16a34a" : team.playoffOdds > 25 ? "#f59e0b" : "#dc2626"
                      }}>
                        {team.playoffOdds}%
                      </div>
                      <div className="playoff-cell">{team.currentRecord}</div>
                      <div className="playoff-cell">{team.projectedWins}</div>
                      <div className="playoff-cell">{team.projectedLosses}</div>
                      <div className="playoff-cell">{team.projectedPointsFor}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Final Standings Odds */}
            <div style={{ marginTop: 32 }}>
              <h3 style={{ marginBottom: 12 }}>Final Standings Odds</h3>
              <div style={{ overflowX: "auto" }}>
                {/* Desktop table */}
                <table className="final-standings-desktop" style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                      <th style={{ padding: "8px", textAlign: "left", position: "sticky", left: 0, background: "white", zIndex: 1 }}>Team</th>
                      {finalStandingsOdds[0]?.positions.map((_, index) => (
                        <th key={index} style={{ padding: "8px", textAlign: "center", minWidth: "45px" }}>
                          {index + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {finalStandingsOdds.map(team => (
                      <tr key={team.name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td className="power-team-name-gold" style={{ padding: "8px", position: "sticky", left: 0, background: "white", zIndex: 1, fontWeight: 500 }}>
                          {team.name}
                        </td>
                        {team.positions.map((pos, index) => (
                          <td 
                            key={index} 
                            style={{ 
                              padding: "8px", 
                              textAlign: "center",
                              backgroundColor: pos.probability > 15 
                                ? `rgba(34, 197, 94, ${Math.min(pos.probability / 100, 0.7)})` 
                                : pos.probability > 5
                                ? `rgba(251, 191, 36, ${pos.probability / 100})`
                                : 'transparent',
                              fontWeight: pos.probability > 20 ? 'bold' : 'normal'
                            }}
                          >
                            {pos.probability > 0 ? `${pos.probability}%` : '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile grid - column count follows however many teams are actually in the
                    league (finalStandingsOdds[0].positions.length) instead of being fixed at
                    10, so this stays correct if the league size changes again in the future. */}
                <div className="final-standings-grid-mobile">
                  {/* Header row */}
                  <div
                    className="final-standings-header"
                    style={{ gridTemplateColumns: `repeat(${finalStandingsOdds[0]?.positions?.length || 10}, 1fr)` }}
                  >
                    {finalStandingsOdds[0]?.positions.map((_, index) => (
                      <div key={index}>{index + 1}</div>
                    ))}
                  </div>

                  {/* Data rows */}
                  {finalStandingsOdds.map(team => (
                    <div
                      key={team.name}
                      className="final-standings-row"
                      style={{ gridTemplateColumns: `repeat(${team.positions.length || 10}, 1fr)` }}
                    >
                      <div className="final-standings-row-bg">{team.name}</div>
                      {team.positions.map((pos, index) => (
                        <div 
                          key={index} 
                          className="final-standings-cell"
                          style={{
                            backgroundColor: pos.probability > 15 
                              ? `rgba(34, 197, 94, ${Math.min(pos.probability / 100, 0.7)})` 
                              : pos.probability > 5
                              ? `rgba(251, 191, 36, ${pos.probability / 100})`
                              : 'transparent',
                            fontWeight: pos.probability > 20 ? 'bold' : 'normal'
                          }}
                        >
                          {pos.probability > 0 ? `${pos.probability}%` : '-'}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Strength of Schedule */}
            {strengthOfSchedule.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h3 style={{ marginBottom: 12 }}>
                  Remaining Strength of Schedule (Weeks {currentWeek + 1} to 14)
                </h3>
<div className="mb-4 text-sm text-gray-600">
<div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
  <p><strong>How it works:< br/></strong> Opponent Power Rank combines each team's win record, scoring strength, and head-to-head performance.< br/> Overall Difficulty averages three factors: your upcoming opponents' scoring averages, win percentages, and power rankings—all normalized against league-wide ranges.</p></div>
</div>
                <div style={{ overflowX: "auto" }}>
                  {/* Desktop table */}
                  <table className="sos-table-desktop" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Team</th>
                        <th style={{ padding: "12px 8px", textAlign: "right" }}>Opp. PPG</th>
                        <th style={{ padding: "12px 8px", textAlign: "right" }}>Opp. Win %</th>
                        <th style={{ padding: "12px 8px", textAlign: "right" }}>Opp. Power Rank</th>
                        <th style={{ padding: "12px 8px", textAlign: "right" }}>Overall Difficulty</th>
                        <th style={{ padding: "12px 8px", textAlign: "center" }}>Difficulty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strengthOfSchedule.map((team, index) => {
                        const difficultyLevel = index < strengthOfSchedule.length / 3 ? "Hard" : 
                                               index < (2 * strengthOfSchedule.length) / 3 ? "Medium" : "Easy";
                        const difficultyColor = difficultyLevel === "Hard" ? "#fee2e2" : 
                                               difficultyLevel === "Medium" ? "#fef3c7" : "#dcfce7";
                        const textColor = difficultyLevel === "Hard" ? "#991b1b" : 
                                         difficultyLevel === "Medium" ? "#92400e" : "#166534";
                        
                        return (
                          <tr key={team.teamName} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td className="power-team-name-gold" style={{ padding: "12px 8px" }}>{team.teamName}</td>
                            <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.avgOpponentPPG}</td>
                            <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.opponentWinPct}%</td>
                            <td style={{ padding: "12px 8px", textAlign: "right" }}>{team.avgOpponentPowerRank}</td>
                            <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: "bold" }}>
                              {team.overallDifficulty}
                            </td>
                            <td style={{ padding: "12px 8px", textAlign: "center" }}>
                              <span style={{
                                padding: "4px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: "bold",
                                backgroundColor: difficultyColor,
                                color: textColor
                              }}>
                                {difficultyLevel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Mobile grid */}
                  <div className="sos-grid-mobile">
                    <div className="sos-header">
                      <div>Opponent PPG</div>
                      <div>Opponent Win%</div>
                      <div>Opponent PowerRank</div>
                      <div>Difficulty Score</div>
                      <div>Difficulty</div>
                    </div>
                    
                    {strengthOfSchedule.map((team, index) => {
                      const difficultyLevel = index < strengthOfSchedule.length / 3 ? "H" : 
                                             index < (2 * strengthOfSchedule.length) / 3 ? "M" : "E";
                      const diffColor = difficultyLevel === "H" ? "#dc2626" : 
                                       difficultyLevel === "M" ? "#f59e0b" : "#16a34a";
                      
                      return (
                        <div key={team.teamName} className="sos-row">
                          <div className="sos-row-bg">{team.teamName}</div>
                          <div className="sos-cell">{team.avgOpponentPPG}</div>
                          <div className="sos-cell">{team.opponentWinPct}%</div>
                          <div className="sos-cell">{team.avgOpponentPowerRank}</div>
                          <div className="sos-cell" style={{ fontWeight: "bold" }}>{team.overallDifficulty}</div>
                          <div className="sos-cell" style={{ color: diffColor, fontWeight: "bold" }}>
                            {difficultyLevel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!loading && rankings.length === 0 && !error && (
          <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
            No power rankings data available yet. Make sure weekly snapshots have been captured.
          </div>
        )}

        {lastUpdated && (
          <div style={{ marginTop: 16, fontSize: 12, color: "#64748b" }}>
            Last updated: {lastUpdated} • Simulations: 50,000
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

// WeeklyForm (the old "add a weekly challenge" UI) was removed 2026-08-25 - see the
// comment above WEEKLY_CHALLENGES near WeeklyView for why and how to make changes now.

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
  // 2026-09-24: holds the pending toggle {id, name, willBePaid} while the
  // ConfirmModal is up - null means no modal showing.
  const [pendingToggle, setPendingToggle] = useState(null);

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

  // 2026-09-24: confirm before toggling, at Hac's request - same reason
  // as the Waiver Dues Checklist above (accidental mobile scroll-taps).
  // Uses the in-app ConfirmModal instead of window.confirm() so the
  // browser's own "don't allow this page to prompt again" checkbox can
  // never appear and silently disable this safety check.
  const togglePaid = (id, name) => {
    setPendingToggle({ id, name, willBePaid: !cur.paid[id] });
  };
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
                  onChange={() => isAdmin && togglePaid(m.id, m.name)}
                  disabled={!isAdmin}
                />
                <span style={{
                  textDecoration: cur.paid[m.id] ? "line-through" : "none",
                  color: cur.paid[m.id] ? "#16a34a" : "#dc2626",
                  fontWeight: 600
                }}>{m.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmModal
        open={!!pendingToggle}
        message={pendingToggle ? `Mark ${pendingToggle.name} as ${pendingToggle.willBePaid ? "PAID" : "NOT PAID"}?` : ""}
        onCancel={() => setPendingToggle(null)}
        onConfirm={() => {
          const { id, willBePaid } = pendingToggle;
          setPendingToggle(null);
          patch({ paid: { ...cur.paid, [id]: willBePaid } });
        }}
      />
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
  
  // Only call it "Week N" once ESPN has confirmed the season actually
  // started (see loadEspnWeekAnchor near the top of this file) - otherwise
  // it's still preseason, whatever the fallback date estimate says.
  const seasonStarted = !!__espnWeekAnchor[seasonYear];
  const label = (seasonStarted && selectedWeek.week > 0) ? `Week ${selectedWeek.week} (Wed→Tue)` : `Preseason (Wed→Tue)`;
  
  return (
  <div className="week-navigation" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
    <button type="button" className="btn" style={btnSec} aria-label="Previous week" onClick={() => go(-1)}>◀</button>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 14, color: "#334155", minWidth: 170, textAlign: "center" }}>{label}</span>
      <button type="button" className="btn week-now-btn" style={btnSec} onClick={nowJump}>This Week</button>
    </div>
    <button type="button" className="btn" style={btnSec} aria-label="Next week" onClick={() => go(1)}>▶</button>
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
