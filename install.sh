#!/usr/bin/env bash
#
# DFO Online mods - one-step install/repair for Linux and macOS.
#
#   ./install.sh                 install the loader and every mod, then set up
#                                the "DFO Online (Mods)" launcher (no service)
#   ./install.sh --app PATH      same, for a game the usual folders don't find
#                                (portable/unpacked build, custom install)
#   ./install.sh --app=PATH
#
# Node.js 18 or newer is required - the system copy, or a portable one in
# node/bin/node (or DFO_NODE=<path>). Everything is idempotent - running it again
# after a game update repairs the install.
set -euo pipefail
cd "$(dirname "$0")"

APP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --app=*) APP="${1#*=}"; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

. ./modloader/find-node.sh
dfo_find_node "$(pwd)" || exit 1

# Remember an explicit game path for the launcher and the check.
if [ -n "$APP" ]; then
  printf '%s\n' "$APP" > modloader/app-path.txt
  printf '%s\n' "$APP" > modloader/game-path.txt
elif [ -f modloader/app-path.txt ]; then
  APP="$(head -n 1 modloader/app-path.txt)"
fi
if [ -n "$APP" ]; then export DFO_APP="$APP"; fi

echo "[dfo-mods] removing the old background sync, then checking the mods (node: $NODE)"
"$NODE" modloader/install.mjs

echo
echo "[dfo-mods] setting up the launcher"
chmod +x play.sh play.command 2>/dev/null || true
if [ "$(uname -s)" = "Darwin" ]; then
  ENTRY="$HOME/Applications/DFO Online (Mods).command"
  mkdir -p "$HOME/Applications"
  cat > "$ENTRY" <<EOF
#!/bin/sh
cd "$(pwd)"
exec ./play.sh "\$@"
EOF
  chmod +x "$ENTRY"
else
  ENTRY="$HOME/.local/share/applications/dfo-online-mods.desktop"
  mkdir -p "$(dirname "$ENTRY")"
  cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=DFO Online (Mods)
Comment=Start DFO Online with the mods applied
Exec="$NODE" "$(pwd)/modloader/play.mjs"
Path=$(pwd)
Terminal=false
Icon=applications-games
EOF
fi
echo "launcher: $ENTRY"
echo "Start the game from 'DFO Online (Mods)' (or $(pwd)/play.sh)."


echo
echo "Done. Start the game from the shortcut; the mods are applied as it starts."
