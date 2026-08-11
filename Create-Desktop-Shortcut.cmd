@echo off
rem Creates a 'StudioMaster' shortcut on your Desktop. Run once.
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $lnk=Join-Path([Environment]::GetFolderPath('Desktop')) 'StudioMaster.lnk'; $sc=$ws.CreateShortcut($lnk); $sc.TargetPath='%ROOT%\Start-StudioMaster.cmd'; $sc.WorkingDirectory='%ROOT%'; $sc.IconLocation='shell32.dll,3'; $sc.Description='StudioMaster'; $sc.Save()"
echo.
echo Desktop shortcut "StudioMaster" created. Double-click it to launch.
pause
