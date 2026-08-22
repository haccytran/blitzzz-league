import traceback
import sys
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from urllib.parse import unquote
from espn_api.football import League
import requests
import random
import numpy as np
import psycopg
from psycopg.rows import dict_row
from statistics import mean, stdev
import os
from dotenv import load_dotenv

# Load environment variables from the project's .env file (one folder up from
# this script) so this works the same way locally as it does on Render, where
# the hosting platform sets these variables directly instead of via a .env file.
load_dotenv(Path(__file__).resolve().parent.parent / '.env')

app = Flask(__name__)
CORS(app)

DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "Set it in your .env file (local) or in your hosting provider's "
        "environment variables (production) before starting this service."
    )

def init_transactions_table():
    """Create transactions table if it doesn't exist"""
    try:
        conn = psycopg.connect(DB_URL)
        cur = conn.cursor()
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                league_id VARCHAR(20) NOT NULL,
                league_year INT NOT NULL,
                transaction_id VARCHAR(100),
                team_id INT NOT NULL,
                transaction_type VARCHAR(20),
                player_id INT,
                player_name VARCHAR(255),
                position VARCHAR(10),
                week INT,
                transaction_date BIGINT,
                UNIQUE(league_id, league_year, transaction_id, player_id)
            )
        """)
        
        conn.commit()
        cur.close()
        conn.close()
        print("Transactions table created successfully")
        
    except Exception as e:
        print(f"Error creating transactions table: {e}")
        traceback.print_exc()

def two_step_dominance(win_matrix):
    """Calculate two-step dominance matrix"""
    size = len(win_matrix)
    dominance = [[0.0] * size for _ in range(size)]
    
    for i in range(size):
        for j in range(size):
            if i != j:
                # Direct dominance
                dominance[i][j] = win_matrix[i][j]
                # Transitive dominance through all other teams
                for k in range(size):
                    if k != i and k != j:
                        dominance[i][j] += win_matrix[i][k] * win_matrix[k][j]
    
    return dominance

def power_points(dominance_matrix, teams_data, team_stats):
    """Calculate power points from dominance matrix using ESPN formula"""
    power_points_list = []
    
    for i, team_data in enumerate(teams_data):
        team_id = team_data['teamId']
        stats = team_stats[team_id]
        
        # Dominance score
        dominance = sum(dominance_matrix[i])
        
        # Average score
        avg_score = np.mean(stats['scores']) if stats['scores'] else 0
        
        # Average margin of victory
        avg_mov = 0
        if 'mov' in stats and stats['mov']:
            avg_mov = np.mean(stats['mov'])
        
        # ESPN's power ranking formula
        power = (dominance * 0.8) + (avg_score * 0.15) + (avg_mov * 0.05)
        
        power_points_list.append((power, team_id))
    
    # Sort by power (descending) and return as dict
    power_points_list.sort(key=lambda x: x[0], reverse=True)
    
    power_dict = {}
    for power, team_id in power_points_list:
        power_dict[team_id] = power
    
    return power_dict

def calculate_team_power_rankings(league_id, year, current_week, espn_s2, swid):
    """Calculate power rankings using dominance matrix - shared logic for both endpoints"""
    league_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mTeam")
    schedule_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mMatchup")
    
    teams = league_data.get('teams', [])
    schedule = schedule_data.get('schedule', [])
    
    # Build team stats
    team_stats = {}
    for team in teams:
        team_id = team['id']
        team_name = team.get('name', f"Team {team_id}")
        scores = []
        scores_against = []  # ADD THIS LINE
        outcomes = []
        
        for matchup in schedule:
            if matchup.get('matchupPeriodId', 0) > current_week:
                continue
                
            home = matchup.get('home', {})
            away = matchup.get('away', {})
            
            if home.get('teamId') == team_id:
                score = home.get('totalPoints', 0)
                opp_score = away.get('totalPoints', 0)
                if score > 0:
                    scores.append(score)
                    scores_against.append(opp_score)  # ADD THIS
                    
                    if score > opp_score:
                        outcomes.append('W')
                    elif score < opp_score:
                        outcomes.append('L')
                    else:
                        outcomes.append('T')
                        
            elif away.get('teamId') == team_id:
                score = away.get('totalPoints', 0)
                opp_score = home.get('totalPoints', 0)
                if score > 0:
                    scores.append(score)
                    scores_against.append(opp_score)  # ADD THIS
                    if score > opp_score:
                        outcomes.append('W')
                    elif score < opp_score:
                        outcomes.append('L')
                    else:
                        outcomes.append('T')
        
        team_stats[team_id] = {
            "teamName": team_name,
            "scores": scores,
            "scores_against": scores_against,       
            "outcomes": outcomes,
            "avg_score": np.mean(scores) if scores else 0,
            "win_pct": outcomes.count('W') / len(outcomes) if outcomes else 0
        }
    
    # Build MOV data
    teams_sorted = sorted(team_stats.items(), key=lambda x: x[0])
    team_mov_schedule = {}
    
    for team_id, stats in teams_sorted:
        mov_list = []
        schedule_list = []
        
        for matchup in schedule:
            week = matchup.get('matchupPeriodId', 0)
            if week > current_week or week < 1:
                continue
            
            home = matchup.get('home', {})
            away = matchup.get('away', {})
            
            if home.get('teamId') == team_id:
                my_score = home.get('totalPoints', 0)
                opp_score = away.get('totalPoints', 0)
                opp_id = away.get('teamId')
                if my_score > 0 and opp_id:
                    mov_list.append(my_score - opp_score)
                    schedule_list.append(opp_id)
                    
            elif away.get('teamId') == team_id:
                my_score = away.get('totalPoints', 0)
                opp_score = home.get('totalPoints', 0)
                opp_id = home.get('teamId')
                if my_score > 0 and opp_id:
                    mov_list.append(my_score - opp_score)
                    schedule_list.append(opp_id)
        
        team_mov_schedule[team_id] = {
            'mov': mov_list,
            'schedule': schedule_list
        }
    
    # Build win matrix
    win_matrix = []
    for team_id, stats in teams_sorted:
        wins = [0] * len(teams_sorted)
        mov_data = team_mov_schedule[team_id]
        
        for mov, opp_id in zip(mov_data['mov'], mov_data['schedule']):
            opp_idx = next((i for i, (tid, _) in enumerate(teams_sorted) if tid == opp_id), None)
            if opp_idx is not None and mov > 0:
                wins[opp_idx] += 1
        
        win_matrix.append(wins)
    
    # Add MOV to team_stats
    for team_id, stats in team_stats.items():
        stats['mov'] = team_mov_schedule[team_id]['mov']
    
    # Calculate power rankings
    dominance_matrix = two_step_dominance(win_matrix)
    teams_for_power = [{'teamId': tid} for tid, _ in teams_sorted]
    power_ranks = power_points(dominance_matrix, teams_for_power, team_stats)
    
    return power_ranks, team_stats

def fetch_espn_data(league_id, year, espn_s2=None, swid=None, view="mTeam", scoring_period=None):
    """Fetch data directly from ESPN API"""
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
    
    cookies = {}
    if espn_s2:
        cookies["espn_s2"] = unquote(espn_s2)
    if swid:
        cookies["SWID"] = unquote(swid)
    
    params = {"view": view}
    if scoring_period:
        params["scoringPeriodId"] = scoring_period
    
    response = requests.get(url, cookies=cookies, params=params)
    
    if response.status_code != 200:
        raise Exception(f"ESPN API returned {response.status_code}")
    
    return response.json()

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "espn-stats"}), 200

@app.route('/power-rankings', methods=['POST'])
def calculate_power_rankings():
    try:
        data = request.json
        league_id = data.get('leagueId')
        year = data.get('year')
        current_week = data.get('currentWeek', 1)
        espn_s2 = data.get('espn_s2')
        swid = data.get('swid')
        print(f"Power Rankings - Current week received: {current_week}")  # ADD THIS
    
        if not league_id or not year:
            return jsonify({"error": "leagueId and year are required"}), 400
        
        # Get power rankings using dominance matrix
        power_ranks, team_stats = calculate_team_power_rankings(
            league_id, year, current_week, espn_s2, swid
        )
        
        # Calculate all-play records
        league_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mTeam")
        schedule_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mMatchup")
        schedule = schedule_data.get('schedule', [])

        all_week_scores = {}
        for matchup in schedule:
            week = matchup.get('matchupPeriodId', 0)
            if week > current_week:
                continue
            
            if week not in all_week_scores:
                all_week_scores[week] = []
            
            home = matchup.get('home', {})
            away = matchup.get('away', {})
            
            if home.get('teamId') and home.get('totalPoints', 0) > 0:
                all_week_scores[week].append({
                    'teamId': home.get('teamId'),
                    'score': home.get('totalPoints', 0)
                })
            if away.get('teamId') and away.get('totalPoints', 0) > 0:
                all_week_scores[week].append({
                    'teamId': away.get('teamId'),
                    'score': away.get('totalPoints', 0)
                })
        # Build rankings output
        rankings = []
        for team_id, stats in team_stats.items():
            power_score = power_ranks.get(team_id, 0)
            wins = stats['outcomes'].count('W')
            losses = stats['outcomes'].count('L')
            ties = stats['outcomes'].count('T')
            total_pf = sum(stats['scores'])
            total_pa = sum(stats.get('scores_against', []))
            
            # Calculate all-play record
            all_play_wins = 0
            all_play_total = 0
            
            for week, week_scores in all_week_scores.items():
                team_score_entry = next((s for s in week_scores if s['teamId'] == team_id), None)
                if team_score_entry:
                    team_score = team_score_entry['score']
                    for opp in week_scores:
                        if opp['teamId'] != team_id:
                            all_play_total += 1
                            if team_score > opp['score']:
                                all_play_wins += 1
            
            all_play_win_pct = all_play_wins / all_play_total if all_play_total > 0 else 0
            actual_win_pct = wins / max(wins + losses + ties, 1)
            
            # Simple Power Score = (PF × 2) + (PF × Win%) + (PF × All-Play Win%)
            simple_score = (total_pf * 2) + (total_pf * actual_win_pct) + (total_pf * all_play_win_pct)
            
            rankings.append({
                "teamId": team_id,
                "teamName": stats['teamName'],
                "comprehensivePowerScore": round(power_score, 2),
                "simplePowerScore": round(simple_score, 2),
                "totalPointsFor": round(total_pf, 2),
                "totalPointsAgainst": round(total_pa, 2),
                "wins": wins,
                "losses": losses,
                "ties": ties
            })
        
        rankings.sort(key=lambda x: x['comprehensivePowerScore'], reverse=True)
        return jsonify({"rankings": rankings}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/debug-espn-data', methods=['POST'])
def debug_espn_data():
    try:
        data = request.json
        league_id = data.get('leagueId')
        year = data.get('year')
        espn_s2 = data.get('espn_s2')
        swid = data.get('swid')
        
        # Fetch all possible views
        views = ['mTeam', 'mMatchup', 'mBoxscore', 'mRoster', 'mScoreboard', 'mStandings']
        results = {}
        
        for view in views:
            try:
                results[view] = fetch_espn_data(league_id, year, espn_s2, swid, view=view)
            except Exception as e:
                results[view] = f"Error: {str(e)}"
        
        return jsonify(results), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/playoff-odds', methods=['POST'])
def calculate_playoff_odds():
    try:
        data = request.json
        league_id = data.get('leagueId')
        year = data.get('year')
        current_week = data.get('currentWeek', 1)
        num_simulations = data.get('numSimulations', 10000)
        espn_s2 = data.get('espn_s2')
        swid = data.get('swid')
        
        if not league_id or not year:
            return jsonify({"error": "leagueId and year are required"}), 400
        
        print(f"[PLAYOFF ODDS] Starting calculation for league {league_id}, year {year}, current week {current_week}")
        
        league_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mTeam")
        schedule_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mMatchup")
        
        teams = league_data.get('teams', [])
        schedule = schedule_data.get('schedule', [])
        
        playoff_spots = 6
        total_weeks = 14
        
        random.seed(42)
        
        # Build team stats from ALL completed weeks
        team_stats = {}
        
        for team in teams:
            team_id = team['id']
            team_name = team.get('name', f"Team {team_id}")
            
            scores = []
            wins = 0
            losses = 0
            ties = 0
            total_pf = 0
            
            # Process ALL matchups up to current week
            for matchup in schedule:
                week = matchup.get('matchupPeriodId', 0)
                if week > current_week or week < 1:  # Skip future weeks and invalid weeks
                    continue
                    
                home = matchup.get('home', {})
                away = matchup.get('away', {})
                
                if home.get('teamId') == team_id:
                    score = home.get('totalPoints', 0)
                    opp_score = away.get('totalPoints', 0)
                    if score > 0:
                        scores.append(score)
                        total_pf += score
                        if score > opp_score:
                            wins += 1
                        elif score < opp_score:
                            losses += 1
                        else:
                            ties += 1
                            
                elif away.get('teamId') == team_id:
                    score = away.get('totalPoints', 0)
                    opp_score = home.get('totalPoints', 0)
                    if score > 0:
                        scores.append(score)
                        total_pf += score
                        if score > opp_score:
                            wins += 1
                        elif score < opp_score:
                            losses += 1
                        else:
                            ties += 1
            
            print(f"[PLAYOFF ODDS] Team {team_name}: {len(scores)} games, {wins}-{losses}-{ties}, {total_pf:.1f} PF")
            
            if scores:
                # Calculate mean from last 6 weeks or all available
                recent_scores = scores[-6:] if len(scores) >= 6 else scores
                avg_score = mean(recent_scores)
                std_score = np.std(scores) if len(scores) > 1 else 15.0
                
                team_stats[team_id] = {
                    "teamName": team_name,
                    "allScores": scores,
                    "avgScore": avg_score,
                    "stdDev": std_score * 2,
                    "currentWins": wins,
                    "currentLosses": losses,
                    "currentTies": ties,
                    "currentPF": total_pf,
                    "playoffCount": 0,
                    "projectedWins": 0,
                    "projectedLosses": 0,
                    "projectedTies": 0,
                    "projectedPF": 0,
                    "positionCounts": [0] * len(teams)
                }
        
        # Get remaining matchups (weeks AFTER current_week)
        remaining_matchups = []
        for matchup in schedule:
            week = matchup.get('matchupPeriodId', 0)
            if current_week < week <= total_weeks:
                home = matchup.get('home', {})
                away = matchup.get('away', {})
                if home and away:
                    remaining_matchups.append({
                        "homeId": home.get('teamId'),
                        "awayId": away.get('teamId')
                    })
        
        print(f"[PLAYOFF ODDS] Remaining matchups to simulate: {len(remaining_matchups)}")
        
        # Run simulations
        for sim in range(num_simulations):
            sim_standings = {}
            
            # Start with current records
            for team_id, stats in team_stats.items():
                sim_standings[team_id] = {
                    "wins": stats["currentWins"],
                    "losses": stats["currentLosses"],
                    "ties": stats["currentTies"],
                    "pf": stats["currentPF"]
                }
            
            # Simulate remaining games
            for matchup in remaining_matchups:
                home_id = matchup["homeId"]
                away_id = matchup["awayId"]
                
                if home_id in team_stats and away_id in team_stats:
                    home_stats = team_stats[home_id]
                    away_stats = team_stats[away_id]
                    
                    home_score = random.gauss(home_stats["avgScore"], home_stats["stdDev"])
                    away_score = random.gauss(away_stats["avgScore"], away_stats["stdDev"])
                    
                    if abs(home_score - away_score) < 0.1:
                        sim_standings[home_id]["ties"] += 1
                        sim_standings[away_id]["ties"] += 1
                    elif home_score > away_score:
                        sim_standings[home_id]["wins"] += 1
                        sim_standings[away_id]["losses"] += 1
                    else:
                        sim_standings[away_id]["wins"] += 1
                        sim_standings[home_id]["losses"] += 1
                    
                    sim_standings[home_id]["pf"] += home_score
                    sim_standings[away_id]["pf"] += away_score
            
            # Sort by wins, then PF
            final_standings = sorted(
                [(tid, standing) for tid, standing in sim_standings.items()],
                key=lambda x: (x[1]["wins"], x[1]["pf"]),
                reverse=True
            )
            
            for idx, (team_id, standing) in enumerate(final_standings):
                stats = team_stats[team_id]
                if idx < playoff_spots:
                    stats["playoffCount"] += 1
                stats["positionCounts"][idx] += 1
                stats["projectedWins"] += standing["wins"]
                stats["projectedLosses"] += standing["losses"]
                stats["projectedTies"] += standing["ties"]
                stats["projectedPF"] += standing["pf"]
        
        # Build results
        results = []
        for team_id, stats in team_stats.items():
            results.append({
                "teamName": stats["teamName"],
                "currentRecord": f"{stats['currentWins']}-{stats['currentLosses']}" + 
                               (f"-{stats['currentTies']}" if stats['currentTies'] > 0 else ""),
                "projectedWins": round(stats["projectedWins"] / num_simulations, 1),
                "projectedLosses": round(stats["projectedLosses"] / num_simulations, 1),
                "projectedTies": round(stats["projectedTies"] / num_simulations, 1),
                "projectedPointsFor": round(stats["projectedPF"] / num_simulations, 1),
                "playoffOdds": round((stats["playoffCount"] / num_simulations) * 100, 1),
                "positions": [
                    {"position": i + 1, "probability": round((count / num_simulations) * 100, 1)}
                    for i, count in enumerate(stats["positionCounts"])
                ]
            })
        
        results.sort(key=lambda x: x["playoffOdds"], reverse=True)
        
        print(f"[PLAYOFF ODDS] Completed {num_simulations} simulations")
        return jsonify({"playoffOdds": results}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
@app.route('/weekly-awards', methods=['GET', 'POST'])
def get_weekly_awards():
    try:
        if request.method == 'POST':
            data = request.json
        else:
            data = request.args
        
        league_id = int(data.get('leagueId'))
        year = int(data.get('year'))
        week = int(data.get('week', 1))
        
        ESPN_S2 = unquote(os.getenv('ESPN_S2', ''))
        SWID = os.getenv('SWID', '')
        
        url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
        cookies = {"espn_s2": ESPN_S2, "SWID": SWID}
        params = {"view": "mBoxscore", "scoringPeriodId": week}
        
        response = requests.get(url, cookies=cookies, params=params)
        if response.status_code != 200:
            return jsonify({"error": f"ESPN API error: {response.status_code}"}), 500
        
        data = response.json()
        schedule = data.get('schedule', [])
        teams_data = data.get('teams', [])
        
        team_names = {t['id']: t.get('name', f"Team {t['id']}") for t in teams_data}
        
        naughty_list = []
        
        for matchup in schedule:
            if matchup.get('matchupPeriodId') != week:
                continue
            
            for side in ['home', 'away']:
                team_data = matchup.get(side, {})
                if not team_data:
                    continue
                
                team_id = team_data.get('teamId')
                roster = team_data.get('rosterForCurrentScoringPeriod', {}).get('entries', [])
                
                inactive_players = []
                
                for entry in roster:
                    slot_id = entry.get('lineupSlotId')
                    if slot_id is None or (slot_id >= 20 and slot_id != 23):
                        continue
                    
                    player = entry.get('playerPoolEntry', {}).get('player', {})
                    player_name = player.get('fullName', 'Unknown')
                    stats = player.get('stats', [])
                    
                    # Check if player scored any points this week
                    scored_points = False
                    for stat in stats:
                        if stat.get('scoringPeriodId') == week and stat.get('appliedTotal', 0) > 0:
                            scored_points = True
                            break
                    
                    # Player in starting lineup with 0 points = inactive/didn't play
                    if not scored_points:
                        inactive_players.append({
                            'name': player_name,
                            'status': 'Did not play'
                        })
                
                if inactive_players:
                    naughty_list.append({
                        'teamId': team_id,
                        'teamName': team_names.get(team_id, f'Team {team_id}'),
                        'inactivePlayers': inactive_players,
                        'inactiveCount': len(inactive_players)
                    })
        
        naughty_list.sort(key=lambda x: x['inactiveCount'], reverse=True)
        
        return jsonify({'week': week, 'naughtyList': naughty_list}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/historical/test', methods=['GET'])
def test_historical_data():
    """Quick test to verify historical data exists"""
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        
        # Check what data we have
        cur.execute("""
            SELECT league_year, COUNT(DISTINCT team_id) as teams, COUNT(*) as matchups
            FROM matchups
            GROUP BY league_year
            ORDER BY league_year DESC
        """)
        
        years_data = []
        for row in cur.fetchall():
            years_data.append({
                "year": row[0],
                "teams": row[1],
                "matchups": row[2]
            })
        
        cur.close()
        conn.close()
        
        return jsonify({"historical_data": years_data}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
@app.route('/luck-index', methods=['POST'])
def calculate_luck_index():
    try:
        data = request.json
        league_id = data.get('leagueId')
        year = data.get('year')
        current_week = data.get('currentWeek', 1)
        espn_s2 = data.get('espn_s2')
        swid = data.get('swid')
        
        print(f"[LUCK INDEX] Request: league={league_id}, year={year}, week={current_week}")  # ADD THIS
        
        schedule_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mMatchup")
        schedule = schedule_data.get('schedule', [])
        league_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mTeam")
        team_names = {}
        for team in league_data.get('teams', []):
            team_names[team['id']] = team.get('name', f"Team {team['id']}")
        
        print(f"[LUCK INDEX] Found {len(team_names)} teams")  # ADD THIS
        
        # Calculate all-play records for each week
        weekly_luck = {}
        
        for week in range(1, current_week + 1):
            week_scores = []
            
            for matchup in schedule:
                if matchup.get('matchupPeriodId') != week:
                    continue
                
                home = matchup.get('home', {})
                away = matchup.get('away', {})
                
                if home.get('teamId') and home.get('totalPoints', 0) > 0:
                    week_scores.append({
                        'teamId': home.get('teamId'),
                        'score': home.get('totalPoints'),
                        'won': home.get('totalPoints') > away.get('totalPoints', 0)
                    })
                if away.get('teamId') and away.get('totalPoints', 0) > 0:
                    week_scores.append({
                        'teamId': away.get('teamId'),
                        'score': away.get('totalPoints'),
                        'won': away.get('totalPoints') > home.get('totalPoints', 0)
                    })
            
            print(f"[LUCK INDEX] Week {week}: {len(week_scores)} team scores")  # ADD THIS
            
            # Calculate all-play for each team
            for team in week_scores:
                all_play_wins = sum(1 for opp in week_scores if opp['teamId'] != team['teamId'] and team['score'] > opp['score'])
                all_play_losses = sum(1 for opp in week_scores if opp['teamId'] != team['teamId'] and team['score'] < opp['score'])
                
                luck = 1 if team['won'] else -1
                expected = all_play_wins / (all_play_wins + all_play_losses) if (all_play_wins + all_play_losses) > 0 else 0.5
                
                if week not in weekly_luck:
                    weekly_luck[week] = []
                
                weekly_luck[week].append({
                    'teamId': team['teamId'],
                    'teamName': team_names.get(team['teamId'], f"Team {team['teamId']}"),
                    'actualWin': team['won'],
                    'allPlayWins': all_play_wins,
                    'allPlayLosses': all_play_losses,
                    'expectedWinPct': round(expected * 100, 1),
                    'luckIndex': round((1 if team['won'] else 0) - expected, 2)
                })
        
        print(f"[LUCK INDEX] Returning data for {len(weekly_luck)} weeks")  # ADD THIS
        return jsonify({'weeklyLuck': weekly_luck}), 200
        
    except Exception as e:
        print(f"[LUCK INDEX] ERROR: {str(e)}")  # ADD THIS
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500  
    
@app.route('/season-records', methods=['GET'])
def get_season_records():
    try:
        league_id = request.args.get('leagueId', '226912')
        
        conn = psycopg.connect(DB_URL)
        cur = conn.cursor(row_factory=dict_row)
        
        # Most wins in a season
        cur.execute("""
            SELECT team_id, league_year, COUNT(*) as wins
            FROM matchups
            WHERE outcome = 'W' AND league_id = %s
            GROUP BY team_id, league_year
            ORDER BY wins DESC
            LIMIT 1
        """, (league_id,))
        most_wins = cur.fetchone()
        
        # Highest single game score
        cur.execute("""
            SELECT team_id, league_year, week, team_score
            FROM matchups
            WHERE league_id = %s
            ORDER BY team_score DESC
            LIMIT 1
        """, (league_id,))
        highest_score = cur.fetchone()
        
        # Most points for in a season
        cur.execute("""
            SELECT team_id, league_year, SUM(team_score) as total_pf
            FROM matchups
            WHERE league_id = %s
            GROUP BY team_id, league_year
            ORDER BY total_pf DESC
            LIMIT 1
        """, (league_id,))
        most_pf = cur.fetchone()
        
        # Most points against in a season
        cur.execute("""
            SELECT team_id, league_year, SUM(opponent_score) as total_pa
            FROM matchups
            WHERE league_id = %s
            GROUP BY team_id, league_year
            ORDER BY total_pa DESC
            LIMIT 1
        """, (league_id,))
        most_pa = cur.fetchone()
        
        # Biggest blowout
        cur.execute("""
            SELECT team_id, opponent_id, league_year, week, 
                   (team_score - opponent_score) as margin
            FROM matchups
            WHERE outcome = 'W' AND league_id = %s
            ORDER BY margin DESC
            LIMIT 1
        """, (league_id,))
        biggest_blowout = cur.fetchone()
        
        # Lowest score (excluding 0s)
        cur.execute("""
            SELECT team_id, league_year, week, team_score
            FROM matchups
            WHERE team_score > 0 AND league_id = %s
            ORDER BY team_score ASC
            LIMIT 1
        """, (league_id,))
        lowest_score = cur.fetchone()
        
        cur.close()
        conn.close()
        
        records = {
            'mostWins': {
                'teamId': most_wins['team_id'] if most_wins else None,
                'year': most_wins['league_year'] if most_wins else None,
                'value': most_wins['wins'] if most_wins else 0
            },
            'highestScore': {
                'teamId': highest_score['team_id'] if highest_score else None,
                'year': highest_score['league_year'] if highest_score else None,
                'week': highest_score['week'] if highest_score else None,
                'value': float(highest_score['team_score']) if highest_score else 0
            },
            'mostPointsFor': {
                'teamId': most_pf['team_id'] if most_pf else None,
                'year': most_pf['league_year'] if most_pf else None,
                'value': float(most_pf['total_pf']) if most_pf else 0
            },
            'mostPointsAgainst': {
                'teamId': most_pa['team_id'] if most_pa else None,
                'year': most_pa['league_year'] if most_pa else None,
                'value': float(most_pa['total_pa']) if most_pa else 0
            },
            'biggestBlowout': {
                'teamId': biggest_blowout['team_id'] if biggest_blowout else None,
                'opponentId': biggest_blowout['opponent_id'] if biggest_blowout else None,
                'year': biggest_blowout['league_year'] if biggest_blowout else None,
                'week': biggest_blowout['week'] if biggest_blowout else None,
                'margin': float(biggest_blowout['margin']) if biggest_blowout else 0
            },
            'lowestScore': {
                'teamId': lowest_score['team_id'] if lowest_score else None,
                'year': lowest_score['league_year'] if lowest_score else None,
                'week': lowest_score['week'] if lowest_score else None,
                'value': float(lowest_score['team_score']) if lowest_score else 0
            }
        }
        
        return jsonify({'seasonRecords': records}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/positional-records', methods=['GET'])
def get_positional_records():
    try:
        league_id = request.args.get('leagueId', '226912')
        
        conn = psycopg.connect(DB_URL)
        cur = conn.cursor(row_factory=dict_row)
        
        positions = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']
        records = {}
        
        for pos in positions:
            cur.execute("""
                SELECT player_name, league_year, week, points, team_id
                FROM player_stats
                WHERE position = %s AND slot != 'Bench' AND league_id = %s
                ORDER BY points DESC
                LIMIT 1
            """, (pos, league_id))
            
            result = cur.fetchone()
            
            if result:
                records[pos] = {
                    'player': result['player_name'],
                    'year': result['league_year'],
                    'week': result['week'],
                    'points': float(result['points']),
                    'teamId': result['team_id']
                }
            else:
                records[pos] = None
        
        cur.close()
        conn.close()
        
        return jsonify({'positionalRecords': records}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/strength-of-schedule', methods=['GET', 'POST'])
def strength_of_schedule_endpoint():
    """Endpoint that Cloudflare worker calls"""
    try:
        # Handle both GET and POST
        if request.method == 'POST':
            data = request.json or {}
            league_id = str(data.get('leagueId'))
            season_id = str(data.get('seasonId'))
            current_week = int(data.get('currentWeek', 1))
            espn_s2 = data.get('espn_s2')
            swid = data.get('swid')
        else:
            league_id = request.args.get('leagueId')
            season_id = request.args.get('seasonId')
            current_week = request.args.get('currentWeek', 1, type=int)
            espn_s2 = request.args.get('espn_s2')
            swid = request.args.get('swid')
        
        print(f"[SOS] Received: league={league_id}, season={season_id}, week={current_week}")
        print(f"[SOS] Credentials: espn_s2={bool(espn_s2)}, swid={bool(swid)}")  # ADD THIS DEBUG LINE
                
        # Fetch all data at once (FAST!)
        league_data = fetch_espn_data(league_id, season_id, espn_s2, swid, view="mTeam")
        schedule_data = fetch_espn_data(league_id, season_id, espn_s2, swid, view="mMatchup")
        
        teams = league_data.get('teams', [])
        schedule = schedule_data.get('schedule', [])
        
        print(f"[SOS] Loaded {len(teams)} teams and {len(schedule)} matchups")
        
        # Build team stats for completed weeks
        team_stats = {}
        for team in teams:
            team_id = team['id']
            team_name = team.get('name', f"Team {team_id}")
            
            total_points = 0
            games_played = 0
            wins = 0
            losses = 0
            
            for matchup in schedule:
                week = matchup.get('matchupPeriodId', 0)
                if week > current_week or week < 1:
                    continue
                
                home = matchup.get('home', {})
                away = matchup.get('away', {})
                
                if home.get('teamId') == team_id:
                    score = home.get('totalPoints', 0)
                    opp_score = away.get('totalPoints', 0)
                    if score > 0:
                        total_points += score
                        games_played += 1
                        if score > opp_score:
                            wins += 1
                        elif score < opp_score:
                            losses += 1
                            
                elif away.get('teamId') == team_id:
                    score = away.get('totalPoints', 0)
                    opp_score = home.get('totalPoints', 0)
                    if score > 0:
                        total_points += score
                        games_played += 1
                        if score > opp_score:
                            wins += 1
                        elif score < opp_score:
                            losses += 1
            
            team_stats[team_id] = {
                'teamName': team_name,
                'avgPoints': total_points / games_played if games_played > 0 else 0,
                'winPct': wins / (wins + losses) if (wins + losses) > 0 else 0,
                'wins': wins,
                'losses': losses,
                'gamesPlayed': games_played
            }
        
        # Calculate power rankings
        power_ranks, _ = calculate_team_power_rankings(league_id, season_id, current_week, espn_s2, swid)
        
        # Calculate SOS for each team
        sos_results = []
        
        for team in teams:
            team_id = team['id']
            team_name = team_stats[team_id]['teamName']
            
            # Find remaining opponents (weeks 6-14)
            remaining_opponents = []
            
            for matchup in schedule:
                week = matchup.get('matchupPeriodId', 0)
                if week <= current_week or week > 14:
                    continue
                
                home = matchup.get('home', {})
                away = matchup.get('away', {})
                
                if home.get('teamId') == team_id and away.get('teamId'):
                    remaining_opponents.append(away.get('teamId'))
                elif away.get('teamId') == team_id and home.get('teamId'):
                    remaining_opponents.append(home.get('teamId'))
            
            if not remaining_opponents:
                continue
            
            # Calculate opponent stats
            total_opp_points = 0
            total_opp_wins = 0
            total_opp_losses = 0
            total_opp_power = 0
            
            for opp_id in remaining_opponents:
                if opp_id in team_stats:
                    total_opp_points += team_stats[opp_id]['avgPoints']
                    total_opp_wins += team_stats[opp_id]['wins']
                    total_opp_losses += team_stats[opp_id]['losses']
                    total_opp_power += power_ranks.get(opp_id, 0)
            
            num_opponents = len(remaining_opponents)
            avg_opp_ppg = total_opp_points / num_opponents if num_opponents > 0 else 0
            opp_win_pct = (total_opp_wins / (total_opp_wins + total_opp_losses)) if (total_opp_wins + total_opp_losses) > 0 else 0
            avg_opp_power = total_opp_power / num_opponents if num_opponents > 0 else 0
            
            # Normalize to 0-100
            all_ppgs = [team_stats[tid]['avgPoints'] for tid in team_stats]
            max_ppg = max(all_ppgs) if all_ppgs else 1
            min_ppg = min(all_ppgs) if all_ppgs else 0
            norm_ppg = ((avg_opp_ppg - min_ppg) / (max_ppg - min_ppg)) * 100 if max_ppg > min_ppg else 50
            
            norm_win_pct = opp_win_pct * 100
            
            all_power_scores = list(power_ranks.values())
            max_power = max(all_power_scores) if all_power_scores else 1
            min_power = min(all_power_scores) if all_power_scores else 0
            norm_power = ((avg_opp_power - min_power) / (max_power - min_power)) * 100 if max_power > min_power else 50
            
            # Weighted formula: PPG 42.5%, Win% 15%, Power 42.5%
            overall_difficulty = (norm_ppg * 0.425) + (norm_win_pct * 0.15) + (norm_power * 0.425)
            
            sos_results.append({
                'teamName': team_name,
                'avgOpponentPPG': round(avg_opp_ppg, 1),
                'opponentWinPct': round(opp_win_pct * 100, 1),
                'avgOpponentPowerRank': round(avg_opp_power, 1),
                'overallDifficulty': round(overall_difficulty, 1)
            })
        
        sos_results.sort(key=lambda x: x['overallDifficulty'], reverse=True)
        
        print(f"[SOS] Success! Calculated for {len(sos_results)} teams")
        return jsonify({'strengthOfSchedule': sos_results}), 200
        
    except Exception as e:
        print(f"[SOS] ERROR: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e), 'strengthOfSchedule': []}), 500

@app.route('/streaming-analysis', methods=['GET'])
def get_streaming_analysis():
    try:
        league_id = request.args.get('leagueId', '226912')
        year = int(request.args.get('year', 2025))
        
        conn = psycopg.connect(DB_URL, row_factory=dict_row)
        cur = conn.cursor()
        
        # Get all transactions for QB, K, D/ST positions
        streaming_positions = ['QB', 'K', 'D/ST']
        
        # Count adds/drops per team per position
        cur.execute("""
            SELECT team_id, position, COUNT(*) as transaction_count,
                   ARRAY_AGG(player_name ORDER BY week) as players,
                   ARRAY_AGG(week ORDER BY week) as weeks
            FROM transactions
            WHERE league_id = %s 
              AND league_year = %s 
              AND transaction_type = 'ADD'
              AND position IN ('QB', 'K', 'D/ST')
            GROUP BY team_id, position
            HAVING COUNT(*) >= 4
        """, (league_id, year))
        
        streaming_data = cur.fetchall()
        
        # Get team names
        cur.execute("""
            SELECT DISTINCT team_id, team_name
            FROM teams
            WHERE league_id = %s AND league_year = %s
        """, (league_id, year))
        
        team_names = {row['team_id']: row['team_name'] for row in cur.fetchall()}
        
        # Calculate streaming success for each team/position
        streamers = []
        
        for stream in streaming_data:
            team_id = stream['team_id']
            position = stream['position']
            
            # Get points scored by streamed players
            cur.execute("""
                SELECT ps.week, ps.player_name, ps.points
                FROM player_stats ps
                WHERE ps.league_id = %s 
                  AND ps.league_year = %s
                  AND ps.team_id = %s
                  AND ps.position = %s
                  AND ps.slot != 'Bench'
                ORDER BY ps.week
            """, (league_id, year, team_id, position))
            
            weekly_scores = cur.fetchall()
            
            # Calculate average points from streaming
            if weekly_scores:
                avg_points = sum(s['points'] for s in weekly_scores) / len(weekly_scores)
                
                # Get league average for this position
                cur.execute("""
                    SELECT AVG(points) as league_avg
                    FROM player_stats
                    WHERE league_id = %s 
                      AND league_year = %s
                      AND position = %s
                      AND slot != 'Bench'
                """, (league_id, year, position))
                
                league_avg = cur.fetchone()['league_avg'] or 0
                
                # Calculate streaming score (how much better than league average)
                streaming_score = avg_points - league_avg
                
                streamers.append({
                    'teamId': team_id,
                    'teamName': team_names.get(team_id, f'Team {team_id}'),
                    'position': position,
                    'transactionCount': stream['transaction_count'],
                    'avgPoints': round(avg_points, 2),
                    'leagueAvg': round(league_avg, 2),
                    'streamingScore': round(streaming_score, 2),
                    'players': stream['players']
                })
        
        # Sort by streaming score (best streamers first)
        streamers.sort(key=lambda x: x['streamingScore'], reverse=True)
        
        cur.close()
        conn.close()
        
        return jsonify({'streamers': streamers}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/test-tables', methods=['GET'])
def test_tables():
    try:
        conn = psycopg.connect(DB_URL, row_factory=dict_row)
        cur = conn.cursor()
        
        # Get all table names
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)
        
        tables = [row['table_name'] for row in cur.fetchall()]
        
        cur.close()
        conn.close()
        
        return jsonify({'tables': tables}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/test-transactions', methods=['GET'])
def test_transactions():
    try:
        league_id = '226912'
        year = 2025
        
        # Try to fetch transactions from ESPN API
        url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
        
        ESPN_S2 = os.getenv('ESPN_S2', '')
        SWID = os.getenv('SWID', '')
        
        cookies = {"espn_s2": ESPN_S2, "SWID": SWID}
        params = {"view": "mTransactions2"}
        
        response = requests.get(url, cookies=cookies, params=params)
        
        if response.status_code != 200:
            return jsonify({"error": f"ESPN API returned {response.status_code}"}), 500
        
        data = response.json()
        
        # Check if transactions exist
        transactions = data.get('transactions', [])
        
        return jsonify({
            'transactionCount': len(transactions),
            'sampleTransaction': transactions[0] if transactions else None,
            'availableKeys': list(data.keys())
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/import-transactions', methods=['POST'])
def import_transactions():
    try:
        data = request.json
        league_id = data.get('leagueId', '226912')
        year = int(data.get('year', 2025))
        
        # Fetch transactions from ESPN
        url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
        
        ESPN_S2 = os.getenv('ESPN_S2', data.get('espn_s2', ''))
        SWID = os.getenv('SWID', data.get('swid', ''))
        
        cookies = {"espn_s2": ESPN_S2, "SWID": SWID}
        
        # Get transactions
        params = {"view": "mTransactions2"}
        response = requests.get(url, cookies=cookies, params=params)
        
        if response.status_code != 200:
            return jsonify({"error": f"ESPN API returned {response.status_code}"}), 500
        
        api_data = response.json()
        transactions = api_data.get('transactions', [])
        
        # Get player names from kona_player_info
        params = {"view": "kona_player_info"}
        player_response = requests.get(url, cookies=cookies, params=params)
        player_data = player_response.json() if player_response.status_code == 200 else {}
        
        # Build player info map
        player_info_map = {}
        if 'players' in player_data:
            for p in player_data['players']:
                player = p.get('player', {})
                player_id = player.get('id')
                if player_id:
                    position_map = {0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'D/ST', 17: 'K'}
                    player_info_map[player_id] = {
                        'name': player.get('fullName', f'Player {player_id}'),
                        'position': position_map.get(player.get('defaultPositionId'), 'UNKNOWN')
                    }
        
        conn = psycopg.connect(DB_URL)
        cur = conn.cursor()
        
        imported = 0
        skipped = 0
        
        for txn in transactions:
            txn_id = txn.get('id')
            team_id = txn.get('teamId', 0)
            week = txn.get('scoringPeriodId', 1)
            txn_date = txn.get('proposedDate', 0)
            txn_type = txn.get('type', '')
            
            # DEBUG: Print first transaction to see structure
            if imported == 0 and skipped == 0:
                print(f"\n=== DEBUG: First Transaction ===")
                print(f"Type: {txn_type}")
                print(f"Team ID: {team_id}")
                print(f"Items: {txn.get('items', [])}")
                print(f"================================\n")
            
            # Skip non-waiver/FA transactions
            if txn_type not in ['WAIVER', 'FREEAGENT']:
                print(f"Skipping transaction type: {txn_type}")
                continue
            
            for item in txn.get('items', []):
                player_id = item.get('playerId')
                from_team = item.get('fromTeamId', 0)
                to_team = item.get('toTeamId', 0)
                item_type = item.get('type', '')
                
                print(f"Processing item - Player: {player_id}, Type: {item_type}, From: {from_team}, To: {to_team}")
                
                if not player_id:
                    print("  -> Skipped: No player ID")
                    continue
                
                # Determine if this is an ADD or DROP
                action = None
                if from_team == 0 and to_team == team_id:
                    action = 'ADD'
                elif from_team == team_id and to_team == 0:
                    action = 'DROP'
                
                if not action:
                    print(f"  -> Skipped: No action determined (from={from_team}, to={to_team}, team={team_id})")
                    continue
                
                # Get player info
                info = player_info_map.get(player_id, {'name': f'Player {player_id}', 'position': 'UNKNOWN'})
                position = info['position']
                player_name = info['name']
                
                print(f"  -> Action: {action}, Position: {position}, Name: {player_name}")
                
                # Only track streaming positions: QB, K, D/ST
                if position not in ['QB', 'K', 'D/ST']:
                    print(f"  -> Skipped: Not a streaming position")
                    continue
                
                try:
                    cur.execute("""
                        INSERT INTO transactions 
                        (league_id, league_year, transaction_id, team_id, transaction_type, 
                         player_id, player_name, position, week, transaction_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (league_id, league_year, transaction_id, player_id) DO NOTHING
                    """, (league_id, year, txn_id, team_id, action, player_id, 
                          player_name, position, week, txn_date))
                    
                    print(f"  -> ✓ IMPORTED")
                    imported += 1
                except Exception as e:
                    skipped += 1
                    print(f"  -> Error: {e}")
                    continue
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'totalTransactions': len(transactions),
            'imported': imported,
            'skipped': skipped
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# Initialize transactions table on startup
init_transactions_table()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=True)