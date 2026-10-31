# Sourced by install.sh and play.sh: sets NODE to the Node.js 18+ binary the
# DFO tools run with. Looked for, in order:
#   1. $DFO_NODE (an explicit path)
#   2. a portable copy in <workspace>/node/bin/node (or node/node)
#   3. `node` on PATH
# Usage: . ./modloader/find-node.sh && dfo_find_node "$(pwd)" || exit 1

dfo_find_node() {
  _root="$1"
  NODE=""
  for _c in "${DFO_NODE:-}" "$_root/node/bin/node" "$_root/node/node"; do
    if [ -n "$_c" ] && [ -x "$_c" ]; then NODE="$_c"; break; fi
  done
  if [ -z "$NODE" ]; then NODE="$(command -v node 2>/dev/null || true)"; fi
  if [ -z "$NODE" ]; then
    echo "Node.js 18 or newer is required: https://nodejs.org" >&2
    echo "  (or put a portable copy at $_root/node/bin/node, or set DFO_NODE)" >&2
    return 1
  fi
  if ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
    echo "Node.js 18 or newer is required; $NODE is $("$NODE" -v)" >&2
    return 1
  fi
  export NODE
}
