Hi, thanks for ovnfs. A small robustness issue I hit while testing crash behaviour on Linux.

## Summary

After the daemon is killed with `kill -9`, its FUSE mount stays behind. Every later `ovnfs start` then fails, and so does any verb that starts the daemon on demand (including the `ovnfs --json start` that omp runs), until someone runs `fusermount3 -u <mount>` by hand. The loss of files that were still in memory is documented in `docs/internals.md` and behaves as described; this report is only about the restart.

## Environment

- ovnfs v0.2.3 (`go install github.com/stencil-hq/ovnfs@63f2700a`, go1.27.3 linux/amd64); the 4 commits on `main` since then don't touch this code
- Linux 7.0.0 (x86_64), ext4 on NVMe, default `serve` (FUSE), fusermount3 3.14.0, git 2.43.0
- Each script uses its own daemon (`OVNFS_STATE`/`OVNFS_MOUNT` in a temp dir) and removes it on exit

## Reproduce

```sh
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
```

Output:

```
ovnfs serve (pid …) exited before accepting connections (exit status 1); last lines of …/state/serve.log:
… mounted at …/mnt
/usr/bin/fusermount3: failed to access mountpoint …/mnt: Permission denied
mount: fuse: mount …/mnt: fusermount exited with code 256
start after kill -9: rc=1
second try: rc=1
fusermount3 -u: rc=0
start after unmount: rc=0
```

In 25 of 25 tries during our testing, the restart failed until the mount was unmounted. Sometimes the log says `mount directory: mkdir <mount>: file exists` instead of the fusermount3 error.

## Observations

- On the FUSE path, `mountInProcess` (`serve.go:337-340`) runs `os.MkdirAll(mount)` and mounts, without first checking for a stale mount left by a dead daemon. On a dead FUSE mount, MkdirAll and fusermount3 fail as shown above.
- `unmount` in `mount_unix.go` calls `umount`. On Linux, an unprivileged user normally needs `fusermount3 -u` (or `-uz`) for a FUSE mount.
- A daemon that crashes or is OOM-killed hits the same thing, so a stale-mount check before mounting would make unattended setups recover on their own.
