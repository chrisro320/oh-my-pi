#!/usr/bin/env bash
# N checkouts of one folder each edit a different line of the same file, then
# all run `ovnfs apply` at once. Uses a private daemon in a temp dir.
set -uo pipefail
N=${1:-8}
R=$(mktemp -d)
export OVNFS_STATE=$R/state OVNFS_MOUNT=$R/mnt
cleanup() { ovnfs stop >/dev/null 2>&1; fusermount3 -u "$R/mnt" 2>/dev/null; rm -rf "$R"; }
trap cleanup EXIT
cd "$R"
git init -q -b main src
seq 0 $((N * 10 - 1)) | sed 's/^/line /' > src/shared.txt
git -C src add . && git -C src -c user.name=t -c user.email=t@t commit -qm init
for i in $(seq 0 $((N - 1))); do
  ovnfs new src --name a$i >/dev/null 2>&1
  sed -i "$((10 * i + 6))s/.*/edit by $i/" "$OVNFS_MOUNT/a$i/shared.txt"
done
for i in $(seq 0 $((N - 1))); do (ovnfs apply a$i >"apply$i.log" 2>&1; echo $? >"rc$i") & done
wait
echo "N=$N applies exited 0: $(grep -lx 0 rc* | wc -l)/$N, edits in folder: $(grep -c '^edit by' src/shared.txt)/$N"
grep -h 'not_found' apply*.log | head -n 1
for i in $(seq 0 $((N - 1))); do grep -q "^edit by $i\$" src/shared.txt || ovnfs apply a$i >/dev/null 2>&1; done
echo "after re-applying the missing ones one at a time: $(grep -c '^edit by' src/shared.txt)/$N"
