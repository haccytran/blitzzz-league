import os
import psycopg2
import requests
from urllib.parse import unquote
import time

DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set. Set it in your .env file before running this script.")

# ESPN credentials - read from environment instead of being hardcoded
ESPN_S2 = os.getenv('ESPN_S2', '')
SWID = os.getenv('SWID', '')
LEAGUE_ID = "226912"

def create_player_stats_table():
    """Create table for player statistics if it doesn't exist"""
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS player_stats (
            id SERIAL PRIMARY KEY,
            league_id VARCHAR(20),
            league_year INTEGER,
            week INTEGER,
            team_id INTEGER,
            player_name VARCHAR(255),
            player_id INTEGER,
            position VARCHAR(10),
            slot VARCHAR(20),
            points DECIMAL(10,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    print("✓ Player stats table created")

def fetch_boxscore(year, week):
    """Fetch boxscore data from ESPN for a specific week"""
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{LEAGUE_ID}"
    
    cookies = {
        "espn_s2": unquote(ESPN_S2),
        "SWID": SWID
    }
    
    params = {
        "view": "mBoxscore",
        "scoringPeriodId": week
    }
    
    response = requests.get(url, cookies=cookies, params=params)
    
    if response.status_code != 200:
        print(f"  ✗ Failed to fetch week {week}: HTTP {response.status_code}")
        return None
    
    return response.json()

def get_position_name(position_id):
    """Convert ESPN position ID to position name"""
    positions = {
        0: "QB", 2: "RB", 4: "WR", 6: "TE", 
        16: "D/ST", 17: "K", 20: "Bench"
    }
    return positions.get(position_id, "FLEX")

def import_player_data_for_year(year):
    """Import player data for all weeks of a season"""
    print(f"\n📊 Importing player data for {year}...")
    
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    
    total_players = 0
    
    for week in range(1, 15):  # Weeks 1-14
        print(f"  Week {week}...", end=" ", flush=True)
        
        data = fetch_boxscore(year, week)
        if not data or 'schedule' not in data:
            print("✗ No data")
            continue
        
        week_players = 0
        
        for matchup in data['schedule']:
            if matchup.get('matchupPeriodId') != week:
                continue
            
            # Process both home and away teams
            for side in ['home', 'away']:
                team_data = matchup.get(side)
                if not team_data:
                    continue
                
                team_id = team_data.get('teamId')
                roster = team_data.get('rosterForCurrentScoringPeriod', {}).get('entries', [])
                
                for entry in roster:
                    player = entry.get('playerPoolEntry', {}).get('player', {})
                    player_id = player.get('id')
                    player_name = player.get('fullName', 'Unknown')
                    position_id = player.get('defaultPositionId')
                    slot_id = entry.get('lineupSlotId')
                    
                    # Get points for this specific week
                    stats = player.get('stats', [])
                    points = 0
                    for stat in stats:
                        if stat.get('scoringPeriodId') == week and stat.get('statSourceId') == 0:
                            points = stat.get('appliedTotal', 0)
                            break
                    
                    # Insert into database
                    cur.execute("""
                        INSERT INTO player_stats 
                        (league_id, league_year, week, team_id, player_name, player_id, position, slot, points)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        LEAGUE_ID, year, week, team_id, player_name, player_id,
                        get_position_name(position_id),
                        get_position_name(slot_id),
                        points
                    ))
                    
                    week_players += 1
        
        conn.commit()
        print(f"✓ {week_players} players")
        total_players += week_players
        
        time.sleep(0.5)  # Rate limiting
    
    cur.close()
    conn.close()
    
    print(f"✓ Year {year} complete: {total_players} total player records")

def main():
    print("🏈 ESPN Player Data Importer")
    print("=" * 50)
    
    # Create table
    create_player_stats_table()
    
    # Import data for each year
    years = [2019, 2020, 2021, 2022, 2023, 2024, 2025]
    
    for year in years:
        import_player_data_for_year(year)
        time.sleep(1)
    
    print("\n✅ All player data imported successfully!")

if __name__ == "__main__":
    main()