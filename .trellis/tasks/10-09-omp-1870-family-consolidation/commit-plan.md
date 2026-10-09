# Approved commit scope

The user approved the task commit, then explicitly approved including necessary pre-existing prerequisites. The next update uses the new family plan as baseline. No push or live deployment is authorized.

## Proposed work commit

`refactor(patches): consolidate 18.7.0 into 24 verified functional layers`

Include task-owned changes only in these paths (shared files require hunk-level separation; existing unrelated edits are not implicitly authorized):

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/patch-rollup-contracts.md`
- `.trellis/spec/backend/verification-gate-contracts.md`
- `patches/.18.7.0-candidates/0004-omp-token-total-cacheread-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0010-omp-extension-idle-ephemeral-turn-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0014-omp-antigravity-deterministic-session-identity-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0017-omp-openai-responses-native-replay-warm-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0025-omp-ollama-cloud-usage-api-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0026-omp-usage-fetch-anthropic-gate-core-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0030-omp-usage-cache-canonical-baseurl-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0031-omp-agent-session-providers-forward-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0032-omp-goal-tool-resident-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0033-omp-cache-turn-status-rollup-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0034-omp-hindsight-snapshot-rollup-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0035-omp-compaction-prefix-rollup-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0036-omp-image-frame-budget-rollup-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0037-omp-usage-statusline-gate-rollup-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0043-omp-interrupt-prune-symmetry-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0044-omp-image-budget-wire-api-family-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0046-omp-supersede-warm-prefix-guard-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0047-omp-date-cwd-anchor-stability-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0048-omp-advisor-quota-rotation-bound-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0050-omp-session-history-preview-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0052-omp-snapcompact-model-billing-commandcode-budget-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0054-omp-antigravity-drop-requesttype-agent-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0055-omp-devin-auth-cache-turn-timing-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0056-omp-devin-metadata-alignment-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0057-omp-devin-image-budget-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0058-omp-devin-thinking-signature-replay-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0060-omp-devin-idle-cascade-pin-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0062-omp-snapcompact-reduction-baseline-previous-archive-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0063-omp-codex-v2-compaction-live-chain-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0065-omp-commandcode-deepseek-model-record-parity-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0066-omp-anthropic-native-compaction-live-context-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0067-omp-remote-compaction-lane-trace-live-tools-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0068-omp-codex-stale-baseline-chain-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0069-omp-codex-effort-history-resume-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0070-omp-codex-compaction-chain-fail-closed-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0071-omp-devin-request-dump-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0072-omp-session-pin-static-auth-ui-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0074-omp-anthropic-context-cache-boundaries-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0075-omp-hindsight-recall-promotion-slot-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0076-omp-eval-state-context-persist-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0077-omp-turn-recovery-reminder-persist-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0078-omp-python-display-mime-preference-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0079-omp-kitty-conversion-finalization-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0080-omp-kitty-shared-png-cache-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0081-omp-main-cache-footer-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0082-omp-user-display-text-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0083-omp-model-mention-surface-resume-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0084-omp-length-stop-reminder-persist-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0085-omp-rejected-prepared-draft-restore-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0088-omp-compaction-cache-liveness-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0089-omp-compaction-drop-capacity-gate-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0090-omp-oauth-durable-refresh-v18.7.0-candidate.patch`
- `patches/.18.7.0-candidates/0092-omp-cache-warming-idle-budget-v18.7.0-candidate.patch`
- `patches/DEPLOYMENT-RUNBOOK.md`
- `patches/PATCHES.md`
- `patches/apply.sh`
- `patches/verify-patch-family-rollups.sh`
- `patches/verify-spec-contracts.sh`
- `.trellis/tasks/10-09-omp-1870-family-consolidation/`
- `patches/.18.7.0-families/`
- `patches/.retired/10-09-18.7.0-pre-family/`
- `patches/verify-family-plan.py`

## Original exclusions (superseded only by the explicit approval below)

- `.gitignore`
- `.trellis/spec/backend/extension-runtime-contracts.md`
- `patches/cache-prefix-audit-extension.ts`
- `patches/context-persist-audit-extension.ts`
- `patches/input-translator-extension.ts`
- `patches/verify-cache-prefix-audit.ts`
- `patches/verify-codex-compaction-chain-fail-closed.ts`
- `patches/verify-context-persist-audit.ts`
- `.trellis/tasks/10-07-omp-prompt-model-identity/`
- `patches/.18.7.0-candidates/0097-omp-computeruse-v18.7.0-candidate.patch`
- `patches/.native-sources/`
- `patches/build-native-computeruse.ts`
- `patches/native-computeruse.json`
- `patches/native-computeruse.ts`
- `patches/verify-anthropic-thinking-drop-resume.ts`
- `patches/verify-prompt-effort-resume.ts`

## Commit boundary

The verified working tree includes pre-existing 0093–0097-era controller/gate/native work. Do not silently absorb those changes or claim a standalone clean-checkout commit is verified. Before committing, separate this task’s hunks and disclose any prerequisite baseline changes that cannot be separated into a coherent commit; request explicit scope approval rather than staging the entire dirty tree. Current acceptance applies to the repository working tree, not a commit that has not been made.

Executed dependency inspection: `research/commit-dependencies.json`. The46-gate selection references two files absent from HEAD (`verify-prompt-effort-resume.ts`, `verify-anthropic-thinking-drop-resume.ts`); repository-variant validation additionally requires the existing0097 candidate, native manifest/controller, source patch and build recipe. These were explicitly excluded from the original proposal, so including them needs approval. The native binary remains a generated local artifact, not a new committed binary or deployment.

## Approved prerequisite inclusion

- `patches/verify-prompt-effort-resume.ts`
- `patches/verify-anthropic-thinking-drop-resume.ts`
- `patches/verify-codex-compaction-chain-fail-closed.ts`
- `patches/.18.7.0-candidates/0097-omp-computeruse-v18.7.0-candidate.patch`
- `patches/verify-context-persist-audit.ts`
- `patches/context-persist-audit-extension.ts` (the two-line0095 `side-request` consumer guard)
- `patches/native-computeruse.json`
- `patches/native-computeruse.ts`
- `patches/build-native-computeruse.ts`
- `patches/.native-sources/18.7.0/0097-computeruse.patch`

Keep native binaries untracked. Keep unrelated extension, DNS, and deployment-watcher changes out of the index, including their hunks in shared documentation. Preserve those working-tree bytes.

The selected0095 gate imports `context-persist-audit-extension.ts`; its existing SDK scenarios require that consumer guard. Include both as necessary prerequisites under the user's approval, rather than reducing the verified gate coverage to HEAD's older test. Other extension/privacy/translator edits remain excluded.
