# PRD: OMP 18.1.18 → 18.2.3 patch-chain migration

## Goal and user value

Upgrade the complete supported patch behavior to OMP 18.2.3 without losing the locally verified cache, compaction, session-lifecycle, and statusline semantics. Preserve the 18.1.14 and 18.1.18 rollback plans.

## Confirmed background

- The saved replay of the 18.1.18 plan onto official 18.2.3 sources covered 38 logical patch entries: 25 CLEAN, 13 CONFLICT, and no patch wholly adopted upstream. The full matrix and partial-adoption evidence are retained in `research.md`; the checked-in audit log is `patches/.18.2.3-candidates/replay-audit-20260917.log`.
- Prior work recorded completed 0030/0033 candidates and an unfinished 0010 candidate. The exact code-resume point is S1-0010 in `implement.md`, not a fresh migration.
- The user approved registration/planning recovery and subsequently approved the final implementation plan with “開” on 2026-09-17. The task is now `in_progress` for repository implementation and sandbox verification. Live upgrade/deployment and real-provider smoke still need explicit approval at their risk boundary.

## Requirements

### R1 — Preserve all effective local semantics

Local, provider-verified cache semantics take precedence over conflicting upstream behavior (user decision, 2026-09-17). Preserve:

- 0035 soft-compaction prefix reuse (historical Opus 5 observation: 97.04% cache hit).
- 0038+0047 stable date/cwd anchors (historical elimination of HISTORY_REWRITE).
- 0068/0069/0070 Codex socket-chain reuse and effort-history restore (historical same-socket observation: 98.0%). Chain loss must fail closed, never silently replay over SSE or another fallback.
- 0034 hindsight snapshot stability (historical 173k resume-prefix observation).
- 0010+0060 atomic idle side requests and Devin cascade pinning.
- 0065 commandcode resume-prefix parity and 0033 cache-turn observability.
- Statusline semantics: Anthropic turn gate 60s, other-provider TTL 50s, and no forced redraw after usage fetch (0007 semantics), rather than upstream's hardcoded 5min TTL and forced redraw.

These historical measurements establish intent, not a claim that the new candidates have passed provider acceptance.

### R2 — Integrate the new lifecycle boundaries safely

The 18.2.3 admission window and session-transition paths must not allow idle/main provider overlap or stale-session dispatch. Preserve publish-before-await `ActiveAgentContinue`, epoch-paired in-flight accounting, and raw `/btw`/`/omfg` concurrency. Cover every upstream entry point, including newly introduced paths. The recorded source anchors and two race scenarios remain in `implement.md`.

### R3 — Complete versioned deployment without changing rollback bytes

Keep finalized 18.1.18 patch files immutable; create changed candidates under `patches/.18.2.3-candidates/`. Only add the 18.2.3 version plan and necessary version-aware verifier support. Retain existing roots, dependency ordering, and canonical patch-set semantics. Shrink partially adopted 0038/0065 hunks to the still-missing behavior.

The previously selected 0037+0041 merge represents two logical entries with one physical candidate. Acceptance therefore means **38/38 logical entries covered, 37/37 resolved physical entries applied**. Any different count requires an explicit mapping and review; it must not conceal omitted behavior.

### R4 — Fail closed and verify the actual selected tree

Unknown, empty, mismatched versions and missing candidates must be rejected before mutation. No nearest-version fallback. All applicable existing verification gates must run for 18.2.3; old version predicates must not silently skip them. Replay, behavioral imports, and rollback comparisons must use isolated, version-matched trees derived from pinned official tarballs, not Bun cache or live packages.

### R5 — Preserve user state and a reversible deployment

Preserve the existing uncommitted `patches/PATCHES.md` edits and unrelated `patches/turn-timer-extension.ts`. No direct runtime edits, live DB/WAL/SHM or credential changes during planning or sandbox work. Deployment must include compatible pi-natives, authoritative repository-to-runtime synchronization, executable source-link validation, a rollback rehearsal, and a process-restart notice. Before the live step, refresh the historical process inventory and backup validity rather than assuming the prior count of 49 is current.

### R6 — Keep records and specifications consistent

Update PATCHES.md's plan/count table, migration history and candidate descriptions without discarding existing edits. Complete Phase 2.2 review, Phase 3.3 spec update, and Phase 3.4 commit workflow before task completion. Repository and runtime patch ledgers must have zero relevant drift after deployment, excluding `.bak` files.

## Acceptance criteria

| ID | Observable result | Requirements |
|---|---|---|
| AC1 | 38 original logical entries map to the resolved 18.2.3 plan; all 37 expected physical entries apply with zero conflicts/missing files. Second application is idempotent. The plan comes from `apply.sh --print-plan`, not a private hand-maintained chain. | R1, R3 |
| AC2 | Reverse replay restores pristine bytes and file set, with no `.orig`, `.rej`, or orphan empty files. Existing 18.1.14/18.1.18 plans and finalized patch bytes remain unchanged. | R3, R4 |
| AC3 | Extended `--verify-rollups` and every applicable existing gate pass on their selected official baselines, including 18.2.3. Admission/idle and reservation/transition regressions fail without the fix and pass with it; epoch-reset and chain-loss cases remain covered. | R1, R2, R4 |
| AC4 | Empty/unknown/wrong-version/missing-candidate cases exit 2 before mutation; check-mode conflict reporting retains its documented contract. No unsupported fallback or version-based silent gate skip. | R4 |
| AC5 | After separately authorized deployment, `omp --version` reports 18.2.3, stack-aware `apply.sh --check` reports all applied, the executable points to source, runtime patch parity holds, and rollback rehearsal is recorded. Required real-provider/TUI smoke is distinguished from offline evidence. | R1, R5 |
| AC6 | PATCHES.md and relevant specs reflect the migrated behavior/counts. Unrelated user changes remain intact; no credential contents are logged or task-scoped writes made to live databases. | R5, R6 |

## Out of scope

- Feature additions, unrelated patch-family cleanup, or changes to the turn-timer extension.
- Replacing local cache semantics with upstream defaults, warmup/racing workarounds, or silent transport/model fallbacks.
- Rebuilding the OMP monorepo/bundle, editing Bun cache, or modifying finalized rollback patches.
- Task start, global upgrade, provider traffic, deployment, or automatic process termination under planning approval alone.

## Planning readiness

The final planning review was approved and Phase 2.1 is active. Remaining technical work is assigned in `design.md` and `implement.md`; no candidate validation or deployment success is implied by task activation.
