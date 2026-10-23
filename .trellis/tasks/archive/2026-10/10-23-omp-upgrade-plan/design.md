# Design: pinned OMP 18.12.6 upgrade

Status: reviewed design approved for repository/sandbox implementation; no permanent installation, publication or production activation approval.

## Situation

The installed code is immutable release `18.10.1-14d1e60540b2-e3991b5e-00608cd3`. The selected controller represents 27 local families, 61 locally owned capabilities and existing upstream adoption 0017 (62 total). The user selected `18.12.6`, source tag commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. Exact observed evidence and its limits live in `research/deployment-boundary.md`, `patch-baseline.md`, `baseline-measurements.json` and `upstream-releases.md`.

## Complication

Upstream changed the same auth, compaction, prefix, task, eval and UI boundaries we customize. Textual applicability is not semantic equivalence. Forty-three paths have multiple current family owners; generating whole-file diffs independently would contaminate ownership. Publication, family validation, installed-smoke version markers and native stamping are explicitly version-bound. Two live companion extensions differ from repository copies and are outside the immutable ledger.

## Decision tree

### 1. Upgrade target

Choose exact `18.12.6` and its pinned official archives. Reject floating `latest` and an unrequested intermediate deployment. A later hotfix requires a new target decision. Registry integrity must be verified and local SHA-256 recorded before extraction; the GitHub tag/attestation relationship must be checked rather than assuming npm `gitHead` exists.

### 2. Migration unit and source of truth

Use one active target revision per existing functional family, generated on documented prerequisite bytes in controller order. Keep historical 18.10.1 bytes and hashes untouched. Reject resurrecting a retired layer chain, cumulative repair tails, hand-edited patch hunks, or copying dirty live/cache sources as pristine.

`research/capability-migration.md` maps every retained local capability and the existing upstream adoption. Until actual consumer evidence establishes an upstream replacement, preserve its behavior through an adapted local delta. An adoption may change physical family count, not silently drop capability coverage. Do not add unrelated features or activate excluded 0097.

### 3. Shared-file integration

One integration owner controls candidate assembly, shared-file hunk generation, catalog generated assets and manifest ownership. Investigations may run concurrently; shared source edits/replay follow prerequisite order. `research/shared-path-owners.json` lists the 43 overlap points, including `agent-session.ts`, `session-maintenance.ts`, auth store/types, `rules.json`, `task/executor.ts` and their declarations. Reject independently diffing each family against a whole final runtime.

### 4. Target-native APIs over compatibility shims

Preserve externally observable custom behavior on supported target APIs. Do not reintroduce removed upstream interfaces merely to make an old gate compile. Particularly, target eval `display()` removal requires mapping preferred MIME/image behavior to the actual target output path; if that is not possible without a user-visible trade-off, stop and obtain a decision before migration. The same rule applies to image-budget signatures, gateway auth options, selector/approval contracts and Codex transport changes.

Pinned task/prefix source confirms warm revival still differs from cold restoration, inherited auto still beats the supplied model default, and the custom provider-only/date-anchor path is not present in the inspected target locations. Preserve those repairs, including target unverified-model handling. Python `_value_image` is a plausible different-layer0078 adoption, but requires actual one-image PNG-priority/JPEG-fallback proof; do not remove the capability or leave a missing-module SKIP. Yield-dependent fixtures must explicitly enable structured task output rather than changing the target default. Exact anchors are in `research/target-task-prefix-source.md`.

Auth/compaction source findings in `research/target-auth-compaction-source.md` require integrating upstream SIGTERM rotation draining with0090's still-custom durable journal; threading target's fourth `model` argument through compaction context; preserving Codex lite/non-lite transport separation; and adapting image counts/bytes through target catalog policy, not the old `(provider, api)` table. None proves upstream adoption. Map installed `pi-agent-core` to upstream `packages/agent`, never the absent `packages/agent-core`.

### 5. Security and persistence

Keep 0090's Anthropic-only durable-refresh boundary, lease/CAS, broker ownership and explicit unlock flow unless independent synthetic consumer proof establishes equivalent target behavior. Upstream SIGTERM fixes are overlap evidence, not journal/idempotency proof. Use synthetic credentials, isolated databases and loopback/intercepted transport only; never test, refresh, rewrite or copy production Anthropic auth or session/model databases.

Retain fail-closed Codex chain recovery, persistent system/tool request-prefix identity, actual model-effort precedence and notebook transitions. Manual `/compact` remains direct without a hidden forced-save turn. The user's subsequent notebook-gate removal supersedes the initial baseline: reminders only, no freshness veto for manual/automatic rollover or `new_context`, and retain exactly the latest saved notebook text. Follow `.trellis/spec/backend/extension-runtime-contracts.md`'s reminder-only contract; do not reinstate the removed gate during migration. Cache warming must respect target persistent-cache eligibility while retaining the eligible-lane budget/stop contract. No fallback or retry expansion is authorized.

### 6. Native overlay and extension companions

Target source still cancels on X11 `MappingNotify`, initializes AT-SPI without the custom timeout, and matches AX titles exactly; retain/adapt the three native repairs rather than assuming upstream adoption (`research/target-native-source.md`). Rebuild target-stamped modern/baseline Linux x64 addons and retain physical Escape/PID/ambiguity safety checks. Historical waiver applies to one past release only.

Companion inventory is separate from text-family ownership. Preserve live `/jevify` and English auto-continue UI/provider continuation strings; do not bulk overwrite `~/.omp/agent/extensions`. Port only required API compatibility changes, verify the affected extension in a private runtime, record exact repo/live bytes and require a clean process reload. No deletion of unrelated live-only extensions.

### 7. Publication architecture

Keep the existing immutable publisher/admission design; extend exact target-version contracts rather than replacing the deployment system. All thirteen OMP packages, including native platform package, must match `18.12.6`; pin and record transitive dependencies in a private cache, with no external code aliases or shared regular-file inodes. Installed-path private smoke must cover all six publisher checks plus target-changed consumers and native overlay verification.

Repository acceptance, preparation, publication and production admission are separate milestones. Final plan approval authorizes repository/sandbox implementation only. Publication requires a later explicit user instruction after candidate evidence. Old sessions and detached brokers exit normally; no kill/watchdog/bypass/hot upgrade. Companion activation is also process-bound and may require a quiet restart window if old/new API compatibility is not bidirectional.

### 8. Rollback boundary

Before a future candidate's `production_admission_started` flag, the publisher may restore its exact previous code pointers. After possible admission, fix forward; never restore tokens/databases, clear the marker or downgrade OAuth code. The currently installed release already has that flag set. `production_activation:false` is not proof of no prior source execution.

## Contracts and validation matrix

| Boundary | Required result | Release blocker |
| --- | --- | --- |
| Official archives/provenance | Exact target versions; verified integrity; recorded SHA-256 and source reference | Missing/mismatched archive or unresolved artifact identity |
| Capability ownership | Baseline 62-ID union represented by local owners plus proven adoptions; 0097 absent | Dropped/duplicated IDs or unproved removal |
| Whole-chain representation | Zero-fuzz replay; exact candidate digest; reverse-to-pristine; identical second replay | Failed hunk, residue, path/mode/symlink drift |
| Runtime/declarations | Real source imports and package-declaration consumers resolve the target closure | Wrong-root imports, missing symbols/types/assets |
| Changed consumer behavior | Named deterministic scenarios pass; plausible negative control for retirement/fix | SKIP on missing behavior, source-only/tautological checks |
| Installed physical path | Six publisher checks and affected consumer smoke under private HOME/XDG/agent | Candidate-only proof, wrong marker, fetch/provider leakage |
| Native/Tern surface | Addon identity and actual cancellation/ownership/rendering interaction verified | Reused old binary, missing physical acceptance, unapproved waiver |
| Publication/admission | Explicit authorization; exact receipt/pointers; old-owner gate | Mixed runtime, agent-state mutation, bypass or downgrade |

## Expected change boundary after implementation approval

- New `patches/.18.12.6-families/` family revisions, plan and manifest: target-specific source/declaration/data representation.
- Existing `patches/apply.sh`, `verify-release-family-plan.py`, `verify-patch-family-rollups.sh`, `publish-release.py` and directly affected fixtures: explicit target routing/ownership and evidence contracts; preserve historical support.
- `patches/native/` recipe/metadata/source patch and directly affected native verification: target source and addon identity.
- Existing behavioral gates and required companion extension sources only where target consumer/API behavior demands adaptation; do not weaken assertions to pass.
- `PATCHES.md`, `DEPLOYMENT-RUNBOOK.md`, `DECISIONS.md` and task artifacts: current accurate usage, decisions and evidence.
- No production runtime or agent/config/credential/database file changes in the repository implementation phase.

## Glossary

- **Capability**: consumer-visible contract retained across upgrades; not the same as a patch file.
- **Family**: one active ownership-preserving representation of related capability deltas.
- **Pristine**: verified official archive bytes, never live/cache copies.
- **Adoption proof**: target consumer evidence that an upstream implementation preserves the custom boundary, including failure/persistence behavior.
- **Closure**: complete independent runtime/dependency/native tree.
- **Admission**: first possible production source execution; durable point after which code-only downgrade is forbidden.

## Deferred technical proof, not deferred scope

Archive SHA-256/provenance, full transitive resolution, patch applicability, target declarations, behavioral adoption, native builds, installed smoke and physical Tern acceptance are execution gates. They are not passing results and cannot be waived by this plan. Any source discovery requiring a genuine behavior loss or expanded feature scope returns to user decision before implementation continues.
