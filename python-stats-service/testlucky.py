import requests

response = requests.post('http://localhost:5001/luck-index', json={
    'leagueId': '226912',
    'year': '2025',
    'currentWeek': 4
})

print(f"Status: {response.status_code}")
if response.status_code == 200:
    print("SUCCESS!")
    print(response.json())
else:
    print(f"ERROR: {response.text}")