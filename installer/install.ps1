<#
  StudioMaster installer wizard (Windows).

  Installs everything needed to run a pilot on one machine:
    1. Prerequisites via winget: Node.js LTS, Python 3.11, ffmpeg, OBS Studio
    2. App dependencies (npm install) + native rebuild (better-sqlite3 for Electron)
    3. Python editing deps + the Hebrew Whisper model (the reels skill's install.ps1)
    4. Registers the StudioMaster panel as an OBS Custom Browser Dock
    5. Creates a desktop shortcut to launch the app

  Run by double-clicking StudioMaster-Setup.cmd, or:
    powershell -ExecutionPolicy Bypass -File install.ps1 [-Build] [-SkipPrereqs]

  -Build       also produce a Windows installer .exe (npm run dist:win)
  -SkipPrereqs skip the winget prerequisite installs
#>

param(
  [switch]$Build,
  [switch]$SkipPrereqs
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Total = 6
$Step = 0

# Remove "Mark of the Web" from our own scripts so re-runs aren't SmartScreen-blocked.
try { Get-ChildItem -Path $PSScriptRoot -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue } catch {}

function Write-Step([string]$msg) {
  $script:Step++
  Write-Host ""
  Write-Host "[$script:Step/$Total] $msg" -ForegroundColor Cyan
}
function Write-Ok([string]$msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }

function Have-Cmd([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Ensure-Winget {
  if (Have-Cmd 'winget') { return $true }
  Write-Warn2 "winget לא נמצא. התקן 'App Installer' מ-Microsoft Store, או התקן ידנית את הכלים."
  return $false
}

function Install-Prereq([string]$id, [string]$probeCmd, [string]$label) {
  if (Have-Cmd $probeCmd) { Write-Ok "$label כבר מותקן"; return }
  if (-not (Have-Cmd 'winget')) { Write-Warn2 "$label חסר ואין winget — התקן ידנית"; return }
  Write-Host "   מתקין $label ..." -ForegroundColor Gray
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (Have-Cmd $probeCmd) { Write-Ok "$label הותקן" } else { Write-Warn2 "$label — ייתכן שצריך לפתוח חלון חדש כדי לרענן PATH" }
}

function Ensure-ObsIni {
  # Returns the OBS global.ini path, creating the folder + an empty file if OBS
  # has never run (so websocket/dock can be pre-configured on a fresh machine).
  $ini = Join-Path $env:APPDATA 'obs-studio\global.ini'
  $dir = Split-Path -Parent $ini
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (-not (Test-Path $ini)) {
    New-Item -ItemType File -Force -Path $ini | Out-Null
    Write-Warn2 "נוצר global.ini ראשוני ל-OBS (OBS עדיין לא הורץ)"
  }
  return $ini
}

function Set-IniValues([string]$ini, [string]$section, [hashtable]$kv) {
  # Set key=value pairs inside an INI [section], adding the section/keys if absent.
  $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $ini -Encoding UTF8)
  $secStart = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -eq "[$section]") { $secStart = $i; break }
  }
  if ($secStart -lt 0) {
    $lines.Add("[$section]")
    foreach ($k in $kv.Keys) { $lines.Add("$k=$($kv[$k])") }
    Set-Content -LiteralPath $ini -Value $lines -Encoding UTF8
    return
  }
  $secEnd = $lines.Count
  for ($i = $secStart + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -match '^\[.*\]$') { $secEnd = $i; break }
  }
  foreach ($k in $kv.Keys) {
    $found = $false
    for ($i = $secStart + 1; $i -lt $secEnd; $i++) {
      if ($lines[$i] -match "^\s*$([regex]::Escape($k))\s*=") { $lines[$i] = "$k=$($kv[$k])"; $found = $true; break }
    }
    if (-not $found) { $lines.Insert($secEnd, "$k=$($kv[$k])"); $secEnd++ }
  }
  Set-Content -LiteralPath $ini -Value $lines -Encoding UTF8
}

function Enable-ObsWebSocket([string]$ini) {
  # Turn on the built-in obs-websocket server (port 4455, no password) so
  # StudioMaster connects with zero manual OBS setup.
  Set-IniValues $ini 'OBSWebSocket' @{ ServerEnabled = 'true'; ServerPort = '4455'; AuthRequired = 'false'; FirstLoad = 'false' }
  Write-Ok "obs-websocket הופעל (פורט 4455, ללא סיסמה) — יחול בהפעלת OBS"
}

function Add-ObsDock([string]$ini) {
  # Registers http://127.0.0.1:3939/dock as an OBS Custom Browser Dock by
  # merging into OBS global.ini. OBS must be CLOSED (it rewrites on exit).
  $url = 'http://127.0.0.1:3939/dock'
  $dock = [ordered]@{ title = 'StudioMaster'; url = $url }
  $lines = Get-Content -LiteralPath $ini -Encoding UTF8
  $idx = ($lines | Select-String -SimpleMatch 'ExtraBrowserDocks=' | Select-Object -First 1).LineNumber
  if ($idx) {
    $line = $lines[$idx - 1]
    $json = $line.Substring($line.IndexOf('=') + 1)
    try { $arr = @($json | ConvertFrom-Json) } catch { $arr = @() }
    if ($arr.url -contains $url) { Write-Ok "ה-Dock כבר רשום ב-OBS"; return }
    $arr += [pscustomobject]$dock
    $lines[$idx - 1] = 'ExtraBrowserDocks=' + ($arr | ConvertTo-Json -Compress)
  } else {
    $bw = ($lines | Select-String -SimpleMatch '[BasicWindow]' | Select-Object -First 1).LineNumber
    $entry = 'ExtraBrowserDocks=' + (@([pscustomobject]$dock) | ConvertTo-Json -Compress)
    if ($bw) {
      $lines = $lines[0..($bw - 1)] + $entry + $lines[$bw..($lines.Count - 1)]
    } else {
      $lines += '[BasicWindow]'; $lines += $entry
    }
  }
  Set-Content -LiteralPath $ini -Value $lines -Encoding UTF8
  Write-Ok "ה-Dock נוסף ל-OBS (ייראה אחרי הפעלה מחדש של OBS)"
}

function New-Shortcut {
  $launcher = Join-Path $RepoRoot 'Start-StudioMaster.cmd'
  @"
@echo off
cd /d "$RepoRoot"
call npm run dev
"@ | Set-Content -LiteralPath $launcher -Encoding ASCII
  $desktop = [System.Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'StudioMaster.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $launcher
  $sc.WorkingDirectory = $RepoRoot
  $sc.IconLocation = 'shell32.dll,3'
  $sc.Description = 'StudioMaster'
  $sc.Save()
  Write-Ok "קיצור דרך נוצר על שולחן העבודה: StudioMaster"
}

# ─────────────────────────────────────────────────────────────────────────────

Write-Host "StudioMaster — התקנה למחשב אחד (פיילוט)" -ForegroundColor White
Write-Host "תיקיית הפרויקט: $RepoRoot" -ForegroundColor Gray

# 1) Prerequisites
Write-Step "בדיקה והתקנה של תוכנות דרושות (Node, Python, ffmpeg, OBS)"
if ($SkipPrereqs) {
  Write-Warn2 "דילוג על התקנת prerequisites (-SkipPrereqs)"
} else {
  Ensure-Winget | Out-Null
  Install-Prereq 'OpenJS.NodeJS.LTS' 'node'   'Node.js'
  Install-Prereq 'Python.Python.3.11' 'python' 'Python 3.11'
  Install-Prereq 'Gyan.FFmpeg'        'ffmpeg' 'ffmpeg'
  Install-Prereq 'OBSProject.OBSStudio' 'obs64' 'OBS Studio'
}

# 2) App dependencies
Write-Step "התקנת רכיבי StudioMaster (npm install + rebuild)"
Push-Location $RepoRoot
try {
  cmd /c "npm install" | Write-Host
  Write-Ok "npm install הושלם"
  try { cmd /c "npm run rebuild --workspace @studiomaster/desktop" | Write-Host; Write-Ok "better-sqlite3 נבנה ל-Electron" }
  catch { Write-Warn2 "rebuild נכשל — האפליקציה תיפול ל-store בזיכרון (עדיין עובד)" }
} finally { Pop-Location }

# 3) Python editing deps + Hebrew Whisper model
Write-Step "התקנת סוכני העריכה + מודל התמלול העברי (עלול לקחת זמן, ~1.6GB)"
if (Have-Cmd 'python') {
  try { cmd /c "python -m pip install --user -r `"$RepoRoot\services\ai-workers\requirements.txt`"" | Write-Host } catch { Write-Warn2 "pip install נכשל — נסה ידנית" }
  $reelsInstall = Join-Path $RepoRoot 'services\skills\podcast-reels-he\install.ps1'
  if (Test-Path $reelsInstall) {
    Write-Host "   מריץ את התקנת סקיל הרילסים..." -ForegroundColor Gray
    Push-Location (Split-Path -Parent $reelsInstall)
    try { & $reelsInstall } catch { Write-Warn2 "install.ps1 של הרילס נכשל — אפשר להריץ אותו ידנית מאוחר יותר" }
    finally { Pop-Location }
  }
} else {
  Write-Warn2 "Python לא זמין — סוכני העריכה לא יותקנו כעת"
}

# 4) Build (optional)
Write-Step "בניית האפליקציה"
Push-Location $RepoRoot
try {
  if ($Build) {
    cmd /c "npm run dist:win" | Write-Host
    Write-Ok "installer .exe נוצר תחת apps\desktop\release"
  } else {
    cmd /c "npm run build" | Write-Host
    Write-Ok "האפליקציה נבנתה (הרצה עם הקיצור / npm run dev)"
  }
} finally { Pop-Location }

# 5) OBS: enable websocket + register the dock
Write-Step "הגדרת OBS: הפעלת WebSocket + רישום הפאנל (Custom Browser Dock)"
Write-Warn2 "אם OBS פתוח — סגור אותו עכשיו כדי שהשינויים יישמרו."
try {
  $obsIni = Ensure-ObsIni
  Enable-ObsWebSocket $obsIni
  Add-ObsDock $obsIni
} catch { Write-Warn2 "לא ניתן לעדכן את OBS אוטומטית: $($_.Exception.Message)" }

# 6) Shortcut
Write-Step "יצירת קיצור דרך"
try { New-Shortcut } catch { Write-Warn2 "יצירת קיצור נכשלה: $($_.Exception.Message)" }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " ההתקנה הושלמה! פשוט הפעל את 'StudioMaster' משולחן העבודה." -ForegroundColor Green
Write-Host " OBS מוגדר אוטומטית: WebSocket דלוק (4455, ללא סיסמה) + הפאנל בפנים." -ForegroundColor Green
Write-Host " מקור החיווי 'StudioMaster Marker' ייווצר אוטומטית בחיבור הראשון." -ForegroundColor Green
Write-Host " מדריך מלא: docs\PILOT.md" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
