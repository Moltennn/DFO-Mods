#!/usr/bin/env bash
# DFO Online (Mods) - sync the mods, then open the game's launcher.
# (No background service; this only runs while the shortcut is starting.)
# Node.js 18+: the system copy, or a portable one in node/bin/node (or DFO_NODE).
set -euo pipefail
cd "$(dirname "$0")"
. ./modloader/find-node.sh
dfo_find_node "$(pwd)" || exit 1
exec "$NODE" modloader/play.mjs "$@"
