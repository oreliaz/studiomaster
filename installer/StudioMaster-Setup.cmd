@echo off
REM StudioMaster one-click installer launcher (Windows).
REM Double-click this file. It runs the PowerShell install wizard.
REM (ASCII-only + CRLF line endings so cmd.exe parses it correctly.)
setlocal
echo.
echo ===============================================
echo    StudioMaster - Installer
echo ===============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
echo Done. You can close this window.
pause
