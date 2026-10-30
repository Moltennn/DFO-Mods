@echo off
rem DFO Online (Mods) - sync the mods, then open the game's launcher.
rem No background service; this only runs while the shortcut is starting.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
node "modloader\play.mjs" %*
if errorlevel 1 pause
