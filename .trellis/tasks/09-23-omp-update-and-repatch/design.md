# Design: OMP 18.2.3 to 18.2.10

## Boundary

The gap is an unsupported target release plus a reproducible added-file status-detection defect. Behavior belongs in the existing patch families and controller, not in runtime-only repairs or a new compatibility layer.

Expected owned files:

- `patches/apply.sh`: exact 18.2.10 routing, TUI package-root handling, and complete old/new-side target enumeration for status mirrors.
- `patches/.18.2.10-candidates/`: only version-specific semantic/context adaptations. Preserve finalized older candidates and plans.
- Existing affected `patches/verify-*.ts` and `verify-patch-family-rollups.sh`: selected-root support, target API-shape changes, actual-plan snapshots, and the added-file regression. No new broad verification framework.
- `patches/PATCHES.md`, existing deployment runbook/specs, and this task's artifacts: accurate target/verification/deployment facts.
- The global OMP installation, launcher, and `~/.omp/patches/`: only after isolated acceptance and backup.

Do not change unrelated uncommitted files, agent policies, authentication, live databases, configuration, Fusion work, or unrelated global packages.

## Pinned inputs and representation

Freeze the current 39-row source plan and hashes from `research/` at implementation entry; if concurrent edits change them, incorporate the actual new baseline explicitly rather than overwrite it. Retain 0041's logical contract inside 0037. No assumption that the target must retain exactly 39 physical files: any upstream absorption requires source and behavioral evidence.

Use exact official 18.2.10 packages. Integrity-check archives, record SHA-256, and extract independently of Bun cache inodes. Runtime sandboxes must resolve all OMP dependencies inside the selected exact-version graph; a textual probe alone has no dependency-completeness claim.

## Controller and roots

1. Extend the existing resolver rather than add a parallel plan source. Target plan enumeration remains `apply.sh --print-plan`.
2. Promote `TUI` to a real printed/resolved/verifier root; `0004`/`0033` target moved TUI files, while 0037 may span TUI and the coding-agent usage host through `NM`.
3. Enumerate the union of old and new patch paths, excluding `/dev/null` and deduplicating. Mirror live existing targets, including added files. Preserve reverse-stack detection and dry-run-before-mutation.
4. Keep exact version mismatch, unsupported/empty values, missing candidates, and incomplete trees fail-closed. Old plan rows must not drift.
5. Gate registration follows resolved membership, not mere symbol presence. Add no version-based blanket skips.

## Semantic migration

- Re-anchor mechanical conflicts only from actual predecessor and after files; never hand-count patch hunks.
- Reconcile partial upstream adoption in memory lifecycle, compaction, and model records without removing remaining local guarantees.
- Treat 0063 and 0068→0069→0070 as one ordered transport/persistence contract: live socket identity, attempt ownership, fail-closed behavior, tool outputs, effort history, and public declarations.
- Carry current 0050 history-preview, 0072 auth UI, 0073 tool-description, and 0074 cache/audit behavior; inspect moved upstream ownership before adaptation.
- Follow upstream's new public tool interfaces rather than restore all removed APIs. The user-facing release changes are disclosed in the final plan.

## Proof and rollout

Candidate acceptance requires official-pristine replay, existing affected behavior gates, actual selected-root SDK/TUI imports and source CLI startup, second apply, status check, reverse byte/file/directory/symlink equivalence, and resolver failure cases. No cloud provider calls during sandbox verification.

Use local Ollama `qwen3:8b-nt` for a minimal actual OMP turn. Run with private HOME/XDG/agent state and explicit local routing; never let the controller's unqualified default smoke select a real Anthropic/cloud account. `OMP_PATCH_OFFLINE_VERIFY=1` remains isolated-replay-only and is not a workaround for live deployment checks. If the existing hard-coded smoke cannot be safely routed through existing configuration, make the smallest explicit local-smoke selection change and keep the smoke mandatory.

Before global deployment:

- Create and verify a non-hardlinked backup of the current global package tree, package-manager manifest/lockfile, launcher target, and deployed ledger. Preserve symlink identities without dereferencing agent-data links.
- Inventory live package deviations and already deployed standalone components, distinguishing them from unregistered experimental files. Do not silently discard an unexplained active modification.
- Do not copy, open, restore, or overwrite live agent/model databases or credentials.
- Install exact `@oh-my-pi/pi-coding-agent@18.2.10`, not unpinned latest or a broad global update. Detach mutable source files from install-cache hardlinks before patching.
- Synchronize final repository artifacts to the deployed ledger, apply the verified target plan, and verify a fresh process and exact owned-file parity.

Existing processes retain loaded modules and may lazily load changed files. Do not kill them; advise a full exit/relaunch after the switch. `/resume` inside an old process is not a module reload.

## Rollback

A live install/apply/startup failure restores the backed-up complete installation and launcher/ledger/package-manager metadata; it does not merely reverse new patches or reinstall pristine 18.2.3. Restore by verified staged replacement, not writes through cache hardlinks. Never restore agent data or overwrite newly refreshed credentials. Recheck the restored package version and original patch semantics; the planned controller repair should eliminate the known 0074 false conflict.

Record exact backup paths, hashes, installed package versions, and restore commands before touching the live install. Only user-approved patch/code changes are in scope; no automatic unrelated commit or branch switch.
