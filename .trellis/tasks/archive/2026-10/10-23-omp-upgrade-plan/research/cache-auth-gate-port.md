# Cache/auth gate port boundary

Owned implementation scope is the fifteen existing gates named in the work order. Target only exact 18.12.6 routing and actual changed consumer fixtures: four-argument compaction context, structured-output opt-in, target model effort/unverified semantics, and synthetic shutdown/interrupted credential rotation. Preserve user-owned model-selection/manual-compaction additions, historical branches, negative controls, chain-only Codex policy and Anthropic content/cache-control distinctions. No source family/controller/native/notebook/spec edits, no production inputs, no gate/test/build/lint/formatter execution. Main owns integration execution and final docs.

Source inputs: approved design/implement and research target-auth-compaction-source.md / target-task-prefix-source.md. Verified pristine readiness and exact source mappings will be recorded below when available.

## Verified pristine source map

TargetClosure supplied the read-only official archive tree at `/tmp/omp-upgrade-18126-01a1684f/pristine/@oh-my-pi` (5639 files; canonical directories0755; reported tree SHA-256 `728e0643027d5f55e12b2fc52f66053fa404ffb986a5208fa4b6cb697070bcd4`). Its `metadata/archive-manifest.json` and `metadata/provenance.json` record all thirteen18.12.6 archives and pinned source `45c35e40c46166dc726ccc52f5d27f40f2449f99`. The anchors below were actually read/grepped from that verified pristine, not inferred from changelog prose.

- `pi-agent-core/src/compaction/compaction.ts:700-705,2117-2118`: `buildProviderContext(summarized, retained, signal, model)` is the target public callback and native invocation. `pi-coding-agent/src/session/session-maintenance.ts:474-479,3572-3573,5393-5394` threads the same fourth model through manual and automatic consumers. The native gate adds a real `compact()` callback observation; the existing Codex declaration consumer additionally consumes both target callback and host declarations.
- `pi-ai/src/providers/openai-codex-responses.ts:1481-1485,3466-3473` keeps full/lite private socket keys separate. `getOpenAICodexTransportDetails:3598+` does NOT accept a `responsesLite` axis and its public alias tracks the last selected socket; therefore the new control observes actual loopback sockets, response IDs and trigger-only frames instead of inventing an introspection API. `resetOpenAICodexHistoryAfterCompaction:746-751` intentionally invalidates all append baselines. FamilyRebaseOwner confirmed no historical custom narrowing; no new post-rewrite independent-lite-survival assertion is imposed.
- `snapcompact/src/snapcompact.ts:583-591`: both `providerImageBudget` and `providerFrameBudget` consume a model, not `(provider, api)`. Only the exact target branch of the existing declaration probe changes those calls.
- `pi-coding-agent/src/task/settings.ts:255-258` defaults `task.structured` false. The warm fixture opts in through its private Settings and its actual `runSubprocess({structured:true})` call; no product default changes. `task/executor.ts:3935-3971` already freezes the revival IRC roster, but `4064-4131` lacks persisted init override/yield restoration. All live/persisted/wake scenarios remain. For target only, the drop-override mutation requires pooled b/b2 failures rather than requiring roster-only failures that upstream's existing capture may already prevent; historical expectations remain.
- `pi-coding-agent/src/session/session-manager.ts:4527-4548` normalizes persisted prompt blocks and carries pooled yield items. The gate compares the actual saved prompt with pre-park blocks, requires a real yield tool, and checks the first message-woken request and unchanged init count.
- `pi-coding-agent/src/session/model-controls.ts:581-599` and `pi-tui/src/thinking.ts:139-140,384-387` distinguish verified default precedence from unverified automatic selection. The model gate retains the user's existing navigation/fork/fallback/auto scenarios, adds actual explicit-low dispatch, and target-only unverified unset-versus-explicit-low plus fresh-process restoration.
- `pi-ai/src/auth/refresh.ts:158-177` registers exit-only postmortem draining over pending durable refreshes. The OAuth gate adds target-only real SIGTERM while a synthetic token response is pending, and hard process interruption immediately after the real durable stage method succeeds. Fresh processes consume the same private SQLite store; no second token POST is permitted. The fault gate mutates only the drain callback to prove the SIGTERM scenario can fail. Existing Anthropic-only journal, ordinary-provider lease/CAS, fence, atomicity and missing-member controls remain intact.
- Zero-change `verify-context-notes-append-projection.ts`: `pi-coding-agent/src/session/context-notes.ts:5-16,41-48` retains exact revision shape and return API; `pi-agent-core/src/compaction/anthropic.ts:119-122` retains its preserve-data writer signature. The gate already drives real SDK/session/journal consumers, malformed/clear/interrupted/nested revisions, native retained group ordering and resume. It has no version refusal needing target routing.
- Zero-change `verify-compaction-cache-liveness.ts`: it already imports the selected real `compact`, `prepareCompaction`, `streamAnthropic` and `Tokenizer`, records wire and trace consumers, distinguishes raw bytes from `cache_control`-stripped content, and retains truncation/capacity/overflow negative controls. No target-refusal/version branch exists. This is source compatibility evidence, NOT an executed PASS; custom callbacks/trace APIs still depend on the rebased family.

## Verification boundary

No gate, test, build, lint, formatter, source CLI, auth/provider request or production DB operation has been executed by this owner. Tool edits and source reads are the only observations; all behavioral outcomes described above are assertions prepared for Main, not claimed passing results. Main must execute against the frozen final candidate and preserve failing-before/mutation evidence.

## Main execution commands (not run here)

After the final candidate is assembled, freeze gate sources and execute against a disposable dependency-complete copy, never pristine/production. `FINAL_RUNTIME` below is the final candidate runtime directory containing `node_modules`; it is not an installed release or the pristine six-root source directory.

```bash
FINAL_RUNTIME=/absolute/path/to/final-candidate-runtime
VERIFY="$(mktemp -d /tmp/omp-cache-auth-final-XXXXXX)"
mkdir -p "$VERIFY/home" "$VERIFY/tmp" "$VERIFY/config" "$VERIFY/cache" "$VERIFY/data" "$VERIFY/state"
cp -a --reflink=auto "$FINAL_RUNTIME/node_modules" "$VERIFY/node_modules"
NM="$VERIFY/node_modules/@oh-my-pi"
for gate in \
  verify-model-selection-resume.ts verify-prompt-effort-resume.ts \
  verify-subagent-warm-revival-prompt.ts verify-manual-compaction-direct.ts \
  verify-context-notes-append-projection.ts verify-prefix-cache-compaction.ts \
  verify-anthropic-native-compaction-live-context.ts verify-compaction-lane-trace.ts \
  verify-compaction-cache-liveness.ts verify-codex-compaction-chain.ts \
  verify-codex-compaction-chain-fail-closed.ts verify-anthropic-cache-boundaries.ts \
  verify-anthropic-thinking-drop-resume.ts
do
  env -i PATH="$PATH" HOME="$VERIFY/home" TMPDIR="$VERIFY/tmp" \
    XDG_CONFIG_HOME="$VERIFY/config" XDG_CACHE_HOME="$VERIFY/cache" \
    XDG_DATA_HOME="$VERIFY/data" XDG_STATE_HOME="$VERIFY/state" \
    OMP_PATCH_VERIFY_NM="$NM" OMP_PATCH_VERIFY_AGENT_ROOT="$NM/pi-coding-agent" \
    OMP_PATCH_VERIFY_AI_ROOT="$NM/pi-ai" OMP_PATCH_VERIFY_CORE_ROOT="$NM/pi-agent-core" \
    OMP_PATCH_VERIFY_CATALOG_ROOT="$NM/pi-catalog" OMP_PATCH_VERIFY_TUI_ROOT="$NM/pi-tui" \
    OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="$NM/snapcompact" \
    bun "patches/$gate" || exit "$?"
done
env -i PATH="$PATH" HOME="$VERIFY/home" TMPDIR="$VERIFY/tmp" \
  XDG_CONFIG_HOME="$VERIFY/config" XDG_CACHE_HOME="$VERIFY/cache" \
  XDG_DATA_HOME="$VERIFY/data" XDG_STATE_HOME="$VERIFY/state" \
  OMP_PATCH_VERIFY_AI_ROOT="$NM/pi-ai" OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1 \
  bun patches/verify-oauth-durable-refresh.ts
env -i PATH="$PATH" HOME="$VERIFY/home" TMPDIR="$VERIFY/tmp" \
  XDG_CONFIG_HOME="$VERIFY/config" XDG_CACHE_HOME="$VERIFY/cache" \
  XDG_DATA_HOME="$VERIFY/data" XDG_STATE_HOME="$VERIFY/state" \
  OMP_PATCH_VERIFY_AI_ROOT="$NM/pi-ai" \
  bash patches/verify-oauth-unlock-fence-faults.sh
```

The OAuth shell controls must run through the real controller dispatch at final integration as required by the task; the standalone command above is the exact focused invocation for an affected rerun. Controller OAuth isolation must scrub inherited AGENT_ROOT/NM rather than mixing private pi-ai with the uncopied candidate agent. This actionable contract was sent to TargetTooling and Main; this owner does not edit the controller.

Remaining unexercised edges: final family semantic mutation anchors (warm anchors now ignore nesting indentation), real target declaration compilation, actual SIGTERM timing/exit143 plus durable stage/commit/restart behavior, and the actual full/lite loopback wire matrix. The source map establishes how the fixture should consume target APIs, not that a candidate passes. Anthropic equality remains content equality without moving `cache_control`; no synthetic result establishes provider-side cache hits, billing, revocation, rotation idempotency or production-account status.
