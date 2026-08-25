"""
check_historical_data.py

A READ-ONLY diagnostic script - it does not change anything in the database
or on ESPN. It just reports what's actually sitting in the historical
Postgres tables right now, broken down by year, so we know for certain
whether the old import_historical_data.py / import_players.py runs actually
captured data for each season (and how much), instead of guessing.

HOW TO RUN THIS (copy/paste):
  1. Open a terminal (PowerShell) in the blitzzz-league folder.
  2. Run:
       cd python-stats-service
       python check_historical_data.py
  3. Copy everything it prints and paste it back into the chat.
"""
import os
from pathlib import Path
import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / '.env')

DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set. Set it in your .env file before running this script.")

LEAGUE_ID = '226912'  # Blitzzz


def print_header(title):
    print(f"\n{'=' * 60}")
    print(title)
    print('=' * 60)


def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    print_header("leagues table - one row per season ESPN successfully returned data for")
    cur.execute("""
        SELECT league_year, league_name, regular_season_weeks
        FROM leagues
        WHERE league_id = %s
        ORDER BY league_year
    """, (LEAGUE_ID,))
    rows = cur.fetchall()
    if not rows:
        print("  (no rows at all - this table is empty for Blitzzz)")
    for year, name, weeks in rows:
        print(f"  {year}: \"{name}\" - {weeks} regular season weeks on record")

    print_header("teams table - team/owner rows per season")
    cur.execute("""
        SELECT league_year, COUNT(*) AS team_count
        FROM teams
        WHERE league_id = %s
        GROUP BY league_year
        ORDER BY league_year
    """, (LEAGUE_ID,))
    rows = cur.fetchall()
    if not rows:
        print("  (no rows at all)")
    for year, count in rows:
        print(f"  {year}: {count} teams")

    print_header("matchups table - REGULAR SEASON only (playoffs were never imported here)")
    cur.execute("""
        SELECT league_year, COUNT(*) AS matchup_rows, MIN(week) AS first_week, MAX(week) AS last_week
        FROM matchups
        WHERE league_id = %s
        GROUP BY league_year
        ORDER BY league_year
    """, (LEAGUE_ID,))
    rows = cur.fetchall()
    if not rows:
        print("  (no rows at all)")
    for year, count, first_week, last_week in rows:
        print(f"  {year}: {count} matchup rows, weeks {first_week}-{last_week}")

    print_header("player_stats table - per-player weekly points")
    cur.execute("""
        SELECT league_year, COUNT(*) AS row_count, MIN(week) AS first_week, MAX(week) AS last_week
        FROM player_stats
        WHERE league_id = %s
        GROUP BY league_year
        ORDER BY league_year
    """, (LEAGUE_ID,))
    rows = cur.fetchall()
    if not rows:
        print("  (no rows at all)")
    for year, count, first_week, last_week in rows:
        print(f"  {year}: {count} player rows, weeks {first_week}-{last_week}")

    print_header("season_records table - NOTE: nothing in the current code ever writes to this table")
    cur.execute("""
        SELECT league_year, COUNT(*) AS row_count
        FROM season_records
        WHERE league_id = %s
        GROUP BY league_year
        ORDER BY league_year
    """, (LEAGUE_ID,))
    rows = cur.fetchall()
    if not rows:
        print("  (no rows - confirmed empty/unused, as expected)")
    for year, count in rows:
        print(f"  {year}: {count} rows")

    cur.close()
    conn.close()
    print("\nDone. Paste all of the above back into the chat.")


if __name__ == "__main__":
    main()
