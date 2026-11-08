# S2 Batch 2 — version-agnostic gate rewrites (anthropic / oauth / cache / worker tooling)

Registry: `patches/versions.json` = `18.16.0` (oldest, O) and `18.18.0` (newest, N). Every converted gate resolves its
plan with `resolvePlan({ gate, roots })` (TS) / `resolve_plan` (Py) / `omp_plan_version` (bash) and branches with
`since("<first release with the behaviour>")`. No gate wraps its whole body in a version `if`: arms that are always true
for O and N were unwrapped, arms that are true for neither were deleted (retired-only), and messages either drop the
number or interpolate `plan.version`.

## Boundary table

`old` is the literal test as it stood; `new` is the rewritten form. "O/N" = value at 18.16.0 / 18.18.0, old vs new.
Since O and N are both inside every kept arm, the value is identical by construction; the only real choices are the
boundary release and the deleted retired arms, listed per file.

| file:line (pre-edit) | old | new | O / N old vs new |
|---|---|---|---|
| verify-compaction-lane-trace.ts:88 | `[...12 versions].includes(aiVersion)` support list | `resolvePlan({gate, roots:[AI_ROOT, CORE_ROOT]})` | true/true vs accepted/accepted |
| verify-compaction-lane-trace.ts:405,458,522 | `["18.10.0"…"18.18.0"].includes(coreVersion) ? {} : {encryptedContent}` | spread removed (always `{}`) | true/true vs same |
| verify-compaction-lane-trace.ts:417,433,482 | `["18.4.4"…"18.18.0"].includes(coreVersion) {…}` | body unwrapped | true/true vs same |
| verify-idle-ephemeral-reservation.ts:34 | `[...13 versions].includes(agentVersion)` | `resolvePlan(...)` | true/true vs accepted |
| verify-idle-ephemeral-reservation.ts:37 | `hasSubmissionWindow = ["18.2.3"…].includes(...)` | arm unwrapped (window landed 18.2.3 ≤ O) | true/true vs same |
| verify-idle-ephemeral-reservation.ts:56 | `["18.3.3"…].includes ? keys.setRuntime : setRuntimeApiKey` | `keys.setRuntime(...)` (legacy else deleted) | true/true vs same |
| verify-idle-ephemeral-reservation.ts:416 | `["18.10.0","18.10.1"].includes(...)` transition asserts | arm deleted (retired-only) | false/false vs absent |
| verify-idle-ephemeral-reservation.ts:534 | `["18.10.0","18.10.1"].includes ? ["ask-reanswer","prompt"] : []` | loop deleted (empty for O and N) | false/false vs absent |
| verify-oauth-durable-refresh.ts:85 | `[...7 versions].includes(aiVersion)` | `resolvePlan(...)` | true/true vs accepted |
| verify-oauth-durable-refresh.ts:86 | `hasExchangeReservation = ["18.10.0"…].includes` | always true → arm unwrapped, flag deleted | true/true vs same |
| verify-oauth-durable-refresh.ts:88 | `hasUnlockRevision = ["18.10.1"…].includes` | always true → arm unwrapped, flag deleted | true/true vs same |
| verify-oauth-durable-refresh.ts:1039,1007 | `assert.equal(hasUnlockRevision/hasExchangeReservation, true)` | removed (resolvePlan guarantees the registered set) | true/true vs same |
| verify-oauth-durable-refresh.ts:1069 | `assert.ok(["18.12.6","18.16.0","18.18.0"].includes(aiVersion))` | removed (18.12.6 ≤ O) | true/true vs same |
| verify-oauth-durable-refresh.ts:1126,2048,2128,3115,3558,3942 | `["18.16.0","18.18.0"].includes(aiVersion) {…}` (18.16.0 arms) | body unwrapped; 18.10-era else paths deleted | true/true vs same |
| verify-oauth-durable-refresh.ts:3548 | `refresh([...].includes(aiVersion) ? 250 : 1)` | `refresh(250)` | 250/250 vs same |
| verify-oauth-durable-refresh.ts:1729 | `const checkUsageIdentity = hasExchangeReservation && entry === "usage" …` | `= entry === "usage" && change === "replacement"` | same/same |
| verify-oauth-durable-refresh.ts:1837-1840 | `race === … ? hasExchangeReservation ? json : tokenReply : status` | nested ternary collapsed to the json arm | same/same |
| verify-oauth-durable-refresh.ts:1865 | `race === "takeover-only" && hasExchangeReservation` | `race === "takeover-only"` | same/same |
| verify-anthropic-native-compaction-live-context.ts:63-72 | `SUPPORTED_PLANS` list + tree assert | `resolvePlan({roots:[CORE_ROOT]})` | true/true vs accepted |
| verify-anthropic-native-compaction-live-context.ts:129 | `["18.10.0"…].includes(coreVersion) ? {} : {encryptedContent}` | spread removed | true/true vs same |
| verify-anthropic-native-compaction-live-context.ts:176 | `wholeChainPlan = ["18.4.4"…].includes(coreVersion)` | always true → `mainPreparation = livePreparation`; flag deleted | true/true vs same |
| verify-anthropic-native-compaction-live-context.ts:281 | `localLiveLegs = wholeChainPlan && hasLocalLiveScope` | `= hasLocalLiveScope` | same/same |
| verify-anthropic-native-compaction-live-context.ts:292 | `if (wholeChainPlan) {…} else if (["18.3.3","18.4.1"]…) {…} else {…}` | first body kept; both retired arms deleted | true/true vs same |
| verify-anthropic-native-compaction-live-context.ts:326 | `wholeChainPlan ? "recent-user" : "recent-assistant"` | `"recent-user"` (+ its message) | same/same |
| verify-anthropic-native-compaction-live-context.ts:322,432 | `["18.3.3"…"18.18.0"]` / `["18.12.6","18.16.0","18.18.0"] {…}` | bodies unwrapped | true/true vs same |
| verify-prefix-cache-compaction.ts:69 | `agentVersion = JSON...` | `plan.version` | same |
| verify-prefix-cache-compaction.ts:70 | `liveChainPlan = ["18.4.4"…].includes(agentVersion)` | always true → ternaries `["history","live"]`, if unwrapped, flag deleted | true/true vs same |
| verify-prefix-cache-compaction.ts:794 | `["18.10.0"…].includes(agentVersion) {…}` | body unwrapped | true/true vs same |
| verify-prefix-cache-compaction.ts:896-901 | support list + 18.1.14 early exit | removed (retired-only) | true/true vs same |
| verify-subagent-warm-revival-prompt.ts:75-86 | `SUPPORTED_PLANS` list + throws | `resolvePlan(...)`, `agentVersion = plan.version` | true/true vs accepted |
| verify-subagent-warm-revival-prompt.ts:148 | `mustFail: ["18.12.6","18.16.0","18.18.0"].includes ? [g] : [a1,a2,b]` | `["g-default-prompt-setting-drift"]` | true/true vs same |
| verify-subagent-warm-revival-prompt.ts:181 | `...(["18.16.0","18.18.0"].includes ? [mounted-device control] : [])` | control inlined into `MUTATIONS` | true/true vs same |
| verify-subagent-warm-revival-prompt.ts:348 | `...(["18.12.6"…].includes ? {"task.structured": true} : {})` | `"task.structured": true` | same/same |
| verify-subagent-warm-revival-prompt.ts:503,507 | `options.items && [...].includes(agentVersion)` | `options.items` | same/same |
| verify-subagent-warm-revival-prompt.ts:637,737 | `["18.12.6"…]` / `["18.16.0","18.18.0"] {…}` | bodies unwrapped | same/same |
| verify-anthropic-cache-boundaries.ts:17-30 | `SUPPORTED_PLANS` + env/tree asserts | `resolvePlan({roots:[AI]})` | true/true vs accepted |
| verify-anthropic-cache-boundaries.ts:133 | `if (!["18.16.0","18.18.0"].includes(aiVersion)) {cacheRetention none legs}` | arm deleted (negation: false for O and N) | false/false vs absent |
| verify-anthropic-cache-boundaries.ts:141,244 | `["18.12.6"…]` / `["18.10.0"…] {…}` | bodies unwrapped | true/true vs same |
| verify-anthropic-cache-boundaries.ts:311 | `${["18.10.0"…].includes(aiVersion) ? ", credit-safe retry…" : ""}` | `, credit-safe retry on both rungs`; `${aiVersion}` → `${plan.version}` | same/same |
| verify-anthropic-cache-boundaries.ts:316 | `aiVersion === "18.18.0"` | `plan.since("18.18.0")` | false/true vs same |
| verify-devin-idle-cascade-pin.ts:28-33 | `[...12 versions].includes(agentVersion)` | `resolvePlan(...)`, `agentVersion = plan.version` | true/true vs accepted |
| verify-devin-idle-cascade-pin.ts:47 | `["18.3.3"…].includes ? keys.setRuntime : setRuntimeApiKey` | `keys.setRuntime(...)`; legacy else deleted | true/true vs same |
| verify-snapcompact-model-billing.ts:48-59 | `SUPPORTED_PLANS` + env/tree asserts | `resolvePlan({roots:[SNAP_ROOT]})` | true/true vs accepted |
| verify-snapcompact-model-billing.ts:121 | `["18.7.0"…].includes(version) {measured billing}` | body unwrapped | true/true vs same |
| verify-snapcompact-model-billing.ts:177 | `["18.12.6","18.16.0","18.18.0"] {catalog budget} else {legacy}` | catalog body kept; legacy else deleted | true/true vs same |
| verify-session-pin-static-auth-ui.ts:13-23 | version read, `=== "18.2.3"` load-only arm, 10-version list | `resolvePlan(...)`; 18.2.3 arm deleted; env-equality assert folded into resolvePlan | true/true vs accepted |
| verify-session-pin-static-auth-ui.ts:75 | `["18.12.6","18.16.0","18.18.0"] {viewSession}` | body unwrapped | true/true vs same |
| verify-anthropic-thinking-drop-resume.ts:17-21 | version read + 6-version list + `serverManagedDrops = ["18.10.0"…]` | `resolvePlan({roots:[AI]})`; `serverManagedDrops = true` (18.10.0 ≤ O) | true/true vs same |
| verify-anthropic-thinking-drop-resume.ts:432 | `version === "18.18.0"` (thread leg) | `plan.since("18.17.0")` — threads land in 18.17.0 | false/true vs same |
| verify-provider-image-budget.ts:31-47 | version read + 7-version list | `resolvePlan({roots:[SNAP_ROOT]})` | true/true vs accepted |
| verify-provider-image-budget.ts:49-56 | `["18.16.0","18.18.0"] / === "18.12.6" / else` dispatch | the three 18.16+ arms kept unconditionally; `verifyFlatTable()` deleted (retired-only) | true/true vs same |
| verify-provider-image-budget.ts:323 | `version === "18.12.6"` byte-wire scenarios | arm deleted (retired-only) | false/false vs absent |
| verify-provider-image-budget.ts:434 | `"18.16.0 must resolve image counts…"` message | number dropped | same |
| verify-rejected-prepared-draft-restore.ts:87-88 | version read + 7-version assert | `resolvePlan(...)`, `agentVersion = plan.version` | true/true vs accepted |
| verify-rejected-prepared-draft-restore.ts:600 | `["18.16.0","18.18.0"].includes(agentVersion) ? strip : sent` | `sent.replace(...)` (both take the journaled shape) | true/true vs same |
| verify-model-mention-surface-resume.ts:26-34 | version read + 8-version assert | `resolvePlan(...)` (18.3.4/18.4.1 boundaries ≤ O) | true/true vs accepted |
| verify-compaction-length-stop.ts:31-33,71-72 | `PLAN_VERSIONS` list, env assert, tree assert | `resolvePlan(...).version` | true/true vs accepted |
| verify-remote-compaction-target-key.ts:30-32,70-71 | same shape | same rewrite | true/true vs accepted |
| verify-advisor-quota-rotation.ts:86-87 | tree version + 2-version assert | `resolvePlan(...)` | true/true vs accepted |
| verify-date-cwd-journal-prefix.ts:45-47 | tree version + 2-version assert | `resolvePlan(...)` | true/true vs accepted |
| verify-provider-registry-lazy.ts:48-52 | tree version + 2-version assert | `resolvePlan(...)` | true/true vs accepted |
| verify-worker-pool-fixture.ts:56-57,88 | `assert.equal(version,"18.18.0")` pin, pinned-message | `resolvePlan` (parent, before HOME sanitizing) + `assert.ok(plan.since("18.18.0"))`, child gets `plan.version`, message de-versioned | false/true vs same |
| verify-tool-schema-bytes.ts:31-37,53,160 | `PLAN_VERSIONS` + env + tree asserts, child env, message | `resolvePlan({roots:[AI_ROOT]})`, child gets `plan.version`, message drops the number | true/true vs accepted |
| verify-cache-warming-idle-budget.ts:179 | `process.env.OMP_PATCH_VERSION === "18.18.0" ? undefined : true` | `plan.since("18.18.0") ? undefined : true` | false/true vs same |
| verify-cache-warming-idle-budget.ts:211 | `process.env.OMP_PATCH_VERSION === "18.18.0"` | `plan.since("18.18.0")` | same |
| verify-computer-control-confirm-deadline.ts:38-39 | tree version + 2-version assert | `resolvePlan(...)` | true/true vs accepted |
| verify-extensions-load-18180.ts:205-217 | tree pin `"18.18.0"` + env pin | `resolvePlan(...)` + `assert.ok(plan.since("18.18.0"))`; `agentVersion = plan.version` | false/true vs same |
| verify-kitty-shared-png-cache.ts:9,437-440 | `tuiVersion === "18.18.0" ? 2 : 1` | `plan.since("18.18.0") ? 2 : 1`, message interpolates `plan.version` | false/true vs same |
| verify-anthropic-threads-cache-shape.ts:110-130,182 | `SUPPORTED_PLANS = ["18.18.0"]` + env/tree pins; child env passed only when set | `resolvePlan` + `since("18.18.0")`; child env always `plan.version` | false/true vs same |
| verify-anthropic-threads-warm-compaction-isolation.ts:74-95,148 | same shape | same rewrite | false/true vs same |
| verify-oauth-worker-single-owner.ts:63-81 | `SUPPORTED_PLANS` + env/ai/agent pins | `resolvePlan({roots:[AI_ROOT, AGENT_ROOT]})` + `since("18.18.0")` | false/true vs same |
| run-worker-matrix.py:46 | `OMP_PATCH_VERSION: '18.18.0'` for `apply.sh --print-gates` | `resolve_plan(roots=[runtime/…/pi-coding-agent]).version` | derived vs derived |
| worker-matrix.sh:23 | `--setenv OMP_PATCH_VERSION 18.18.0` | `omp_plan_version` of the runtime under test | derived vs derived |
| verify-compaction-live-chain-midnight.ts:16 | `assert.equal(version, "18.18.0")` | `resolvePlan` + `assert.ok(plan.since("18.18.0"))` | false/true vs same |
| verify-retry-slow-schedule.ts:14 | `process.env.OMP_PATCH_VERSION === "18.18.0"` | `plan.since("18.18.0")` (derived from AGENT_ROOT) | same |

## Boundaries chosen (first release with the behaviour)

* `18.18.0`: message threads / thread-shaped cache and live replay, worker-mode single owner, companion staging
  (`verify-extensions-load-18180`), Kitty shell-replay teardown, `CacheWarmer` stop clock.
* `18.17.0`: "message threads land in 18.17.0" — used for the thinking-drop thread leg (first release with threads).
* `18.12.6` / `18.10.1` / `18.10.0` / `18.4.4` / `18.2.3` / `18.1.x`: all ≤ oldest registered release, so every arm
  keyed on them is always true (unwrapped) or, for negations and for lists that exclude both O and N, retired-only
  (deleted). No `since()` boundary outside `(18.16.0, 18.18.0]` is present in the converted files (checker `notes: []`).

## Harness dependencies copied with gate copies

`worker-matrix.sh` sources `version-registry.sh` next to itself and derives the plan from the runtime; the gate it
runs is reached through the read-only repo bind, so `version-registry.ts` + `versions.json` are the real ones.
`run-worker-matrix.py` imports `version_registry` from `patches/`. No converted gate copies itself into another
directory; the audit gate spawns the thread gates in place.

## Native items (contract §8) — decision: retired recipes moved, overlay REQUIRED

Two-version rule (main, follow-up): native tooling must not default to a retired version.

* `patches/native/build-natives.sh` — the overlay is a required argument (`overlay="${3:-}"`, usage error exit 2 without
  it); header/usage updated; header no longer names a default recipe.
* `patches/verify-native-overlay.py` — `--overlay` is `required=True`; docstring/usage updated; the unused default-path
  constant is gone.
* Moved verbatim (sha256 verified) into `patches/.retired/11-07-pre-18.16-plans/native/`: `overlay.json` (18.10.1),
  `18.12.6/` (2 files) and the root `0001-escape-monitor-mapping-refresh.patch` (neither `native/18.16.0/overlay.json`
  nor `native/18.18.0/overlay.json` references it: each resolves patches relative to its own directory and carries its
  own copy; the 18.16.0 local copy's sha256 still matches its overlay).
* References fixed: `patches/DEPLOYMENT-RUNBOOK.md` (superseded 18.12.6 recipe now points at the retired path and states
  the argument is required; the installation step passes `patches/native/<version>/overlay.json` to both tools),
  `.trellis/spec/backend/patch-rollup-contracts.md` (signatures now `--overlay PATH` required, no historical default),
  `patches/PATCHES.md` (path fix only). `.gitignore` has no `native/` entry, so nothing to change. The archived
  `.retired/11-07-PATCHES-history.md` is history and was left untouched.

Verification (receipt `s2-batch2-native.json`): `build-natives.sh w o` → usage error exit 2 (no build); verifier without
`--overlay` → argparse exit 2; `bwrap --unshare-net` + private HOME `verify-native-overlay.py --nm
<18.18.0 candidate copy>/node_modules/@oh-my-pi --overlay patches/native/18.18.0/overlay.json` → PASS (2 addons,
1 patch); whole-tree literal check exit 0 (126 files, 0 violations); the four menus remain byte-identical.

## Verification

* `python3 patches/verify-no-version-literals.py <35 batch files>` → exit 0, `violations {}`, `notes []`
  (receipt `s2-batch2-literals.json`).
* Menus byte-identical to `/var/tmp/omp-vagn-baseline/` for 18.16.0 and 18.18.0, both modes (receipt
  `s2-batch2-menu.json`; sha256 `e47e0e1d…`, `4d8ac593…`, `7cbd48dc…`, `15c35ab0…`).
* 18.18.0 candidate runtime (`/var/tmp/omp-vagn-s1/run/runtime-18180`), `bwrap --unshare-net` + private HOME:
  `verify-anthropic-request-audit.ts` PASS (including the spawned `verify-anthropic-threads-cache-shape.ts`) and 29
  converted gates PASS. `verify-extensions-load-18180.ts` fails closed before its version arm because
  `OMP_EXTENSIONS_STAGED_DIR` (a staged private fixture) is not present in this environment. Receipt
  `s2-batch2-gates.json`; per-gate output `/tmp/b2-<gate>.out`.
* Negative controls: `18.19.0` (unregistered) and env≠runtime are refused with the registry message on
  `verify-tool-schema-bytes.ts`, `verify-retry-slow-schedule.ts`, `verify-oauth-durable-refresh.ts` (exit 1, nothing
  skipped).

### Not run by this batch (handoff)

* 18.19.0 relabel simulation against the converted children (S1's `/var/tmp/omp-vagn-s1/sim` + `runtime-18190` exist;
  the run needs a temp `patches/` copy whose `versions.json` is `["18.18.0","18.19.0"]` so that the gate copies resolve
  the sim registry). The audit gate's children now follow the registry instead of pinning 18.18.0, which is what that
  simulation exercises.
* `run-worker-matrix.py` / `worker-matrix.sh` end-to-end (matrix harness; every selected gate they wrap passes
  individually).

## Follow-up fixes (review of batch 2)

1. `verify-extensions-load-18180.ts` child env now forwards `OMP_PATCH_VERSION: plan.version` (the stale `selectedPlan`
   is gone). Exercised past the staging prerequisite with the prior task's private 15-module companion fixture
   (`/var/tmp/omp-18180-m8e/full/companions`, never the live agent dir) on the 18.18.0 runtime copy: **8/8 legs PASS**.
2. `verify-anthropic-native-compaction-live-context.ts`: the `hasLocalLiveScope` block now closes directly after the
   safe-cut `for` loop, matching `9c9dc16e:patches/verify-anthropic-native-compaction-live-context.ts` (block 336–383
   inside the always-true arm); the stray EOF brace is gone. Gate PASS on the 18.18.0 copy.
3. `run-worker-placement-controls.py` copies `version-registry.sh` + `versions.json` into its harness beside
   `worker-matrix.sh`; placement controls PASS with every mutation rejected (10 gates, worker mode). The full matrix was
   not run end-to-end (~10 min window).
4. `verify-worker-pool-fixture.ts` resolves the plan in the parent before the private-HOME env is built and forwards
   `plan.version`; unregistered and mismatch both refuse.
5. Children of `verify-oauth-durable-refresh.ts` (4 spawns), `verify-subagent-warm-revival-prompt.ts` (`childEnv`),
   `verify-advisor-quota-rotation.ts`, `verify-compaction-live-chain-midnight.ts` and
   `verify-date-cwd-journal-prefix.ts` (`childEnv`) forward `OMP_PATCH_VERSION: plan.version` explicitly.
6. Boundary-table row for `verify-worker-pool-fixture.ts` corrected: the old pin was false at 18.16.0 and true at
   18.18.0. New row: `| verify-worker-pool-fixture.ts:56-57,88 | ... | false/true vs same |`.

Receipts: `s2-batch2-fix-extensions.json`, `s2-batch2-fix-native-structure.json`, `s2-batch2-fix-placement.json`,
`s2-batch2-fix-children.json`.
