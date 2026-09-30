# Session Input Translator — Execution Record

## Scope and user direction

The approved feature removes manual translation/copy/paste: ordinary input is translated automatically before the main model receives it, while the TUI keeps the original. The later user instruction supersedes the expanded verification plan: minimal changes, no defensive framework, no added gate/test matrix, no repeated review rounds, at most three or four todos.

Implementation and deployment are complete. No commit or archive was authorized or performed. A full OMP restart is required to load the new core and extension; the user's running process was not restarted.

## Delivered

- `patches/input-translator-extension.ts`: independent session-local translator, native credentials, default `cline-pass/deepseek-v4.1-flash`, low effort, no tools, durable own history and native soft maintenance.
- `patches/.18.3.3-candidates/0082-omp-user-display-text-v18.3.3-candidate.patch`: awaited ordinary-input preparation and one real user message with English `content` plus original `displayText`; native commands retain their path. Published declarations match the source contract.
- `/translator`, `/translator on`, `/translator off`, `/translator model <provider/id>`. Failure modal: Escape retries; Enter sends the original for this input only.
- Existing `apply.sh` 18.3.3 plan now has 48 patches. Only the existing rollup expected-plan list/count changed; no new gate was registered. Finalized older patches and other version plans remain unchanged.
- Removed the newly created `verify-user-display-text.ts` and `verify-input-translator.ts`, plus redundant input-decision caching and custom cancellation-link scaffolding. All workers/reviewers are stopped.

## Observed verification

Evidence: [functional-smoke.json](research/functional-smoke.json) and its referenced TUI captures.

- Actual Enter/Ctrl+Enter flow with the real provider: original Chinese remains visible; one English input reaches the primary model, preserving the exercised path and identifiers. Translator requests carry `reasoning_effort: "low"` and no tools.
- Two injected HTTP 400 responses exercise the actual failure modal. Escape retries without raw delivery; Enter durably sends the original once. A fresh resumed process restores the original rows and translator history; its next English-only input stays unchanged.
- Synthetic prior successful pairs under a controlled 40k window trigger two real native soft cycles. The second reuses the exact previous summary; two checkpoints are persisted, with zero primary compaction entries and no additional full-history payload dump.
- The first translator response explicitly reports zero cached prompt tokens and approximately 1.615 s to first content. This is one observation, not a cache or latency guarantee.
- The plugin's strict TypeScript check exited 0. The independently verified 47-layer pristine 18.3.3 baseline accepted 0082 with `--fuzz=0`; all resulting touched bytes match the implementation. See [candidate-replay.log](research/candidate-replay.log).
- After atomic deployment, the live source CLI reports `omp/18.3.3`. A new isolated process loading the deployed extension completed another actual Chinese-to-English exchange, with both HTTP responses 200 and the original visible. Repository/runtime copies match.

No full existing regression suite, added permanent test suite, exhaustive race matrix or additional review round was run. Earlier planning/review artifacts are historical, not instructions to restart the superseded verification plan.

## Deployment and rollback

- Core: touched files only under `~/.bun/install/global/node_modules/@oh-my-pi`.
- Extension: `~/.omp/agent/extensions/input-translator-extension.ts`; managed patch assets synchronized to `~/.omp/patches/`.
- Backup: `~/.omp/patches/backups/20260928-input-translator-0082/manifest.json` records exact targets, prior copies and newly created paths. Rollback restores only those targets; never replace the whole agent directory or delete session history.
- Credentials were obtained through native `omp token cline-pass` into process memory; live credential/session databases were not copied. Temporary smoke scaffolds were removed after retaining concise evidence.
- Contract writeback is in the existing backend extension-runtime spec. Its existing index routing remains sufficient; `AGENTS.md` is unchanged.
