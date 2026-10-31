@echo off
rem DFO Online (Mods) - start the game with the mods applied.
rem No background service; this only runs while the shortcut is starting.
rem Node.js 18+: the system copy, or a portable one in node\node.exe (or DFO_NODE).
setlocal
cd /d "%~dp0"
call "modloader\find-node.bat" "%~dp0"
if errorlevel 1 (
  pause
  exit /b 1
)
"%NODE%" "modloader\play.mjs" %*
if errorlevel 1 pause
