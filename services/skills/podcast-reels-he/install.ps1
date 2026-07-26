# install.ps1 - one-shot setup for the self-contained podcast-reels-he skill.
#
# Drop this whole folder into  %USERPROFILE%\.claude\skills\podcast-reels-he  (so Claude
# Code sees it as a skill), then from inside it run:
#     powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# The premium engine is VENDORED in .\engine (build_reel.py + assets) - nothing external
# to deploy. This installs faster-whisper, ensures ffmpeg, sets up the premium Node deps
# (puppeteer + a matching Chrome), seeds .env from .env.example, and runs setup_check.py.
# Safe to re-run. Pure ASCII so Windows PowerShell 5.1 parses it regardless of code page.

param([switch]$SkipPython, [switch]$SkipFfmpeg, [switch]$SkipPremium)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

Write-Host "== podcast-reels-he installer ==" -ForegroundColor Cyan

# 1. .env for Qwen b-roll (optional feature)
$envFile = Join-Path $src ".env"
$envEx   = Join-Path $src ".env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envEx)) {
    Copy-Item $envEx $envFile
    Write-Host "[1/5] Created .env from template - fill QWEN_API_KEY + QWEN_DASHSCOPE_BASE to enable b-roll." -ForegroundColor Yellow
} else {
    Write-Host "[1/5] .env present (or no template)."
}

# 2. Python + faster-whisper
$py = Get-Command python -ErrorAction SilentlyContinue
if ($SkipPython) {
    Write-Host "[2/5] Skipping Python step (-SkipPython)."
} elseif (-not $py) {
    Write-Warning "[2/5] Python not found. Install Python 3.9+ from python.org, then re-run."
} else {
    Write-Host "[2/5] Python: $($py.Source)  - installing faster-whisper ..."
    python -m pip install --quiet --disable-pip-version-check faster-whisper
}

# 3. ffmpeg
if ($SkipFfmpeg) {
    Write-Host "[3/5] Skipping ffmpeg step (-SkipFfmpeg)."
} else {
    $ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $ff) {
        Write-Host "[3/5] ffmpeg missing - trying winget ..."
        try {
            winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
            Write-Host "      ffmpeg installed. Open a NEW terminal so PATH refreshes."
        } catch { Write-Warning "      Auto-install failed. Install ffmpeg manually and add to PATH." }
    } else {
        Write-Host "[3/5] ffmpeg found: $($ff.Source)"
    }
}

# 4. Premium Node deps: puppeteer (npm install pulls a matching Chrome too)
if ($SkipPremium) {
    Write-Host "[4/5] Skipping premium engine setup (-SkipPremium)."
} else {
    $premiumDir = Join-Path $src "premium-engine"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "[4/5] Node.js missing - trying winget ..."
        try { winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements } catch {}
        $node = Get-Command node -ErrorAction SilentlyContinue
    }
    if ($node -and (Test-Path (Join-Path $premiumDir "package.json"))) {
        Write-Host "[4/5] Premium engine: installing puppeteer + Chrome (one-time, ~150MB) ..."
        Push-Location $premiumDir
        if (-not (Test-Path (Join-Path $premiumDir "node_modules\puppeteer"))) {
            try { npm install --no-audit --no-fund --loglevel=error } catch { Write-Warning "      npm install failed - run it manually in $premiumDir" }
        } else { Write-Host "      puppeteer present." }
        $chromeOk = $false
        try {
            node -e "const p=require('./node_modules/puppeteer'),fs=require('fs');process.exit(fs.existsSync(p.executablePath())?0:1)" 2>$null
            $chromeOk = ($LASTEXITCODE -eq 0)
        } catch {}
        if (-not $chromeOk) {
            Write-Host "      Fetching Chrome for puppeteer ..."
            try { npx --yes puppeteer browsers install chrome } catch { Write-Warning "      Chrome fetch failed - run: npx puppeteer browsers install chrome (in $premiumDir)" }
        } else { Write-Host "      Chrome for puppeteer ready." }
        Pop-Location
    } else {
        Write-Warning "[4/5] Node.js unavailable - premium style stays off until you install Node and run 'npm install' in premium-engine (open a NEW terminal after a winget Node install). Simple style works without it."
    }
}

# 5. Verify
Write-Host "[5/5] Verifying ..." -ForegroundColor Cyan
if (Get-Command python -ErrorAction SilentlyContinue) {
    python (Join-Path $src "scripts\setup_check.py")
} else {
    Write-Warning "Skipping setup_check (no Python yet)."
}

Write-Host ""
Write-Host "Done. Point the skill at a folder with a Hebrew podcast and ask it to make reels." -ForegroundColor Green
