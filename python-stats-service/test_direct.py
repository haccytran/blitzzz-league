import requests

# Test direct ESPN API call
league_id = 226912
year = 2025
espn_s2 = "AEAYl663wD7uyx9v7kiBOtJKx9FGl6eMF7Hy55jy5NXqAaaymIsMkaObt%2BQJDhBfj%2FKbryigU22mR9AQvZTWWi8%2BFXCkV%2BIqHmC7cZn5d5LAqmUPQNVYfHGfDGXmeJ5Jn6F%2BMSNxpiBrEQkJnqseiwFG0cHEQw3K1Lw2JmDpCH%2FTSRfM6z6qMDwBlaozCiXY5MFw75JPorKg%2FlI7zBdACQVPbUzhVOBqfnAHEA9qrYfRbicgBxF9KdHhZOsjDuEum3mzGZ6bwiZ0%2Bg6m0sDV2Mhr"  # Paste your actual cookie
swid = "{24083333-3B45-4857-8833-333B455857BD}"

url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"

cookies = {
    "espn_s2": espn_s2,
    "SWID": swid
}

params = {
    "view": "mTeam"
}

response = requests.get(url, cookies=cookies, params=params)
print(f"Status: {response.status_code}")
print(f"Response length: {len(response.text)}")

if response.status_code == 200:
    print("SUCCESS - ESPN API is accessible")
    data = response.json()
    print(f"Teams found: {len(data.get('teams', []))}")
else:
    print(f"FAILED - {response.text[:200]}")