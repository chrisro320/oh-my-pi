#!/usr/bin/env bash
# kill -9 the daemon, then try to start it again. Uses a private daemon in a temp dir.
set -uo pipefail
R=$(mktemp -d)
export OVNFS_STATE=$R/state OVNFS_MOUNT=$R/mnt
cleanup() { ovnfs stop >/dev/null 2>&1; fusermount3 -u "$R/mnt" 2>/dev/null; rm -rf "$R"; }
trap cleanup EXIT
ovnfs start >/dev/null
pid=$(ovnfs --json status | python3 -c 'import json,sys; print(json.load(sys.stdin)["pid"])')
kill -9 "$pid"; sleep 0.5
ovnfs start; echo "start after kill -9: rc=$?"
ovnfs start >/dev/null 2>&1; echo "second try: rc=$?"
fusermount3 -u "$R/mnt"; echo "fusermount3 -u: rc=$?"
ovnfs start >/dev/null; echo "start after unmount: rc=$?"
