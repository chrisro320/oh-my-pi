# Patch Rollup Contracts

## Scenario: Consolidating a finalized patch family

### 1. Scope / Trigger

Use this contract when multiple finalized patches implement, repair, or supersede one feature and `apply.sh` needs special status logic to keep the chain replayable.

A rollup changes patch representation only. The old effective chain and the new active chain MUST produce byte-identical package trees from the same official pristine release.

### 2. Signatures

Supported controller modes:

```sh
patches/apply.sh
patches/apply.sh --check
patches/apply.sh --revert
patches/apply.sh --verify-rollups
OMP_PATCH_OFFLINE_VERIFY=1 patches/apply.sh
```

Active entries retain the existing file/root contract:

```sh
"<patch-file>:${AGENT|CORE|AI|SNAP|NM}"
```

Cross-package rollups use paths such as `pi-agent-core/...` and are applied from `${NM}` with `patch -p1`.

### 3. Contracts

- Pristine input MUST be the official pinned npm release tarball, verified by SHA-256 before extraction.
- NEVER patch `~/.bun/install/cache` or live `node_modules` to generate or verify a rollup. Bun may hard-link those trees; an in-place patch can mutate both. The same trees are also unreadable as pristine sources: in-place patching has written through the cache repeatedly (pi-ai@18.1.14's `ollama.ts` was found carrying the 18.1.18 file on 2026-09-13; `auth-storage.ts` has carried 0026-core since 2026-08-29), so any cache copy may already contain patch output. Pristine means an official tarball verified by SHA-256 — nothing else.
- Generate each family in an isolated `mktemp` tree by applying only that family's old patches in historical order.
- The rollup touched-file set MUST equal the union of its old family touched-file sets.
- Any failed hunk, `.orig`, `.rej`, or unexpected `Only in` output MUST abort generation.
- Finalized old patches MUST remain byte-identical in a retired directory with pinned hashes.
- Full-chain verification MUST consume the exact file/root/order sequence parsed from `apply.sh`; a second hand-maintained active list is not an oracle.
- Runtime source bytes MUST remain unchanged when switching from the old effective chain to the rollup chain. This equivalence is discharged per family on the family-generation baseline (old member chain vs rollup, byte-compared) — no single baseline can host both the retired member shapes and the current chain, so a whole-chain old-vs-new oracle is not required and MUST NOT be faked by pointing both sides at the same resolved plan.
- Identical OLDCHAIN/resolved plans MUST be materialized only once. A NOTE is not
  equivalence evidence. When representations differ, OLDCHAIN must name retained
  original bytes explicitly; resolving an overwritten same-name file is not a before oracle.
- Controller patch commands MUST use `--no-backup-if-mismatch`; revert also
  uses `--remove-empty-files`. Apply/revert/replay must leave no `.orig`, `.rej`,
  or empty files that were absent from pristine.
- `OMP_PATCH_OFFLINE_VERIFY` accepts only `0` or `1`. `1` is reserved for
  isolated zero-provider replay and skips the real provider smoke; unknown
  values abort before mutation.
- A later active entry MAY rewrite lines an earlier one introduced (patch 0041
  over 0037). Patch state is therefore a property of the whole stack: status
  detection MUST peel applied layers top-down and replay them bottom-up in a
  sandbox, never probe one entry in isolation on the final tree. A pure-insertion
  patch may pass a forward dry-run after application; its reverse dry-run and
  stack-level byte comparison remain the required applied-state checks.
- Every sandbox mutation used for status detection MUST be gated on a clean
  dry run. A patch that fails midway still rewrites the hunks it already
  matched, which would corrupt every verdict computed after it.
- Status detection MUST NOT write to live `node_modules`; mirror only the files
  each patch declares in its `--- a/` headers.
- Nothing in this document weakens the retention rule above: a patch that ever
  entered the active chain MUST keep its bytes and pinned hash in the retired
  directory. Deletion is permitted only for a patch that never entered the
  active chain and served solely as a record or rollback token.
- A retired or abandoned patch number MUST NOT be reused, whether its file was
  kept or deleted. The verifier MUST assert every abandoned number is absent
  from the `apply.sh` chain; documentation alone is not an acceptance gate.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Official tarball SHA differs | Abort before extraction |
| `npm pack` fails | Keep the selected file empty and use the pinned direct-download fallback |
| An old-family hunk fails | Abort; do not diff a half-patched tree |
| Sandbox contains `.orig` or `.rej` | Abort and regenerate from a fresh sandbox |
| Rollup touched-file set differs from old-family union | Abort as cross-family contamination |
| Old-final and rollup-final differ | Abort and report the first differing file |
| Reverse rollup does not restore pristine/family pre-state | Abort |
| `apply.sh` active sequence cannot be parsed exactly | Abort full-chain verification |
| Runtime source hash changes during representation cutover | Stop synchronization and restore the controller from the repository |
| Apply/revert creates `.orig`, `.rej`, or leaves an added file empty | Abort; fix controller flags and restart from pristine |
| `OMP_PATCH_OFFLINE_VERIFY` is neither `0` nor `1` | Exit 2 before mutation |
| Offline replay mode is `1` | Skip provider smoke; do not claim live provider acceptance |
| `--check`: all applied, all pending, or mixed applied/pending | Exit 0; source and bin unchanged |
| `--check`: any conflict or missing ordinary patch | Exit 1; source and bin unchanged |
| `--check`: bin missing or not source-linked | Report PENDING, not conflict |

### 5. Good / Base / Bad Cases

- **Good:** Official tarballs pass pinned hashes; each old-family/new-rollup pair is byte-equal; stack reverse restores pristine. An unchanged resolved plan is replayed once, without a second self-comparison tree.
- **Base:** A finalized independent patch remains active and is not absorbed merely because it touches the same subsystem.
- **Bad:** A full runtime-to-pristine diff is used for a family that shares `session-maintenance.ts` with another family; unrelated changes become baked into both rollups.

### 6. Tests Required

A permanent rollup verifier MUST assert:

1. Active entry count and absence of retired names or `superseded_by_*` control flow.
2. Retired patch SHA-256 values.
3. Rollup paths contain no `.orig`/`.rej` artifacts.
4. Per-family old-final equals rollup-final byte-for-byte.
5. Reverse rollup restores pristine/family pre-state.
6. Reversing the entire active chain in stack order restores pristine bytes; each layer's reverse dry-run succeeds at its own stack depth, and a forward dry-run MUST fail while it is still on the tree when the patch has removable old text. Pure-insertion patches are exempt from that forward-failure assertion and MUST still pass reverse/byte-equivalence checks. Isolated per-entry probing on the final tree is not a substitute and is forbidden.
7. The EXPECTED_PLAN / EXPECTED_PLAN_18 snapshots equal the plans emitted by `apply.sh --print-plan`, including candidates, omissions and tail appends. OLDCHAIN is separately reserved for a genuine previous representation, not for parsing the current controller.
8. A sensitivity probe omits one rollup, leaves `new-final` pristine, and proves the old-final/new-final comparison fails.
9. Normal deployment keeps the real `apply.sh` smoke path; isolated replay uses
   explicit offline mode plus separate zero-provider behavioral fixtures.
10. Status detection survives a partially applicable patch: a dry-run-gated
    probe leaves the sandbox byte-identical when any hunk fails.
11. A pristine tree reports every entry `pending`, including entries whose hunk
    context only exists after a lower layer is applied.

Executable gate:

```sh
bash patches/verify-patch-family-rollups.sh
bash patches/verify-patch-family-rollups.sh --selftest
patches/apply.sh --check
OMP_PATCH_OFFLINE_VERIFY=1 patches/apply.sh
# Only in an isolated HOME/XDG/package tree; compare revert output to pristine.
```

### 7. Wrong vs Correct

#### Wrong

```sh
# Private list can stay correct while apply.sh drifts.
NEWCHAIN=("0033.patch:AGENT" "0004.patch:AGENT")
apply_chain "$sandbox" "${NEWCHAIN[@]}"

# A failed npm pack may accidentally select an older package tarball.
npm pack "$pkg" || true
f="$(ls -t *.tgz | head -1)"
```

#### Correct

```sh
# Parse the controller's exact ordered file/root contract and fail on omissions.
mapfile -t NEWCHAIN < <(
  sed -n '/^PATCHES=(/,/^)/p' patches/apply.sh |
    sed -n 's/^[[:space:]]*"\([^"]*\.patch\):${\(AGENT\|CORE\|AI\|SNAP\|NM\)}"$/\1:\2/p'
)
[[ ${#NEWCHAIN[@]} -eq "$expected" ]] || exit 1

# Only accept npm pack's returned filename after a successful command.
packed="$(npm pack --silent "$pkg")" || packed=""
[[ -n "$packed" && -f "$packed" ]] && f="$packed"
```

## Scenario: Diagnosing a resume-adjacent cache miss

### 1. Scope / Trigger
- Trigger: `cacheRead=0` occurs near resume, retry, credential recovery, or model/provider change.
- Do not attribute the miss to resume until provider, model, credential recovery, and request usage are correlated.

### 2. Signatures
- Request evidence: `provider`, `model`, `input`, `cacheRead`, `cacheWrite`, timestamp.
- Recovery evidence: `usage_limit_reached`, retry status, credential recovery, and model-change events.
- Resume paths: in-process `AgentSession.switchSession()` and new-process `createAgentSession()` startup.
- New-process ordering: `createTools()` → extension provider registration → late `restoreSessionModel()` reclaim → `initialTools`/`new Agent()`.

### 3. Contracts
- `cacheRead=0` with positive `cacheWrite` is a cold-start/cache-fill candidate, not by itself a regression.
- A provider/account/model fallback creates a different cache namespace and is the primary cause when followed by a large request with `cacheRead=0`.
- Resume may still introduce an independent prefix difference; event evidence MUST NOT claim it is fully excluded without payload comparison.
- Model-dependent tool descriptions are cached at tool construction. If an extension-backed session model is reclaimed after `createTools()`, refresh the affected description after `model = restoredModel` and before `initialTools` is materialized. **(Historical — retired 2026-09-13: upstream removed the read.description refresh machinery in 18.1.10; patches 0019/0042 are in `.retired/09-13-dead-plans/`. Kept as a diagnostic record, not an active contract.)**
- Do not use full model reconciliation for this startup gap when only the cached `read.description` is stale; model roles, recovery order, provider state, system prompt, and other tools remain unchanged. **(Historical — same retirement as above.)**

### 4. Validation & Error Matrix
| Evidence | Required conclusion |
|---|---|
| `cacheRead=0`, `cacheWrite>0` on first request | Cold start; do not call a miss regression |
| `usage_limit_reached` → recovery/fallback → large `cacheRead=0` | Fallback is direct/primary cause |
| Resume with no provider/model change | Investigate payload prefix drift |
| Provider/model change absent payload comparison | Do not fully exclude resume |
| Active model restored correctly; only `read.description` differs across resume | (Historical — mechanism retired 2026-09-13) Check both resume paths and the tool-construction/model-reclaim ordering; refresh the cached description at the path that changes the model |

### 5. Good / Base / Bad Cases
- Good: correlate adjacent JSONL events and distinguish cold start, fallback, and true prefix drift.
- Base: normal first request after process restart writes a fresh cache prefix.
- Bad: use an older session's usage event to explain a newer resume-adjacent miss.
- Good: both in-process switching and new-process late model reclaim refresh only the cached read description after the target model is active. (Historical — retired 2026-09-13)
- Base: the target model exists before tool construction, so the initial description is already correct and no late reclaim refresh runs. (Historical)
- Bad: patch only `switchSession()` and assume a restarted process uses that method; CLI startup restores through `createAgentSession()` instead. (Historical)

### 6. Tests Required
- Parse the exact session JSONL and assert event order: error/recovery, model change, then request usage.
- Assert `cacheRead=0`/`cacheWrite>0` is classified as cold start.
- Assert fallback evidence reports primary cause while preserving resume as an unexcluded possibility.
- For a model-dependent cached tool description, cover both in-process `switchSession()` and new-process late extension-model reclaim; assert the final description equals a fresh tool built for the target model and make no provider request. (Historical — retired 2026-09-13)

### 7. Wrong vs Correct
#### Wrong
```text
resume happened, therefore resume caused the cache miss
```
#### Correct
```text
usage_limit_reached → credential recovery/provider fallback → cacheRead=0
is the direct primary cause; resume-related prefix drift is not proven or excluded.
```

## Scenario: Selecting a versioned patch plan

### 1. Scope / Trigger
- Trigger: the installed `pi-coding-agent` version determines which patch plan applies; an upstream release may also change patch context so a plan needs versioned candidates.
- The `PATCHES` array is the canonical patch set shared by every supported plan; it is NOT itself a deployable chain (members' a-sides span multiple upstream releases).
- Supported plans: 18.1.14 (rollback), 18.1.18 (current deployment). Dead version branches are removed, not kept for documentation.

### 2. Signatures
```sh
patches/apply.sh                    # auto-route by installed version
patches/apply.sh --check
OMP_PATCH_VERSION=18.1.14 patches/apply.sh --check   # explicit plan
```

### 3. Contracts
- Unset `OMP_PATCH_VERSION` MUST auto-route by the installed `pi-coding-agent` version — exact match to a supported plan, never a nearest-version fallback. This preserves the documented one-key re-apply flow.
- An explicit `OMP_PATCH_VERSION` MUST match the installed package version and every referenced candidate file MUST exist before mutation.
- An empty, unset-with-unknown-installed, or unsupported value MUST exit 2 before mutation.
- Only the version-specific conflicting entries may be substituted; all other active entries retain order and roots. `omit:` drops an entry for that plan only.
- `--verify-rollups` MUST execute before version gating because it owns its own fixed pristine baselines.

### 4. Validation & Error Matrix
| Condition | Required result |
|---|---|
| Variable unset, installed version supported | Auto-route to that plan |
| Variable unset, installed version unsupported | Exit 2 before mutation |
| Variable empty | Exit 2 before mutation |
| Unsupported version | Exit 2 before mutation |
| Explicit version ≠ installed package version | Exit 2 before mutation |
| Referenced candidate missing | Exit 2 before mutation |
| Version and candidates valid | Resolve plan and continue |

### 5. Good / Base / Bad Cases
- Good: unset on an 18.1.18 install routes to the 18.1.18 plan; explicit 18.1.14 on an 18.1.18 install exits 2.
- Base: a future release is rejected until its plan and candidates are verified.
- Bad: silently fall back to a nearby version, or keep a dead version branch "for documentation".

### 6. Tests Required
- Assert unset auto-route, empty, unsupported, wrong-package, and missing-candidate behavior.
- Assert the resolved plan parsed from the real `apply.sh` equals the pinned snapshot.
- Assert apply, revert, replay, idempotence, and smoke in a pristine version-matched sandbox.

### 7. Wrong vs Correct
#### Wrong
```sh
# Applies a plan based on the current date or nearest package version.
patches/apply.sh
```
#### Correct
```sh
# Exact installed-version match, fail-closed otherwise.
OMP_PATCH_VERSION=18.1.14 patches/apply.sh
```
