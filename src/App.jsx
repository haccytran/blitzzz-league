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
