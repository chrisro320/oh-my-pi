# OMP 更新與完整補丁部署

## Goal

Upgrade the installed OMP to the latest official stable release identified during planning, preserving the effective local patch behavior and a recoverable current installation.

## Confirmed Evidence

- The user approved the final plan with “開始” and emphasized remotecompaction and unusual cache drift. Implementation and the planned backed-up live deployment are authorized.
- Installed `pi-coding-agent` is `18.2.3`, with matching OMP dependencies (`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/package.json:4,49-61`).
- The npm `latest` endpoint resolves to `18.2.10`; its official tarball is `https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-18.2.10.tgz`.
- `patches/apply.sh:178-193,310-368` only routes 18.1.14, 18.1.18, and 18.2.3. Unknown installed versions fail closed before mutation.
- The current `bash patches/apply.sh --print-plan` returns 39 physical patches, including 0072, 0073, and 0074. Historical ledger counts are not the current plan.
- The prior 18.2.6 task remains planning-only. Its 18-conflict matrix is historical evidence, not a result for 18.2.10 (`../09-18-omp-1826-patch-migration/research.md:10-16,42-47`).
- Existing uncommitted work includes the controller, ledger, 0050, 0070 candidate, 0074, and specs. Preserve those working-tree bytes as the starting point; do not reset to HEAD.
- The official 18.2.10 isolated ordered probe produced 18 CLEAN / 21 CONFLICT. Conflicting layers were not applied, so later results use partial predecessor state; this is not a full-chain acceptance result (`research/replay-probe.json`).
- Current `--check` reports 0074 CONFLICT despite its successful live reverse dry run. The controller omits newly added files from its mirror (`patches/apply.sh:401-431`; 0074 patch lines 71-73). The exact-flag isolated reproduction fails with the old-side-only mirror and passes with both file sides (`research/0074-*.log`).
- The target moves terminal UI into `pi-tui`, changes tool APIs, and restructures affected runtime paths; details and source anchors are in `research.md`.

## Requirements

- R1: Pin 18.2.10 for this migration; do not silently follow a later `latest` release.
- R2: Preserve every current logical patch capability. Remove a target-version delta only after proving upstream supplies its behavior; keep older supported plans usable.
- R3: Generate candidates from verified official pristine archives and actual before/after files. Never generate patches from the live installation or Bun cache.
- R4: Validate the complete ordered target plan in isolated package roots before changing the global installation.
- R5: Back up the current installation, launcher, package-manager metadata, and deployed patch ledger before deployment. Preserve unrelated global packages and repository changes.
- R6: Do not overwrite `~/.omp/agent`, credentials, configuration, session history, or databases; do not stop other OMP sessions automatically.
- R7: Keep repository and deployed patch representations synchronized after the final edit. Do not promote unregistered standalone/experimental patches merely because their files exist.
- R8: Fix the generic added-file mirror defect so status detection covers real patch contents; do not whitelist a patch or weaken failure handling.
- R9: Adopt upstream 18.2.10 public API changes while preserving local patch contracts. Use only isolated/local Ollama smoke, never real Anthropic authentication or implicit cloud-provider selection.
- R10: Prioritize remote compaction connection/attempt ownership, tool-call/result continuity, retry/fallback, and resume effort history; prioritize cache-prefix stability across resume, model switches, context hooks, and local/native compaction.
- R11: Per the user's execution-time instruction, exclude redundant 0076/scout thinking customization. Prioritize the upgrade, remotecompaction and cache verification; no unrelated expansion.

## Acceptance Criteria

- AC1 (R1/R4): A freshly launched CLI reports `omp/18.2.10`, with the source entrypoint selected and all relevant OMP packages resolving inside the intended installation.
- AC2 (R2/R3): A per-layer migration record accounts for every current plan member as unchanged, version-specific candidate, or evidenced upstream adoption.
- AC3 (R3/R4): The target plan applies from official pristine, is idempotent, passes its selected behavior gates, and reverses to the exact original touched-package contents in isolation. Unknown/mismatched versions still fail closed.
- AC4 (R4/R9): Actual selected-root SDK/TUI imports and CLI startup succeed; a fresh deployed CLI completes one minimal turn against local Ollama `qwen3:8b-nt` using private agent state. Offline/local checks are not represented as cloud-provider acceptance.
- AC5 (R5/R6): Verified backups and explicit rollback commands exist before the live switch; protected agent data and unrelated work are not overwritten.
- AC6 (R7): Final live `--check` has no missing/conflicting/pending entries; repository and deployed ledger owned files compare byte-for-byte.
- AC7 (R8): A patch that creates a file survives apply/check/second-apply/revert state transitions; the retained regression fails with the old target enumeration.
- AC8 (R10): Exercise existing remote-chain and prefix-preservation behavioral gates, including stale sockets, missing tool output, terminal failures, transcript reconstruction, and changed model/context boundaries. Report exact coverage and any live-provider limits.

## Out of Scope

- New features, patch-family consolidation, unrelated Trellis/extension changes, provider/account changes, data repair, or automatic termination/restart of existing sessions.
- Finishing or archiving the old 18.2.6 planning task.
- Claiming cache-hit improvement or every provider's live acceptance from a basic startup/smoke check.

## Risks and Approval Boundary

- The 21 textual conflicts require semantic review; patch count alone does not predict the final candidate count.
- Upstream removes bash `env` and read image query/bare-image APIs, and changes eval judgment/image/web selectors. Restoring those removed upstream interfaces is not part of this migration.
- Existing running sessions do not reload changed modules; full exit/relaunch is required after deployment. This task will not terminate them.
- Final-plan approval received. Implementation may proceed; global deployment still requires the isolated acceptance and backup gates above.
