# archive-old-files.ps1
#
# What this does: moves your old "revision copy" files (the server - CLAUDE 2.4.mjs,
# App - VERSION 3.5.jsx, etc. style backups) into a new folder called _archive,
# organized the same way they are now. It does NOT touch server.mjs, src/App.jsx,
# or any other file that's currently in active use. It does NOT touch node_modules,
# your .env file, or anything in the data folder.
#
# Nothing gets deleted - files are only moved into _archive so your project folder
# is easier to look at, but you can still get any old version back later.
#
# HOW TO RUN THIS:
# 1. Save this file directly inside C:\blitzzz-league (it may already be there if
#    Claude placed it for you).
# 2. Right-click the Windows Start button -> "Windows PowerShell" (or search for
#    "PowerShell" in the Start menu and open it).
# 3. Copy and paste this single line, then press Enter:
#    powershell -ExecutionPolicy Bypass -File "C:\blitzzz-league\archive-old-files.ps1"
# 4. Watch the messages that scroll by - it will tell you how many files it moved,
#    and list anything it could not find (that's OK, just means it was already moved
#    or renamed).

$base = "C:\blitzzz-league"
$archive = Join-Path $base "_archive"

if (-not (Test-Path $base)) {
    Write-Host "Could not find $base - is this the right computer/folder?" -ForegroundColor Red
    exit
}

# Files to archive, grouped by the sub-folder they currently live in (relative to $base)
$filesByFolder = @{
    "" = @(
        "ChatGPT server-merged.mjs",
        "et --hard HEAD@{1}",
        "fix-server.cjs",
        "server - before attempt dues fix.mjs",
        "server - before Auto Refresh Neon compute fix.mjs",
        "server - before backup waiver claim fix.mjs",
        "server - Before Billable play off adds fix.mjs",
        "server - CLAUDE 1.0.mjs",
        "server - CLAUDE 1.1.mjs",
        "server - CLAUDE 1.2.mjs",
        "server - CLAUDE 1.3.mjs",
        "server - CLAUDE 1.5.mjs",
        "server - CLAUDE 1.6.mjs",
        "server - CLAUDE 1.7.mjs",
        "server - CLAUDE 1.8.mjs",
        "server - CLAUDE 1.9.mjs",
        "server - CLAUDE 2.0.mjs",
        "server - CLAUDE 2.2.mjs",
        "server - CLAUDE 2.3.mjs",
        "server - CLAUDE 2.4.mjs",
        "server - CLAUDE 3.0.mjs",
        "server - CLAUDE 3.1mjs",
        "server - CLAUDE 3.2.mjs",
        "server - CLAUDE 3.3.mjs",
        "server - CLAUDE 3.5.mjs",
        "server - CLAUDE Before new chat.mjs",
        "server - CLAUDE TEMP.mjs",
        "server - Claude unfinished script.mjs",
        "server - Copy (10).mjs",
        "server - Copy (11).mjs",
        "server - Copy (2).mjs",
        "server - Copy (3).mjs",
        "server - Copy (4).mjs",
        "server - Copy (5).mjs",
        "server - Copy (6).mjs",
        "server - Copy (7).mjs",
        "server - Copy (8).mjs",
        "server - Copy (9).mjs",
        "server - Copy.mjs",
        "server - Error Free Fetching.mjs",
        "server - Gemini combined.mjs",
        "server - LAST CLAUDE.mjs",
        "server - Last rendition from chatGPT.mjs",
        "server - Online 1.0.mjs",
        "server - VERSION 2.5.mjs",
        "server - VERSION 2.6.mjs",
        "server - VERSION 2.7.mjs",
        "server - VERSION 2.8.mjs",
        "server - VERSION 2.9.mjs",
        "server - VERSION 2.mjs",
        "server - VERSION 3.0.mjs",
        "server - VERSION 3.1.mjs",
        "server - VERSION 3.2.mjs",
        "server - VERSION 3.3.mjs",
        "server - VERSION 3.4.mjs",
        "server - VERSION 3.5 - Final Desktop Version - Copy - Copy.mjs",
        "server - VERSION 3.5.mjs",
        "server - VERSION 3.6.mjs",
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
        "v37-state-routes.mjs"
    )
    "src" = @(
        "1)Let's make the following changes.txt",
        "App - before billable adds playoffs fix.jsx",
        "App - Before fixing recent activity.jsx",
        "App - Before Trophy Case.jsx",
        "App - CLAUDE 1.0.jsx",
        "App - CLAUDE 1.1.jsx",
        "App - CLAUDE 1.2.jsx",
        "App - CLAUDE 1.3.jsx",
        "App - CLAUDE 1.5.jsx",
        "App - CLAUDE 1.6.jsx",
        "App - CLAUDE 1.7.jsx",
        "App - CLAUDE 1.8.jsx",
        "App - CLAUDE 1.9.jsx",
        "App - CLAUDE 2.0.jsx",
        "App - CLAUDE 2.2.jsx",
        "App - CLAUDE 2.3.jsx",
        "App - CLAUDE 2.4.jsx",
        "App - CLAUDE 2.9.jsx",
        "App - CLAUDE 3.0.jsx",
        "App - CLAUDE 3.1.jsx",
        "App - CLAUDE 3.2.jsx",
        "App - CLAUDE 3.3.jsx",
        "App - CLAUDE 3.4.jsx",
        "App - CLAUDE 3.5.jsx",
        "App - CLAUDE Before new chat.jsx",
        "App - CLAUDE TEMP.jsx",
        "App - Copy (10).jsx",
        "App - Copy (2).jsx",
        "App - Copy (3).jsx",
        "App - Copy (4).jsx",
        "App - Copy (5).jsx",
        "App - Copy (6).jsx",
        "App - Copy (7).jsx",
        "App - Copy (8).jsx",
        "App - Copy (9).jsx",
        "App - Copy.jsx",
        "App - needs fix hood trophies before chad.jsx",
        "App - pre-Overachievers underachievers.jsx",
        "App - season leaders table needs fixed.jsx",
        "App - VERSION 2.5.jsx",
        "App - VERSION 2.6.jsx",
        "App - VERSION 2.7.jsx",
        "App - VERSION 2.8.jsx",
        "App - VERSION 2.9.jsx",
        "App - VERSION 2.jsx",
        "App - VERSION 3.0.jsx",
        "App - VERSION 3.1.jsx",
        "App - VERSION 3.2.jsx",
        "App - VERSION 3.3.jsx",
        "App - VERSION 3.4.jsx",
        "App - VERSION 3.5 - Final Desktop Version.jsx",
        "App - VERSION 3.5 - Final Mobile Version.jsx",
        "App - VERSION 3.6.jsx",
        "App Online 1.0.jsx",
        "App.jsx.txt",
        "dont need index.css",
        "LandingPage.js",
        "styles - CLAUDE 1.0.css",
        "styles - CLAUDE 2.css",
        "styles - CLAUDE 2.jsx",
        "styles - CLAUDE 3.0.css",
        "styles - CLAUDE 3.1.css",
        "styles - CLAUDE 3.2.css",
        "styles - CLAUDE 3.3.css",
        "styles - CLAUDE 3.4.css",
        "styles - CLAUDE 3.5.css",
        "styles - Copy.css",
        "styles - VERSION 3.3.css",
        "styles - VERSION 3.4.css",
        "styles - VERSION 3.5 - Final Desktop Version.css",
        "styles - VERSION 3.5 - Final Mobile Version.css",
        "styles - VERSION 3.6.css",
        "styles backup.txt"
    )
    "src\components" = @(
        "LandingPage - Copy (2).jsx",
        "LandingPage - Copy.jsx"
    )
    "src\config" = @(
        "leagueConfigs - CLAUDE 3.0.js"
    )
    "python-stats-service" = @(
        "New Text Document.txt",
        "stats_service - Before New Chat (working but needs SOS and CPS).py",
        "stats_service - works with SOS Locally not webhosted.py"
    )
}

$movedCount = 0
$missingCount = 0
$missingList = @()

foreach ($folder in $filesByFolder.Keys) {
    $sourceFolder = if ($folder -eq "") { $base } else { Join-Path $base $folder }
    $destFolder = if ($folder -eq "") { Join-Path $archive "root" } else { Join-Path $archive $folder }

    if (-not (Test-Path $destFolder)) {
        New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
    }

    foreach ($fileName in $filesByFolder[$folder]) {
        $sourcePath = Join-Path $sourceFolder $fileName
        $destPath = Join-Path $destFolder $fileName

        if (Test-Path -LiteralPath $sourcePath) {
            try {
                Move-Item -LiteralPath $sourcePath -Destination $destPath -Force
                $movedCount++
            } catch {
                Write-Host "Could not move: $sourcePath ($($_.Exception.Message))" -ForegroundColor Yellow
                $missingList += $sourcePath
                $missingCount++
            }
        } else {
            $missingList += $sourcePath
            $missingCount++
        }
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Moved $movedCount file(s) into $archive" -ForegroundColor Green
if ($missingCount -gt 0) {
    Write-Host "$missingCount file(s) were not found (already moved, renamed, or never existed) - this is normally fine:" -ForegroundColor Yellow
    $missingList | ForEach-Object { Write-Host "  - $_" }
}
