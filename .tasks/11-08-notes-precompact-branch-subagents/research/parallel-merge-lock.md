# 平行合併鎖：omp C10 與 ovnfs #25

scout `OvnfsApplyLock` 2026-11-08 唯讀查證報告，引用以 omp 18.18.0 安裝版原始碼為準。

# ovnfs `apply` concurrency: source facts + feasible local fix

Prefixes: `omp18/` = `~/.bun/install/omp-releases/18.18.0-f74e59923d16-3b2faede-9ac28b0e/runtime/node_modules/@oh-my-pi/pi-coding-agent/src/`; `ovnfs/` = `~/go/pkg/mod/github.com/stencil-hq/ovnfs@v0.2.3/`.

## 1. How omp 18.18.0 uses ovnfs

**It never calls `ovnfs apply` or `ovnfs diff`.** All daemon calls are `start`/`status` (subprocess) and `new`/`rm`/`grep`/`glob` (admin socket):

- `omp18/ovnfs/daemon.ts:39-75` spawns `command --json start|status` (`:44`), parses `{version,socket,mount}` and requires admin protocol 5 (`:63-69`); `startDaemon` at `:79-83`; `runningDaemon` rechecks every 10 s (`:29-30`).
- `omp18/task/ovnfs.ts:49-61` generic `call(command, op, args)` over the socket; `rm` at `:79`; `new` at `:155`. `releaseOvnfsCheckout` (`:90-101`) is used by `omp worktree clear` (`omp18/cli/worktree-cli.ts:29,237`).
- `omp18/ovnfs/search.ts:77,106` routes `grep`/`glob` to the daemon.
- Backend selection: `omp18/task/structured-subagent.ts:889-894` (`isolation.backend=auto` + ovnfs found ⇒ `ovnfsWorkspace`); `omp18/task/settings.ts:167-189` (`ovnfs.path`, else PATH lookup).

**Merge-back is omp's own git code, not ovnfs.** The checkout is captured with git diff/commit (`omp18/task/isolation-runner.ts:1-9,264-283,411`), then:
- patch mode (default, `omp18/task/settings.ts:191-204`): `repo.applyPatch(normalized)` at `omp18/task/isolation-runner.ts:753-780`;
- branch mode: `mergeTaskBranches` at `:708-716`, which is wrapped in `withRepoLock` (`omp18/task/worktree.ts:1064-1066`).

**Yes, batch merges run concurrently:** `omp18/task/index.ts:1881-1885` calls `mapWithConcurrencyLimitAllSettled(spawns, spawns.length, …)`, and each isolated spawn merges immediately when it finishes (`omp18/task/structured-subagent.ts:1114-1128`). Patch mode in 18.18.0 has **no** `withRepoLock` — that is upstream issue #18483/C10 (fixed by PR 18484), **separate from ovnfs #25**. An ovnfs lock will not fix C10, and omp's isolation path does not exercise `ovnfs apply` at all.

The only `apply` path in practice is the system-prompt guidance telling agents to run `ovnfs apply <name>` by hand (`omp18/prompts/system/system-prompt.md:147-157`).

## 2. Where ovnfs `apply` runs and what is missing

- CLI `runApply` only sends the RPC: `ovnfs/cli.go:449-463` (`call[api.ApplyReply](c, "apply", a)` at `:459`). Dispatch: `ovnfs/ops.go:81-82` → `reg.Apply`. Admin serves each request in its own goroutine (`ovnfs/admin/admin.go:215-223`), so concurrent applies really run concurrently in the daemon.
- Entry: `Registry.Apply` `ovnfs/checkout/diff.go:469`; folder root `:477` (`h.base.view.Meta().Dir`, already symlink-resolved via `source.Resolve` in `ovnfs/checkout/plan.go:19-40`).
- Existing locking: `h.merge sync.Mutex` (`ovnfs/checkout/types.go:193`), taken in `Apply` at `diff.go:500-501` and in `Pull` at `pull.go:94-95`. It is **per checkout**, so two checkouts of one folder are not serialized. The registry-wide `r.mu` is state metadata, not folder I/O.
- Read–merge–write: `applyOne` `diff.go:572-613`; `leafAt` reads current content `:574`, `mergeText` `:608`, `writeAtomic` `:612`.
- `writeAtomic` `diff.go:695-707` uses a fixed temp name `.ovnfs-apply-<base>` (`:696`) and `os.Remove`s it first (`:697`). `place` also uses it (`:665`). `Store.CloneBlob` writes with `O_EXCL` (`ovnfs/store/store.go:407-412`) / `FICLONE`, so the temp path must not exist → generate a unique *name*, don't pre-create via `os.CreateTemp`.
- Daemon scope: defaults are per-user (`ovnfs/main.go:25-33`), and `state.lock` (`ovnfs/checkout/registry.go:58`, `lock_unix.go:13-24`) allows exactly one daemon **per state directory**, not per folder. `grep` found no folder-level lock (`flock` only on state/start/git index). Two daemons with different `--state`/`--mount` can therefore `new` and `apply` the same folder, unprotected. In-daemon mutex fixes the normal single-daemon case only.

## 3. Local install state and patched build

- Only `v0.2.3` is in the module cache (`~/go/pkg/mod/cache/download/github.com/stencil-hq/ovnfs/@v/list`, `v0.2.3.info`: tag `v0.2.3`, commit `63f2700a…`, downloaded 2026-11-08). Binaries exist at `/home/chris/.local/bin/ovnfs` and `/home/chris/go/bin/ovnfs` (both 20.5 MB).
- The **running daemon executes `/home/chris/go/bin/ovnfs`**: `/proc/2760573/cmdline` = `…/go/bin/ovnfs serve -state /home/chris/.local/state/ovnfs -mount /home/chris/checkouts`.
- A live omp session’s PATH starts `.bun/bin:.local/bin:~/bin:…` and contains **no** `go/bin` (`/proc/2760573/environ`), so `which ovnfs` most likely resolves `~/.local/bin/ovnfs` [INFERENCE: not executed]; whether `.local/bin/ovnfs` is a copy or symlink of the go/bin build is unverified.
- No ovnfs fork/patch directory exists in the project; `patches/` is omp-only. The module-cache tree is read-only.
- Build: copy the module to a writable dir, patch, `go build -o …/ovnfs.new .` (go.mod requires go 1.27.3), run `go test ./checkout`, then atomically `mv` over the target. A local build prints `ovnfs (devel) …` (`main.go:136-141`); omp ignores the version string and checks only admin protocol 5 (`client.ts:21`, `daemon.ts:63-69`), so this is cosmetic.
- Replacement requires a daemon restart: the running process keeps the old inode, and only `restart` execs a new `os.Executable()` (`daemon.go:96-100,241-251`). Restarting via `~/.local/bin/ovnfs` would spawn that binary, so invoke the patched path explicitly (or patch both paths / set `ovnfs.path`).
- Restart does **not** drop named checkouts: they are restored from `state.json` (`registry.go:154-183`), and conflict resolutions survive (`docs/checkouts.md:221-222`). Only prepared unnamed checkouts are discarded (`docs/internals.md:190-191`). A planned stop flushes the memory tier (`docs/internals.md:199-201`), so sub‑2 s writes are not lost. Transient errors for processes with cwd/open files inside the remounting mount are [INFERENCE].

## 4. Alternative omp-side fix

Not viable for this bug: omp has no `ovnfs apply` call site to wrap; only the bash tool runs shell text (`omp18/exec/bash-executor.ts:736-738`), so a patch would have to parse arbitrary shell commands — fragile (aliases, subshells, `xargs`, `cd`). An extension cannot intercept subprocesses reliably either.

- Patching omp’s **git-apply** race (`isolation-runner.ts:753-780` under `withRepoLock`) fixes C10/#18483, not ovnfs #25; it is a separate, larger change (new family + gate + replay under this repo’s rules, since no family owns `isolation-runner.ts`).
- A wrapper script named `ovnfs` that flocks around `apply` only covers CLI callers and must parse `apply`’s checkout name to find the folder; weaker than the daemon patch.

## Feasible designs (smallest first)

1. **Daemon-side lock (recommended).** In `Registry`, add one context-aware apply gate (buffered `chan struct{}` of size 1, or a keyed map by `h.base.view.Meta().Dir` if unrelated folders must overlap) acquired after the `--branch` early return and **before** `h.merge.Lock()` (`diff.go:477-501`), released at return. Serializes read→merge→rename and `setMergeBases` per folder. Then fix `writeAtomic` (`:696`) to a unique name (pid + atomic counter + base; no pre-remove), preserving the `O_EXCL`/symlink callbacks. ~20 lines + one concurrency test in `checkout/apply_test.go` (N checkouts, disjoint lines, assert all edits and no `not_found`). Use a channel/select on `ctx.Done()` rather than `sync.Mutex` so canceled waiting applies still return `canceled`.
2. **Cross-process robustness (optional).** If multiple daemons may share a folder, add `flock` on `$XDG_RUNTIME_DIR/ovnfs/apply-<sha256(root)>.lock` (not a file inside the repo — the folder is watched and git-visible). More code; unnecessary for the default single daemon.
3. **omp patch for C10 separately.** Wrap patch-mode `repo.applyPatch` (+ nested apply) in `withRepoLock`; mirrors PR 18484. Does not fix #25.

Risks: holding the gate across `Snap` blocks other applies to that folder for seconds (intended); keyed-map cleanup; lock ordering must remain gate → `h.merge` → freeze → `r.mu` (per `types.go:193`); patching creates an upstream-divergent build and `(devel)` version output; restart disturbs currently running agents inside checkouts.

## Unknowns

- Whether upstream `main` already fixes #25 (not checked live; issue says post-tag commits did not touch this code).
- Exact `which ovnfs` result and whether `~/.local/bin/ovnfs` is the same build as the running `go/bin` one.
- Go toolchain presence/version locally (go.mod says 1.27.3; trial recorded go1.27.3).
- Restart’s transient effect on open FUSE handles / agent cwd.
- Whether any user workflow actually runs a second daemon against the same folder (only then is the flock variant needed).