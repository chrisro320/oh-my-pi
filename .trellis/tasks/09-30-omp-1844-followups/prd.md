# omp 18.4.4 follow-ups

## Goal
Close the items left open by task 09-29-omp-1844-patch-migration (18.4.4 deployed live 2026-09-30, fresh omp/18.4.4, 50/50 APPLIED). Top user priorities for omp: (1) cache drift after resume, (2) cache misses from soft/remote compaction.

## Confirmed facts (evidence in prior task implement.md and audit logs)
- Cache-audit label `MISS CAUSED BY SYSTEM_DRIFT` is noise: it compares interleaved claude vs gpt-5.6-luna requests (system[0] 0f62…->65a9…, ttl none->1h on 118 of 192 claude rows, 117 hits). Raw system array and headers are not captured on a miss (`~/.omp/agent/cache-prefix-audit.log`).
- One real miss observed before deploy: 04:19:57Z, messages 418->457 (+39 in one request), cacheRead=14314, cacheWrite=342867. Cause is [INFERENCE]: no breakpoint near the previous request tail (applyPromptCaching, pi-ai/src/providers/anthropic.ts ~3920: head, two tail, one decimation checkpoint per 15 user turns). No measured proof yet; "20-block lookback" is unverified.
- Post-deploy resume at 04:40Z: expected one cold miss (system prompt changed upstream), then 95-99.9% hits.
- Review #2 (major, unfixed): a prepared input rejected on dispatch via `onInputCallback` loses text and images (`main.ts:445-468`, `interactive-mode.ts:3229-3246`). Same gap exists in live 0082 on 18.4.1; not a regression.
- Review #4 (minor, unfixed): async image paste can be overwritten by restore after a cancelled Ctrl+Enter preparation.
- audit-repro r2/r3/r3x/r3x-real/r4 fail identically on 18.4.1 (pre-existing drift; r1 passes via 0084).
- Root cause of ClinePass 403 (user config, not code): stale `apiKey` in `~/.omp/agent/models.yml`; already removed by the user.

## Candidate work items (scope pending user decision)
A. Cache-audit baseline: compare only same model + same TTL; on a miss dump raw `system` array and headers.
B. Cache anchor patch (originally called 0085): extra breakpoint at previous request tail; only if A's evidence confirms the cause.
C. 0082 Review #2 and #4 with a behavior gate (rejected-dispatch restore; paste-race).
D. audit-repro r2/r3/r3x/r3x-real/r4 pre-existing drift.

## Open question (blocking)
Which of A-D belong in this task.
