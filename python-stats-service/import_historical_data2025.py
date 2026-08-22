import os
import psycopg2
from espn_api.football import League
from urllib.parse import unquote

# ESPN credentials - read from environment instead of being hardcoded
ESPN_S2 = unquote(os.getenv('ESPN_S2', ''))
SWID = os.getenv('SWID', '')
LEAGUE_ID = 226912
DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set. Set it in your .env file before running this script.")

def import_season(year):
    """Import all data for a single season"""
    print(f"\n{'='*50}")
    print(f"Importing {year} season...")
    print(f"{'='*50}")
    
    try:
        # Connect to ESPN
        print(f"Connecting to ESPN API for year {year}...")
        league = League(
            league_id=LEAGUE_ID,
            year=year,
            espn_s2=ESPN_S2,
            swid=SWID
        )
        print(f"✓ Connected successfully")
        print(f"  League: {league.settings.name}")
        print(f"  Teams: {len(league.teams)}")
        print(f"  Regular season weeks: {league.settings.reg_season_count}")
        
    except Exception as e:
        print(f"✗ Failed to connect to ESPN API: {e}")
        return False
    
    try:
        # Connect to database
        print(f"\nConnecting to database...")
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        print(f"✓ Database connected")
        
        # Insert league info
        print(f"\nInserting league info...")
        cur.execute("""
            INSERT INTO leagues (league_id, league_year, league_name, regular_season_weeks)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (league_id, league_year) DO UPDATE
            SET league_name = EXCLUDED.league_name,
                regular_season_weeks = EXCLUDED.regular_season_weeks
        """, (str(LEAGUE_ID), year, league.settings.name, league.settings.reg_season_count))
        print(f"✓ League info inserted")
        
        # Import teams
        print(f"\nInserting teams...")
        for team in league.teams:
            # owners is a list, get first owner or use 'Unknown'
            owner = team.owners[0]['firstName'] + ' ' + team.owners[0]['lastName'] if team.owners else 'Unknown'
            cur.execute("""
                INSERT INTO teams (league_id, league_year, team_id, team_name, owner_name)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (league_id, league_year, team_id) DO UPDATE
                SET team_name = EXCLUDED.team_name, owner_name = EXCLUDED.owner_name
            """, (str(LEAGUE_ID), year, team.team_id, team.team_name, owner))
            print(f"  ✓ {team.team_name} ({owner})")
        
        # Import matchups for each week
        print(f"\nInserting matchups...")
        matchup_count = 0
        for week in range(1, league.settings.reg_season_count + 1):
            try:
                box_scores = league.box_scores(week)
                
                for matchup in box_scores:
                    if not matchup.home_team or not matchup.away_team:
                        continue
                    
                    # Home team
                    cur.execute("""
                        INSERT INTO matchups (league_id, league_year, week, team_id, opponent_id, 
                                            team_score, opponent_score, is_home, outcome)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        str(LEAGUE_ID), year, week, matchup.home_team.team_id, matchup.away_team.team_id,
                        matchup.home_score, matchup.away_score, True,
                        'W' if matchup.home_score > matchup.away_score else 
                        'L' if matchup.home_score < matchup.away_score else 'T'
                    ))
                    
                    # Away team
                    cur.execute("""
                        INSERT INTO matchups (league_id, league_year, week, team_id, opponent_id,
                                            team_score, opponent_score, is_home, outcome)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        str(LEAGUE_ID), year, week, matchup.away_team.team_id, matchup.home_team.team_id,
                        matchup.away_score, matchup.home_score, False,
                        'W' if matchup.away_score > matchup.home_score else
                        'L' if matchup.away_score < matchup.home_score else 'T'
                    ))
                    
                    matchup_count += 2
                
                print(f"  ✓ Week {week}")
                
            except Exception as e:
                print(f"  ✗ Week {week} failed: {e}")
        
        print(f"\n✓ Total matchups inserted: {matchup_count}")
        
        conn.commit()
        cur.close()
        conn.close()
        print(f"\n{'='*50}")
        print(f"✓ {year} imported successfully!")
        print(f"{'='*50}\n")
        return True
        
    except Exception as e:
        print(f"\n✗ Database error: {e}")
        return False

if __name__ == "__main__":
    # Test just 2025
    if import_season(2025):
        print("Success! Cookie works")
    else:
        print("Failed - cookie expired or invalid")