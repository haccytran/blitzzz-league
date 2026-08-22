import traceback
import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
from urllib.parse import unquote
import requests
import random
import numpy as np
from statistics import mean
import os

app = Flask(__name__)
CORS(app)

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
        
        if not league_id or not year:
            return jsonify({"error": "leagueId and year are required"}), 400
        
        league_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mTeam")
        schedule_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mMatchup")
        
        teams = league_data.get('teams', [])
        schedule = schedule_data.get('schedule', [])
        
        # Build all scores for all-play calculation
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
        
        rankings = []
        
        for team in teams:
            team_id = team['id']
            team_name = team.get('name', f"Team {team['id']}")
            print(f"Team {team['id']}: name='{team_name}'")
            
            scores = []
            scores_against = []
            wins = 0
            losses = 0
            ties = 0
            
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
                        scores_against.append(opp_score)
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
                        scores_against.append(opp_score)
                        if score > opp_score:
                            wins += 1
                        elif score < opp_score:
                            losses += 1
                        else:
                            ties += 1
            
            if not scores:
                continue
            
            total_pf = sum(scores)
            total_pa = sum(scores_against)
            avg_score = mean(scores)
            std_dev = stdev(scores) if len(scores) > 1 else 0
            
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
            actual_win_pct = wins / max(wins + losses, 1)
            
            # Dominance
            dominance = 0.18 * ((2 * total_pf) + total_pa)
            
            # Consistency
            consistency = 130 / (std_dev + 12)
            
            # Luck
            luck = (actual_win_pct - all_play_win_pct) * 100
            
            # Comprehensive Power Score
            power_score = (0.8 * dominance) + (0.15 * luck) + (0.05 * consistency)
            
            # Simple Power Score
            simple_score = (total_pf * 2) + (total_pf * actual_win_pct) + (total_pf * all_play_win_pct)
            
            rankings.append({
                "teamId": team_id,
                "teamName": team_name,
                "comprehensivePowerScore": round(power_score, 2),
                "simplePowerScore": round(simple_score, 2),
                "dominance": round(dominance, 2),
                "consistency": round(consistency, 2),
                "luck": round(luck, 2),
                "totalPointsFor": round(total_pf, 2),
                "totalPointsAgainst": round(total_pa, 2),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "allPlayRecord": f"{all_play_wins}-{all_play_total - all_play_wins}"
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
        
        league_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mTeam")
        schedule_data = fetch_espn_data(league_id, year, espn_s2, swid, view="mMatchup")
        
        teams = league_data.get('teams', [])
        schedule = schedule_data.get('schedule', [])
        
        playoff_spots = 6
        total_weeks = 14
        
        random.seed(42)  # Match DoritoStats random seed
        # Build team stats
        team_stats = {}
        
        for team in teams:
            team_id = team['id']
            team_name = team.get('name', f"Team {team_id}")
            
            scores = []
            wins = 0
            losses = 0
            ties = 0
            total_pf = 0
            
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
            
            if scores:
                # Calculate mean from last 6 weeks
                recent_scores = scores[-6:] if len(scores) >= 6 else scores
                avg_score = mean(recent_scores)
                
                # Calculate std from ALL scores, then multiply by 2
                # Use numpy.std (population std) to match DoritoStats
                import numpy as np
                std_score = np.std(scores) if len(scores) > 1 else 15.0  # Default to 15 if only 1 game
                
                team_stats[team_id] = {
                    "teamName": team_name,
                    "allScores": scores,  # Store all scores
                    "avgScore": avg_score,
                    "stdDev": std_score * 2,  # Multiply by 2!
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
        
        # Get remaining matchups
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
        
        print(f"Total remaining matchups: {len(remaining_matchups)}")
        print(f"Current week: {current_week}, simulating weeks {current_week + 1} to {total_weeks}")
        
        # Run simulations
        for _ in range(num_simulations):
            sim_standings = {}
            
            for team_id, stats in team_stats.items():
                sim_standings[team_id] = {
                    "wins": stats["currentWins"],
                    "losses": stats["currentLosses"],
                    "ties": stats["currentTies"],
                    "pf": stats["currentPF"]
                }
            
            for matchup in remaining_matchups:
                home_id = matchup["homeId"]
                away_id = matchup["awayId"]
                
                if home_id in team_stats and away_id in team_stats:
                    home_stats = team_stats[home_id]
                    away_stats = team_stats[away_id]
                    
                    # Generate scores using DoritoStats methodology
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
            
            # Sort standings by wins, then points_for (DoritoStats tiebreaker)
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
        
        print(f"Returning {len(results)} teams")
        if results:
            print(f"First team: {results[0]}")
        
        return jsonify({"playoffOdds": results}), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=True)