# OMP 18.2.10 migration evidence

## Scope and provenance

Planning-only inspection. No product code, installed package, credentials, session data, or Bun cache was modified.

- Current package metadata: `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/package.json:4,49-61` identifies 18.2.3.
- Official registry: https://registry.npmjs.org/@oh-my-pi%2fpi-coding-agent/latest resolved to 18.2.10 on 2026-09-23.
- Downloaded exact 18.2.10 archives for `pi-coding-agent`, `pi-ai`, `pi-agent-core`, `snapcompact`, `pi-catalog`, and `pi-tui`; verified registry SHA-512 integrity, calculated SHA-256, and rechecked stored archive bytes before extraction. Digests and URLs: `research/archives.json`.
- Temporary archive/pristine/work root: `/tmp/omp-18210-plan-yahiqmkw`. It is disposable; the durable registry coordinates and hashes permit reconstruction.
- The CLI catalog still records OMP 18.1.5; its static verify checks executable existence, not package-version freshness. Use current package metadata instead.

## Actual source plan and ordered textual probe

`bash patches/apply.sh --print-plan` emitted **39 physical entries**. Exact rows: `research/plan-18.2.3.txt`; patch hashes, logs, and results: `research/replay-probe.json`.

Rows were probed in current order on one work tree copied from the official 18.2.10 packages, using `patch --batch --forward --fuzz=0 --no-backup-if-mismatch --dry-run`. Only a successful whole-patch dry run was followed by application. A conflicting patch was skipped without applying any hunk.

| Probe result | Count | IDs |
|---|---:|---|
| CLEAN | 18 | 0014, 0036, 0017, 0025, 0026, 0031, 0032, 0038, 0044, 0052, 0057, 0046, 0048, 0054, 0047, 0056, 0058, 0063 |
| CONFLICT | 21 | 0033, 0004, 0034, 0037, 0010, 0035, 0030, 0043, 0045, 0050, 0060, 0062, 0065, 0066, 0067, 0068, 0069, 0070, 0072, 0073, 0074 |

**Limits:** after the first skipped predecessor, later results describe a partial-predecessor tree, not a complete candidate chain. CLEAN is textual feasibility, not runtime correctness; CONFLICT is not proof that a local behavior is missing upstream. There is no completed target plan or semantic adoption verdict yet.

## Current 0074 status false conflict

- Current `bash patches/apply.sh --check` exits 1: 38 patch rows APPLIED, 0074 CONFLICT, and source launcher APPLIED.
- `cmp` confirms the controller and 0074 patch are identical between the repository and `~/.omp/patches/`.
- The complete live 0074 patch reverse dry run succeeds; log: `research/live-0074-reverse-dry-run.txt`.
- `patches/apply.sh:401-403` enumerates only `--- a/` paths; `mirror_touched:414-431` copies only that list.
- `patches/0074-omp-anthropic-context-cache-boundaries.patch:71-73` introduces `src/providers/anthropic-request-audit.ts` via `--- /dev/null` / `+++ b/...`. The mirror therefore omits an existing added file.
- Isolated two-file reproduction with the controller's exact flags (`-p1 -R --force --silent --dry-run`): old-side-only mirror exits **1**, full old/new-side mirror exits **0**. Logs: `research/0074-before-headers-only.log` and `research/0074-both-file-sides.log`.
- A preliminary `--batch` probe misleadingly returned 0 by ignoring `-R` for the missing file; it is not controller evidence. The persisted comparison uses the actual `--force` flags.

Fix the shared target enumeration and retain stack-order checking. Do not whitelist 0074 or suppress its failure.

## Confirmed upstream boundary changes

Source locations below are relative to the corresponding extracted `package/` directory.

- `pi-coding-agent/CHANGELOG.md:169-173`: 18.2.5 moves terminal UI/status-line modules to `pi-tui`; old coding-agent subpaths are removed.
- Actual target files are `pi-tui/src/status-line/{component,segments}.ts`. `segments.ts:530-534` still excludes cacheRead from token_total, and `component.ts:1713-1720` repaints after changed usage. These local contracts are not automatically supplied by relocation.
- `pi-ai/src/providers/openai-codex-responses.ts:440-441,1031-1040,1581-1583` uses an `effortControls` map; 0068/0069/0070 must integrate with the current transport state rather than copy an obsolete map.
- `pi-coding-agent/src/tools/read.ts:827-828,983-995` still stores `description` and renders current file-display settings through `#renderDescription`. 0073 needs lifecycle-aware adaptation, not assumed whole-patch adoption.
- `pi-coding-agent/CHANGELOG.md:120-126`: bash `env` removed; eval judgment API and image/web CLI selectors change.
- `pi-coding-agent/CHANGELOG.md:73-75`: removal of read-tool image query/bare-image paths is an upstream change, not a patch regression. Follow target tool contracts; do not recreate every removed upstream API.

## Existing work boundaries

- Prior 18.2.6 research is useful context only; this task owns 18.2.10 and current 39-layer bytes. The earlier matrix had different membership.
- `.trellis/tasks/09-19-omp-native-fusion/implement.md:58-64,105` leaves Fusion implementation isolated and pending deployment approval. Do not incorporate it into this upgrade.
- Keep unregistered 0071/0075 and standalone extensions outside the chain unless existing deployment evidence requires preserving them. Inventory such evidence before replacing the live tree; a filename alone is not deployment evidence.

## Smoke boundary

`http://127.0.0.1:11434/api/tags` currently lists local `qwen3:8b-nt` (Q4_K_M, 8.2B; no remote_model/remote_host). Use this local model for a minimal OMP provider smoke with an isolated agent directory and no cloud credentials. Do not use the listed GLM cloud model or real Anthropic authentication.

This planning session queried model metadata only; it did not run model inference, candidate gates, SDK imports, target CLI startup, or a deployment.
