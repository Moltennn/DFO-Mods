#!/usr/bin/env bash
# DFO Online (Mods) - sync the mods, then open the game's launcher.
# (No background service; this only runs while the shortcut is starting.)
set -euo pipefail
cd "$(dirname "$0")"
exec node modloader/play.mjs "$@"
