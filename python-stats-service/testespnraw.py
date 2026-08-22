import os
from pathlib import Path
import requests
from urllib.parse import unquote
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / '.env')

# ESPN credentials - read from environment instead of being hardcoded
espn_s2 = unquote(os.getenv('ESPN_S2', ''))
swid = os.getenv('SWID', '')

url = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/226912"

cookies = {
    "espn_s2": espn_s2,
    "SWID": swid
}

response = requests.get(url, cookies=cookies, params={"view": "mTeam"})
print(f"Status Code: {response.status_code}")

if response.status_code == 200:
    print("SUCCESS! ESPN accepted the cookies")
    data = response.json()