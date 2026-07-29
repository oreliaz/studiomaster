<#
  StudioMaster installer wizard (Windows).

  ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 files as the system
  ANSI codepage (not UTF-8), so non-ASCII text corrupts parsing. Keeping this
  file ASCII makes it robust on every PowerShell version and locale. (The app's
  own Hebrew UI is unaffected - that runs in Electron, which is UTF-8.)

  Installs everything needed to run a pilot on one machine:
    1. Prerequisites via winget: Node.js LTS, Python 3.11, ffmpeg, OBS Studio
    2. App dependencies (npm install) + native rebuild (better-sqlite3)
    3. Python editing deps + the Hebrew Whisper model
    4. Enables obs-websocket + registers the StudioMaster OBS dock
    5. Creates a desktop shortcut

  Run by double-clicking StudioMaster-Setup.cmd, or:
    powershell -ExecutionPolicy Bypass -File install.ps1 [-Build] [-SkipPrereqs]
#>

param(
  [switch]$Build,
  [switch]$SkipPrereqs
)

$ErrorActionPreference = 'Stop'

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
function Write-Ok([string]$msg) { Write-Host "   OK  $msg" -ForegroundColor Green }
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
  Write-Warn2 "winget not found. Install 'App Installer' from the Microsoft Store, or install the tools manually."
  return $false
}

function Install-Prereq([string]$id, [string]$probeCmd, [string]$label) {
  if (Have-Cmd $probeCmd) { Write-Ok "$label already installed"; return }
  if (-not (Have-Cmd 'winget')) { Write-Warn2 "$label missing and no winget - install it manually"; return }
  Write-Host "   installing $label ..." -ForegroundColor Gray
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (Have-Cmd $probeCmd) { Write-Ok "$label installed" } else { Write-Warn2 "$label - open a new window to refresh PATH" }
}

function Ensure-ObsIni {
  $ini = Join-Path $env:APPDATA 'obs-studio\global.ini'
  $dir = Split-Path -Parent $ini
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (-not (Test-Path $ini)) {
    New-Item -ItemType File -Force -Path $ini | Out-Null
    Write-Warn2 "created a starter OBS global.ini (OBS has not run yet)"
  }
  return $ini
}

function Set-IniValues([string]$ini, [string]$section, [hashtable]$kv) {
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
  Set-IniValues $ini 'OBSWebSocket' @{ ServerEnabled = 'true'; ServerPort = '4455'; AuthRequired = 'false'; FirstLoad = 'false' }
  Write-Ok "obs-websocket enabled (port 4455, no password) - applies when OBS starts"
}

function Add-ObsDock([string]$ini) {
  $url = 'http://127.0.0.1:3939/dock'
  $dock = [ordered]@{ title = 'StudioMaster'; url = $url }
  $lines = Get-Content -LiteralPath $ini -Encoding UTF8
  $idx = ($lines | Select-String -SimpleMatch 'ExtraBrowserDocks=' | Select-Object -First 1).LineNumber
  if ($idx) {
    $line = $lines[$idx - 1]
    $json = $line.Substring($line.IndexOf('=') + 1)
    try { $arr = @($json | ConvertFrom-Json) } catch { $arr = @() }
    if ($arr.url -contains $url) { Write-Ok "dock already registered in OBS"; return }
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
  Write-Ok "StudioMaster dock added to OBS (shows after OBS restarts)"
}

function New-Shortcut {
  $launcher = Join-Path $RepoRoot 'Start-StudioMaster.cmd'
  $body = "@echo off`r`ncd /d `"$RepoRoot`"`r`ncall npm run dev`r`n"
  Set-Content -LiteralPath $launcher -Value $body -Encoding ASCII
  $desktop = [System.Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'StudioMaster.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $launcher
  $sc.WorkingDirectory = $RepoRoot
  $sc.IconLocation = 'shell32.dll,3'
  $sc.Description = 'StudioMaster'
  $sc.Save()
  Write-Ok "desktop shortcut created: StudioMaster"
}

# -----------------------------------------------------------------------------

Write-Host "StudioMaster - one-computer pilot install" -ForegroundColor White
Write-Host "Project folder: $RepoRoot" -ForegroundColor Gray

# 1) Prerequisites
Write-Step "Checking / installing prerequisites (Node, Python, ffmpeg, OBS)"
if ($SkipPrereqs) {
  Write-Warn2 "skipping prerequisite installs (-SkipPrereqs)"
} else {
  Ensure-Winget | Out-Null
  Install-Prereq 'OpenJS.NodeJS.LTS' 'node' 'Node.js'
  Install-Prereq 'Python.Python.3.11' 'python' 'Python 3.11'
  Install-Prereq 'Gyan.FFmpeg' 'ffmpeg' 'ffmpeg'
  Install-Prereq 'OBSProject.OBSStudio' 'obs64' 'OBS Studio'
}

# 2) App dependencies (pure JS - no native build/toolchain needed)
Write-Step "Installing StudioMaster (npm install)"
Push-Location $RepoRoot
try {
  cmd /c "npm install"
  if ($LASTEXITCODE -eq 0) { Write-Ok "npm install done" }
  else { Write-Warn2 "npm install reported errors (exit $LASTEXITCODE) - see output above" }
} finally { Pop-Location }

# 3) Python editing deps + Hebrew Whisper model
Write-Step "Installing editing agents + Hebrew transcription model (may take a while, ~1.6GB)"
if (Have-Cmd 'python') {
  try { cmd /c "python -m pip install --user -r `"$RepoRoot\services\ai-workers\requirements.txt`"" | Write-Host } catch { Write-Warn2 "pip install failed - try manually later" }
  $reelsInstall = Join-Path $RepoRoot 'services\skills\podcast-reels-he\install.ps1'
  if (Test-Path $reelsInstall) {
    Write-Host "   running reels skill install..." -ForegroundColor Gray
    Push-Location (Split-Path -Parent $reelsInstall)
    try { & $reelsInstall } catch { Write-Warn2 "reels install.ps1 failed - run it manually later" }
    finally { Pop-Location }
  }
} else {
  Write-Warn2 "Python not available - editing agents not installed now"
}

# 4) Build
Write-Step "Building the application"
Push-Location $RepoRoot
try {
  if ($Build) {
    cmd /c "npm run dist:win" | Write-Host
    Write-Ok "installer .exe created under apps\desktop\release"
  } else {
    cmd /c "npm run build" | Write-Host
    Write-Ok "app built (launch via the shortcut / npm run dev)"
  }
} finally { Pop-Location }

# 5) OBS: enable websocket + register the dock
Write-Step "Configuring OBS: enable WebSocket + register the dock"
Write-Warn2 "if OBS is open, close it now so the changes are saved."
try {
  $obsIni = Ensure-ObsIni
  Enable-ObsWebSocket $obsIni
  Add-ObsDock $obsIni
} catch { Write-Warn2 "could not update OBS automatically: $($_.Exception.Message)" }

# 6) Shortcut
Write-Step "Creating a desktop shortcut"
try { New-Shortcut } catch { Write-Warn2 "shortcut creation failed: $($_.Exception.Message)" }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " Install complete! Launch 'StudioMaster' from the desktop." -ForegroundColor Green
Write-Host " OBS is auto-configured: WebSocket on (4455, no password) + dock inside." -ForegroundColor Green
Write-Host " The 'StudioMaster Marker' source is auto-created on first connect." -ForegroundColor Green
Write-Host " Full guide: docs\PILOT.md" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
