Hi, and thanks for ovnfs. We are using it to run several agents on one repository at once, and while testing that setup I found one case where `apply` loses edits without reporting an error. Please feel free to close this if concurrent applies into one folder are out of scope.

## Summary

When several checkouts of one folder change **different lines of the same file** and run `ovnfs apply` at the same time, most of their edits are lost. Most of those applies exit 0 and list the path as applied. Run one after another, the same applies merge correctly (32/32). Applies that touch different files don't lose anything.

## Environment

- ovnfs v0.2.3 (`go install github.com/stencil-hq/ovnfs@63f2700a`, go1.27.3 linux/amd64); the 4 commits on `main` since then don't touch this code
- Linux 7.0.0 (x86_64), ext4 on NVMe, default `serve` (FUSE), fusermount3 3.14.0, git 2.43.0
- Each script uses its own daemon (`OVNFS_STATE`/`OVNFS_MOUNT` in a temp dir) and removes it on exit

## Reproduce

```sh
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
```

Output, 3 runs each (`bash repro.sh 8`, `bash repro.sh 32`):

```
N=8 applies exited 0: 6/8, edits in folder: 2/8
not_found: shared.txt: rename …/src/.ovnfs-apply-shared.txt …/src/shared.txt: no such file or directory
after re-applying the missing ones one at a time: 8/8
N=8 applies exited 0: 6/8, edits in folder: 2/8
N=8 applies exited 0: 7/8, edits in folder: 3/8
N=32 applies exited 0: 32/32, edits in folder: 13/32
N=32 applies exited 0: 32/32, edits in folder: 14/32
N=32 applies exited 0: 31/32, edits in folder: 12/32
after re-applying the missing ones one at a time: 32/32 (every run)
```

## Observations

- In `checkout/diff.go`, `applyOne` reads the folder's current file, merges it three-way with the checkout's version (`mergeText`), and writes the result with `writeAtomic` (temp file + rename). Nothing serializes this between applies into the same folder, so concurrent applies each merge against the same old content, and the last rename wins.
- `writeAtomic` uses a fixed temp name per file (`.ovnfs-apply-<name>`) and removes it first (`checkout/diff.go:694-705`). Two concurrent applies of the same path can therefore delete or rename each other's temp file. That is where the occasional `not_found: … rename …` error comes from; the other losses are silent.
- A per-folder lock around apply (or at least around the read–merge–rename of each path), plus a unique temp name, would probably cover it. Until then, callers can run applies into one folder one at a time.
