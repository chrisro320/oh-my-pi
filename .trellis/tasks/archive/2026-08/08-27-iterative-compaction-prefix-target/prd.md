# Fix iterative compaction cache-prefix and summary-target ranges

## Goal

Second and later local soft compactions must preserve the exact live provider-ready prompt prefix without changing which history is folded into the durable summary. A real warmed `gpt-5.6-sol` summary request must report a strict cache hit rate above 90%:

```text
cacheRead / (cacheRead + cacheWrite + input) * 100 > 90
```

## Confirmed Failure

The 2026-08-27 iterative GPT compaction used PID `3183884` and reported:

```text
model=gpt-5.6-sol
structured=true
hasCachePreservingContext=true
input=130778
cacheRead=16896
cacheWrite=0
```

The required formula yields 11.44%. The summary wire began at live OpenAI input item 45, omitted live items 0–44, and injected the date/cwd reminder again at summary-relative item 84. Removing that injected reminder made summary items 0–379 equal live items 45–424, proving a sliced-context reconstruction rather than provider cache failure.

## Requirements

1. Treat the cache prefix and summary target as separate ranges.
   - Cache prefix: the exact live model context from the active compaction summary through the last entry included in the current summary call.
   - History target: messages that will be discarded and must be folded into the durable summary.
   - Recent retained messages: excluded from both the history target and the history summary request prefix.
2. Use stable `SessionEntry.id` boundaries produced by `prepareCompaction`; never infer a provider prefix by subtracting `recentMessages.length` from `agent.state.messages`.
3. Iterative local history targets must include messages retained by the previous compaction when those messages will be dropped by the new compaction. Provider-native replacement history remains owned by the existing remote-compaction path and must not be duplicated.
4. The primary host must rebuild the prefix from the captured session branch at the stable prefix leaf, then use `AgentSession.convertMessagesToLlm()` followed by the active `Agent.buildSideRequestContext()`.
5. Advisor compaction must rebuild from its own synthetic branch and use its own Agent, model, tools, converter, provider transform, session id, and prompt-cache key.
6. Manual and automatic compaction must use the same range contract.
7. Split-turn history and turn-prefix calls must receive independent targets and independent stable prefix leaves.
8. Target messages, not the full cache prefix, own serialization and token/window planning. A full live prefix may be used on wire only when that request fits the summary input budget.
9. When the live prefix already contains the prior compaction summary, the structured update prompt must reference that prefix summary without embedding a duplicate `<previous-summary>` body. Flat/multi-window fallback keeps the existing tagged previous-summary contract.
10. Multi-window folds remain structured. Only a request that actually carries the verified live prefix may claim cache-prefix preservation; later target windows make no provider-hit claim.
11. Exact active runtime model identity remains mandatory. Clone/different candidate, model drift, session-leaf drift, remote endpoint, standalone callers, or an unprovable boundary use the existing safe fallback.
12. Preserve normal cache reads and writes. Do not change cache retention, TTL, breakpoint policy, pricing, native compaction selection, or fallback candidate ordering.
13. Keep archived 0013 patches unchanged. Package the follow-up as an independent 0018 patch and synchronize the authoritative `~/.omp/patches/` mirror.

## Out of Scope

- Changing provider cache retention or disabling cache writes.
- Treating `cacheRead > 0` or the audit extension's later `verdict=hit` as summary acceptance.
- Reworking provider-native V1/V2 compaction payloads.
- Making `Agent.buildSideRequestContext()` construct contexts for arbitrary non-active candidates.
- Claiming later multi-window fold calls can read the original live prefix.

## Acceptance Criteria

- [x] `CompactionPreparation` exposes stable history and split-turn prefix entry boundaries plus the prior retained messages that become part of the local history target.
- [x] Primary manual and auto builders rebuild the prefix from a captured branch/leaf; they do not slice `agent.state.messages` by message count.
- [x] Advisor uses the same range semantics over its own branch without primary state.
- [x] Core window planning uses only the target range; the live prefix is used only as the wire prefix for a fitting structured request.
- [x] A structured iterative update does not duplicate the prior summary body in its appended tail.
- [x] Split-turn history and turn-prefix requests use separate targets and prefix leaves.
- [x] Candidate clone, wire-id mismatch, model drift, session-leaf drift, missing boundary, explicit remote endpoint, and oversized prefix degrade safely without borrowing active context.
- [x] Deterministic OpenAI Responses regression proves `summary.input[0:N]` is byte/structure-equal to the corresponding live wire prefix and that the date/cwd reminder appears only at the original first user message.
- [x] Sensitivity check proves the new iterative regression fails against the pre-fix sliced-context behavior and passes after the fix.
- [x] Existing first-compaction, flat fallback, retention, identity gate, advisor ownership, and multi-window assertions remain green.
- [x] Focused verifier, touched-module imports, independent 0018 forward/reverse dry-runs, mirror checksum, and `~/.omp/patches/apply.sh --check` pass. The known incomplete repository-local `patches/apply.sh --check` is not counted.
- [x] Fresh PID `3212418` produced matching `gpt-5.6-sol` request/wire/usage records with `input=560`, `cacheRead=178688`, `cacheWrite=0`; strict hit rate is `99.687584%`.
- [x] Phase 3.3 updated `.trellis/spec/backend/extension-runtime-contracts.md` with the dual-range iterative contract before archive.

## Machine Checks

```sh
bun patches/verify-prefix-cache-compaction.ts
~/.omp/patches/apply.sh --check
grep -R -n -E 'summaryCacheRetention = "none"|cacheRetention: summaryCacheRetention' \
  ~/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction \
  patches/0013-omp-prefix-cache-preserving-compaction-*.patch \
  patches/0018-omp-iterative-compaction-prefix-target.patch
```

The grep command must produce no output. Real provider acceptance is computed only from the matching `gpt-5.6-sol` `summarize.usage` record.