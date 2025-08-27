buyins={buyins}
              updateBuyins={updateBuyins}
            />
          </div>

          <div className="card dues-week" style={{padding:12, minWidth:0}}>
            <h3 style={{marginTop:0}}>By Week (Wed→Tue, cutoff Tue 11:59 PM PT)</h3>
            {report.weekRows.map(w=>(
              <div key={w.week} style={{marginBottom:12}}>
                <div style={{fontWeight:600, margin:"6px 0"}}>Week {w.week} — {w.range}</div>
                <table style={{width:"100%", borderCollapse:"collapse"}}>
                  <thead>
                    <tr>
                      <th style={th}>Team</th>
                      <th style={th}>Adds</th>
                      <th style={th}>Owes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.entries.map(e=>(
                      <tr key={e.name}>
                        <td style={{...td, whiteSpace:"normal"}}>{e.name}</td>
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

function BuyInTracker({ isAdmin, members, seasonYear, buyins, updateBuyins }) {
  const BUYIN = 200;
  const displayYear = new Date().getFullYear();
  const seasonKey = String(seasonYear);
  const cur = buyins[seasonKey] || { paid: {}, hidden: false, venmoLink: "", zelleEmail: "", venmoQR: "" };

  const patch = (p) => updateBuyins(seasonKey, { ...cur, ...p });
  const togglePaid = (id) => patch({ paid: { ...cur.paid, [id]: !cur.paid[id] } });
  const markAll = () => patch({ paid: Object.fromEntries(members.map(m => [m.id, true])) });
  const resetAll = () => patch({ paid: {} });

  const paidCount = members.filter(m => cur.paid[m.id]).length;
  const allPaid = members.length > 0 && paidCount === members.length;

  if (cur.hidden && !isAdmin) return null;

  const [venmo, setVenmo] = useState(cur.venmoLink || "");
  const [zelle, setZelle] = useState(cur.zelleEmail || "");
  useEffect(() => { setVenmo(cur.venmoLink || ""); setZelle(cur.zelleEmail || ""); }, [seasonKey, cur]);

  const saveMeta = () => patch({ venmoLink: venmo.trim(), zelleEmail: zelle.trim() });

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
}(
    <div className="card" style={{ padding:16, marginTop:16 }}>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
        <h3 style={{marginTop:0}}>${BUYIN} Season Buy-In — {displayYear}</h3>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <span className="badge">{paidCount} / {members.length} paid</span>
          {isAdmin && (
            cur.hidden
              ? <button className="btn" onClick={()=>patch({hidden:false})}>Show tracker</button>
              : allPaid
                ? <button className="btn" onClick={()=>patch({hidden:true})}>Hide (all paid)</button>
                : null
          )}
        </div>
      </div>

      {members.length === 0 && (
        <p style={{color:"#64748b", marginTop:0}}>
          No members yet. Import teams in <b>League Settings</b> first.
        </p>
      )}

      {members.length > 0 && (
        <div className="grid" style={{gridTemplateColumns:"1fr", gap:16}}>
          <div className="card" style={{ padding:12, background:"#f8fafc" }}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
              <strong>Buy-In Paid Checklist ✅</strong>
              {isAdmin && (
                <div style={{display:"flex", gap:8}}>
                  <button className="btn" onClick={markAll}>Mark all paid</button>
                  <button className="btn" onClick={resetAll}>Reset</button>
                </div>
              )}
            </div>
            <ul style={{listStyle:"none", padding:0, margin:0}}>
              {[...members].sort((a,b)=>a.name.localeCompare(b.name)).map(m => (
                <li key={m.id} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid #e2e8f0"}}>
                  <input
                    type="checkbox"
                    checked={!!cur.paid[m.id]}
                    onChange={()=> isAdmin && togglePaid(m.id)}
                    disabled={!isAdmin}
                  />
                  <span style={{textDecoration: cur.paid[m.id] ? "line-through" : "none"}}>{m.name}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card buyin-pay" style={{ padding:12 }}>
            <h4 style={{marginTop:0}}>Pay Dues</h4>
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {cur.venmoLink && (
                <a className="btn primary" href={cur.venmoLink} target="_blank" rel="noreferrer">Pay with Venmo</a>
              )}
              {cur.zelleEmail && (
                <button type="button" className="btn" onClick={copyZelle}>Pay with Zelle</button>
              )}
            </div>
            {(cur.venmoQR || cur.venmoLink || cur.zelleEmail) && (
              <div style={{marginTop:8}}>
                <a href={cur.venmoLink || `mailto:${encodeURIComponent(cur.zelleEmail)}`} target="_blank" rel="noreferrer" title={cur.venmoLink ? "Open Venmo" : "Email for Zelle"}>
                  {cur.venmoQR && <img src={cur.venmoQR} alt="Venmo QR"/>}
                </a>
              </div>
            )}
            {isAdmin && (
              <>
                <div className="grid" style={{gridTemplateColumns:"1fr", gap:8, marginTop:8}}>
                  <input className="input" placeholder="https://venmo.com/u/YourHandle" value={venmo} onChange={e=>setVenmo(e.target.value)}/>
                  <input className="input" placeholder="Zelle email" value={zelle} onChange={e=>setZelle(e.target.value)}/>
                </div>
                <div style={{display:"flex", gap:8, alignItems:"center", marginTop:8, flexWrap:"wrap"}}>
                  <input type="file" accept="image/*" onChange={onUploadQR}/>
                  {cur.venmoQR && <button className="btn" onClick={()=>patch({venmoQR:""})}>Remove QR</button>}
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

function TransactionsView({ report }){
  if (!report) {
    return (
      <Section title="Transactions">
        <p style={{color:"#64748b"}}>No snapshot yet — go to <b>Dues</b> and click <b>Refresh Snapshot</b> (or have the commissioner update it).</p>
      </Section>
    );
  }

  const SHOW_METHOD_COLUMN = false;
  const METHOD_FOR_ADDS_ONLY = true;

  const all = (report.rawMoves || report.rawAdds || []).map(r => ({
  ...r,
  week: Math.max(1, Number(r.week) || 1)
}));

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

function Rosters({ leagueId, seasonId, members, isAdmin, loadServerData }) {
  const [rosters, setRosters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRosters = async () => {
    try {
      const response = await fetch(API(`/api/league-data/rosters?seasonId=${seasonId}`));
      if (response.ok) {
        const data = await response.json();
        setRosters(data.rosters || []);
      }
    } catch (err) {
      console.error("Failed to load rosters:", err);
    }
  };

  const populateFromESPN = async () => {
    if (!leagueId || !seasonId) return alert("Set League ID & Season in Settings first");
    if (!isAdmin) return alert("Admin access required");
    
    setLoading(true);
    setError("");
    
    try {
      const [teamJson, rosJson] = await Promise.all([
        fetchEspnJson({ leagueId, seasonId, view: "mTeam" }),
        fetchEspnJson({ leagueId, seasonId, view: "mRoster" })
      ]);
      
      const teamsById = Object.fromEntries((teamJson?.teams || []).map(t => [t.id, teamName(t)]));
      const rostersData = (rosJson?.teams || []).map(t => {
        const entries = (t.roster?.entries || []).map(e => {
          const p = e.playerPoolEntry?.player;
          return {
            name: p?.fullName || "Player",
            position: posIdToName(p?.defaultPositionId),
            slot: slotIdToName(e.lineupSlotId)
          };
        });
        return { 
          teamId: t.id,
          teamName: teamsById[t.id] || `Team ${t.id}`, 
          roster: entries 
        };
      }).sort((a, b) => a.teamName.localeCompare(b.teamName));

      // Save to server
      const response = await fetch(API('/api/league-data/rosters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ seasonId, rosters: rostersData })
      });

      if (response.ok) {
        setRosters(rostersData);
        alert(`Populated rosters for ${rostersData.length} teams`);
      }
    } catch (err) {
      setError("Failed to populate rosters from ESPN");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    if (seasonId) loadRosters(); 
  }, [seasonId]);

  return (
    <Section title="Rosters" actions={
      <div style={{display:"flex", gap:8, alignItems:"center"}}>
        {isAdmin && (
          <button className="btn" style={btnPri} onClick={populateFromESPN} disabled={loading}>
            {loading ? "Importing..." : "Import Teams"}
          </button>
        )}
        <span className="badge">Server-side stored</span>
      </div>
    }>
      {!leagueId && <p style={{color:"#64748b"}}>Set your ESPN League ID & Season in <b>League Settings</b>.</p>}
      {loading && <p>Loading rosters...</p>}
      {error && <p style={{color:"#dc2626"}}>{error}</p>}
      
      <div className="grid" style={{gridTemplateColumns:"1fr 1fr"}}>
        {rosters.map(team => (
          <div key={team.teamId || team.teamName} className="card" style={{padding:16}}>
            <h3 style={{marginTop:0}}>{team.teamName}</h3>
            <ul style={{margin:0,paddingLeft:16}}>
              {team.roster.map((e,i)=> 
                <li key={i}><b>{e.slot}</b> — {e.name} ({e.position})</li>
              )}
              {team.roster.length === 0 && <li style={{color:"#64748b"}}>No players yet</li>}
            </ul>
          </div>
        ))}
      </div>
      
      {!loading && rosters.length === 0 && leagueId && (
        <p style={{color:"#64748b"}}>
          No roster data yet. {isAdmin ? "Click 'Import Teams' to populate from ESPN." : "Ask commissioner to import teams."}
        </p>
      )}
    </Section>
  );
}

function posIdToName(id){ 
  const map={0:"QB",1:"TQB",2:"RB",3:"RB",4:"WR",5:"WR/TE",6:"TE",7:"OP",8:"DT",9:"DE",10:"LB",11:"DE",12:"DB",13:"DB",14:"DP",15:"D/ST",16:"D/ST",17:"K"}; 
  return map?.[id] || "—"; 
}

function slotIdToName(id){ 
  const map={0:"QB",2:"RB",3:"RB/WR",4:"WR",5:"WR/TE",6:"TE",7:"OP",16:"D/ST",17:"K",20:"Bench",21:"IR",23:"FLEX",24:"EDR",25:"RDP",26:"RDP",27:"RDP",28:"Head Coach"}; 
  return map[id] || `Slot ${id}`;
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
      {isAdmin && editing ? (
        <RichEditor
          html={leagueSettingsHtml || ""}
          readOnly={false}
          setHtml={(h) => {
            updateLeagueSettings(h);
            setEditing(false);
          }}
        />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div className="prose" dangerouslySetInnerHTML={{ __html: leagueSettingsHtml || "<p>No settings yet.</p>" }} />
        </div>
      )}
    </Section>
  );
}

function RichEditor({ html, setHtml, readOnly }) {
  const [local, setLocal] = useState(html || "");
  const ref = useRef(null);
  const lastTyped = useRef(null);

  useEffect(() => { setLocal(html || ""); }, [html]);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (local || "")) {
      ref.current.innerHTML = local || "";
    }
  }, []);

  useEffect(() => {
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
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("bold");}}><b>B</b></button>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("italic");}}><i>I</i></button>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("underline");}}><u>U</u></button>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("strikeThrough");}}><s>S</s></button>
        <span style={{ width: 8 }} />
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("insertUnorderedList");}}>• List</button>
        <button className="btn" style={btnSec} onMouseDown={(e)=>{e.preventDefault(); exec("insertOrderedList");}}>1. List</button>
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

function TradingView({isAdmin,addTrade,deleteTrade,tradeBlock}) {
  return (
    <Section title="Trading Block">
      {isAdmin && <TradeForm onSubmit={addTrade}/>}
      <div className="grid">
        {tradeBlock.length===0 && <p style={{color:"#64748b"}}>Nothing on the block yet.</p>}
        {tradeBlock.map(t=>(
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

function TradeForm({onSubmit}){
  const [player,setPlayer]=useState(""); 
  const [position,setPosition]=useState(""); 
  const [owner,setOwner]=useState(""); 
  const [notes,setNotes]=useState("");
  
  return (
    <form onSubmit={(e)=>{
      e.preventDefault(); 
      if(!player) return; 
      onSubmit({player,position,owner,notes}); 
      setPlayer(""); setPosition(""); setOwner(""); setNotes("");
    }} className="card" style={{padding:16, background:"#f8fafc", marginBottom:12}}>
      <div className="grid" style={{gridTemplateColumns:"1fr 1fr 1fr", gap:8}}>
        <input className="input" placeholder="Player" value={player} onChange={e=>setPlayer(e.target.value)}/>
        <input className="input" placeholder="Position (e.g., WR)" value={position} onChange={e=>setPosition(e.target.value)}/>
        <input className="input" placeholder="Owner" value={owner} onChange={e=>setOwner(e.target.value)}/>
      </div>
      <input className="input" placeholder="Notes" style={{marginTop:8}} value={notes} onChange={e=>setNotes(e.target.value)}/>
      <div style={{textAlign:"right", marginTop:8}}>
        <button className="btn" style={btnPri}>Add to Block</button>
      </div>
    </form>
  );
}

function IntroSplash(){
  const [show,setShow] = useState(true);
  useEffect(()=>{ const t=setTimeout(()=>setShow(false), 1600); return ()=>clearTimeout(t); }, []);
  if(!show) return null;
  return function WeeklyForm({ seasonYear, onAdd }) {
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
    <Section title="Dues (Official Snapshot)" actions={
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <button className="btn" style={btnSec} onClick={()=>loadOfficialReport(false)}>Refresh Snapshot</button>
        {isAdmin && <button className="btn" style={btnPri} onClick={updateOfficialSnapshot}>Update Official Snapshot</button>}
        <button className="btn" style={btnSec} onClick={()=>print()}>Print</button>
        {report && <>
          <button className="btn" style={btnSec} onClick={()=>{
            const rows=[["Team","Adds","Owes"], ...report.totalsRows.map(r=>[r.name,r.adds,`${r.owes}`])];
            downloadCSV("dues_totals.csv", rows);
          }}>Download CSV (totals)</button>
          <button className="btn" style={btnSec} onClick={()=>{
            const rows=[["Week","Range","Team","Adds","Owes"]];
            report.weekRows.forEach(w=> w.entries.forEach(e=> rows.push([w.week,w.range,e.name,e.count,`${e.owes}`])));
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
      <p style={{marginTop:-8, color:"#64748b"}}>
        Last updated: <b>{lastSynced || "—"}</b>. Rule: first two transactions per Wed→Tue week are free, then $5 each.
      </p>
      {!report && <p style={{color:"#64748b"}}>No snapshot yet — Commissioner should click <b>Update Official Snapshot</b>.</p>}

      {report && (
        <div className="dues-grid dues-tight">
          <div className="dues-left">
            <div className="card" style={{padding:12}}>
              <h3 style={{marginTop:0}}>League Owner Dues</h3>
              <table style={{width:"100%", borderCollapse:"collapse"}}>
                <thead>
                  <tr>
                    <th style={th}>Team</th>
                    <th style={th}>Adds</th>
                    <th style={th}>Owes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.totalsRows.map(r=>(
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
              members={members}
              seasonYear={seasonYear}
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
  const [tradeBlock, setTradeBlock] = useState([]);

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
        setTradeBlock(serverData.tradeBlock || []);
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
      
      // Store rosters server-side
      const response = await fetch(API('/api/league-data/rosters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ 
          seasonId: espn.seasonId, 
          rosters: teams.map(t => ({ 
            teamId: t.id, 
            teamName: teamName(t),
            roster: [] // Will be populated when roster data is available
          }))
        })
      });
      
      const importResponse = await fetch(API('/api/league-data/import-teams'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin': ADMIN_ENV },
        body: JSON.stringify({ teams: names })
      });
      
      if (importResponse.ok) {
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
      await loadServerData(); // Refresh data
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
      await loadServerData(); // Refresh data
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
    rosters: <Rosters leagueId={espn.leagueId} seasonId={espn.seasonId} members={members} isAdmin={isAdmin} loadServerData={loadServerData} />,
    settings: <SettingsView {...{isAdmin,espn,setEspn,importEspnTeams,leagueSettingsHtml,updateLeagueSettings}}/>,
    trading: <TradingView {...{isAdmin,addTrade,deleteTrade,tradeBlock}}/>,
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