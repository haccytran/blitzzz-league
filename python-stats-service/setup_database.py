import psycopg2

DB_URL = "postgresql://neondb_owner:npg_2RpxLi7PZYAH@ep-summer-grass-afx8wu4n.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require"

def setup_schema():
    """Create all necessary tables"""
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    
    # Leagues table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS leagues (
            id SERIAL PRIMARY KEY,
            league_id VARCHAR(20) NOT NULL,
            league_year INTEGER NOT NULL,
            league_name VARCHAR(100),
            regular_season_weeks INTEGER DEFAULT 14,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(league_id, league_year)
        );
    """)
    
    # Teams table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS teams (
            id SERIAL PRIMARY KEY,
            league_id VARCHAR(20) NOT NULL,
            league_year INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            team_name VARCHAR(100),
            owner_name VARCHAR(100),
            UNIQUE(league_id, league_year, team_id)
        );
    """)
    
    # Matchups table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS matchups (
            id SERIAL PRIMARY KEY,
            league_id VARCHAR(20) NOT NULL,
            league_year INTEGER NOT NULL,
            week INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            opponent_id INTEGER,
            team_score DECIMAL(6,2),
            opponent_score DECIMAL(6,2),
            is_home BOOLEAN,
            outcome VARCHAR(1),
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)
    
    # Weekly stats table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS weekly_stats (
            id SERIAL PRIMARY KEY,
            league_id VARCHAR(20) NOT NULL,
            league_year INTEGER NOT NULL,
            week INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            points_for DECIMAL(6,2),
            points_against DECIMAL(6,2),
            optimal_points DECIMAL(6,2),
            lineup_efficiency DECIMAL(5,2),
            bench_points DECIMAL(6,2),
            inactive_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)
    
    # Season records table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS season_records (
            id SERIAL PRIMARY KEY,
            league_id VARCHAR(20) NOT NULL,
            record_type VARCHAR(50) NOT NULL,
            league_year INTEGER NOT NULL,
            team_id INTEGER NOT NULL,
            team_name VARCHAR(100),
            value DECIMAL(10,2),
            week INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)
    
    conn.commit()
    cur.close()
    conn.close()
    print("✓ Database schema created successfully")

if __name__ == "__main__":
    setup_schema()