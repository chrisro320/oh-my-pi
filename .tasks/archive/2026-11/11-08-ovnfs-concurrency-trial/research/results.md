# ovnfs v0.2.3 concurrency trial: results

Per-run numbers below come from the taskex final run of `python3 research/trial/run_all.py` (default `--repeat 5`,
2026-11-08 03:01–03:09, wall time **514.5 s**). That run's JSON was overwritten by a later partial rerun;
`research/trial/results.json` now holds the second full run by main (03:15–03:24, **508.5 s**, `--repeat 5`)
and `research/trial/results-recheck.json` the main recheck of C3,C4,C6–C10 (`--repeat 2`, 175.5 s).
All three runs (plus one earlier full run with an older harness revision) gave the same ten verdicts.
Loss counts vary per run; across the three runs: C4 simultaneous same-file applies kept 3–5 of 8 and
14–23 of 32 edits; C10 same-file subagents lost 2–7 of 8 and 12–22 of 32 edits.

Machine: Intel i5-14600KF, 20 logical cores, 78 GiB RAM, kernel 7.0.0-31, scratch on ext4
(`/dev/nvme2n1p2`, NVMe, no reflinks); ovnfs v0.2.3 (go1.27.3, FUSE), git 2.43.0, bun 1.4.4, omp 18.18.0.
"Cold" means a fresh private daemon state (no capture, no stat cache); the OS page cache was warm
(dropping it would have needed root and touched the whole machine). Times are CLI wall times
(process start to exit) unless a row says otherwise. Doc paths are relative to
`~/go/pkg/mod/github.com/stencil-hq/ovnfs@v0.2.3/`.

Isolation of the run: private daemon (`--state/--mount` under `/var/tmp/ovnfs-trial`, also pinned by
`OVNFS_STATE/OVNFS_MOUNT`), git config isolated (`GIT_CONFIG_GLOBAL=/dev/null`), C10 with
`HOME` and `TMPDIR` inside scratch. After the run: scratch removed, no private `ovnfs serve`, no
private mount, user daemon `ovnfs status` = pid 2760573, checkouts 0, snapshots 1, bases 1,
layers 1 (as before), `~/.o2/ovnfs.yml` still absent, repo `git status --porcelain` unchanged
(`?? .tasks/archive/2026-11/11-08-ovnfs-concurrency-trial/`). Peak scratch ≈ 2.6 GB.

Rerun one claim: `cd .tasks/archive/2026-11/11-08-ovnfs-concurrency-trial && python3 research/trial/run_all.py --only C4`
(any comma list, `--repeat N`).

## Verdicts

| Claim | Doc | Verdict | Key numbers (median / max over 5 runs) | Rerun |
|---|---|---|---|---|
| C1 creates fast, size-independent, reused, prepared, shared capture | docs/checkouts.md:17-28, docs/internals.md:92-99, 158-191 | **holds** | cold create 2k 0.11/0.42 s, 50k 0.37/0.43 s, omp-move copy (2,102 files) 0.15/0.16 s; warm create 0.018–0.019 s (max 0.026); 8 prepared after first capture; 8 at once warm 0.03 s wall, cold 50k 0.37/0.41 s; 32 at once cold 50k 0.41/0.47 s; every concurrent batch on 1 base; `git status` in a 50k checkout 0.50/0.65 s | `--only C1` |
| C2 same path written in 8/32 checkouts at once stays isolated; folder untouched | README.md:64-65, docs/configuration.md:36-37 | **holds** | 10/10 runs: every checkout reads back only its own 50th write, own append log, own delete; folder digest (incl. index/refs) unchanged; `diff` per checkout exact | `--only C2` |
| C3 folder edited while checkouts open | docs/limitations.md:4-6, docs/configuration.md:32-36, docs/internals.md:160-167 | **holds with conditions** | new checkout saw all 6 kinds of edit; open checkout kept the captured view for 5/6, but showed an in-place same-size/same-mtime rewrite; 21,710 reads during 15,126 rewrites: all original, 0 torn | `--only C3` |
| C4 apply of many checkouts into one folder | docs/checkouts.md:203-225 | **partly fails** | sequential: 32/32 disjoint, 32/32 same-file-other-line merged; conflicts, delete-vs-edit, binary, apply-twice, `--dry-run` as documented. **Simultaneous applies, same file other lines: 8 → 3–5 edits kept, 32 → 16–19 kept, the lost ones exit 0**; sporadic `not_found … rename .ovnfs-apply-<file>` errors; disjoint files 0 lost | `--only C4` |
| C5 private git dir, `apply --branch`, checked-out branch FF only | docs/checkouts.md:5-15, README.md:65-66 | **holds** | 8 checkouts committing at once: 8 distinct HEADs, 0 objects/refs in folder; 8 simultaneous `apply --branch featN`: 8/8 refs = checkout HEADs, worktree unchanged; `--branch main`: FF, index updated, worktree file untouched (`git status` then shows ` M` until checked out); non-FF and staged same path refused | `--only C5` |
| C6 cache/ignored paths visible, read-only, always live | README.md:57-62, docs/configuration.md:25-37 (code: rules/rules.go:19-22) | **partly fails** | visible: yes; **read-only: no** — overwrite/create in `node_modules`, overwrite of an ignored file, and `rm -rf dist && rebuild` all succeed inside the checkout (private copy-on-write); a written path then shows the checkout's copy, not the folder; unwritten paths stay live; writes never reach folder/diff/apply | `--only C6` |
| C7 search vs snap/rm/writes; stalled checkout; concurrent start | docs/internals.md:7-8, 41-44 | **holds with conditions** | grep 3.9 s alone; snap of same checkout ends 0.005–0.024 s after grep; rm likewise; writes during grep 0.0008–0.009 s max — **but once a snap is waiting on the grep, a write to that checkout blocks 2.54–2.59 s until the grep ends**; other checkouts' snap/ls/new/diff 0.012–0.024 s max meanwhile; 8 and 32 concurrent `start`: 1 pid, 1 serve process (10/10) | `--only C7` |
| C8 snap/fork during writes; snapshot O(1) | docs/checkouts.md:101-116, docs/internals.md:195-201 | **holds with conditions** | during a writer: snap 0.075/0.107 s, fork 0.015/0.015 s, 5/5 forks a gap-free prefix, log consecutive; settled snap 10 files 0.034 s … 10,000 files 0.016 s … 500 MB 0.036 s; **hot snap (right after writing) 10,000 files 0.236/0.245 s** vs 0.046 s for 10 files | `--only C8` |
| C9 kill -9: <2 s files lost, rest and conflict resolutions kept | docs/internals.md:195-207, 68-79, docs/checkouts.md:217-222 | **partly fails** | survival after kill -9 by delay (5 each): 0.2/1.0/1.8 s → 0/5 small new files, 0/5 overwrites; 2.5/4.0 s → 5/5; >1 MiB files 5/5 at every delay; resolutions kept after kill -9 and after `restart`; **plain `ovnfs start` failed 25/25 after kill -9 until `fusermount3 -u <mount>`** | `--only C9` |
| C10 omp isolated parallel subagents on ovnfs | docs/internals.md:53-64; omp task/ovnfs.ts, task/structured-subagent.ts:889-894, 1106-1118, task/isolation-runner.ts:741-786 | **partly fails** | 8 and 32 workers: each in its own checkout under the private mount, no leaks, folder untouched before merge, 0 checkouts left; different files: every worker merged (8/8 and 32/32 in 10/10 runs). **Same file, different lines: 8 workers → 2–6 edits missing, 32 → 16–22 missing; 2–17 per run reported "Applied patches: yes" for an edit that is not in the folder** | `--only C10` |

Sub-claim verdicts and all raw measurements: `results.json` → `claims.<C>.subclaims` / `.measurements`.

## Details of non-holding and conditional claims

Manual reproductions below were run once more after the trial against a separate private daemon
(`/var/tmp/ovnfs-trial/repro`, removed afterwards), with this prelude:

```sh
R=/var/tmp/ovnfs-trial/repro; mkdir -p $R && cd $R
export OVNFS_STATE=$R/state OVNFS_MOUNT=$R/mnt GIT_CONFIG_GLOBAL=/dev/null \
  GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
# afterwards: ovnfs stop; rm -rf /var/tmp/ovnfs-trial
```

### C4: simultaneous applies into one folder lose edits and report success

Doc (docs/checkouts.md:212-215) says each changed path is merged three-way against the base. That
holds when applies run one after another (32/32). Run at the same moment (start barrier), applies of
checkouts that edit *different lines of the same file* overwrite each other: each reads the folder
file, merges, and renames its result in; the last rename wins. The losers exit 0 with the path in
`applied`. Occasionally two applies collide on the shared temp name and one fails with
`not_found: shared.txt: rename …/.ovnfs-apply-shared.txt …/shared.txt: no such file or directory`.
Applying the losers again, one at a time, brings every edit back (8/8 and 32/32 in all runs).
Disjoint files never lost anything (10/10 runs, 8 and 32). Same line at once: 1 apply wins, the others
report the conflict (the markers then hold 2 texts; later applies leave the marked file alone, as
documented at docs/checkouts.md:219-220), plus the same sporadic rename error (2 of 10 runs).

Observed in the trial (edits kept / applies that exited 0 but whose edit is gone):
8 at once: 3/4, 4/3, 4/4, 5/2, 4/4; 32 at once: 16/16, 16/15, 19/13, 18/13, 19/13.

Manual reproduction:

```sh
git init -q -b main src && seq 0 399 | sed 's/^/line /' > src/shared.txt && git -C src add . && git -C src commit -qm init
for i in $(seq 0 7); do ovnfs new src --name a$i >/dev/null 2>&1; sed -i "$((10*i+6))s/.*/edit by $i/" mnt/a$i/shared.txt; done
for i in $(seq 0 7); do ( ovnfs apply a$i >/dev/null 2>&1; echo "a$i rc=$?" ) & done; wait
echo "edits in folder: $(grep -c '^edit by' src/shared.txt) of 8"
for i in $(seq 0 7); do grep -q "^edit by $i$" src/shared.txt || ovnfs apply a$i >/dev/null 2>&1; done
echo "after re-applying the missing ones one by one: $(grep -c '^edit by' src/shared.txt) of 8"
```

Output:

```
a5 rc=0
a4 rc=0
a2 rc=0
a3 rc=0
a1 rc=0
a6 rc=0
a7 rc=0
a0 rc=0
edits in folder: 3 of 8
after re-applying the missing ones one by one: 8 of 8
```

Safe use: serialize `ovnfs apply` per folder (one at a time); a lock in the caller is enough.

### C6: cache and ignored paths are writable (copy-on-write), not read-only

README.md:59-60 and docs/configuration.md:28-29,35-36 say cache/local paths "show the live folder,
read-only". The code comment says otherwise (rules/rules.go:19-22: "Cache paths are copy-on-write
here"), and that is what happens: inside a checkout, overwriting `node_modules/pkg0/index.js`,
creating `node_modules/new.js`, overwriting the ignored `build.log`, and the build-like
`rm -rf dist && mkdir -p dist && echo … > dist/out.js && mkdir -p node_modules/.cache && …` all
succeed (rc 0). The folder and other checkouts are unaffected, and `diff`/`apply` ignore these paths.
The cost is liveness: a path the checkout wrote keeps the checkout's copy (`checkout A`) after the
folder changes it (`folder v2`); a replaced `dist/` no longer shows files the folder adds later.
Paths the checkout never wrote stay live (`folder v2`, new `node_modules/pkg1/added.js` visible).
So builds inside a checkout work; but a checkout that ran `npm install` or a build keeps its own
`node_modules`/`dist` and stops following the folder there.

```sh
mkdir c6 && cd c6 && git init -q -b main && echo 'node_modules/' > .gitignore && mkdir -p node_modules/p \
  && echo v1 > node_modules/p/i.js && echo a > a.txt && git add . && git commit -qm init && cd ..
ovnfs new c6 --name c6a >/dev/null 2>&1
ovnfs explain c6 node_modules
echo mine > mnt/c6a/node_modules/p/i.js; echo "write rc=$?"
echo "folder: $(cat c6/node_modules/p/i.js)  checkout: $(cat mnt/c6a/node_modules/p/i.js)"
echo v2 > c6/node_modules/p/i.js
echo "after folder writes v2 -> checkout: $(cat mnt/c6a/node_modules/p/i.js)"
```

```
cache    builtin:3  cache cachedir | dir & (node_modules | .venv | __pycache__ | .next | .nuxt | .turbo | .gradle | .pytest_cache | .mypy_cache | .ruff_cache | .tox)
write rc=0
folder: v1  checkout: mine
after folder writes v2 -> checkout: mine
```

### C9: after kill -9 the daemon does not come back until the dead FUSE mount is unmounted

The data side holds exactly as documented (docs/internals.md:197-207): small new files and small
overwrites written 0.2, 1.0 or 1.8 s before `kill -9` were lost in 15/15 cases; written 2.5 or 4.0 s
before, kept in 10/10; files over 1 MiB were kept at every delay (they go to the upper directly).
A conflict marked by `apply`, resolved in the folder, survived `kill -9` and `ovnfs restart`: the
next apply left the resolution alone and a later edit merged next to it.

Not documented: `kill -9` leaves the FUSE mount in place, and every later `ovnfs start` (and so every
verb that auto-starts the daemon, including omp's `ovnfs --json start`) fails until someone runs
`fusermount3 -u <mount>`. 25/25 restarts in the trial; same with a mount under `/tmp` in a probe.
The serve log shows either `mount directory: mkdir <mount>: file exists` or
`fusermount3: failed to access mountpoint <mount>: Permission denied`. (On Linux FUSE the daemon
neither unmounts a stale mount nor reuses it: serve.go:337-343, mount_unix.go:35-48.)

```sh
ovnfs start   # private daemon of the prelude env
pid=$(ovnfs --json status | python3 -c 'import json,sys;print(json.load(sys.stdin)["pid"])')
kill -9 $pid; sleep 0.3
ovnfs start; echo "start rc=$?"
fusermount3 -u $R/mnt; echo "fusermount3 -u rc=$?"
ovnfs start; echo "start rc=$?"
```

```
ovnfs serve (pid 3151505) exited before accepting connections (exit status 1); last lines of /var/tmp/ovnfs-trial/repro/state/serve.log:
2026/11/08 03:10:01 mounted at /var/tmp/ovnfs-trial/repro/mnt
mount directory: mkdir /var/tmp/ovnfs-trial/repro/mnt: file exists
start rc=1
fusermount3 -u rc=0
started ovnfs (pid 3151546, log /var/tmp/ovnfs-trial/repro/state/serve.log)
start rc=0
```

### C10: omp's parallel isolated subagents lose same-file edits on merge-back

Setup: SDK session (`research/trial/c10_omp.ts`), scripted offline model registered as a provider,
in-memory settings `task.isolation.enabled=true`, `isolation.backend=auto`,
`ovnfs.path=<wrapper pinned to the private daemon>`; one `task` call with N isolated workers
(N = 8, 32), each writes `c10/w<i>.txt` plus either its own `own/o<i>.txt` (disjoint) or line
`5+8i` of `shared.txt` (shared; hunks 8 lines apart, beyond git's 3 context lines). Workers wait on a
barrier, the test inspects all open checkouts, then they yield; the parent `wait`s.

What holds (20/20 runs): omp opened one ovnfs checkout per worker under the private mount
(N open at the barrier), each saw only its own files, the folder had none of them before merge,
each checkout's `ovnfs diff -p` was a one-line hunk, all checkouts were removed afterwards, and
with disjoint files every worker's file and edit landed (8/8, 32/32).

What fails: with the same file, merges race. Per run (edits missing in the folder / workers that
reported `Applied patches: yes` but whose edit or new file is absent / workers reported
"Patches were not applied", patch kept under the temp dir):
8 workers: 2/2/0, 5/3/2, 6/5/1, 3/3/0, 4/4/0; 32 workers: 19/16/3, 22/17/5, 17/15/2, 16/14/2, 18/16/2.
Cause (from the omp 18.18.0 source, [INFERENCE] not instrumented): in patch mode each subagent's
patch is applied when it finishes, by `mergeIsolatedChanges` → `canApplyPatch` then `applyPatch`
(task/isolation-runner.ts:741-786), with no repository lock; branch mode does take
`withRepoLock` because "background merges would race on HEAD and the index"
(task/worktree.ts:1064-1065). ovnfs `apply` is not used on this path (omp diffs the checkout and
`git apply`s the patch), so this is an omp race, independent of C4.

Reproduction: `cd .tasks/archive/2026-11/11-08-ovnfs-concurrency-trial && python3 research/trial/run_all.py --only C10`
(≈40 s); per-run numbers in `results.json` → `claims.C10.measurements.shared_8|shared_32`.

### C3 (conditional): an open checkout is mostly a stable capture, with one leak

After checkout A opened, the folder changed six paths; new checkout B saw all six. A kept the
captured content for a content+size change, a delete, an untracked-file change and a new file, and
showed the live folder for `node_modules` (cache class, as documented). The exception: a tracked
file rewritten **in place with the same size, inode and mtime** showed the new bytes in A, because a
source file is served from the folder while size, mtime and inode match the capture
(docs/configuration.md:32-35). A later size-changing write made A fall back to the captured content.
A 3 s race (15,126 in-place rewrites of a 256 KiB file in the folder vs 21,710 reads in an open
checkout) gave only the captured content, no torn or empty reads. `diff` of A stayed empty, so folder
edits never become checkout changes.

```sh
mkdir c3 && cd c3 && git init -q -b main && printf 'hello world\n' > f.txt && git add . && git commit -qm init && cd ..
ovnfs new c3 --name c3a >/dev/null 2>&1
t=$(stat -c %y c3/f.txt); printf 'HELLO world\n' | dd of=c3/f.txt conv=notrunc status=none; touch -d "$t" c3/f.txt
echo "open checkout reads: $(cat mnt/c3a/f.txt)"
printf 'changed size\n' > c3/f.txt
echo "after a size-changing write: $(cat mnt/c3a/f.txt)"
```

```
open checkout reads: HELLO world
after a size-changing write: hello world
```

### C7 (conditional): a snap waiting on a search also blocks writes to that checkout

docs/internals.md:41-44: "snapshot/removal waits for an active search; ordinary writes can
continue". Both parts hold separately: `snap` and `rm` of the searched checkout finished 0.005–0.024 s
after a 3.9 s `grep` (`--workers 1`, regex without literal prefix, 300 × 4 MiB files); small writes to
that checkout during the grep took ≤ 0.009 s. But a write issued after a `snap` of the same checkout
started waiting (1.3 s into the grep) blocked until the grep ended: 2.54, 2.54, 2.59, 2.59, 2.57 s.
Meanwhile `snap`/`ls`/`new`/`diff` on other checkouts and folders took ≤ 0.024 s, so the stall stays
inside that checkout. Reproduction: `--only C7` (≈70 s); `claims.C7.measurements.grep_with_snap_and_writes`
lists `writes_during_grep_only_s` and `writes_while_snap_waits_s` per run.

### C8 (conditional): snap is O(1) only for data older than 2 s

Settled data (written ≥ 2.5 s before): `snap` 0.016–0.036 s median whether 10 files, 10,000 files or
one 500 MB file changed (max 0.083 s). Right after writing ("hot"), `snap` first moves memory-resident
files to the upper, as docs/internals.md:199-201 says: 10,000 small files 0.236/0.245 s against 0.046 s
for 10 files; a single large file is unaffected (500 MB hot 0.011 s, it left memory at 1 MiB).
`snap --wait` stayed ≤ 0.24 s for every size (500 MB: 0.046 s); the reply carried the tree id.
Forks taken every ~0.4 s while a writer created 17,137 files: 5/5 forks held a gap-free prefix with
matching log lines; only the file being written at that instant may be a prefix of its content.
Reproduction: `--only C8` (≈195 s).

## What could not be tested

- Truly cold disk reads: the page cache was not dropped (needs root, affects the whole machine);
  "cold" is a fresh daemon state on a warm cache.
- Remote attach/mesh/share: excluded by the user (TASK.md 5A).
- Power loss / kernel crash durability (docs/internals.md:150-156): not testable safely here; only
  `kill -9` of the daemon was tested.
- The Windows-only numbers in docs/checkouts.md:20-22 (15 ms create, 50 ms recapture on 3k files):
  Linux equivalents are reported above (warm create ≈ 0.018 s, create after an edit 0.04–0.19 s).
