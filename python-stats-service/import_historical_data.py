import psycopg2
from espn_api.football import League
from urllib.parse import unquote

# Your credentials (URL decoded)
ESPN_S2 = unquote("AEBajs7sNZne74Zi%2FchVZW4UjLd7tIss%2FnGhSx3ZCF2fXy6%2BSf0YPn%2FvAjHYWCw3dI778IewOM0XsaKZRm9h6a0VV2yN2KOTTHYBJfMlUBCyj0U5%2Fuykvvch%2BHnvbulqbwm5DBb%2FWrt1sQJlQus1ZVKwSfA%2F2xnvnap%2BwXSwQ9Sdel%2FBpO0c%2BH4o%2F6sdgmpClUR%2Baym6ApwEREbu%2FU%2B%2BCtJsWojQL6VolllCwTkOFZrcZArIufJC3mqfiSQj0cSVgtmujwEQrGYBiX5Pqah60Hiw")
SWID = "{24083333-3B45-4857-8833-333B455857BD}"
LEAGUE_ID = 226912
DB_URL = "postgresql://neondb_owner:npg_2RpxLi7PZYAH@ep-summer-grass-afx8wu4n.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require"

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
    # Test how far back we can go
    START_YEAR = 2015  # ESPN Fantasy started around 2015 for most leagues
    END_YEAR = 2025
    
    print("Testing historical data availability...")
    print(f"Attempting to import years {START_YEAR} to {END_YEAR}\n")
    
    successful = []
    failed = []
    
    for year in range(START_YEAR, END_YEAR + 1):
        print(f"\nAttempting year {year}...")
        if import_season(year):
            successful.append(year)
        else:
            failed.append(year)
            print(f"Year {year} failed - league may not exist for this year")
    
    print("\n" + "="*50)
    print("IMPORT SUMMARY")
    print("="*50)
    print(f"✓ Successful years: {successful}")
    if failed:
        print(f"✗ Failed years: {failed}")
    print(f"\nTotal seasons imported: {len(successful)}")
    print("="*50)