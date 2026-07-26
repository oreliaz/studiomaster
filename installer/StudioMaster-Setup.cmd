@echo off
REM StudioMaster one-click installer launcher (Windows).
REM Double-click this file. It runs the PowerShell install wizard with the
REM right execution policy and UTF-8 output for Hebrew.
chcp 65001 >nul
setlocal
echo.
echo ===============================================
echo    StudioMaster - Installer / אשף התקנה
echo ===============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
echo Done. You can close this window.  (סיום — אפשר לסגור)
pause
