@echo off
rem StudioMaster launcher - double-click to open StudioMaster (no "npm run dev").
rem After an update it installs/rebuilds once, then opens the app and this
rem window closes by itself. On the home screen, "Start everything" opens the
rem studio programs, connects OBS and sets the lighting in one click.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Run installer\StudioMaster-Setup.cmd first.
  pause
  exit /b 1
)
node scripts\launch.mjs %*
if errorlevel 1 pause
