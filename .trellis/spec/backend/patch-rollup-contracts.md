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
- Generate each family in an isolated `mktemp` tree by applying only that family's old patches in historical order.
- The rollup touched-file set MUST equal the union of its old family touched-file sets.
- Any failed hunk, `.orig`, `.rej`, or unexpected `Only in` output MUST abort generation. Dry-run and exit-code gates apply to owned layers too. For declaration-only closure, retain validated source hunks byte-for-byte and append declaration diffs; broad regeneration once silently dropped 0052's namespace budget despite a green complete replay. Its real image-budget gate caught `5 !== 200`.
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
- The `PATCHES` array is the canonical patch set shared by every supported plan; it is NOT itself a deployable chain (members' a-sides span multiple upstream releases).
- Supported plans: 18.1.14 (27 entries), 18.1.18 (38), 18.2.3 (39), and 18.2.10 (42). Counts are physical patch rows, excluding the launcher. 0041 is absorbed into 0037 only in the two 18.2.x plans.

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
- Regression applicability follows resolved plan membership (`_omp_plan_has`).
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
- `research/run-prefix-1841.py` / `run-remote-prefix-1841.py` / `run-tag-prefix-1841.py`: two fresh bun processes (live, then resume) comparing provider-facing bytes.
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
