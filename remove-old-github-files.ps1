# remove-old-github-files.ps1
#
# Run this AFTER "git checkout -f -B main origin/main" has completed successfully.
#
# What this does: removes the old backup/duplicate files that are still tracked
# in your GitHub repo (separate from the local ones already archived) using
# "git rm", which both deletes the file and stages the deletion for your next
# commit. It does NOT touch server.mjs, src/App.jsx, or stats_service.py.
#
# HOW TO RUN: open PowerShell in C:\blitzzz-league (or paste the full path) and run:
#   powershell -ExecutionPolicy Bypass -File "C:\blitzzz-league\remove-old-github-files.ps1"

Set-Location "C:\blitzzz-league"

$filesToRemove = @(
    "ChatGPT server-merged.mjs",
    "fix-server.cjs",
    "python-stats-service/New Text Document.txt",
    "python-stats-service/stats_service - Before New Chat (working but needs SOS and CPS).py",
    "server - CLAUDE 3.1mjs",
    "server-3.5-robust-tz (1).mjs",
    "server-fixed-with-polls (1).mjs",
    "server-fixed-with-polls.mjs",
    "server-merged (1).mjs",
    "server-merged (2).mjs",
    "server-merged (3).mjs",
    "server.jsx",
    "server.mjs - Copy.txt",
    "server.mjs.bak",
    "server.mjs.txt",
    "src/App Online 1.0.jsx",
    "src/App.jsx.txt",
    "src/LandingPage.js",
    "src/components/LandingPage - Copy (2).jsx",
    "src/components/LandingPage - Copy.jsx",
    "src/config/leagueConfigs - CLAUDE 3.0.js",
    "src/dont need index.css",
    "src/styles - CLAUDE 2.jsx",
    "src/styles backup.txt",
    "v37-state-routes.mjs"
)

$removed = 0
$skipped = 0

foreach ($f in $filesToRemove) {
    $result = git rm --ignore-unmatch --quiet -- "$f" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Removed: $f" -ForegroundColor Green
        $removed++
    } else {
        Write-Host "Skipped (not found or already removed): $f" -ForegroundColor Yellow
        $skipped++
    }
}

Write-Host ""
Write-Host "Done. Removed $removed file(s), skipped $skipped." -ForegroundColor Cyan
Write-Host "These removals are staged. Do NOT commit yet - wait for Claude to send you the updated stats_service.py first." -ForegroundColor Cyan
