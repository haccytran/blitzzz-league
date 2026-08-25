"""
check_current_week.py

READ-ONLY diagnostic - makes one request to ESPN, prints what comes back,
changes nothing.

WHY: we want to switch the site from guessing "week 1 = first Wednesday of
September" to just asking ESPN directly what week it currently thinks the
season is on (ESPN tracks the real NFL schedule, so it's always right,
every year, automatically). Before building that, we need to see what ESPN
actually reports for the 2026 season RIGHT NOW - since the season hasn't
started yet, this checks whether ESPN's "current week" field already makes
sense pre-season, or needs a fallback until the season actually begins.

HOW TO RUN THIS (copy/paste):
  1. Terminal (PowerShell) in the blitzzz-league folder.
  2. cd python-stats-service
  3. python check_current_week.py
  4. Paste back everything it prints.
"""
import os
from pathlib import Path
import requests
from urllib.parse import unquote
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / '.env')

ESPN_S2 = unquote(os.getenv('ESPN_S2', ''))
SWID = os.getenv('SWID', '')
LEAGUE_ID = 226912  # Blitzzz


def check_season(year):
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{LEAGUE_ID}"
    cookies = {"espn_s2": ESPN_S2, "SWID": SWID}
    params = {"view": ["mSettings", "mTeam"]}

    print(f"\n{'=' * 60}")
    print(f"Season {year}")
    print('=' * 60)

    r = requests.get(url, cookies=cookies, params=params)
    print(f"HTTP status: {r.status_code}")

    if r.status_code != 200:
        print("Did not get a successful response - snippet below:")
        print(r.text[:300])
        return

    data = r.json()
    status = data.get('status', {})

    print("Raw 'status' block from ESPN:")
    for key, value in status.items():
        print(f"  {key}: {value}")

    print(f"\nTop-level 'scoringPeriodId': {data.get('scoringPeriodId')}")
    print(f"Top-level 'seasonId': {data.get('seasonId')}")

    settings = data.get('settings', {})
    schedule_settings = settings.get('scheduleSettings', {})
    print(f"\nRegular season weeks (matchupPeriodCount): {schedule_settings.get('matchupPeriodCount')}")
    print(f"Playoff spots (playoffTeamCount): {schedule_settings.get('playoffTeamCount')}")


if __name__ == "__main__":
    print("Checking what ESPN currently reports for Blitzzz (226912)...")
    check_season(2026)  # the season we actually care about right now
    check_season(2025)  # last season, for comparison - should look "finished"
