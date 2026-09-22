"""
fix_player_positions.py

WHY THIS EXISTS: import_players.py stored each player's position using a
wrong ESPN position-ID table. The real ESPN defaultPositionId values are
1=QB, 2=RB, 3=WR, 4=TE, 5=K, 16=D/ST (confirmed against ESPN's live
mBoxscore data on 2026-09-22). The old table in import_players.py's
get_position_name() was:
    {0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST", 17: "K"}
- QB (real id 1) wasn't in the table at all, so every QB fell through to
  the "FLEX" default.
- WR (real id 3) wasn't in the table either - same FLEX fallback.
- K (real id 5) wasn't in the table - same FLEX fallback.
- TE (real id 4) WAS in the table, but pointed at "WR" (4 is TE's real id,
  not WR's) - so every real tight end got stored with position='WR'
  instead of 'TE'.
- RB (2) and D/ST (16) happened to be correct.

WHY IT MATTERS: /#nerddata's "Season Positional Records" table reads
`position` straight out of this table. With the above bug, it can never
find a QB, WR, or K record (nothing is ever stored under those labels),
and shows N/A for all three. Its "WR" record was actually showing whichever
tight end scored the most in this data - not a wide receiver at all.

WHAT THIS SCRIPT DOES, IN ORDER:
  1. Reports how many player_stats rows currently sit under each position
     label (read-only, safe).
  2. Looks up every distinct player_id in the table against ESPN's live
     player list (kona_player_info) to get each player's real, current
     defaultPositionId. A player's real-life position (QB/RB/WR/TE/K) is
     essentially permanent, so today's ESPN data is a safe source of truth
     for correcting rows imported for any past season.
  3. Updates every player_stats row whose stored position doesn't match
     what ESPN says it should be.
  4. Re-reports the counts so you can see the shift (WR should drop, QB/K
     should now have rows, TE should gain the rows that were wrongly under
     WR).

This DOES modify your live database. It only rewrites the `position`
column using ESPN's own data - it does not touch scores, weeks, teams, or
any other column, and it does not add or remove rows. Still, it's a real
change, so it prints what it's about to do and asks you to press Enter
before it commits anything.

Player IDs it can't find on ESPN (very old/inactive players ESPN no longer
lists, or D/ST rows which use negative IDs and are already correct) are
left untouched and reported at the end, in case any need a manual look.

HOW TO RUN THIS (copy/paste):
  1. Terminal (PowerShell) in the blitzzz-league folder.
  2. cd python-stats-service
  3. python fix_player_positions.py
  4. Read what it prints, then press Enter when it asks to confirm.
  5. Paste the full output back into the chat.
"""
import os
from pathlib import Path
from urllib.parse import unquote

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / '.env')

DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set. Set it in your .env file before running this script.")

ESPN_S2 = os.getenv('ESPN_S2', '')
SWID = os.getenv('SWID', '')
LEAGUE_ID = '226912'  # Blitzzz
SEASON_FOR_LOOKUP = 2026  # any active season works - defaultPositionId is a player attribute, not season-specific

# The correct mapping (see docstring above).
CORRECT_POSITION = {1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST'}


def print_header(title):
    print(f"\n{'=' * 60}")
    print(title)
    print('=' * 60)


def report_counts(cur, title):
    print_header(title)
    cur.execute("""
        SELECT position, COUNT(*) AS rows
        FROM player_stats
        GROUP BY position
        ORDER BY position
    """)
    for position, count in cur.fetchall():
        print(f"  {position or '(null)'}: {count} rows")


def fetch_espn_positions():
    """Fetch every player ESPN currently knows about (not just the ~50 it
    returns by default), with their real defaultPositionId, via the same
    kona_player_info view stats_service.py already uses elsewhere.

    2026-09-22: the first version of this script called kona_player_info
    with no filter, which ESPN silently caps at 50 players - that's why the
    first run only matched 13 of 553 mismatched players. The fix is the
    X-Fantasy-Filter header below, which tells ESPN to return every player
    (limit 3000, well above the ~2000 that exist in an NFL player pool) sorted
    by total points so real, ever-rostered players come back reliably."""
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{SEASON_FOR_LOOKUP}/segments/0/leagues/{LEAGUE_ID}"
    cookies = {"espn_s2": unquote(ESPN_S2), "SWID": SWID}
    params = {"view": "kona_player_info"}
    headers = {
        "X-Fantasy-Filter": (
            '{"players":{"limit":3000,'
            '"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}'
        )
    }
    response = requests.get(url, cookies=cookies, params=params, headers=headers)
    if response.status_code != 200:
        raise RuntimeError(f"ESPN API returned HTTP {response.status_code} for kona_player_info")

    data = response.json()
    positions_by_id = {}
    for entry in data.get('players', []):
        player = entry.get('player', {})
        player_id = player.get('id')
        pos_id = player.get('defaultPositionId')
        if player_id is not None and pos_id in CORRECT_POSITION:
            positions_by_id[player_id] = CORRECT_POSITION[pos_id]
    return positions_by_id


def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    report_counts(cur, "player_stats position counts BEFORE fix")

    print("\nFetching live player position data from ESPN...")
    espn_positions = fetch_espn_positions()
    print(f"Got position data for {len(espn_positions)} players from ESPN.")

    cur.execute("""
        SELECT DISTINCT player_id, position
        FROM player_stats
        WHERE player_id IS NOT NULL AND player_id > 0
    """)
    stored = cur.fetchall()

    to_fix = []       # (player_id, old_position, new_position)
    not_found = set()
    for player_id, old_position in stored:
        new_position = espn_positions.get(player_id)
        if new_position is None:
            not_found.add(player_id)
            continue
        if new_position != old_position:
            to_fix.append((player_id, old_position, new_position))

    if not to_fix:
        print("\nNo mismatches found. Nothing to fix.")
        if not_found:
            print(f"({len(not_found)} player_ids in the table weren't found on ESPN's current "
                  f"player list and were left untouched - likely old/inactive players.)")
        cur.close()
        conn.close()
        return

    print(f"\nFound {len(to_fix)} distinct players whose stored position disagrees with ESPN.")
    print("Examples (player_id, stored position -> correct position):")
    for player_id, old_position, new_position in to_fix[:10]:
        print(f"  {player_id}: {old_position!r} -> {new_position!r}")
    if len(to_fix) > 10:
        print(f"  ...and {len(to_fix) - 10} more.")
    if not_found:
        print(f"\n{len(not_found)} player_ids weren't found on ESPN's current player list "
              f"and will be left untouched (likely old/inactive players).")

    answer = input("\nType 'yes' and press Enter to update these rows in the database: ").strip().lower()
    if answer != 'yes':
        print("Cancelled - no changes made.")
        cur.close()
        conn.close()
        return

    total_rows_updated = 0
    for player_id, _old_position, new_position in to_fix:
        cur.execute("""
            UPDATE player_stats
            SET position = %s
            WHERE player_id = %s
        """, (new_position, player_id))
        total_rows_updated += cur.rowcount

    conn.commit()
    print(f"\nUpdated {total_rows_updated} rows across {len(to_fix)} players.")

    report_counts(cur, "player_stats position counts AFTER fix")

    cur.close()
    conn.close()
    print("\nDone. Paste all of the above back into the chat.")


if __name__ == "__main__":
    main()
