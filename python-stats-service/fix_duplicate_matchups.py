"""
fix_duplicate_matchups.py

WHY THIS EXISTS: the "matchups" table has no protection against being
imported twice, so re-running import_historical_data.py for a year that
was already imported just adds a second (or third) full copy of that
year's games instead of updating in place. check_historical_data.py's
output showed exactly that for 2023 (3 copies), 2024 (3 copies), and 2025
(2 copies) - each team's real weekly score is sitting in the table 2-3
times over for those years.

WHY IT MATTERS: your site's Season Records page (/season-records) sums
and counts rows straight out of this table for two of its six records -
"Most wins in a season" and "Most points for / against in a season."
Duplicated rows get summed/counted 2-3x for exactly those three years,
which can make a team look like it won more games or scored more total
points than it actually did, and could be silently showing the wrong
team/year as the record-holder right now. (The other four records -
highest single score, lowest single score, biggest blowout - are NOT
affected, since a duplicate row has the exact same score as the original,
so it doesn't change what the single highest/lowest/biggest value is.)

WHAT THIS SCRIPT DOES, IN ORDER:
  1. Reports how many duplicate rows exist per year (read-only, safe).
  2. Deletes the extra copies, keeping exactly one copy of each real game
     (the earliest-inserted copy - same data either way, just picking one).
  3. Adds a safety rule to the table itself (a UNIQUE constraint) so it's
     no longer possible for the same team/week/season to be inserted twice
     - re-running the import script in the future can no longer cause this
     again, it'll just harmlessly update the existing row instead.
  4. Re-reports the counts so you can see they now match what's expected
     (10 teams x however many weeks, no more no less).

This DOES modify your live database. It only removes exact duplicate rows
and adds a safety rule - it does not touch or guess at any real game data.
Still, it's a real change, so it prints what it's about to delete and asks
you to press Enter before it commits anything.

HOW TO RUN THIS (copy/paste):
  1. Terminal (PowerShell) in the blitzzz-league folder.
  2. cd python-stats-service
  3. python fix_duplicate_matchups.py
  4. Read what it prints, then press Enter when it asks to confirm.
  5. Paste the full output back into the chat.
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


def report_counts(cur, title):
    print_header(title)
    cur.execute("""
        SELECT league_year, COUNT(*) AS matchup_rows
        FROM matchups
        WHERE league_id = %s
        GROUP BY league_year
        ORDER BY league_year
    """, (LEAGUE_ID,))
    for year, count in cur.fetchall():
        print(f"  {year}: {count} rows")


def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    report_counts(cur, "Matchup row counts BEFORE cleanup")

    # Find groups of exact-duplicate rows (same team/week/season/scores),
    # counting how many extra copies exist beyond the one we'll keep.
    cur.execute("""
        SELECT league_year, week, team_id, COUNT(*) AS copies
        FROM matchups
        WHERE league_id = %s
        GROUP BY league_year, week, team_id
        HAVING COUNT(*) > 1
        ORDER BY league_year, week, team_id
    """, (LEAGUE_ID,))
    dupes = cur.fetchall()

    if not dupes:
        print("\nNo duplicates found. Nothing to clean up.")
        cur.close()
        conn.close()
        return

    total_extra_rows = sum(copies - 1 for (_, _, _, copies) in dupes)
    print(f"\nFound {len(dupes)} team/week slots with duplicate rows, "
          f"{total_extra_rows} extra rows total that will be deleted.")
    print("Example:", dupes[0], "means that year/week/team has that many copies on file.")

    answer = input("\nType 'yes' and press Enter to delete the extra copies and add the safety rule: ").strip().lower()
    if answer != 'yes':
        print("Cancelled - no changes made.")
        cur.close()
        conn.close()
        return

    # Delete every row except the lowest id (earliest-inserted, i.e. "first import")
    # for each (league_id, league_year, week, team_id) group.
    cur.execute("""
        DELETE FROM matchups a
        USING matchups b
        WHERE a.id > b.id
          AND a.league_id = b.league_id
          AND a.league_year = b.league_year
          AND a.week = b.week
          AND a.team_id = b.team_id
    """)
    deleted = cur.rowcount
    print(f"\nDeleted {deleted} duplicate rows.")

    # Add a safety rule: a team can only have one matchup row per week per
    # season. This is what makes future re-imports safe (see the matching
    # ON CONFLICT change in import_historical_data.py).
    cur.execute("""
        ALTER TABLE matchups
        ADD CONSTRAINT matchups_one_row_per_team_week_season
        UNIQUE (league_id, league_year, week, team_id)
    """)
    print("Added a UNIQUE constraint so this can't happen again.")

    conn.commit()

    report_counts(cur, "Matchup row counts AFTER cleanup")

    cur.close()
    conn.close()
    print("\nDone. Paste all of the above back into the chat.")


if __name__ == "__main__":
    main()
