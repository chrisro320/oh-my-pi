# PRD: OMP 18.2.3 → 18.2.6 patch-chain migration

## Goal and user value

Migrate the complete effective 18.2.3 patch behavior to official OMP 18.2.6 without losing the locally verified cache, compaction, session-lifecycle, provider, and status-line contracts. Keep the installed 18.2.3 runtime unchanged until an isolated 18.2.6 chain is deploy-ready and live cutover is separately authorized.

## Confirmed background

- The installed and documented deployment remains 18.2.3. The upstream comparison target is 18.2.6; these are separate facts from whether any local patch semantics remain necessary.
- The six official 18.2.6 package tarballs were downloaded to `/tmp/omp-18.2.6/` and matched npm registry `dist.integrity`. No global package, Bun cache, runtime patch tree, credential, or database was modified.
- Ordered `--fuzz=0` replay of the current 18.2.3 plan found 19 clean physical patches and 18 conflicts. A conflict is not adoption evidence; TUI package moves account for several conflicts.
- Upstream partially overlaps Hindsight transcript freezing and repeated local-compaction retained-tail handling. It does not provide the durable Hindsight resume snapshots, provider-ready live compaction context, `live` scope, remote tools/trace, Codex fail-closed chain semantics, shape-aware snapcompact budgets, or the local status-line behavior.
- Existing unrelated uncommitted files `patches/0071-omp-devin-request-dump.patch` and `patches/turn-timer-extension.ts` are user work and must remain untouched.

## Requirements

### R1 — Preserve effective local semantics

Retain every behavior from the selected 18.2.3 plan unless source-level comparison and a behavior-sensitive gate prove that 18.2.6 fully owns it. Partial adoption must shrink or rewrite only the overlapping hunks; changelog similarity, filename movement, clean application, or patch conflict alone is insufficient evidence.

### R2 — Use official isolated sources

Build candidates and verification trees only from integrity-verified official 18.2.6 tarballs in disposable locations. Compare each patch against its actual package root and ordered predecessor state. Do not use the live installation or Bun cache as a writable fixture.

### R3 — Add an exact fail-closed 18.2.6 plan

Add exact 18.2.6 routing, version-specific candidates, package roots, dependency ordering, and plan-selected gates without changing finalized 18.1.14, 18.1.18, or 18.2.3 rollback bytes. Unknown, empty, mismatched, or incomplete versions must fail before mutation.

### R4 — Handle the TUI split explicitly

Migrate `0004` and `0033` segment/schema behavior to `@oh-my-pi/pi-tui`. Rebuild `0037` as a cross-package boundary: `pi-tui` owns usage cadence, turn detection, render-cache invalidation, and repaint suppression; coding-agent owns the `StatusLineHost`/`AgentSession.fetchUsageReports` bridge; existing `0026` in pi-ai owns provider-filtered credential fan-out. The 18.2.6 plan must use `TUI` for TUI-only patches and `NM` for cross-package 0037. Preserve cache-read totals, per-turn cache visibility, turn-end refresh, Anthropic idle silence, provider restriction, and no forced repaint.

### R5 — Rewrite partially adopted and high-risk families

- Shrink `0034` around upstream transcript-local freezing while retaining durable recall/MM snapshot replay, empty-result semantics, reset boundaries, and transition ownership.
- Remove only the retained-tail overlap from `0035`; retain provider-ready cache-preserving summary context and iterative compaction semantics.
- Preserve `0062`, `0066`, and `0067` where upstream history correctness does not supply previous-archive reduction credit, live provider context, remote tools, or trace ownership.
- Rebase `0068 → 0069 → 0070` as one ordered Codex contract: connection-scoped append identity, durable effort baseline, and fail-closed compaction retries/fallbacks.

### R6 — Prove behavior and reversibility

Run applicable existing behavior gates against the selected 18.2.6 tree, add or revise only gates needed for changed upstream boundaries, and demonstrate fault sensitivity for rewritten high-risk contracts. Prove clean apply, real second apply, stack-aware check, reverse restoration of bytes and file set, source CLI startup, and package-root correctness in an isolated HOME.

### R7 — Preserve records and review independence

Update the patch ledger, migration notes, version counts, and executable spec contracts. Complete read-only independent review, Phase 3.3 spec update, and authorized commit workflow. Reviewer findings are fixed by the implementation owner, not the reviewer.

## Acceptance criteria

| ID | Observable result | Requirements |
|---|---|---|
| AC1 | `apply.sh --print-plan` resolves an exact 18.2.6 plan with all surviving logical semantics and deterministic order: 0004/0033 use `TUI`, cross-package 0037 uses `NM`, every gate imports its selected root, and all three older plan outputs remain byte-stable. | R1, R3, R4, R5 |
| AC2 | Every 18.2.6 conflict has a recorded source-level disposition: fully adopted with behavior proof, partially adopted with reduced hunks, or still required with a candidate/re-anchor. | R1, R2, R5 |
| AC3 | An integrity-verified isolated 18.2.6 HOME passes apply, second apply, `--check`, full applicable gate suite, CLI startup, and reverse restoration to the exact pristine file set and bytes. | R2, R3, R6 |
| AC4 | Fault controls reject removal or weakening of durable Hindsight snapshots, live compaction context, TUI token/cache-turn rendering, 50s/60s usage gating, active-provider forwarding, no-repaint behavior, snapcompact budget accounting, Devin contracts, and Codex connection/effort/fail-closed semantics. | R4, R5, R6 |
| AC5 | `PATCHES.md`, controller comments, verifier selection, and Trellis specs distinguish installed 18.2.3, upstream 18.2.6, and the resulting 18.2.6 patch plan without claiming changelog-only adoption. | R7 |
| AC6 | The two pre-existing uncommitted files are unchanged, no live runtime/cache/credential/DB is mutated during planning or sandbox implementation, and live cutover cannot occur without explicit point-of-risk approval. | R2, R7 |

## Out of scope

- New patch features unrelated to compatibility with 18.2.6.
- Opportunistic rollups or renumbering beyond reductions forced by proven upstream adoption.
- Modifying or deploying `0071-omp-devin-request-dump.patch` or `turn-timer-extension.ts`.
- Treating a provider smoke on another model or an ordinary cache hit as proof of compaction cache behavior.
- Live global OMP/package upgrade, synchronization to `~/.omp/patches`, runtime backup/restore, provider smoke, and process restart. These require a later separately authorized cutover task or phase.

## Delivery boundary

- The task ends when the repository and an integrity-verified isolated 18.2.6 sandbox are deploy-ready. Implementation approval authorizes no live side effect.
