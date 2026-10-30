#!/usr/bin/env bash
#
# DFO Online mods - one-step install/repair for Linux and macOS.
#
#   ./install.sh                 install the loader and every mod, then set up
#                                autosync so a game update re-installs them
#   ./install.sh --app PATH      same, for a game the usual folders don't find
#                                (portable/unpacked build, custom install)
#   ./install.sh --app=PATH
#
# Node.js 18 or newer is required. Everything is idempotent - running it again
# after a game update repairs the install.
set -euo pipefail
cd "$(dirname "$0")"

APP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --app=*) APP="${1#*=}"; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required: https://nodejs.org" >&2
  exit 1
fi

# Remember an explicit game path for the headless autosync runs (a portable
# build is only findable while it runs, so the scheduler needs the hint).
if [ -n "$APP" ]; then
  printf '%s\n' "$APP" > modloader/app-path.txt
elif [ -f modloader/app-path.txt ]; then
  APP="$(head -n 1 modloader/app-path.txt)"
fi
if [ -n "$APP" ]; then export DFO_APP="$APP"; fi

echo "[dfo-mods] installing the loader and every mod"
node modloader/sync.mjs

echo
echo "[dfo-mods] setting up autosync (re-installs after a game update)"
node modloader/install.mjs --install-watch

echo
echo "[dfo-mods] checking"
node modloader/install.mjs --check
for dir in */install.mjs; do
  [ "$dir" = "modloader/install.mjs" ] && continue
  node "$dir" --check || true
done

echo
echo "Done. The game loads the mods on its next launch."
