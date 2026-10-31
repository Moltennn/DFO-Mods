@echo off
rem
rem DFO Online mods - one-step install/repair for Windows.
rem
rem   install.bat                 install the loader and every mod, then set up
rem                               the "DFO Online (Mods)" desktop shortcut
rem                               (no background service)
rem   install.bat "C:\path\to\DFO Online.exe"   same, for a portable/unpacked
rem                               build (or a custom install folder)
rem
rem Node.js 18 or newer is required: the system copy, or a portable one in
rem node\node.exe (or DFO_NODE set to its path). Everything is idempotent -
rem running it again after a game update repairs the install.
setlocal
cd /d "%~dp0"

if not "%~1"=="" (
  > "modloader\app-path.txt" echo %~1
  > "modloader\game-path.txt" echo %~1
  set "DFO_APP=%~1"
)

call "modloader\find-node.bat" "%~dp0"
if errorlevel 1 (
  pause
  exit /b 1
)

echo [dfo-mods] installing the loader and every mod (node: %NODE%)
"%NODE%" "modloader\sync.mjs"
if errorlevel 1 goto fail

echo.
echo [dfo-mods] removing any background watcher ^(the shortcut replaces it^)
"%NODE%" "modloader\install.mjs" --remove-watch

echo.
echo [dfo-mods] setting up the "DFO Online (Mods)" desktop shortcut
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'DFO Online (Mods).lnk')); $s.TargetPath=(Join-Path (Get-Location) 'play.bat'); $s.WorkingDirectory=(Get-Location).Path; $s.Save()"
if errorlevel 1 goto fail
echo shortcut: %USERPROFILE%\Desktop\DFO Online (Mods).lnk

echo.
echo [dfo-mods] checking
"%NODE%" "modloader\install.mjs" --check
if errorlevel 1 goto fail
for /d %%D in (*-mod) do (
  if exist "%%D\install.mjs" "%NODE%" "%%D\install.mjs" --check
)

echo.
echo Done. Start the game from the "DFO Online (Mods)" desktop shortcut.
pause
exit /b 0

:fail
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
