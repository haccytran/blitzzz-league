import requests

response = requests.post(
    'http://localhost:8787/api/leagues/blitzzz/weekly-awards/2025',
    params={'week': 4}
)

print(response.json())