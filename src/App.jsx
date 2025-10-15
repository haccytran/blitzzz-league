// Week 6: Overachiever - biggest positive difference from projection
async function determineOverachiever(weekNumber, leagueId, seasonId) {
  try {
    console.log(`[OVERACHIEVER] Starting calculation for Week ${weekNumber}`);
    
    // Fetch both team data and boxscore data for the specific week
    const [teamResponse, boxscoreResponse] = await Promise.all([
      fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mTeam`, {
        mode: 'cors',
        headers: { 'Accept': 'application/json' }
      }),
      fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}?view=mMatchup&view=mBoxscore&scoringPeriodId=${weekNumber}`, {
        mode: 'cors',
        headers: { 'Accept': 'application/json' }
      })
    ]);
    
    if (!teamResponse.ok || !boxscoreResponse.ok) {
      console.error(`[OVERACHIEVER] API error - Team: ${teamResponse.status}, Boxscore: ${boxscoreResponse.status}`);
      throw new Error(`ESPN API error`);
    }
    
    const [teamData, boxscoreData] = await Promise.all([
      teamResponse.json(),
      boxscoreResponse.json()
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
