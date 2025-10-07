import requests
from urllib.parse import unquote

# Your fresh cookies
espn_s2 = unquote("AEBajs7sNZne74Zi%2FchVZW4UjLd7tIss%2FnGhSx3ZCF2fXy6%2BSf0YPn%2FvAjHYWCw3dI778IewOM0XsaKZRm9h6a0VV2yN2KOTTHYBJfMlUBCyj0U5%2Fuykvvch%2BHnvbulqbwm5DBb%2FWrt1sQJlQus1ZVKwSfA%2F2xnvnap%2BwXSwQ9Sdel%2FBpO0c%2BH4o%2F6sdgmpClUR%2Baym6ApwEREbu%2FU%2B%2BCtJsWojQL6VolllCwTkOFZrcZArIufJC3mqfiSQj0cSVgtmujwEQrGYBiX5Pqah60Hiw")
swid = "{24083333-3B45-4857-8833-333B455857BD}"

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