# Patch Rollup Contracts

## Scenario: Consolidating a finalized patch family

### 1. Scope / Trigger

Use this contract when multiple patches implement or repair one functional family, or when revising an existing family. Maintenance must not grow the active chain merely because a previous revision was deployed.

A rollup changes patch representation only. The old effective chain and the new active chain MUST produce byte-identical package trees from the same official pristine release.

### 2. Signatures

Supported controller modes:

```sh
patches/apply.sh
patches/apply.sh --check
patches/apply.sh --revert
patches/apply.sh --verify-rollups
OMP_PATCH_VERSION=18.7.0 patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.7.0 patches/apply.sh --print-capabilities
OMP_PATCH_VERSION=18.7.0 patches/apply.sh --print-gates
OMP_PATCH_OFFLINE_VERIFY=1 patches/apply.sh
```

Active entries retain the existing file/root contract:

```sh
"<patch-file>:${AGENT|CORE|AI|SNAP|TUI|NM}"
```

Cross-package rollups use paths such as `pi-agent-core/...` and are applied from `${NM}` with `patch -p1`.

### 3. Contracts

- Pristine input MUST be the official pinned npm release tarball, verified by SHA-256 before extraction.
- NEVER patch `~/.bun/install/cache` or live `node_modules` to generate or verify a rollup. Bun may hard-link those trees; an in-place patch can mutate both. The same trees are also unreadable as pristine sources: in-place patching has written through the cache repeatedly (pi-ai@18.1.14's `ollama.ts` was found carrying the 18.1.18 file on 2026-09-13; `auth-storage.ts` has carried 0026-core since 2026-08-29), so any cache copy may already contain patch output. Pristine means an official tarball verified by SHA-256 — nothing else.
- Dependency-complete sandboxes MUST use matching exact registry versions for
  all selected OMP roots (six, including pi-tui, for 18.2.10). Mixing `file:tgz` direct dependencies with registry
  transitive dependencies can create nested unpatched copies. Rebuild the
  sandbox dependency graph when correcting this; editing package.json alone
  does not remove nested copies. Extract verified targets independently after
  install so mutable source inodes cannot be shared with Bun's cache.
- Official extraction canonicalizes directory modes to0755 once before recording pristine identity; regular-file modes and symlinks retain archive semantics. `canonicalize_extracted` in `verify-release-family-plan.py` must never run after forward/reverse replay: a later directory-mode mutation must change `tree_digest` and fail equality, not be silently normalized away. Historical pinned digests are never rewritten to accommodate extractor defaults.
- Generate each family in an isolated tree against documented prerequisites, retaining historical member order where applicable. Interleaved edits require ownership-preserving context rebases, not concatenation or copying whole final shared files.
- The rollup touched-file set MUST equal the union of its old family touched-file sets.
- Any failed hunk, `.orig`, `.rej`, or unexpected `Only in` output MUST abort generation. Dry-run and exit-code gates apply to owned layers too. For declaration-only closure, retain validated source hunks byte-for-byte and append declaration diffs; broad regeneration once silently dropped 0052's namespace budget despite a green complete replay. Its real image-budget gate caught `5 !== 200`.
- Historical patch revisions MUST remain byte-identical in a retired directory with pinned hashes. The active revision may be replaced after verification; historical immutability does not require another active tail layer.
- Full-chain verification MUST consume the exact file/root/order sequence parsed from `apply.sh`; a second hand-maintained active list is not an oracle.
- When OLD and NEW representations target the same upstream release, independently apply retained OLD bytes and resolved NEW bytes to identical official pristine trees and require complete byte/structure equality. Also verify each family's owned delta on its prerequisite baseline. Cross-version upstream differences are not same-release equivalence; never fake an OLD oracle by resolving the NEW plan twice.
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
- Status detection MUST NOT write to live `node_modules`; mirror the union of
  `--- a/` and `+++ b/` paths, excluding `/dev/null`. Reverse dry-run and real
  peel both use `--remove-empty-files`, including within the status mirror.
- Nothing in this document weakens the retention rule above: a patch that ever
  entered the active chain MUST keep its bytes and pinned hash in the retired
  directory. Deletion is permitted only for a patch that never entered the
  active chain and served solely as a record or rollback token.
- A retired or abandoned patch number MUST NOT be reused, whether its file was
  kept or deleted. The verifier MUST assert every abandoned number is absent
  from the `apply.sh` chain; documentation alone is not an acceptance gate.
- Same-family repairs MUST revise that family's single active representation. Archive the previous revision first, preserve capability ownership and gates, and revalidate the complete chain. A new independent capability requires an explicit ownership decision, not automatic numeric tail allocation.
- Removing a "redundant" guard MUST be proven, not argued from appearance: the surviving check runs with no intervening `await`, covers a superset of the conditions, and produces outcomes that no consumer can tell apart. Observe the affected window before and after the edit with the same consumer smoke; a guard whose early exit avoids a side effect (for example, opening an in-flight bracket or aborting an idle reservation) is not redundant. Example: 0010's attempt-wrapper guard was removed on 2026-10-12 because `#runAgentContinue` performs a superset check on entry.
- A cross-version rebase MUST re-verify every deletion a family owns, not only its additions. When upstream moves a line the old family deleted (18.12.6 moved `if (this.isStreaming) return false;` below a new ACP block in `#canContinueQueuedMessages`), a 3-way merge keeps the moved copy, the zero-fuzz oracle stays green, and the capability is silently lost. The 18.12.6 input-translation rebase lost the queue-policy split this way; physical Tern acceptance froze on abort-with-queued-steer (synchronous drain reschedule livelock that also ignores SIGTERM). Repair by propagating the deletion through the owner's `after` and every later owner's `before`/`after` snapshot of the shared path, then re-export; prove it with the behavioral leg in `verify-user-display-text-queue.ts` (child with a SIGKILL deadline), not by source inspection.
- Textual CLEAN, reversible patches, and a green representation oracle do not
  prove executable source. In 18.2.3, old 0048 fuzzy-applied into invalid scopes.
  Import the real SDK and launch the source CLI after whole-chain replay; then
  exercise changed lifecycle behavior. Generate corrections from actual
  before/after files, never handwritten hunk counts or a cumulative repair layer.
- The 18.3.3 preflight reproduced a zero-fuzz counterexample: unchanged 0014
  applied cleanly, but `verify-antigravity-envelope.ts` called the real
  `buildRequest` and failed with `ReferenceError: createHash is not defined`
  because upstream removed its import. Check retained imports and execute the
  affected entry point before classifying a text-clean patch as reusable.
- The rollup oracle owns representation, plan snapshots, and replay equivalence.
  Private constant names and source spelling are not runtime behavior gates.
  In particular, do not inspect a tree for applied behavior after peeling it.

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
# Resolve through the controller; the canonical PATCHES array is not a plan.
mapfile -t NEWCHAIN < <(OMP_PATCH_VERSION=18.2.3 patches/apply.sh --print-plan)
[[ ${#NEWCHAIN[@]} -eq 37 ]] || exit 1

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
- The `PATCHES` array supplies the retained historical plans; it is NOT itself a deployable chain (members' a-sides span multiple upstream releases). The 18.7.0 plan instead resolves `.18.7.0-families/plan.tsv`, with the unchanged 0097 overlay only for explicit `OMP_PATCH_PLAN=repository`.
- Supported versions and physical counts MUST be obtained from the controller's resolved `--print-plan`, not copied from a historical checkpoint. A family row can own multiple behavior capabilities without adding physical layers.

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
- Behavior regression applicability follows resolved capabilities (`_omp_has_capability`). Reserve `_omp_plan_has` for physical artifact/native lifecycle checks; a retired numeric filename is not a valid family behavior selector.
  Do not gate the entire suite on `version === 18.1.18` or skip because a required
  symbol is absent. Shared gates select their version-specific API shape.
- Keep finalized old patch bytes and old plan rows unchanged during migration.
  Verify the updated candidate chain with real second apply and reverse replay,
  comparing bytes plus file/directory/symlink sets, not only diff exit status.
- For 18.2.10, require matching metadata in all six package roots before any
  mutation. 0004/0033 use TUI; 0037/0050 use NM across the moved UI/host boundary.
- Inventory deployed deltas against official old-version replay before upgrade.
  Preserve evidenced unregistered behavior, not merely every patch file present:
  target 0055 → 0071 preserves deployed Devin behavior; 0075 preserves recall
  promotion. The user explicitly excluded scout customization/0076.
- Upgrade directly pinned coding-agent, pi-natives and pi-natives-linux-x64
  together. Detach mutable package sources from cache hardlinks before patching.
- `OMP_PATCH_SMOKE_MODEL` optionally pins the controller's exact `$BIN` smoke.
  Smoke stdin is `/dev/null`; use private agent state and a static loopback-only
  model definition when discovery is not ready. Never infer cloud acceptance.

### 4. Validation & Error Matrix
| Condition | Required result |
|---|---|
| Variable unset, installed version supported | Auto-route to that plan |
| Variable unset, installed version unsupported | Exit 2 before mutation |
| Variable empty | Exit 2 before mutation |
| Unsupported version | Exit 2 before mutation |
| Explicit version ≠ installed package version | Exit 2 before mutation |
| Referenced candidate missing | Exit 2 before mutation |
| Any 18.2.10 package root missing or wrong version | Exit 2 before mutation |
| Applied patch adds a file | Mirror includes it; reverse peel removes it |
| Version and candidates valid | Resolve plan and continue |

### 5. Good / Base / Bad Cases
- Good: unset on an 18.1.18 install routes to the 18.1.18 plan; explicit 18.1.14 on an 18.1.18 install exits 2.
- Base: a future release is rejected until its plan and candidates are verified.
- Bad: silently fall back to a nearby version, or keep a dead version branch "for documentation".

### 6. Tests Required
- Assert unset auto-route, empty, unsupported, wrong-package, and missing-candidate behavior.
- Assert the resolved plan parsed from the real `apply.sh` equals the pinned snapshot.
- Assert apply, revert, replay, idempotence, and smoke in a pristine version-matched sandbox.
- Preserve older plan snapshots and replay bases. The oracle uses official
  18.0.9 family, 18.1.14 full-chain, 18.2.3 and six-root 18.2.10 replay bases.
- Retain a synthetic add-file regression sensitive to the old mirror defect.
- Machine-check resolver/gate registration before delivery and independent review:
  `grep -nE '_omp_plan_has|18\.2\.10|EXPECTED_PLAN_18210|OMP_PATCH_VERIFY_TUI_ROOT' patches/apply.sh patches/verify-patch-family-rollups.sh`.

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

## Scenario: Preserving Codex effort history across resume

### 1. Scope / Trigger
Codex `supportsConfigurationUpdate` conversations that change reasoning effort and
then reload JSONL or switch branches. Root cause category: cross-layer persistence
contract plus an implicit assumption that process-local state survives resume.

### 2. Signatures
- `OpenAIResponsesHistoryPayload.effortControl?: OpenAIEffortControlState<ReasoningConfig["effort"]>`.
- Snapshot fields: `baseEffort`, `currentEffort`, `transitions[{index, anchor, effort}]`.
- `buildTransformedCodexRequestBody(...) -> Promise<RequestBody>` stays unchanged;
  request-local planning also supplies the snapshot saved by Codex finalization.

### 3. Contracts
- The current branch's latest successful same provider/api/model assistant is the
  only restoration source. Ignore error/aborted assistants; a matching successful
  assistant without a snapshot starts fresh, never falls through to older state.
- Clone before planning: a later effort switch MUST NOT mutate persisted history.
- Reuse transition index/anchor validation; a history rewrite invalidating any
  transition resets the baseline. Do not preserve stale transitions by force.
- Metadata stays in `providerPayload`, never becomes an outgoing request field or
  native history item. Only supported normal Codex turns with a session id opt in.
- Do not infer missing old snapshots from the latest UI effort or guess historical
  insertion positions. Deployment is prospective and requires a new omp process.
- Stable effort is not transport state: a new socket MUST NOT inherit a
  `previous_response_id`. Preserving client prefix bytes does not prove server
  cache hits, TTL, account affinity, or model-routing identity.
- Compare cache audit baselines within the same model/provider; cross-model
  `SYSTEM_DRIFT` cannot establish a main model's actual system change.

### 4. Validation & Error Matrix
| Condition | Required result |
|---|---|
| high → xhigh, JSONL reload + new transport state | Top-level high and historical xhigh item unchanged |
| Fork before the switch | No future transition leakage |
| Later switch planned | Earlier assistant bytes unchanged |
| Failed response after successful snapshot | Last successful baseline remains available |
| Compaction/rewrite invalidates a transition anchor | Fresh baseline, no stale configuration_update |
| Latest successful response has no snapshot | Use current requested effort, do not invent history |
| Other provider/model or unsupported model | No foreign snapshot restored |
| Fresh WebSocket connection | Full replay without old previous_response_id |

### 5. Good / Base / Bad Cases
- Good: response production → JSONL round-trip → real transport serialization.
- Base: legacy sessions establish a new baseline after deployment.
- Bad: helper-only tests with a manually preseeded Map, or lowering actual xhigh
  to conceal a prefix change.

### 6. Tests Required
```sh
bun patches/verify-codex-effort-resume.ts
OMP_PATCH_VERIFY_AI_ROOT=<isolated-ai> OMP_PATCH_VERIFY_CATALOG_ROOT=<isolated-catalog> \
  bun patches/verify-codex-effort-resume.ts
grep -nE '0069|verify-codex-effort-resume' patches/apply.sh patches/verify-patch-family-rollups.sh
```
The gate MUST fail without the patch, with the producer/restore link severed,
without cloning, without anchor synchronization, and when a missing latest
snapshot revives older state. Missing runtime modules fail closed. Local
cross-process WebSocket smoke separately verifies ordinary chaining survives
while resume preserves the full rebuilt prefix on a new connection.

### 7. Wrong vs Correct
- Wrong: recreate an empty process Map at resume and pin its first effort to the
  current UI setting; the old request may have pinned a different value.
- Correct: recover a detached branch-local response snapshot, validate it against
  the rebuilt input, apply the existing planner, then persist the resulting state.

## Scenario: Anthropic native compaction wire diagnostics

### 1. Scope / Trigger
Native compaction bypasses the session payload hook. Extend 0074 in place;
diagnostics must not alter request content, cache policy, retries or fallback.

### 2. Signatures
`createAnthropicRequestAudit({ sessionId, provider, sideRequest, refresh })`
returns `wrapFetch(base)` and `observe(RawSseEvent)` for Anthropic only.

### 3. Contracts
- Capture the actual fetch body after OAuth cch replacement, including Uint8Array
  bodies, into `getAgentDir()/payloads/<session>/anthropic-wire/`.
- UUID-correlated `.body.json`, `.meta.json`, `.usage.jsonl` hold final bytes,
  classification/prefix comparison, HTTP request ID and untouched SSE usage.
- Header allowlist: anthropic-beta, anthropic-version, content-type. Never
  archive Authorization, cookies, URL query parameters or URL credentials.
- `OMP_PAYLOAD_ARCHIVE_OFF` disables diagnostics; missing session ID skips them.
- Baseline is the last ordinary outbound request, not proof of server caching.
  Partition by session/provider/endpoint/model; side/refresh/native calls cannot
  replace it. Compare old tools/system/messages allowing appended messages;
  normalize only billing cch and separate cache_control breakpoint movement.
- Prefix equality is not cache-hit proof. Neither large cache_creation usage nor
  an offline equal prefix proves a client bug or normal server compaction cost.

### 4. Validation & Error Matrix
Missing baseline → no-baseline; changed old prefix → prefix-different with path;
I/O failure → warning only; transport failure → original error unchanged.

### 5. Good / Base / Bad Cases
Good: native wire + HTTP request ID + raw usage including iterations.
Base: no baseline after opt-out or deployment; no inferred historical equality.
Bad: calling a mutating session hook just to archive, or treating Context message
counts as serialized wire message counts.

### 6. Tests Required
`OMP_PATCH_VERIFY_NM=<isolated-root> bun patches/verify-anthropic-request-audit.ts`
must exercise the real provider and OAuth final bytes with an offline fetch.
Assert prefix changes, side/session isolation, usage correlation, opt-out and
non-interference on storage and transport failures. Machine check:
`grep -nE 'createAnthropicRequestAudit|wrapFetch|observe' patches/0074-omp-anthropic-context-cache-boundaries.patch`
and `grep -n 'verify-anthropic-request-audit' patches/apply.sh`.

### 7. Wrong vs Correct
Wrong: declare the 20-block lookback or expected server rewrite the root cause
without the actual native wire payload and provider response evidence.
Correct: preserve the final body and raw usage first; distinguish client prefix
changes from provider-side compaction accounting without changing fallback.

## Scenario: Kitty display-only PNG conversion (0080)

### 1. Scope / Trigger
When tool or assistant WebP images must render on Kitty, convert only the display copy. Keep `message.content` and the provider-facing tool result byte-identical; do not change the source encoder or Orca.

### 2. Signatures
`imageFingerprint(Pick<ImageContent, "data" | "mimeType">): string` hashes full MIME and base64 contents with SHA-256.
`ensurePng(ImageContent, fingerprint?): Promise<ImageContent | null>` shares a conversion Promise.
`completedPng(fingerprint): { png: ImageContent | null; reason?: string } | undefined` exposes settled display data synchronously.
`pngFailureReason(fingerprint, conversion?): string` prefers the exact failed flight's sanitized reason when a Promise is supplied, even if its LRU slot was evicted.

### 3. Contracts
The global PNG cache is one LRU bounded by 32 MiB of base64 image data and 256 entries. A pending slot reserves its input base64 length; settlement calls `set` again with the same Promise and the PNG or positive failure-reason length. An entry larger than the whole budget is not retained. While retained, pending, successful, and failed entries return the original Promise. Eviction permits later reconversion, but late settlement must not resurrect a slot or overwrite a newer flight. Each miss attempts conversion at most twice and resolves null on failure. Failed flights also put their sanitized reason in a `WeakMap` keyed by the Promise: a still-subscribed UI callback can report the real reason after eviction without a strong unbounded map. Both TUI components compare the full SHA before displaying the result; assistant callbacks also require the current flight token before committing, and `finally` only removes that same token. `imageKey` includes SHA so a reused slot cannot reuse an older graphic. The provider message is never converted.
Native assistant slots use `native:<index>`; tool-result slots use `tool:${JSON.stringify(toolCallId)}:<index>` and decode that exact tool call ID before lookup or prefix cleanup. Never identify origin solely by the raw tool call ID: `"native"` is a valid opaque tool ID and would collide with `native:0`. Conversion failures resolve null; an exception from an async repaint callback is a separate error and must be logged after identity-guarded cleanup, not mislabeled as a decoder failure or left as an unhandled rejection.

### 4. Validation & Error Matrix
| Input/state | Display |
|---|---|
| PNG | Use source immediately |
| WebP in flight | Wait; 0079 keeps tool result unfinalized |
| WebP cached | Render the completed PNG in the same update |
| Corrupt WebP after two attempts | Show `PNG conversion failed: <reason>` and release retirement gate |
| Same slot A→B→A | Render B then cached A; stale callbacks cannot overwrite either |

### 5. Good / Base / Bad Cases
Good: eight 2048² WebPs paint as eight graphics after conversion and remain after width redraw. Base: a JPEG or WebP tool result remains its original MIME/data for the model. Bad: a slot-index-only PNG map renders A when B replaces the slot, or converting the provider message expands the prompt.

### 6. Tests Required
`OMP_PATCH_VERIFY_TUI_ROOT=<isolated-patched-root> bun patches/verify-kitty-shared-png-cache.ts` checks eight 2048² graphics, tool/native/assistant A→B→A, stale callbacks, a toolCallId of `"native"` alongside native content, exact failure reason even after pending-slot eviction, retained Promise identity, pending versus settled snapshots, 200-image byte eviction and 600-image entry-count eviction. Reproduce the old candidate failure at the settled Promise identity assertion before claiming the fix. Machine-check the integration before delivery and review: `grep -nE '0080-omp-kitty-shared-png-cache|verify-kitty-shared-png-cache' patches/apply.sh patches/verify-patch-family-rollups.sh` and `grep -nE 'ensurePng|completedPng|imageFingerprint' patches/.18.2.10-candidates/0080-omp-kitty-shared-png-cache-v18.2.10-candidate.patch`.

### 7. Wrong vs Correct
Wrong: key completed PNGs by `toolCallId:index`, replace the original Promise with `Promise.resolve(png)`, or read an evicted failure reason only from the LRU. Correct: compare SHA and flight identity before publishing; retain the original Promise in a bounded slot, reprice on settlement, and let subscribers recover an evicted flight's reason through a weak Promise key.

## Scenario: 18.3.3 source migration

### 1. Scope / Trigger
Upstream API migrations require semantic adaptation even when all old hunks apply.

### 2. Signatures
`CodexWebSocketConnection.streamRequest` accepts `{send: body}` or `{attachSteerIds}`, never a bare frame. Settings use typed handles; auth uses the `keys`/`usage` facades.
`OpenAICodexCompactionStreamOptions.onAccept(commit, rollback)` hands collection an acceptance transaction; collector rejection calls rollback even after a valid terminal event. Snapshot metadata before socket opening, not after the 101 handshake.

### 3. Contracts
The 18.3.3 plan contains 46 physical patches preserving the previous 47 capabilities: 0073 is upstream behavior and keeps its gate. Native Anthropic compaction preserves upstream safeCut/first-kept-entry boundaries; live rendering supplies the prefix only, not the retained tail. Aborted/error `requestControls` survive live and rebuild as empty-content carriers; synthetic results and display-only `strippedToolCalls` must not reach the wire.

### 4. Validation & Error Matrix
Unsigned native compaction summaries fail; bare WS recovery frames enter the wrong exchange branch and fail; legacy settings reads fail at actual SDK creation. Unknown/mismatched versions must exit 2 without writes.

### 5. Good / Base / Bad Cases
Good: non-generating recovery sends `{send:{...body,generate:false}}`, then chains compaction on the accepted baseline. Base: ordinary no-controls interrupted turns disappear. Bad: retaining interrupted payload with control metadata, or summarizing both the live prefix and retained tail.

### 6. Tests Required
Run strict complete replay, real second apply, reverse pristine-byte equality, all root-selected behavior gates, model lifecycle across fresh processes, and source CLI tool execution. `verify-interrupt-prune-symmetry.ts` covers both stop reasons and paired/missing results; native compaction checks retained-tail exclusion; Codex fail-closed checks recovery and failed acceptance.
Published `.d.ts` files must include every added callable/interface/member, including transitive host methods; the consumer probe invokes rollback, live-scope builders and source-aware conversion. Handshake metadata faults are injected at the real upgrade boundary because Bun hides 101 response headers; failed open and rejected collection must restore the snapshot, acceptance must retain it.

### 7. Wrong vs Correct
Wrong: re-pin source regexes after an upstream rename, or treat clean hunks as runtime proof. Correct: real SDK/transport fixtures, typed settings, official pinned package sources, generated same-ID candidates, and preserved historical plans.

## Scenario: Version upgrade rollback covers the resolved dependency graph

### 1. Scope / Trigger
Before changing the global OMP package version or applying a new versioned candidate chain, prepare a reversible runtime snapshot. The six patch roots are not the whole installation: pi-coding-agent also resolves `pi-utils`, `pi-wire`, `omptype`, `pi-mnemopi`, `omp-stats`, `pi-natives`, platform-specific native packages and possibly nested copies.

### 2. Signatures
`OMP_PATCH_VERSION=<old-version> bash patches/apply.sh --print-plan` identifies the old patch sequence, **not** the package backup set. The backup manifest records `{path, realpath, packageName, version, sha256, loadedBy}` for every old-runtime resolved package and every package the installer will replace, plus the `bin/omp` symlink target, patch mirror and any `.installed` snapshots required by the current install. Resolve paths from the actual entry/dependency tree rather than a hand-maintained six-name list.

### 3. Contracts
Freeze the old and prospective dependency graphs before stopping OMP. Back up the union of packages loaded by the old runtime and paths the new installation may overwrite, including optional native/platform dependencies and nested resolutions. Preserve the old patch plan, exact runtime source bytes, entry target and mirror independently; never restore `~/.omp/agent` as part of a package rollback. DB backup/integrity and WAL/SHM activity are a separate offline gate governed by `database-guidelines.md`; a reported `integrity_check = ok` alone does not discharge it.

### 4. Validation & Error Matrix
| Condition | Required result |
|---|---|
| Resolved old path or version is missing from the backup manifest | Abort before install |
| New graph replaces a path with no verified old bytes | Abort before install |
| Restored package resolves to the new or cache copy | Rollback failed; do not restart the old runtime |
| Old source plan, entry target or patch mirror differs after restore | Rollback failed |
| OMP process exists during the DB gate or backup sidecar activity is unattributed | Stop deployment per database-guidelines |

### 5. Good / Base / Bad Cases
Good: capture the resolved closure including native/platform packages, install the pinned new version, then restore the entire old closure and verify real module paths and old CLI behavior in a private HOME. Base: a package is unchanged and its pre/post hash is identical, so the manifest records it without copying redundant bytes. Bad: back up only the six patch roots, then roll back an incompatible old CLI against new `pi-wire` or native binaries.

### 6. Tests Required
Before deployment, compare the captured graph to the installer overwrite set and assert every changed path has restorable old bytes. In a disposable install, rehearse restore and assert old package versions, resolved realpaths, entry target, `OMP_PATCH_VERSION=<old-version> ... --check` with no conflicts and a real source-CLI smoke; compare the patch mirror to the repository plan. Keep the live SQLite test exclusively in the offline database gate.

### 7. Wrong vs Correct
Wrong: archive six patch roots and treat the global installation as recoverable. Correct: enumerate the effective old/new dependency graphs, snapshot the overwrite union and prove that the restored old entry resolves the old versions and behavior.

## Scenario: 18.4.1 source migration and resume-prefix acceptance

### 1. Scope / Trigger
An upstream upgrade whose releases add new session behavior (18.3.4-18.4.1: session cache warmer, committed-text stall continuation, speculation fallback, cross-cwd system prompt, `^` model-tag notices). Text-level porting is necessary but not sufficient: every new upstream path that injects or rebuilds model-facing content must be proven identical between the live request and a fresh-process resume.

### 2. Signatures
- `research/replay-1841.py --nm <sandbox NM> [--before NNNN | --until NNNN]`: rebuild six roots from pinned tarballs, strict `--fuzz=0` dry-run gated replay of `apply.sh --print-plan`; a failing layer is skipped whole and later layers sharing its files are flagged `after-skip`.
- `research/mkcand-1841.py snapshot|emit --nm <NM> --layer NNNN [--extra REL]`: same-ID candidates only from real before/after files; `emit` re-replays to prove `APPLIED` at its stack depth.
- Historical18.4.1 prefix/remote/tag runners compared two fresh Bun processes. Those temporary runners were removed with the obsolete baseline; retained JSON captures are evidence, not runnable current commands. Use the current controller-selected resume/compaction gates.
- `research/deploy-1841.py prepare|preflight|deploy --execute [--root R --rehearsal]`.

### 3. Contracts
- Separate direct from derived failures by skipping failing layers whole; never discard failed hunks and continue on a mixed tree.
- Grep every candidate, including byte-clean ones, for each API named in upstream Breaking Changes. 0074 applied at fuzz=0 on 18.4.1 while still reading `options.anthropicCacheRefreshRequest`, removed in 18.3.5.
- Enumerate new upstream `agent.appendMessage(...)` sites that bypass session persistence. 18.4.1 `handleCommittedTextStreamStall` appended its continuation reminder in memory only; a resume dropped it and forked the prefix until 0077 routed it through the persisting helper. Pruning rules (0043) must key on that durable reminder, never on live-only flags, and must run before any carrier-emptying branch (Anthropic `requestControls`).
- Prefix acceptance compares real serializer or transport output (`convertAnthropicMessages`, `buildTransformedCodexRequestBody`, loopback HTTP/WS bodies), not in-memory context objects (they legitimately differ in fields such as `errorId`). Codex must be raw-byte equal. Anthropic is content-equal with `cache_control` stripped: `applyPromptCaching` rolls the two message breakpoints to the newest messages on every turn, so raw bytes differ at the old breakpoint on ordinary turns too; report `raw_byte_prefix_equal` and `content_prefix_equal_without_cache_control` separately and never call the Anthropic lane byte-identical.
- Remote lanes need real transports: Anthropic native compaction only accepts official hosts (`anthropic-compaction.ts isSupportedCompactionEndpoint`) and inference uses `coworkFetch` over `node:https`, so intercept at the fetch boundary; Codex V2 runs over WebSocket and needs a loopback server via a private `models.yml` baseUrl.
- A new behavior that differs between in-process `switchSession` and fresh-process resume is a drift candidate: 18.4.1 `^` tags absorbed at a base-prompt rebuild were restored by switchSession but not by a fresh process (regression versus 18.3.3; fixed by 0083 persisting the committed surface).
- Shared gates stay green on every supported plan: 18.4.1-only scenarios, and every asset they read, live inside a version branch.
- Sandboxes live on disk (`/home/chris/.cache/omp-1841-upgrade/`), not on `/tmp` tmpfs; hardlinked copies must re-extract the six patch roots so no inode is shared.

### 4. Validation & Error Matrix
| Condition | Result |
|---|---|
| Candidate references an API listed as removed upstream | Class B port required even when replay is clean |
| New upstream in-memory injection not persisted | Resume-prefix blocker until a persistence layer covers it |
| Anthropic raw bytes differ only in rolling `cache_control` | Content-equal pass; must be reported as such |
| Any other system/tools/message byte difference after resume | Blocker; do not deploy |
| Shared gate throws on an older plan (missing 18.4.1 asset) | Gate regression; move the read into the version branch |

### 5. Good / Base / Bad Cases
Good: 0043 retains the committed partial text plus `requestControls` only when the persisted stall reminder follows, and the gate asserts on wire bytes. Base: 0066/0067/0068 needed no byte change once 0035 was ported. Bad: a probe that compares the resumed request only after a forced rebuild, skipping the first resumed request, reports "no drift" for the tagged-session regression.

### 6. Tests Required
Full-chain replay 49/0; real `apply.sh` on a dependency-complete private tree with the whole suite; second apply all SKIP with identical digest; `--check`; `--revert` byte-equal to pristine; `--verify-rollups`; cross-process prefix probes for plain, soft, snapcompact, remote Anthropic native, remote Codex V2 and `^` tag with and without rebuild; the old-plan suite on an old-version tree with the new ledger; deploy/rollback rehearsal including forced post-verify failure.

### 7. Wrong vs Correct
Wrong: treat 31 clean layers as done and certify prefix stability from in-memory context equality. Correct: audit clean layers for removed APIs and new unpersisted injections, then prove provider-facing bytes across fresh processes for every compaction method the user configures.

## Scenario: 18.4.4 same-ID migration with overlapping upstream mechanisms

### 1. Scope / Trigger
Upstream 18.4.3/18.4.4 added its own detached-draft handling (`restoreDetachedDraft`, `startPendingSubmission({ preserveDraft, clearEditor })`, `queueCompactionMessage(..., { preserveDraft })`) and RPC queue removal (`rawText`, `removeQueuedMessage`). These overlap local layer 0082 (prepared input, `displayText`).

### 2. Signatures
- `.18.4.4-candidates/` starts as the 18.4.1 bytes; only failing layers change; controller branch `18.4.4)` is a copy of `18.4.1)`.
- `research/{replay,mkcand,deploy}-1844.py`, `final-1844.sh` (fail-closed), `resolved-deps-18.4.4.bun.lock` (resolved dependency graph of the dependency-complete sandbox).
- 0082 merged form: `queueCompactionMessage(text, mode, images, { preserveDraft, displayText, prepared })`; queued `rawText` is `displayText ?? text`.

### 3. Contracts
- When upstream ships an overlapping mechanism, keep the upstream structure and re-insert the local boundary inside it; do not restore the old local variant beside it.
- Queue identity for RPC removal is the operator's original text (`displayText`), never the model text; verified by `verify-user-display-text-queue.ts` with a cross case (prepared model text equals another message's original text).
- A submission path that moves attachments into a queue clears them under the same revision guard as its sibling branches; do not rely on a queue helper that no longer clears.
- Non-ASCII check compares added lines against the previous candidate set (`comm -13`), not a whole-file grep: upstream context and data legitimately contain non-ASCII.
- Integration proof is one fail-closed script over a dependency-complete sandbox (six roots from pinned tarballs plus the rest of the resolved graph): apply, second apply all SKIP with unchanged digest, `--check` equals plan length, `--verify-rollups` including the new version and older plans, `--revert` equals pristine, reapply equals applied, no `.rej/.orig`.
- Known upstream gap, not a local regression: a prepared submission handed to `onInputCallback` whose dispatch is rejected shows an error and does not return text or images to the editor (`main.ts` catch path). Same for unprepared input.

### 4. Validation & Error Matrix
| Situation | Verdict |
|---|---|
| Six-root-only sandbox | Gates that import transitive packages fail (`pi-utils/lru`); use the dependency-complete sandbox |
| Gate reads the operator's real services | See gate isolation scenario |
| rawText recorded as model text | RPC removal deletes the wrong queued message |

### 5. Good / Base / Bad Cases
Good: 38 of 50 layers replay clean, 12 adapted, all 50 apply in the Full sandbox with every gate exit 0. Bad: fold two failing layers into one candidate to make replay green.

### 6. Tests Required
Resume, soft, snapcompact, remote (Codex raw bytes equal; Anthropic content equal with cache breakpoints reported separately), tag/rebuild, stress A and B, and the audit-repro set compared field by field with the previous version; fault injection (`run-stress-a --fault drift`) must fail.

### 7. Wrong vs Correct
Wrong: call audit-repro r2/r3/r3x/r4 regressions. Correct: they fail identically on 18.4.1 and 18.4.4 (open drift, tracked separately); r1 passes only because 0084 is in the chain.

## Historical scenario: 18.4.4 / 0085 input-restoration repair

### 1. Scope / Trigger

0085 repaired two gaps left by 0082: a rejected prepared submission lost its text and images, and a cancelled Ctrl+Enter preparation overwrote an image pasted meanwhile. The historical 18.4.4 plan used a separate tail layer. That representation is retained for replay, not a current requirement to add a layer for every deployed-feature repair. Current maintenance uses the family-revision contract above.

### 2. Signatures

- 0085 edits `src/main.ts` (`submitInteractiveInput`), `src/modes/controllers/input-controller.ts`, `src/slash-commands/helpers/draft.ts`, plus the two shipped declaration hunks `dist/types/main.d.ts` and `dist/types/slash-commands/helpers/draft.d.ts`, and sits AFTER 0082 in the 18.4.4 plan.
- `restoreRejectedDraft(runtime, draft, revision?)`, `retainRejectedDraft(runtime, draft)`, `editorHoldsNewerDraft(editor, draft, revision)`, and the module-private `isDraftOwnedImage(draft, image)`. Image ownership is by reference OR by value (`data` + `mimeType`); there is still no helper that compares the whole rejected submission's content.
- At the original 0085 planning checkpoint, the 18.4.4 candidate plan had 51 layers and live had 50; these are historical counts, not current deployment acceptance values.

### 3. Contracts

- Governance: preserve the historical 0082/0085 bytes and plan for replay. In a consolidated plan, both behaviors belong to the input-translation family; subsequent repairs revise that active family after archiving its prior revision. Report current deployed and repository counts from their selected resolved plans, never from the historical 51/50 example.
- ONE owner per rejection path, decided by an explicit signal: the prompt-dropped callback (`interactive-mode.ts`'s `#restoreDroppedPrompt`) writes the draft back before rethrowing, so the dispatch-catch skips only when the caught error IS that case. The session throws `AgentStartPolicyChangedError` there; that class is not exported, so `main.ts` recognizes it by the name the class assigns itself (`error instanceof Error && error.name === "AgentStartPolicyChangedError"`) — duck typing, not content equality and not transcript length. Every other throw restores.
- Restore the draft in the dispatch-catch for any throw that is not the session's own hand-back. The rule is deliberately wide and the residual is accepted: because aggregate transcript state cannot tell a pre-dispatch rejection from a rare failure after the turn already took the message, a rare post-admission throw may offer already-sent text back as a restorable draft. Offering a possible duplicate beats losing the input.
- Restores never overwrite something newer: `editorHoldsNewerDraft` treats a changed text revision, non-empty text, OR a pending image that is not one of the draft's own captured images as "newer" and keeps the capture restorable instead. Attachment newness is decided by `isDraftOwnedImage`: an editor image belongs to the draft when it is the SAME reference OR has the same `data` and `mimeType` as one of the captured images (`editor.pendingImages.some(image => !isDraftOwnedImage(draft, image))`), not by any non-empty list — an ordinary Enter leaves the captured attachments pending until admission, so a non-empty list alone is not newer, and a genuinely different pasted image is. Value equality is required because the supported `input` handler path may hand back rebuilt-but-equal replacement objects (`event.images.map(image => ({ ...image }))`); reference identity alone would misread those as a newer draft. Residual (accepted): an image re-pasted with the same bytes and mime as a captured one reads as the draft's own.

### 4. Validation & Error Matrix

| Situation | Required result |
|---|---|
| prepared dispatch rejected, editor empty | original text + attachments return |
| prepared dispatch rejected, newer draft present | newer draft kept; rejected input stays restorable |
| prompt-dropped callback already restored (caught `AgentStartPolicyChangedError`) | not restored twice; nothing queued as restorable |
| pre-dispatch transcript growth, then a throw | restored: aggregate length is not an admission signal |
| throw after the turn admitted the message (rare) | residual: the draft is offered back anyway; a possible duplicate beats losing it |
| preparation cancelled after an image paste | pasted image kept; capture stays restorable |
| preparation cancelled after a registered `input` handler returned rebuilt-but-equal replacement images | nothing newer was typed or pasted; the text returns directly |

### 5. Good / Base / Bad Cases

Good: 0085 lands after the frozen 0082 as a new layer; the 18.4.4 plan is 51 with 50 live. Base: a non-prepared submission behaves as before. Bad: edit the deployed 0082 in place, let both rejection paths restore the same draft, or decide attachment newness by reference identity alone (a rebuilt-but-equal replacement image is then misread as a newer draft).

### 6. Tests Required

`OMP_PATCH_VERIFY_AGENT_ROOT=<18.4.4 tree> bun patches/verify-rejected-prepared-draft-restore.ts` has ten legs. It drives the real `submitInteractiveInput` (legs 1-6: rejected dispatch, newer draft retained, accepted dispatch restores nothing, session-owned `AgentStartPolicyChangedError`, an equal-text independent rejection, and pre-dispatch transcript growth) and the real `InputController.setupEditorSubmitHandler` cancel path with a small editor double (legs 7-9: an ordinary Enter whose own captured attachments are still pending returns its text; an image pasted during preparation survives; a registered `input` handler returning rebuilt-but-equal replacement image objects is not a newer draft, so the text returns directly), plus a shared-helper control (leg 10). Negative controls: without 0085 leg 1 is red (editor stays empty); the tree before the round-2 fixes fails legs 5, 6 and 7; dropping the ownership skip fails leg 4; removing the draft-image condition from `editorHoldsNewerDraft` fails leg 8 (the pasted image is replaced by the captured one, while leg 7 stays green); and reference-only image ownership fails leg 9 (the rebuilt-but-equal objects are misread as a newer draft, while legs 7 and 8 stay green).

Machine check:

```sh
grep -n 'AgentStartPolicyChangedError\|restoreRejectedDraft\|editorHoldsNewerDraft\|isDraftOwnedImage' patches/.18.4.4-candidates/0085-omp-rejected-prepared-draft-restore-v18.4.4-candidate.patch
OMP_PATCH_VERIFY_AGENT_ROOT=<18.4.4 tree> bun patches/verify-rejected-prepared-draft-restore.ts
grep -n '0085' patches/PATCHES.md
```

Shipped declarations: the patch carries `dist/types` hunks for `main.d.ts` and `draft.d.ts` so package type consumers see the widened runtime contract and the new exports. There is no in-tree typecheck to run — the sandbox tree ships neither `tsgo` nor a `tsconfig.json`. The declaration hunks were instead proved with a consumer probe under `tsc` 6.0.3 (`/home/chris/.local/bin/tsc`) importing the shipped `.d.ts` through `package.json`'s `types` condition: red against the old declarations, green after, and a variant without the `@ts-expect-error` names the members the new contract requires.

Not covered (accepted): the Ctrl+Enter / follow-up entry (`#submitFollowUp` and its own restore call site), restoration through the dequeue path (`handleDequeue`), and the composer's own `[Image #N]` chip rendering (the editor double's `setCollapsedText` stores plain text). Left untouched: `#restoreDroppedPrompt` (`interactive-mode.ts`) keeps the same attachment-overwrite shape and was outside Review #4.

### 7. Wrong vs Correct

```text
Wrong: overwrite an archived revision, let the dispatch-catch restore what the prompt-dropped callback already handed back, gate ownership on content equality, gate admission on aggregate transcript length, or decide attachment newness by reference identity alone.
Correct: preserve historical 0082/0085 bytes while revising the active owning family; skip the restore only when the caught error is `AgentStartPolicyChangedError` (duck-typed by name because the class is not exported), restore on every other throw, and treat an attachment as newer only when it is neither the same object as one of the draft's own images nor the same bytes and mime (`isDraftOwnedImage`).
```

## Scenario: Selecting and maintaining the 18.7.0 family plan

### 1. Scope / Trigger

Use for the 18.7.0 representation cutover and subsequent same-family repairs. Current policy replaces the historical mandatory-new-tail practice without rewriting historical patch bytes or weakening behavioral contracts.

### 2. Signatures

```sh
OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.7.0 bash patches/apply.sh --print-capabilities
OMP_PATCH_VERSION=18.7.0 bash patches/apply.sh --print-gates
bash patches/verify-patch-family-rollups.sh --version 18.7.0
```

### 3. Contracts

- `.18.7.0-families/plan.tsv` is the authoritative base registry: one row per physical entry, with TAB-separated patch path relative to `patches/`, package-root symbol, and comma-separated historical capability IDs. The resolver owns ordering and plan selection.
- `OMP_PATCH_PLAN` is supported for18.7.0,18.10.0 and18.10.1 using the corresponding `.<version>-families/plan.tsv`. Unset or `deployed` selects the migrated baseline. Only18.7.0 accepts `repository` to add its unchanged, undeployed0097 overlay;18.10.x rejects that selection until separately migrated. Missing files never implicitly choose a smaller plan.
- Numeric member IDs are capability provenance, not active patch aliases. `_omp_plan_has` remains physical; `_omp_has_capability` selects behavior gates. `--print-gates` uses the same dispatch path as actual execution.
- The initial cutover maps OLD58 to NEW24 and OLD59 to NEW25. These are acceptance snapshots for this migration, not timeless hardcoded counts. Subsequent same-family revisions preserve physical count and ownership.
- The18.10.0/18.10.1 candidates have23 physical families and58 retained capabilities. Capability0017 is explicitly upstream-owned, not silently dropped; retirement requires actual ordinary self-contained and connection-bound native Responses consumers. The independent frozen baseline and approved per-family ownership, not two generated outputs agreeing with each other, govern capability completeness.0090 uses `NM`;0048 moves from `AGENT` to `NM` only in18.10.1 for the advisor native picker repair.
- A new capability after the cutover is a new family, never folded into an unrelated family: append it to the migration `family_order`, register its paths, declare it in `verify-release-family-plan.py` `ADDED_FAMILIES` (id, root, capabilities) and add its `_omp_gate`. 18.10.1 adds 0098 and 0099 (25 families /60 capabilities). Check: `python3 patches/verify-release-family-plan.py --version 18.10.1 --tgz-cache <archives>` reports the new totals and PASS.
- The next upstream update MUST start from this verified family representation and its capability ownership, not reconstruct an active chain from the retired 58 numeric layers. Port each family against the target release and revalidate behavior; version-specific patch bytes are not blindly reusable. Retained OLD58/OLD59 remain historical replay/rollback evidence, and0097 remains opt-in.
- Revision order: archive exact prior bytes and hash; regenerate the owning family's net diff; rebase affected context without absorbing another family; verify independent OLD/NEW semantics, gate coverage and round-trip; update ledger; deploy only with separate authorization.
- A repair changes intended behavior, unlike this representation-only cutover. For later repairs, compare unchanged surfaces byte-for-byte and prove the approved behavior delta with the relevant regression gate; do not falsely require a behavioral repair to equal its broken OLD tree.
- The 2026-10-10 model-selection repair keeps one persistent-prefix-resume owner. Its archived prior family and additive delta are SHA-pinned under `.retired/10-10-18.7.0-model-selection-resume/`. Preserve the original representation oracle separately; repaired-tree equality is OLD plus that declared delta, never equality to the broken OLD tree or an exclusion of entire changed files.
- `navigateTree` retains the live model and thinking. Committed destination ancestry must record that retained selection with its routing, role and fallback attribution; cancelled/no-op moves remain unchanged. `verify-model-selection-resume.ts` supplies one focused switch/navigation/fresh-process-resume regression, selected alongside0093.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/empty registry, missing entry, malformed root, duplicate capability | Fail before mutation |
| Unknown `OMP_PATCH_PLAN`, unsupported release, or18.10.x repository overlay | Exit 2 |
| Same-release representation-only OLD/NEW mismatch | Reject cutover |
| Same-family repair adds an active tail | Reject representation; update family instead |
| Historical-ID rename removes a behavior gate | Reject until gate coverage is restored |
| Archived bytes/hash changed | Reject; restore immutable evidence |
| Repository0097 absent from deployed selection | Expected; do not activate it implicitly |

### 5. Good / Base / Bad Cases

Good: a repaired family replaces its active revision after preserving the old hash; its capability gates remain selected. Base: an independent patch retains one physical entry. Bad: append a new tail to obey an obsolete immutability rule, or retain fake old-ID files solely to keep gate conditions true.

### 6. Tests Required

Selected-version verification must prove independent OLD58/NEW24 and OLD59/NEW25 complete trees, including complete auxiliary archives for the repository variant. Both variants require exact path/type/mode/symlink restoration and zero-fuzz reverse/reapply. For each approved owner, independently rebase only its frozen OLD members onto the ordered prerequisite state, compare the actual NEW delta, and reverse to that prerequisite state; whole-chain equality alone cannot detect cross-family behavior transfers. Validate approved ownership boundaries and identical resolved behavior-gate coverage. Missing/mutated family and cross-family ownership-swap negative controls must fail. Run actual isolated source CLI and tool behavior; tree equality is not executable-source proof. During review, inspect the original normative clauses and their executable consumers for contradictions, not merely the presence of this section.

### 7. Wrong vs Correct

Wrong: immutable deployed revision implies a permanent new active patch for every repair.
Correct: immutable archived revisions provide provenance; one replaceable, verified active revision per functional family prevents layer growth.

## Scenario: Immutable code installation before old-process retirement

### 1. Scope / Trigger

Deploy a verified release while old OMP processes still own live sessions or OAuth state. Installation is not hot activation.

### 2. Signatures

```sh
python3 -I patches/publish-release.py prepare --home <home> --runtime <private-runtime> --ledger <patches> --version <exact-version>
python3 -I patches/publish-release.py publish --release <physical-release> --smoke <installed-private-smoke.json>
python3 -I patches/publish-release.py rollback --release <physical-release>
python3 -I patches/verify-release-publication.py
```

### 3. Contracts

- Full dependency/native closure lives at `~/.bun/install/omp-releases/<version-digests>/runtime`; no external aliases or shared regular-file inodes. Never replace old global paths beneath running imports/workers.
- Installed `ledger/.runtime-root` binds `apply.sh` to that physical runtime. Missing/mismatched binding fails closed; bound apply/revert rejects mutation. `--check` checks the release-local source link, not the admission wrapper.
- One code-only lock serializes publication, rollback and new production admission. Retain the exact old launcher target and old ledger; persist transaction intent before publishing the closed launcher, ledger pointer and final receipt.
- Receipt `code_installation=complete` means installed code. `current_session_upgrade=false` and `production_activation=false` remain explicit; no tool ever sets `production_activation`, so `production_admission_started=true` is the only activation marker. Process identities use boot ID, PID and start time, supplemented by a fresh ownership scan.
- Standalone `--version`/`--help` report admission state without loading OMP (`installed; restart required; old owners: …` before, `installed; ready for a new process` after all owners exit). Source CLI/help/tool/native smoke uses private HOME/XDG/agent and no provider requests. When probes must live inside the runtime (18.12.6 onward), smoke runs byte-identical private copies of the installed runtime and ledger and compares both tree digests with the receipt before and after; it never writes into the installed tree (no probes, no `__pycache__`: set `sys.dont_write_bytecode`).
- Persist `production_admission_started=true` before source exec. After any possible admission, automatic code-only downgrade is forbidden: older OAuth code does not honor the new exchange journal. Never restore token/session state as package rollback.
- No watcher, force bypass, process signals, credential refresh or live DB connection is part of installation.

### 4. Validation & Error Matrix

| Boundary | Required result |
|---|---|
| Partial launcher/ledger publication | Admission closed; compensate using retained code pointers |
| Old owner still alive, unresolved ownership or incomplete receipt | Normal launch exits75 before importing OMP |
| Captured owner exited or PID reused | Start-time/boot identity distinguishes the new process; fresh scan still applies |
| Bound ledger apply/revert | Exit2 without global mutation |
| Possible production admission | Automatic code-only rollback refuses |
| Release smoke writes into the installed tree or a digest differs from the receipt | Smoke FAIL; do not publish, do not regenerate the receipt |

### 5. Good / Base / Bad Cases

Good: independent installed closure passes private smoke, public launcher/ledger agree, old sessions continue on old paths and new admission waits. Base: a complete staged tree is only staging. Bad: relabel a migration cache as deployed, mutate global lazy-import paths, or downgrade after token exchange may have started.

### 6. Tests Required

Use the synthetic publication gate for partial-pointer failure, exact code rollback, live old-owner blocking, missing-binding refusal and durable-before-exec ordering. Then run actual installed source version/read/native IPC/gallery plus bound controller checks in private HOME. Never execute production provider probes to make an acceptance checkbox green.
Installed private smoke harnesses are committed. 18.10.1 (in place): `.trellis/tasks/archive/2026-10/10-12-omp-18101-footer-release/research/smoke/run-installed-smoke.py --release <physical-release> --out <json>` (with `offline-preload.ts`, `cli-smoke.ts`, `ipc-smoke.ts`). 18.12.6 onward (private copies, loopback-only namespace): `.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/smoke/run-sandbox-smoke.py --release <physical-release> --out <json>`. Never keep a harness only in temp/cache dirs; a cleanup once deleted it and forced a rebuild. Each check asserts its expected output, not just exit 0, and the preload must actually reject `fetch`/`WebSocket` (negative-check it when the harness changes).
Machine-check at delivery and review:
`grep -nE 'production_admission_started|runtime-root|current_session_upgrade|production_activation' patches/release-launcher.py patches/publish-release.py patches/apply.sh patches/DEPLOYMENT-RUNBOOK.md`

### 7. Wrong vs Correct

Wrong: two atomic pointer replacements are treated as one transaction, or `HOME` makes an old-global controller safe for a new release. Correct: durable intent plus fail-closed receipt coherence protects the gap; an installed ledger has an explicit physical runtime binding.

## Scenario: Native addon overlay (pi-natives)

### 1. Scope / Trigger
A defect lives in compiled `pi-natives` Rust code (e.g. the Linux Escape monitor cancelling on every `MappingNotify`). Text patches cannot reach it; a TS workaround around native behavior is rejected.

### 2. Signatures
`patches/native/<NNNN>-*.patch` (historical default) or `patches/native/<version>/<NNNN>-*.patch` (new target source diff against its pinned commit); `patches/native/build-natives.sh <work> <out> [overlay-json]`; `python3 patches/verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi [--overlay PATH]`. Omitting either overlay argument keeps the historical18.10.1 recipe, not the latest target. The selected overlay pins version/commit/toolchain, patch hashes and both original/rebuilt addon hashes.

### 3. Contracts
- Build from the pinned upstream commit with its `rust-toolchain.toml`, release profile, both CPU variants (`x86-64-v3` modern, `x86-64-v2` baseline) and the upstream version stamp; exports must equal the shipped addon.
- New release recipes live under their version directory; never overwrite the historical default recipe/patch. Build stamping reads the selected overlay version. Verify the runtime package version and both actual rebuilt hashes; null pending hashes fail closed. Recover an existing completed build from its log, current artifact digests and fresh addon identity loads before repeating compilation; a cancelled job handle alone does not prove all subprocess outputs are incomplete.
- Local builds are not bit-identical to upstream CI: verify against the recorded rebuilt hashes, never against upstream bytes.
- Install into the staging runtime before `prepare`; the candidate-tree digest does not cover `pi-natives-linux-x64`, the runtime-tree digest does. Re-run the verifier on the installed release.
- Live acceptance runs only in a scratch window with user consent, via the real OMP path after activation, with an `xinput test-xi2 --root` witness for device switches. Physical Escape must still cancel.

### 4. Validation & Error Matrix
| Condition | Required result |
|---|---|
| Rebuilt hash differs from `overlay.json` | Stop; re-run live checks before recording new hashes |
| Verifier sees original upstream hash | FAIL (overlay missing) |
| Selected package version differs or rebuilt hash is null | FAIL before claiming overlay acceptance |

### 5. Good / Base / Bad Cases
Good: overlay PASS in staging and installed release; loaded `.node` hash (`/proc/<pid>/maps`) equals the rebuilt hash. Bad: edit the addon inside an immutable release, or claim acceptance from a direct-native harness only.

### 6. Tests Required
`grep -c '"rebuilt_sha256"' <selected-overlay-json>` (expect2), `verify-native-overlay.py --nm <selected-runtime>/node_modules/@oh-my-pi --overlay <selected-overlay-json>` at delivery and review, and fresh-process loads of both variants reporting the exact target stamp. The verifier must reject the original official addons against the rebuilt recipe; direct-load/hash results do not waive physical acceptance. Historical calls without explicit overlay retain their default behavior.

### 7. Wrong vs Correct
Wrong: pre-switch the XTEST device from TS so the monitor never sees the mapping change. Correct: fix the monitor (re-read Escape on `MappingNotify`, cancel only when it cannot) in a recorded native overlay.
