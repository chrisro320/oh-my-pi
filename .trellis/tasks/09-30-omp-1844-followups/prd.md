# omp 18.4.4 follow-ups

## Goal
Close the defects left open by 09-29-omp-1844-patch-migration (18.4.4 live since 2026-09-30, 50/50 APPLIED). User priorities: (1) cache drift after resume, (2) cache misses from soft/remote compaction. This task fixes three diagnosed items; audit-repro drift is split out.

## Confirmed facts
- **A. Audit baseline is cross-model.** `patches/cache-prefix-audit-extension.ts:873` uses `prev = st.last` (last request of ANY model) as the verdict baseline; only the diff *slot* is per-model (`lastDiffByModel`, :877). Interleaved claude / gpt-5.6-luna requests therefore log `SYSTEM_DRIFT system[0] 940ccaef… -> d17688e7…` on claude rows that are 96-99% hits (audit log 2026-09-30 04:44-04:50Z). The label misattributes; it does not describe a real change. Earlier claim that raw system/headers "were never captured" was wrong: `payload-archive.ts` keeps every outbound payload (`~/.omp/agent/payloads/<session>/…`, plus `anthropic-wire/`), and it holds the 04:19:57Z miss request.
- **B. The one real miss is explained by breakpoint spacing.** Archived payloads for session 01a0f047: previous request had tail breakpoints at content blocks 600 and 601 (messages 416/417); the missing request `…0780-main-claude-sonnet-5-5.json` had 643 blocks, tail breakpoints at 640 and 642, and one head breakpoint (system[3]). The nearest earlier written entry is 39-41 blocks behind the new tail. Anthropic's documented lookback from a breakpoint is 20 blocks. Result: cacheRead=14314, cacheWrite=342867. Measured structure matches the hypothesis; the request-side effect has not been reproduced against the live API.
- `resume-cache-breakpoint-extension.ts` already adds one breakpoint at the previous request's tail, but only on the first request of a resumed session, and it counts the 4-breakpoint budget (a 5th is a hard 400).
- **C. 0082 Review gaps (18.4.4, live).** #2 (major): a prepared input rejected on dispatch through `onInputCallback` loses text and images (`main.ts:445-468`, `interactive-mode.ts:3229-3246`). #4 (minor): an async image paste can be overwritten by the restore after a cancelled Ctrl+Enter preparation. Both exist in 18.4.1 live 0082; neither is a migration regression.
- **D (out of scope).** audit-repro r2/r3/r3x/r3x-real/r4 fail identically on 18.4.1.

## Requirements
- R1 (A): the audit verdict baseline is the previous request of the SAME model. Cross-process pid comparison and state-file compatibility are preserved.
- R2 (B): the resume-cache-breakpoint extension also fires within a live session when the block count grew by more than a threshold since the previous request, adding one breakpoint at the previous request's tail, inside the 4-breakpoint budget, at most once per such growth event.
- R3 (C): a rejected dispatch of a prepared submission restores text and images to the editor; a paste that arrives during preparation survives cancellation.
- R4: deployment of C reuses `deploy-1844.py` style tooling (backup, fresh-process verification, auto-rollback) and needs an all-omp-closed window. A and B are extension mirrors, deployed by copy with `cmp` parity across repo / `~/.omp/patches` / `~/.omp/agent/extensions`.

## Acceptance criteria
- [x] AC1 (A): a fixture of interleaved claude/luna requests where claude's request N follows claude's N-1 (append-only) yields verdict kind `APPEND_ONLY` for claude. It must fail on the current code (sensitivity control) and pass after the fix. Existing `verify-cache-prefix-audit.ts` stays green, including the interloper case (main model's miss is explained by its own diff).
- [x] AC2 (B): using the archived request pair (previous `…0779…`/prior request and `…0780…`) as fixture, the extension output has a `cache_control` on the previous tail block, total breakpoints ≤ 4, and the fixture without the fix has none there. Normal +2-message steps add no breakpoint (no extra cache writes). `verify-resume-cache-breakpoint.ts` stays green.
- [x] AC3 (C): a behavior gate drives a prepared submission whose dispatch is rejected and asserts text + images return to the editor; a second case pastes an image during a cancelled preparation and asserts it is kept. Both are red on the current 18.4.4 tree and green after. Gates registered in `apply.sh` under the 0082 family.
- [x] AC4: 18.4.4 `apply.sh` full apply on a fresh pristine sandbox: all layers APPLIED, second apply all SKIP, `--check` all APPLIED, revert equals pristine, rollup verifier PASS.
- [ ] AC5: live deploy verified by fresh `omp --version`, live `--check`, repo/ledger zero drift, and (for A/B) one observed real audit row from a running session.
- [x] AC6: `.trellis/spec` updated (Phase 3.3) and grep-checkable.

## Out of scope
- audit-repro r2/r3/r3x/r3x-real/r4 (task D, separate).
- Changing `applyPromptCaching` in pi-ai core; any resume-time history rewrite ("rewind" of long tails); payload-archive disk budget (observed 2.7 GB vs 400 MiB default; noted, not touched).

## Risks
- B adds a breakpoint that may bill one extra cache write; the growth threshold must keep it to rare events. Threshold value is unproven against the live API.
- C changes input handling; the earlier Enter-during-compaction fix had only code-path evidence.
