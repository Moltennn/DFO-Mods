@echo off
rem Called with "call": sets NODE to the Node.js 18+ program the DFO tools run
rem with, looked for in order: DFO_NODE (an explicit path), a portable copy in
rem <workspace>\node\node.exe, then node on PATH. Usage:
rem   call "modloader\find-node.bat" "%~dp0"  &&  if errorlevel 1 exit /b 1
rem (No setlocal here: NODE must reach the caller.)
set "NODE="
if defined DFO_NODE if exist "%DFO_NODE%" set "NODE=%DFO_NODE%"
if not defined NODE if exist "%~1node\node.exe" set "NODE=%~1node\node.exe"
if not defined NODE for %%N in (node.exe) do if not "%%~$PATH:N"=="" set "NODE=%%~$PATH:N"
if not defined NODE (
  echo Node.js 18 or newer is required: https://nodejs.org
  echo   ^(or put a portable copy at %~1node\node.exe, or set DFO_NODE^)
  exit /b 1
)
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 18 or newer is required; %NODE% is too old.
  set "NODE="
  exit /b 1
)
exit /b 0
