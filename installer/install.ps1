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

function Add-ObsDock {
  # Registers http://127.0.0.1:3939/dock as an OBS Custom Browser Dock by
  # merging into OBS global.ini. OBS must be CLOSED (it rewrites on exit).
  $ini = Join-Path $env:APPDATA 'obs-studio\global.ini'
  if (-not (Test-Path $ini)) { Write-Warn2 "OBS עדיין לא הורץ פעם ראשונה — דלג על הוספת ה-Dock (אפשר להוסיף ידנית)"; return }
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

# 5) OBS dock
Write-Step "רישום הפאנל של StudioMaster בתוך OBS (Custom Browser Dock)"
Write-Warn2 "אם OBS פתוח — סגור אותו עכשיו כדי שהשינוי יישמר."
try { Add-ObsDock } catch { Write-Warn2 "לא ניתן לעדכן את OBS אוטומטית: $($_.Exception.Message)" }

# 6) Shortcut
Write-Step "יצירת קיצור דרך"
try { New-Shortcut } catch { Write-Warn2 "יצירת קיצור נכשלה: $($_.Exception.Message)" }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " ההתקנה הושלמה! להפעלה: לחץ על 'StudioMaster' בשולחן העבודה" -ForegroundColor Green
Write-Host " ואז ב-OBS: Tools → WebSocket Server Settings → Enable (4455)" -ForegroundColor Green
Write-Host " מקור החיווי 'StudioMaster Marker' וה-Dock ייווצרו אוטומטית בחיבור הראשון." -ForegroundColor Green
Write-Host " מדריך מלא: docs\PILOT.md" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
