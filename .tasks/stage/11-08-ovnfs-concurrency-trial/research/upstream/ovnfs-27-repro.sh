#!/usr/bin/env bash
# Write into a cache-class path (node_modules) inside a checkout.
set -uo pipefail
R=$(mktemp -d)
export OVNFS_STATE=$R/state OVNFS_MOUNT=$R/mnt
cleanup() { ovnfs stop >/dev/null 2>&1; fusermount3 -u "$R/mnt" 2>/dev/null; rm -rf "$R"; }
trap cleanup EXIT
cd "$R"
git init -q -b main src && cd src
echo 'node_modules/' > .gitignore && mkdir -p node_modules/p && echo v1 > node_modules/p/i.js && echo a > a.txt
git add . && git -c user.name=t -c user.email=t@t commit -qm init && cd ..
ovnfs new src --name c >/dev/null 2>&1
ovnfs explain src node_modules
echo mine > "$OVNFS_MOUNT/c/node_modules/p/i.js"; echo "write in checkout: rc=$?"
echo "folder: $(cat src/node_modules/p/i.js)  checkout: $(cat "$OVNFS_MOUNT/c/node_modules/p/i.js")"
echo v2 > src/node_modules/p/i.js
echo "after the folder writes v2, checkout shows: $(cat "$OVNFS_MOUNT/c/node_modules/p/i.js")"
echo "diff: [$(ovnfs diff c)]"
