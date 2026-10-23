# Current patch baseline and migration boundaries

## Observed resolver and byte evidence

Main-session measurement executed only the controller's read-only selectors with `OMP_PATCH_VERSION=18.10.1` and no `OMP_PATCH_PLAN` override:

- `bash patches/apply.sh --print-plan`: exit 0, 27 entries.
- `bash patches/apply.sh --print-capabilities`: exit 0, 62 IDs (61 locally owned plus existing upstream adoption 0017).
- `bash patches/apply.sh --print-gates`: exit 0, 57 gate entries. These were listed, NOT executed.
- Parsed manifest: 27 families, 61 locally owned capability IDs, 179 unique owned paths.
- Exact byte comparison against installed `18.10.1-14d1e60540b2-e3991b5e-00608cd3/ledger`: every selected family patch, `apply.sh`, `plan.tsv`, `manifest.json`, `verify-model-selection-resume.ts` and `verify-release-family-plan.py` is identical. `PATCHES.md` differs. Full path SHA-256 records and selector output are in `baseline-measurements.json`.
- This closes the research agent's sampling-only limitation. Its content samples and sizes alone were not treated as equality proof.

The six initially modified tracked files are therefore not an undeployed patch candidate: four patch/manifest/verifier files are already installed; `PATCHES.md` and root `DECISIONS.md` include later documentation. Root DECISIONS also contains a newer CPA configuration assessment and this task's planning entry. Do not overwrite any of them from HEAD or from the installed ledger. The model-default repair archive is untracked locally and exists in the installed ledger; preserve it and its pinned revision rather than treating untracked as disposable.

Subsequent user-owned change supersedes the initial companion snapshot: notebook freshness enforcement was removed, with the reminder-only contract now in `.trellis/spec/backend/extension-runtime-contracts.md:1272-1320` and `DECISIONS.md` under `Notebook compaction gate removed`. Initial byte hashes remain historical observations, not current companion hashes. Migration must preserve non-blocking manual/automatic/`new_context` compaction and exactly the latest saved notebook text; reconcile current bytes before execution without undoing the newer change. This planning pass did not repeat its runtime tests or edit those source/spec files.

## Family inventory and provisional policy

`plan.tsv` is the authoritative family/capability ownership inventory. All 27 current entries are retention requirements until target-source and consumer evidence supports an explicit migration disposition. They are not proven reusable unchanged. Existing 0017 upstream ownership must be revalidated on the selected target; 0097 remains excluded. Do not revive retired 0045, 0073, 0086/0087 or 0091 layers to reconstruct a historical chain.

| Risk cluster | Current ownership | Required investigation after target selection |
| --- | --- | --- |
| Compaction, notes, image retention | `family-compaction`; `family-image-budget-snapcompact`; `family-image-display` | Signed-thinking and kept-tail ordering, chain-only Codex recovery, archive restoration, direct manual `/compact`, reminder-only notes behavior without manual/automatic freshness veto, child behavior, native compaction and image costs. |
| Prefix/resume/effort | `family-persistent-prefix-resume`; 0069; 0074; 0094; 0095; 0101 | Actual serialized request continuity, system/tool contract stability, effort precedence, persisted prompt/yield items and fresh-process restore. |
| OAuth/usage/provider wire | 0090; `family-usage-pipeline`; `family-devin-wire`; `family-antigravity-wire`; 0065; 0098; 0099; 0100 | Anthropic-only durable protection, lease/CAS/account-scoped discovery, gateway and endpoint changes, retry policy and StepFun built-in versus custom override. |
| TUI/session workflow | `family-status-accounting`; `family-input-translation`; 0010; 0032; 0046; 0048; 0050; 0072; 0092; `family-hindsight` | Actual queue/steering/selector surfaces, footer accounting, scheduling/resource lifetime, memory composition and cache keepalive. |
| Native closure | `patches/native/overlay.json` and its source patch, separate from text family manifest | Target source/API drift, two CPU variants/version stamp, mapping/AT-SPI/Chrome ownership semantics and real Tern/native acceptance. |

Shared files must be rebased in controller order. In particular 0101 follows compaction's edits to `task/executor.ts`; preserve separate ownership rather than folding it silently. The new target may remove or restructure eval `display()`: map the existing MIME-display behavior explicitly before deciding how to retain it.

## Registered versus companion gates

The 57 selected entries are captured verbatim in `baseline-measurements.json`. Source entry points include `verify-manual-compaction-direct.ts`, `verify-context-notes-append-projection.ts`, `verify-model-selection-resume.ts`, `verify-codex-compaction-chain-fail-closed.ts`, `verify-oauth-durable-refresh.ts`, `verify-subagent-warm-revival-prompt.ts` and their existing capability neighbors. Gate list membership does not establish coverage or a passing result.

Independent deployment/extension checks are outside that list and must not be lost: `verify-cache-prefix-audit.ts`, `verify-context-notes-save-gate.ts`, `verify-session-cache-keepalive.ts`, `verify-auth-unlock-extension.ts`, `verify-native-overlay.py`, `verify-release-publication.py`, and the installed-path smoke. Absence of a dedicated gate for a capability does not prove it is untested: inspect actual consumer coverage, then use the smallest relevant existing gate or a throwaway smoke. StepFun 0100 has no dedicated selected gate and modifies generated catalog data; verify actual discovery/stream URL behavior without creating a source-spelling test.

## Companion extension closure

Exact byte comparisons, not sampling:

- Identical repo/live pairs: `cache-prefix-audit-extension.ts` → `cache-prefix-audit.ts`; `context-notes-save-gate.ts`; `input-translator-extension.ts`; `cron-extension.ts` → `cron.ts`; `resume-cache-breakpoint-extension.ts` → `resume-cache-breakpoint.ts`; `context-persist-audit-extension.ts` → `context-persist-audit.ts`; `auth-unlock-extension.ts` → `auth-unlock.ts`; `turn-timer-extension.ts` → `turn-timer.ts`.
- Different: `auto-continue-extension.ts` versus live `auto-continue.ts`. Inspected diff changes comments, UI/command descriptions and provider-visible `additionalContext` strings from Chinese to English. Do not call this comments-only or silently overwrite it.
- Different: `magic-commands-extension.ts` versus live `magic-commands.ts`. The live copy additionally registers `/jevify`. Preserve this behavior pending explicit ownership/source assessment.

These companions live under the excluded `~/.omp/agent/extensions` directory, not the immutable runtime ledger. Future publication must separately inventory and review required companion changes without reading credentials or databases. Live-only extensions are not authorized for deletion or bulk replacement. No companion file was modified by this investigation.

## Reusable tooling and limitations

- `verify-release-family-plan.py`: existing full official-archive replay/reverse/second-replay oracle. Target-version and ownership/adoption support currently explicit for 18.10.x.
- `verify-patch-family-rollups.sh`: existing selected-version wrapper; do not replace it with a second private family list.
- `publish-release.py`, `release-launcher.py`, `verify-release-publication.py`: immutable closure, admission barrier and synthetic transaction proof. Do not reuse obsolete direct-global watcher scripts as current deployment instructions.
- `native/build-natives.sh`, `native/overlay.json`, `verify-native-overlay.py`: recorded source/toolchain/addon closure, requiring target adaptation and physical acceptance as applicable.
- Archived installed-path smoke: reusable six-check behavioral pattern; version markers and possibly consumer APIs need target migration.

See `deployment-boundary.md` for exact current anchors and invocation boundaries. All future commands remain unexecuted until the corresponding planning/implementation gate is approved.

## Documentation discrepancies

`DEPLOYMENT-RUNBOOK.md:11` says 26 families/61 capabilities, while current selectors report 27/62. `PATCHES.md:11` says 176 owned paths, while manifest parsing reports 179. These do not change current selected behavior, but the eventual upgrade documentation must derive current totals from selected manifest/controller evidence.

## Verification boundary

No apply, `--check`, replay, behavioral gate, tests, provider calls, database access, package install, native rebuild, public normal launch, extension sync, publication or rollback was performed. Selector execution, byte comparison, metadata reads and inspection of two observed companion diffs are the evidence collected here.
