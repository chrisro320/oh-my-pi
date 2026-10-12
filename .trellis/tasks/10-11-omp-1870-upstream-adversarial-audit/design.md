# Authorized upgrade design

## State and authority

Audit complete; **direct unpatched upgrade is NO-GO**. The user subsequently approved safety repairs, complete family rebase and verified deployment without another confirmation. The authoritative mutable work lists are `risk-register.json` (stable finding IDs) and `family-migration-matrix.json` (all 24 selected family IDs plus excluded 0097). Raw `research/` observations are retained independently.

The final target is official18.10.1 at `5d0aaffaf1f987503ce129a642fb6e30339615af`. The complete18.10.0 repair set passed all48 selected gates before the registry advanced; its bytes/evidence remain preserved, with only affected latest-release consumers rerun. The baseline includes the user's uncommitted18.7.0 family/controller/extension changes captured in `research/baseline-manifest.json` and `working-baseline.diff`. The partial original target replay is not a candidate runtime.

## Decision tree

### Is this an upstream regression, a baseline defect, or an unported capability?

- Actual patched-baseline failure -> repair the owning active family; do not blame 18.10.0 or append another tail patch.
- Actual stock-target failure -> retain target architecture and repair its affected boundary; do not restore whole old files.
- Local behavior absent upstream -> semantic rebase, even when textual application is clean.
- Apparent overlap -> trace the real consumer before retirement. 0017 is adopted only after ordinary and connection-bound native replay both pass their real stream consumers; 0094 requires a provenance split.
- Inference without execution -> keep its conditions and evidence level explicit. Do not inflate a source finding into observed data loss, provider billing or credential revocation.

### Does durable local ownership guarantee a safe remote token exchange?

No. The existing lease/CAS protects local writes; it cannot prove that an unacknowledged token POST was not consumed remotely. Persist a per-credential-generation reservation only when a future real exchange begins; an ambiguous attempted generation is not automatically redeemable by a later lease owner. Persist a known replacement before returning it. Unknown outcomes fail closed pending recovery or reauthentication. Existing healthy credentials are never reclassified, quarantined or rewritten at startup or deployment.

Rejected: retrying R0 after arbitrary transport failure, removing invalid-grant handling, or declaring exactly-once behavior from a database fence. Trade-off: the safe policy can require reauthentication after an ambiguous outage. Provider idempotency/recovery behavior remains unverified; there is no client-only proof of actual server revocation.

### Where does resume correctness belong?

At common successful writable adoption and persisted history boundaries, not only CLI startup or `navigateTree`. Preserve model/effort selection, date/cwd anchors, tool/reminder pruning state, frozen system/tools and legacy Hindsight snapshots. Fresh-process startup must reconstruct the same committed wire history as the live host. Moved-session markers and import comparisons must be checked under the appropriate ownership before writes.

Rejected: pinning a UI setting after resume while historical effort-control or prompt bytes still drift; comparing session-file reconstruction alone to itself; accepting the second resumed request after the first already changed the prefix.

### Which compaction fallback is permitted?

Use the effective remote API to select transport policy. Typed chain-loss errors propagate through outer callers. Codex chain-only requests may reconnect, warm with the approved non-generating live context and continue on a valid chain; they must not silently enter V1 or SSE through entitlement, transport or outer-catch paths.

Configured host next-method transitions are distinct from hidden internal replay. Preserve them only under the existing explicit configuration/error contract. Preserve target acceptance transactions and defer metadata/baseline commit until a valid compaction is accepted.

### How should Anthropic changes be integrated?

- Rebase eligible breakpoints into the new checkpoint walk; retain head relocation, correct content-block distance, provider limits, requested TTL and OAuth no-cache policy.
- All credit-sensitive retry rungs pass through the credit-aware rebuild boundary. A previously executed server tool must not be replayed without its credit through a new cache-control shortcut.
- Legacy persisted client omissions reproduce exactly on first resume. New server-managed `drop_block` reports do not imply client-side deletion. Explicit client 400 repairs retain their own durable provenance.
- Native `compaction.type=summarize` is classified separately from ordinary requests. Native beta/context namespaces can change cache behavior despite equal message content; only actual provider usage can establish a hit.

Rejected: replaying the whole old 0094 hunk unchanged, declaring all cache misses client drift, or changing cache policy to make a diagnostic green.

### How much verification is justified?

One strict representation replay plus actual consumer probes at the changed authority boundaries. Reuse existing gates and add only missing discriminating cases during implementation. No all-suite expansion, wording assertions, repeated identical checks or permanent investigation tests. The audit used two existing focused gates plus narrowly scoped source probes; the exact ledger is `verification.md`.

The audit stopped additional protocol simulations after the cyber-flag question. Implementation uses only the minimum synthetic consumer fixtures needed to prove the authorized safety fixes; no real credentials or provider requests.

### What is the deployment and rollback boundary?

The authorized deployment installs an independent immutable runtime/native/ledger closure and atomically publishes code pointers. All 13 OMP packages are `18.10.1`; the old global package tree remains intact. A code-only admission wrapper checks the frozen release binding and old PID/start/boot identities before importing OMP. It refuses normal launch while old sessions or brokers survive, including an unstable successor census. This permits installation without forcibly stopping the current session or allowing mixed-version credential-capable owners.

`research/deployment-final.json` records `code_installation=complete`, `current_session_upgrade=false`, `production_activation=false` and `production_admission_started=false`. The fixed installed source passed six private-HOME smoke checks. Publication succeeded; normal admission was observed refusing with exit 75. Old owners must exit normally; no hot upgrade, forced kill or automatic activation watcher was introduced.

Rollback restores exact code pointers, never stale credentials or `~/.omp/agent`. The launcher durably records possible production admission before source exec; automatic code downgrade is then forbidden. The pre-admission rollback and partial-publication compensation passed synthetic consumer checks. Live cache-hit measurement is not a deployment prerequisite when it would require real credentials; server behavior remains unmeasured.

## Terminology

| Term | Meaning |
|---|---|
| Baseline B | Official 18.7.0 plus the captured current 24-family working plan |
| Target T | Official, unpatched18.10.1 at the final pinned commit |
| Candidate | Complete latest-version source/declaration rebase and its dependency/native closure; installation and activation are tracked separately |
| Text replay | Zero-fuzz patch applicability, not semantic correctness |
| Effective lane | Transport policy selected by remote API/provider configuration, not just native model API |
| Ambiguous generation | Refresh token may have been consumed but no durable replacement is known |
| Observed-synthetic | Real client code exercised with synthetic data/intercepted transport; not server behavior |
| Static-independent | Reachable source chain confirmed by a second current-model reviewer; not runtime proof |

## Spec update

Phase 3.3 is complete. `verification-gate-contracts.md` records implemented exchange reservation/stage/commit, adoption and native lifecycle contracts; `patch-rollup-contracts.md` records the immutable release/admission/rollback protocol; `extension-runtime-contracts.md` records request-only diagnostic attribution. Existing user changes were preserved. The final evidence separates repaired synthetic consumers, installed code and unstarted production admission.
