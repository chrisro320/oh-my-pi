# Session cache keepalive — implementation plan

Planning was approved and `task.py start` moved the task into implementation.

## Ordered checklist

### 1. Enter Trellis development

- Run the `trellis-before-dev` workflow against
  `.trellis/tasks/08-25-session-cache-keepalive`.
- Load the nearest project instructions plus `.trellis/spec/guides/index.md`,
  `cross-layer-thinking-guide.md`, and `code-reuse-thinking-guide.md`.
- Capture pristine copies of every installed OMP 18.0.4 source/type file that the
  new source patch will touch before editing.
- Confirm the active `~/.bun/bin/omp` link still targets `src/cli.ts` and the
  existing 0002-0007 patch set is applied.

### 2. Add the guarded core seam

- Add `IdleEphemeralTurnOptions` and `IdleEphemeralTurnResult` to extension
  types, plus `ExtensionContext.runIdleEphemeralTurn()` and its action handler.
- Add `AgentSession.runIdleEphemeralTurn()` with a synchronous idle reservation.
  Every authoritative main-turn entry must increment its in-flight count, abort
  an existing idle reservation, and wait for it to settle before provider
  dispatch; raw `runEphemeralTurn()` remains unchanged for concurrent `/btw` and
  `/omfg` side requests.
- Wire the guarded method through `ExtensionRunner.initialize()` and
  `createContext()`.
- Update all six session-host context constructions:
  1. common runtime initialization
  2. TUI extension controller initialization
  3. TUI hook-runner reinitialization
  4. ACP managed session
  5. task executor session
  6. runner-less `AgentSession` command context
- Update `dist/types/extensibility/extensions/types.d.ts`; do not modify the stock
  `dist/cli.js`.

Cross-layer gate: search every `getSystemPrompt: () =>` host construction and
verify each corresponding context also supplies `runIdleEphemeralTurn`. Expected
host count: six, excluding the runner's returned context and the interface
itself.

### 3. Replace the generic cron extension

- Rewrite `patches/cron-extension.ts` around a factory-local `KeepaliveState`.
- Implement one duration parser shared by command and tool entry points:
  `s`/`m`/`h`, minimum 240,000 ms, maximum 2,147,483,647 ms.
- Implement managed one-shot scheduling with generation invalidation and exactly
  one timer/request per extension instance.
- Implement idle/pending/model/session gates and an `AbortController` for every
  provider request.
- Handle `agent_start`, terminal `agent_end`, pre-switch, pre-branch, shutdown,
  compact, and tree-navigation lifecycle events according to `design.md`.
- Implement only `/cron [status|off|<duration>]` and tool actions
  `status|enable|disable`.
- Record bounded diagnostics in `~/.omp/agent/cache-keepalive.log`; keep status
  counters in memory only.
- Copy the tracked extension to `~/.omp/agent/extensions/cron.ts` and verify the
  two files are byte-identical.
- Leave legacy `cron.json` and `cron.log` untouched but unused.

Clean-cutover gate: both extension copies must have zero matches for the removed
HTTP/shell/config implementation symbols (`CronJob`, `spawn`, `fetch`,
`watchFile`, `cron.json`, `url`, `runAtStart`, `maxRuns`).

### 4. Make the core change reproducible

- Generate `~/.omp/patches/0010-omp-extension-idle-ephemeral-turn.patch` from the
  pristine OMP 18.0.4 copies and the edited installed files.
- Add 0010 after 0007 in `~/.omp/patches/apply.sh`.
- Verify forward and reverse dry runs; the patch must be idempotently classified
  as `APPLIED`, not fuzzy-applied.
- Document the new patch and keepalive extension in
  `~/.omp/patches/README.md` and tracked `patches/PATCHES.md`.

### 5. Add focused behavioral verification

Create `patches/verify-session-cache-keepalive.ts`, using a fake extension API,
managed timer, and context to defend these observable contracts without a
provider call:

- `239s` rejects and `4m` schedules
- enable replaces the prior timer rather than duplicating it
- busy/queued final gate sends no request
- `agent_start` aborts an in-flight request and stale completion cannot reschedule
- terminal `agent_end` schedules; `willContinue` does not
- switch/branch/shutdown disable permanently for that extension instance
- compact/tree events reset one full countdown
- `cacheRead > 0`, `cacheRead = 0`, and thrown provider errors classify distinctly
- two extension factory invocations do not share state
- the tool schema and command surface contain no generic scheduler operations

Create `patches/verify-idle-ephemeral-reservation.ts` with real `AgentSession`
instances and delayed mock transports. It must prove:

- guarded ordering is `side-dispatch → side-abort → side-settled → main-dispatch`
- abort/reset during settlement drops the superseded main dispatch and protects
  the replacement epoch from the stale finalizer
- raw `runEphemeralTurn()` remains concurrent with main turns
- `beginDispose()` aborts a direct guarded request without an extension signal
- tree navigation rejects idle work before its first `await`
- neither guarded nor raw ephemeral prompts persist to transcript state

Both harnesses test behavior, not source text or private helpers.

## Validation

### Static and load checks

1. Run both focused Bun harnesses.
2. Type-check the extension and fake-timer harness under strict settings using
   the installed package declarations.
3. Bundle the source entrypoint so every edited core host and type boundary is
   parsed together.
4. Run a source-mode OMP extension-discovery smoke test; extension load
   diagnostics must be empty and the `cron` tool/command must be registered once.
5. Run `~/.omp/patches/apply.sh --check`; 0002-0007 and 0010 must report
   `APPLIED`, and `bin/omp` must target `src/cli.ts`.
6. Compare `patches/cron-extension.ts` with the live extension byte-for-byte.

### Actual-surface smoke test

Use a disposable live OMP session, not a direct test-only call:

1. Complete one ordinary model turn and wait for the session to settle.
2. Record the session transcript/message entry count.
3. Run `/cron 4m`; verify status is scheduled with a next-run time.
4. Wait through the real four-minute minimum without user activity.
5. Verify one `cache-keepalive.log` record has the same session/provider/model and
   `cacheRead > 0`.
6. Verify the transcript/message entry count is unchanged by the keepalive.
7. Enable again, switch to a disposable second session, and verify the old timer
   does not fire and `/cron status` is disabled there.
8. Exit and reopen OMP; verify `/cron status` remains disabled.

Provider rejection or `cacheRead = 0` is not a passing substitute for step 5.
Use the actual active provider/model and report its exact usage fields.

## Execution status

> RESUME: complete — proceed through Phase 3.4 commit and `/trellis:finish-work`.

- [x] S1 preflight/source patch baseline — verified; OMP 18.0.4 runs `src/cli.ts`,
  pristine copies are in `/tmp/omp-session-cache-keepalive-base`.
- [x] S2 core seam + keepalive extension — verified by both Bun harnesses, strict
  extension type-check, source bundle, six-host grep, clean-cutover grep,
  byte-identical live mirror, and `apply.sh --check`.
- [x] S3 actual-surface smoke — verified: session
  `01a03944-4e3d-7000-9d42-979a9e3d5fed` logged
  `input=5250 output=5 cacheRead=9984 cacheWrite=0` in
  `/tmp/omp-keepalive-live.log`; transcript stayed at 8 lines. Session switch
  showed disabled, restart showed disabled, and a separately armed timer produced
  no `/tmp/omp-keepalive-cancel.log` after its real four-minute deadline.
- [x] S4 closeout — consolidated behavior/type/build/discovery/patch/host/
  clean-cutover validation passed; AC1-AC9 are checked. Independent
  `trellis-check` found two P1 lifecycle gaps: disposal did not abort a direct
  guarded request, and tree navigation installed its gate after the first await.
  Both were fixed, added to the real `AgentSession` harness, revalidated, and
  reviewer-confirmed PASS with patch 0010 synchronized.

## Risky files and rollback points

- `types.ts` plus six context hosts are one atomic interface cutover. Do not leave
  a required action missing in one host mode.
- The source patch and installed source must be generated from the same final
  bytes; otherwise an upgrade reapply silently loses behavior.
- Before replacing the live extension, retain its prior bytes until focused tests
  pass. Rollback restores that file, reverses 0010, removes its `apply.sh` entry,
  and restarts OMP.
- Do not delete legacy `cron.json` or `cron.log` during rollback or migration.

## Completion gates

- Run `trellis-check` after implementation and actual-surface verification.
- Run the required `trellis-update-spec` phase so the extension-context seam,
  source-patch reapply rule, and live-session keepalive lifecycle become inherited
  project guidance.
- Re-read the Trellis handbook before closing the batch.
