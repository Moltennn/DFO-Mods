@echo off
rem
rem DFO Online mods - one-step install/repair for Windows.
rem
rem   install.bat                 install the loader and every mod, then set up
rem                               autosync so a game update re-installs them
rem   install.bat "C:\path\to\DFO Online.exe"    same, for a portable/unpacked
rem                               build (or a custom install folder)
rem
rem Node.js 18 or newer is required. Everything is idempotent - running it
rem again after a game update repairs the install.
setlocal
cd /d "%~dp0"

if not "%~1"=="" (
  > "modloader\app-path.txt" echo %~1
  set "DFO_APP=%~1"
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required: https://nodejs.org
  pause
  exit /b 1
)

echo [dfo-mods] installing the loader and every mod
node "modloader\sync.mjs"
if errorlevel 1 goto fail

echo.
echo [dfo-mods] setting up autosync ^(re-installs after a game update^)
node "modloader\install.mjs" --install-watch
if errorlevel 1 goto fail

echo.
echo [dfo-mods] checking
node "modloader\install.mjs" --check
if errorlevel 1 goto fail
for /d %%D in (*-mod) do (
  if exist "%%D\install.mjs" node "%%D\install.mjs" --check
)

echo.
echo Done. The game loads the mods on its next launch.
pause
exit /b 0

:fail
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
