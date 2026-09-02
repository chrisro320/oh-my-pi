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
- NEVER patch `~/.bun/install/cache` or live `node_modules` to generate or verify a rollup. Bun may hard-link those trees; an in-place patch can mutate both.
- Generate each family in an isolated `mktemp` tree by applying only that family's old patches in historical order.
- The rollup touched-file set MUST equal the union of its old family touched-file sets.
- Any failed hunk, `.orig`, `.rej`, or unexpected `Only in` output MUST abort generation.
- Finalized old patches MUST remain byte-identical in a retired directory with pinned hashes.
- Full-chain verification MUST consume the exact file/root/order sequence parsed from `apply.sh`; a second hand-maintained active list is not an oracle.
- Runtime source bytes MUST remain unchanged when switching from the old effective chain to the rollup chain.
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

### 5. Good / Base / Bad Cases

- **Good:** Official tarballs pass pinned hashes; old and new family trees are byte-equal; reverse restores pristine; the exact 18-entry active sequence parsed from `apply.sh` matches the 30-entry old effective chain including independent patches 0038, 0041, and 0042.
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
7. Old effective full chain equals the exact active sequence parsed from `apply.sh` across every owned package.
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

### 3. Contracts
- `cacheRead=0` with positive `cacheWrite` is a cold-start/cache-fill candidate, not by itself a regression.
- A provider/account/model fallback creates a different cache namespace and is the primary cause when followed by a large request with `cacheRead=0`.
- Resume may still introduce an independent prefix difference; event evidence MUST NOT claim it is fully excluded without payload comparison.

### 4. Validation & Error Matrix
| Evidence | Required conclusion |
|---|---|
| `cacheRead=0`, `cacheWrite>0` on first request | Cold start; do not call a miss regression |
| `usage_limit_reached` → recovery/fallback → large `cacheRead=0` | Fallback is direct/primary cause |
| Resume with no provider/model change | Investigate payload prefix drift |
| Provider/model change absent payload comparison | Do not fully exclude resume |

### 5. Good / Base / Bad Cases
- Good: correlate adjacent JSONL events and distinguish cold start, fallback, and true prefix drift.
- Base: normal first request after process restart writes a fresh cache prefix.
- Bad: use an older session's usage event to explain a newer resume-adjacent miss.

### 6. Tests Required
- Parse the exact session JSONL and assert event order: error/recovery, model change, then request usage.
- Assert `cacheRead=0`/`cacheWrite>0` is classified as cold start.
- Assert fallback evidence reports primary cause while preserving resume as an unexcluded possibility.

### 7. Wrong vs Correct
#### Wrong
```text
resume happened, therefore resume caused the cache miss
```
#### Correct
```text
usage_limit_reached → credential recovery/provider fallback → cacheRead=0
is the direct primary cause; resume-related prefix drift is not proven or excluded.

## Scenario: Opting into a versioned patch candidate

### 1. Scope / Trigger
- Trigger: an upstream release changes patch context while the canonical chain remains valid for its original release.
- Use an explicit version gate; never silently replace the canonical patch.

### 2. Signatures
```sh
OMP_PATCH_VERSION=18.0.11 patches/apply.sh
OMP_PATCH_VERSION=18.0.11 patches/apply.sh --check
OMP_PATCH_VERSION=18.0.11 patches/apply.sh --revert
```

### 3. Contracts
- Unset `OMP_PATCH_VERSION` MUST preserve the canonical 18.0.9 sequence.
- `OMP_PATCH_VERSION=18.0.11` MUST verify installed `pi-coding-agent` version `18.0.11` and candidate-file existence before mutation.
- Only the version-specific conflicting entry may be replaced; all other active entries retain order and roots.
- `--verify-rollups` MUST execute before version gating because it owns its own fixed pristine baseline.

### 4. Validation & Error Matrix
| Condition | Required result |
|---|---|
| Variable unset | Canonical path, no candidate substitution |
| Variable empty | Exit 2 before mutation |
| Unsupported version | Exit 2 before mutation |
| 18.0.11 with wrong installed package version | Exit 2 before mutation |
| 18.0.11 candidate missing | Exit 2 before mutation |
| 18.0.11 package and candidate valid | Select candidate and continue |

### 5. Good / Base / Bad Cases
- Good: explicit 18.0.11 selects only its candidate; unset remains 18.0.9.
- Base: a future release is rejected until its pristine candidate is verified.
- Bad: use the 18.0.11 candidate for 18.0.9 or silently fall back to a nearby version.

### 6. Tests Required
- Assert unset, empty, unsupported, wrong-package, and missing-candidate behavior.
- Assert canonical `0010` SHA-256 remains unchanged.
- Assert exact active sequence and candidate selection from the real `apply.sh`.
- Assert apply, revert, replay, idempotence, and smoke in a pristine version-matched sandbox.

### 7. Wrong vs Correct
#### Wrong
```sh
# Applies a candidate based on the current date or nearest package version.
patches/apply.sh
```
#### Correct
```sh
# Explicit opt-in, exact package match, fail-closed otherwise.
OMP_PATCH_VERSION=18.0.11 patches/apply.sh
```
```
