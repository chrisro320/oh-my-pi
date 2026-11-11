# R5a — durable OAuth refresh and idle cache warming

## Result / hand-off

**Both families accepted, in order.** Rebase state is `next = 16`, with **nothing pending**. No export was run.

| family | accepted | conflicts / resolution | `check` |
|---|---|---|---|
| 15 — `0090-omp-oauth-durable-refresh` | yes | One import-head diff3 block in `pi-ai/src/auth/usage.ts`; retain upstream `providerPauseReason`, remove the obsolete `OAuthCredentials` type import | exit 0; accepted 15; replay equals work; `ef615fa7156a847259583b7d89d1f54207122e55f2bdddeb40bbd2737a73bbfe` |
| 16 — `0092-omp-cache-warming-idle-budget` | yes | All 11 paths merge without a conflict; retained the idle-owner, cron budget, side-purpose and Anthropic thread opt-out behavior | exit 0; accepted 16; replay equals work; `b7f98168f3ded023aa6bf7d4edc8648dd9b21677ca236b5f9f0ad7c5516f9363` |

Fresh fuzz-0 source snapshot: **`/var/tmp/omp-18186/r5a-snap16`**, digest equal to the family-16 check above.

Dependency-complete runtime for the next slice:

```text
/home/chris/checkouts/r5a-oauth-warm-runtime/install/global/node_modules
```

It is an **ovnfs checkout of R4's runtime**; R4's runtime was not modified. The six snapshot packages were overlaid individually. All six package tree digests equal the source snapshot, including modes/structure: [`r5a-snapshot-runtime.json`](r5a-snapshot-runtime.json).

Candidate runtime: **17,356 entries**, SHA-256 **`63ba50791583ed2f88b7ee8945f737f6f4f1f3b5fc8a621dd65bde09eba3cf59`**. Every acceptance receipt reports unchanged runtime bytes.

**All six assigned-family gates pass.** The complete compaction isolation gate also passes. Two additional complete gates remain red only on behavior authored by pending **0094 / 0095**, with historical ownership proof below. This is not a claim that those two complete gates pass.

No TASK.md, `patches/apply.sh`, `patches/versions.json`, or `patches/.18.18.6-families/*` edit was performed. No commit, reset, stash, live installation, live credential or live DB access was used.

## Family rewrite / semantic review

[`r5a-merge-summary.json`](r5a-merge-summary.json) records the emitted delta statistics:

| family | changed paths | historical hunks / additions / deletions | accepted hunks / additions / deletions | retired production code removed |
|---|---:|---:|---:|---|
| 0090 | 36 | 154 / 1,796 / 395 | 154 / 1,796 / 395 | none |
| 0092 | 11 | 53 / 376 / 48 | 53 / 376 / 48 | none |

Equal totals do not mean unchanged patch context: the source fragments and replay are target-native.

### 0090: Anthropic-only protection and upstream logout

The policy is unchanged from DECISIONS.md, **“Anthropic-only durable OAuth protection”**:

- `auth/refresh.ts:121,819` still uses the exact `anthropic` provider predicate for durable reservation/staging/unknown-outcome protection. Non-Anthropic exchanges keep ordinary single-flight, lease renewal and CAS publication.
- Matching legacy staged non-Anthropic replacements are adopted once; pending/stale markers remain inert. Public unlock is not applicable to other providers.
- The import conflict resolution keeps upstream pause enforcement in both usage lookup and probing (`usage.ts`, `providerFor` and the per-credential probe). It does not remove the pause or register an override for Antigravity.

Re-checked the upstream logout/scoped-model change against the accepted source:

- `slash-commands/helpers/logout.ts:128-145` receives the session, reloads credentials, removes the exact row, refreshes that provider online, then calls `session.refreshScopedModels()`.
- The selector and RPC paths pass the session (`selector-controller.ts:2326`, `rpc-mode.ts:2836`); `main.ts:2807` installs the session-owned scoped-model refresher.
- `AgentSession.setScopedModelsRefresher` / `refreshScopedModels` remain intact (`agent-session.ts:8358-8367`). Failure of the scoped-model callback is logged, not allowed to undo logout.
- This family does not call the old logout callback shape. No compatibility shim or extra logout policy was added. The gate's real refresh/key/usage concurrent-logout cases pass; row/lease/CAS ownership remains the guard against late publication. `/auth-unlock` retains its warning to close or idle other processes before confirmation, and the held-result residual-risk case remains covered.

This is a source-level logout integration review plus the existing concurrent-logout behavioral coverage, **not** a newly added end-to-end logout UI test.

### 0092: single owner, including workers

Preserved the production owner boundaries:

- SDK warmer defers while compaction, idle recap or a guarded idle side turn owns the session (`sdk.ts:4814-4821`).
- Warmer re-checks deferral after the async decision hook and publishes `settling` before the synchronous start callback; ownership lasts until settlement, not merely abort (`cache-warmer.ts:833-919`).
- Replay sets `requestPurpose: "side"` and disables stateful threading **only for Anthropic Messages** (`cache-warmer.ts:939-952`). OpenAI chaining remains intact.
- Maintenance retries only its own blocked slot, preserving the other deadline; repeated warm hits must not starve recap/compaction.
- Production task and worker warm-up sessions still use `cacheWarming: false` (`task/executor.ts:4991`, `thread/worker-warm-up.ts:62`). No worker mirror or second timer was introduced.

The unchanged idle-owner gate passes in both normal main placement and a **forced real worker** using `worker-matrix-runner.ts`; that launcher requires an acquired worker and checks the returned execution thread against it. This worker run is the historical SDK-root behavioral twin described in `m6-worker-matrix.md`, not a claim that production children now start warmers.

## Gate repairs and selective Antigravity retirement

### Durable refresh scenarios

`verify-oauth-durable-refresh.ts` (u)–(x) now refresh **`openai-codex`** through the real public `AuthStorage.oauth` pipeline and its real built-in token descriptor. Fixtures carry Codex `accountId` metadata. The original intents remain:

- (u): a legacy pending marker neither blocks ordinary refresh nor gets rewritten;
- (v): adopt the matching staged successor without another POST; ignore a stale generation and perform ordinary refresh;
- (w): a peer takeover wins publication and a non-Anthropic exchange creates no journal;
- (x): staged adoption cannot overwrite a replaced row or a lost lease, tested independently.

Also moved the generic non-applicable-unlock (t) and unpublishable-local-exchange fixtures to Codex, avoiding a paused-provider rejection masking the intended assertion.

Added a **public `pi-ai/oauth` `refreshOAuthToken`** leg, selected by `plan.since("18.18.4")`: an SDK caller holding an old Antigravity grant receives `ProviderDisabledError` **before any token endpoint request**. No custom provider override is registered. The control removes the upstream pause assertion and is rejected at the zero-token-POST assertion.

One existing owner-timeout fixture exposed a cold-copy timing flaw: its 250 ms caller budget could expire before the exchange was admitted. It now advances the existing synthetic clock only inside the admitted public refresh callback, spending a 5 s caller budget deterministically. The same admitted-exchange, no-abort, no-second-exchange and durable-publication assertions remain. No production timeout was changed.

The existing fence script's isolated `--only=` cases still work: the scenario-runner insertion seam is preserved, and those intentionally isolated runs do not fan out the new scope controls.

### Keep supported pre-pause coverage

Following Main's instruction, neither Antigravity-only leg was deleted outright:

- `verify-auth-unlock-extension.ts`: retain the old Antigravity refusal and advertising mutation **only when `!plan.since("18.18.4")`**. Codex refusal and its advertising mutation are unconditional. One-line reason: a paused provider cannot prove that a usable non-Anthropic login is excluded from the durable journal.
- `verify-account-eligibility-retention.ts`: Codex 403/401/pruning/replacement legs remain unconditional. The Google discovery fixture is **Antigravity-only** (`googleAntigravityModelManagerOptions`, injected `resolveAccounts`), bypassing the production auth pause, so that leg is selected **only when `!plan.since("18.18.4")`**. The current plan prints the explicit paused-provider skip.

Production discovery obtains its key/accounts through auth (`model-registry.ts:2690-2709,2779-2787`); paused-provider key resolution returns no key (`auth/cascade.ts:219,261,391`). The fake Google resolver therefore proves no currently reachable built-in provider behavior on the candidate. It remains useful on supported 18.18.0, so only its candidate leg is retired. No apply.sh/menu change is required: the Codex half still justifies the gate.

Both selective gates were also run against a separate ovnfs **18.18.0** runtime (all 13 OMP package versions checked):

- unlock: **PASS**, including `google-antigravity not applicable` and the Antigravity advertising mutation;
- retention: **PASS**, including Antigravity 403 retention, tagless union and keyless-403 behavior.

Receipt: `/var/tmp/omp-18186/r5a-stable-final/receipt.json`, exit **0**, 2/2 PASS; runtime hash unchanged, `2644167106badba690c843de6cd9eab3b51e8a8a2be49cadf02c689319fd879e`.

## Verification results and exits

Durable index: [`r5a-gate-results.json`](r5a-gate-results.json). It is explicitly a selection of the latest observed cells, **not** a fabricated combined run.

| gate | final exit | evidence / result |
|---|---:|---|
| `verify-oauth-durable-refresh.ts` | 0 | 69 behavioral scenarios, including paused-provider refusal; nine new red controls |
| `verify-oauth-unlock-fence-faults.sh` | 0 | unmutated control green; all existing shutdown/fence/surface/scope/release-atomicity controls rejected |
| `verify-auth-unlock-extension.ts` | 0 | Anthropic-only completions/routing; Codex advertising control rejected |
| `verify-account-eligibility-retention.ts` | 0 | Codex retention green; candidate's Antigravity-only discovery explicitly skipped |
| `verify-oauth-worker-single-owner.ts` | 0 | real worker bridge; nine worker callers share one token POST per rotation; fenced unlock reaches the main owner |
| `verify-idle-warming-owners.ts` | 0 | normal main placement: budget + `/cron keep`, no overlapping idle owners, settlement and deadline preservation |
| same gate, forced worker | 0 | same complete gate in a real worker; `/var/tmp/omp-18186/r5a-worker-idle/receipt.json` |
| `verify-anthropic-threads-warm-compaction-isolation.ts` | 0 | **complete** unchanged gate; warm replay unthreaded, anchor retained, every summary leg and OpenAI chaining pass |
| `verify-anthropic-request-audit.ts` | 1 | earlier warmer `requestPurpose` assertion now passes; remaining compression-observer failure belongs to pending 0094 |
| `verify-extensions-load-18180.ts` | 1 | 15 staged modules load unchanged; 0092 `cache_warming_result` dependency now present; only pending 0095 `ContextEvent.purpose` fails |

Receipts:

- `/var/tmp/omp-18186/r5a-final-gates/receipt.json`: family selection plus all three requested re-checks; exit 1. The final source of the standalone OAuth gate and fence script is accepted by the next receipt. The companion gate was NOT_RUN here because `--companions` had not been supplied; this is not counted as execution evidence.
- `/var/tmp/omp-18186/r5a-oauth-extension-final/receipt.json`: repaired OAuth + fence gates both PASS; complete companion gate executed with `/var/tmp/omp-18186/companions-snapshot`, fails only on 0095; batch exit 1.
- `/var/tmp/omp-18186/r5a-worker-idle/receipt.json`: forced-worker complete idle-owner gate, exit 0.
- `/var/tmp/omp-18186/r5a-stable-final/receipt.json`: both supported pre-pause provider gates, exit 0.
- Final `verify-no-version-literals.py` over all three changed gate files: exit **0**, **0 violations**, five `since()` boundaries.

All executions use the standard runner's `bwrap --unshare-net`, private HOME/XDG and hidden live agent/install/credential directories. Synthetic fetches or loopback fixtures only; no real API calls. No full-batch, build, lint or general typecheck was run. The optional 16-second synchronous-stall variant remains explicitly unrun.

### New mutation controls: observed red child output

Controls transform only a selected source module in their child realm; the parent requires nonzero exit **and** the named behavioral failure. Final durable-gate log lines 74–82:

| control | child exit | observed failure |
|---|---:|---|
| (t), permit another provider's unlock scope | 1 | `openai-codex: refused before any row or journal read` |
| (u), journal every provider | 1 | `outcome is unresolved` |
| (v), remove staged adoption | 1 | `a staged replacement must be published without another exchange` |
| (v), accept stale generation in read/commit | 1 | `a stale marker must not suppress the ordinary exchange` |
| (w), publish before ownership/CAS fence | 1 | `a peer rotation must survive the previous owner's CAS` |
| (x), replaced row, publish before fence | 1 | `row: the concurrent winner is returned, never the staged bytes` |
| (x), lost lease, publish before fence | 1 | `lease: the peer's row survives` |
| unpublishable local exchange, drop pre-grant guard | 1 | `an unpublishable local exchange must be refused before the grant` |
| paused provider, drop upstream auth assertion | 1 | `a paused provider must be refused before any token POST` |

The extension's added Codex-advertising control also exits **1** at `only the journal-protected provider may be advertised`; both the candidate and stable logs record that diagnostic.

### Proven remaining later-family failures

**0094 / request audit:** the earlier failure at `verify-anthropic-request-audit.ts:207` is cleared: the test proceeds through the real warmer replay/archiving/baseline checks and stops at `:255`, `the audit must see the uncompressed body: a compressed request left no archive`. Frozen `0094-omp-anthropic-thinking-drop-resume-v18.18.0.patch:313-320` installs `wrapRequestFetch` / `wrapWireFetch`; `:349-359` places those observers above/below compression. That is precisely the missing behavior. The pinned historical full-batch receipt records this named gate **PASS, exit 0** (`final-full-batch-18.18.0.json:471-485`). No 0094 code was copied into 0092.

**0095 / companion hooks:** complete companion log lines 5 and 11 now name only `ContextEvent.purpose` (source interface and runtime event); `cache_warming_result` is no longer missing. Frozen `0095-omp-context-audit-request-purpose-v18.18.0.patch:49-63,78-85` authors the field and its actual event forwarding. The pinned historical full-batch receipt records this named gate **PASS, exit 0** (`final-full-batch-18.18.0.json:911-927`). The complete gate remains intact and red, rather than being narrowed to hide 0095.

Historical receipt path for both proofs:

```text
.tasks/archive/2026-11/11-07-omp-version-agnostic-gates/research/final-full-batch-18.18.0.json
```

## Reproduction

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py snapshot \
  --through 0092-omp-cache-warming-idle-budget --out <fresh-source-dir>
# Start from an ovnfs copy of the R4 dependency-complete runtime. Overlay each
# snapshot package separately with rsync -a --checksum --delete; do not delete
# the seven sibling dependency packages.
python3 patches/run-gates.py \
  --families 0090-omp-oauth-durable-refresh,0092-omp-cache-warming-idle-budget \
  --node-modules /home/chris/checkouts/r5a-oauth-warm-runtime/install/global/node_modules \
  --jobs 1 --out <fresh-family-evidence> --json <fresh-family-evidence>/receipt.json
python3 patches/run-gates.py \
  --gates verify-anthropic-request-audit,verify-anthropic-threads-warm-compaction-isolation,verify-extensions-load-18180 \
  --node-modules /home/chris/checkouts/r5a-oauth-warm-runtime/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out <fresh-dependency-evidence> --json <fresh-dependency-evidence>/receipt.json
python3 patches/run-gates.py \
  --gates verify-auth-unlock-extension,verify-account-eligibility-retention \
  --node-modules /home/chris/checkouts/r5a-stable-gate-runtime/install/global/node_modules \
  --jobs 1 --out <fresh-stable-evidence> --json <fresh-stable-evidence>/receipt.json
python3 patches/verify-no-version-literals.py \
  patches/verify-oauth-durable-refresh.ts patches/verify-auth-unlock-extension.ts \
  patches/verify-account-eligibility-retention.ts
```

The worker run uses `patches/run-gates.py`'s `Runner.prepare`, `environment` and `command` without altering their sandbox policy, replacing only the command's final gate argument with:

```text
patches/worker-matrix-runner.ts worker patches/verify-idle-warming-owners.ts
```

Its complete actual bwrap argv is retained at `/var/tmp/omp-18186/r5a-worker-idle/logs/verify-idle-warming-owners.log:2`; its receipt includes the gate source hash and before/after runtime hash.

## Non-acceptance attempts / remaining risks

- The first new-control run rejected the correct (t) mutation but its parent expected one space after `FAIL`, while the gate prints two. Fixed the result matcher; it now requires the actual named failure and all nine controls pass.
- The first full fence-copy control exposed the pre-admission 250 ms timing problem described above. The final fence receipt is green after the deterministic admitted-callback clock change.
- The first companion re-check omitted its required staged-fixture option; the complete configured re-check is the later executed receipt, not that NOT_RUN cell.
- A first stable-runtime preparation used rsync's size/mtime quick check. npm tar entries share timestamps and the equal-length version string was retained, so that run still reported the candidate version and is **not** stable acceptance evidence. Re-overlaid with `--checksum`; the accepted stable receipt reports 18.18.0, all 13 package manifests report that version, and its Antigravity legs actually execute. The same checksum overlay was applied to the candidate; its hash remained exactly unchanged, and all six candidate packages match the snapshot byte-for-byte.

No unresolved family-15/16 conflict or single-owner defect remains. R5b must land 0094 and 0095, then rerun the **complete** request-audit and companion-load gates; their remaining reds are proven pending-family dependencies, not waived acceptance. Main owns export, task evidence and final full-chain acceptance.
