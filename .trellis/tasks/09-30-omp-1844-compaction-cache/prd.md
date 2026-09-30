# omp 18.4.4: compaction summarize request must reuse the main-chain cache

## Incident (proof)
Session 01a0f047, 2026-09-30T07:21:39Z soft compaction on claude-sonnet-5-5:
- `compaction-trace.log` lines 6412-6414: request context 373 msgs, wire 355 msgs, breakpoints `353:1h,354:1h`; usage `cacheRead 14257, cacheWrite 265136` (about $1.15). Previous compaction (04:37) read 383514 / wrote 1573 (about $0.15).
- Wire messages 0..353 are byte-identical (cache_control stripped) to the last main request (`payloads/01a0f047-.../1790752504855-2749314-0840-main-claude-sonnet-5-5.json`, 433 msgs). Byte identity was fine.
- Cause: the compaction request is main-chain prefix cut at the summarize boundary (354 of 433) plus the instruction. `applyPromptCaching` (pi-ai anthropic.ts ~3978-3999) anchors the request's last two messages, i.e. index 353. The main chain last wrote a 1h entry at 353 at 05:24:25Z and every later turn anchored the advancing tail (431/432), so the 353 entry expired 06:24:25Z. Nothing checks entry liveness. Result: full rewrite.
- All existing gates only assert byte-identity / breakpoint positions (see research report `agent://CompactionResearch`), none models entry liveness.

## Requirement (user, zero tolerance for cache misses)
A compaction summarize request on the Anthropic path MUST read the main chain's existing cache entries (the request's message prefix and its breakpoint placement must land on entries the main chain wrote at its tail), not re-write the history. Acceptance is the cache behavior, not only byte identity.

## Design (chosen by main thread; implementer may refine within the invariants)
Send the FULL live main-chain message list (same as the last main request, including the kept tail) followed by the summarize instruction that names the boundary: "summarize only messages up to <boundary>; the messages after it are retained verbatim in the session and MUST NOT be restated". Breakpoint placement then naturally anchors the last live message (= the main chain's own tail entry) plus the instruction.
Invariants that MUST NOT change:
- `firstKeptEntryId`, `recentEntryIds`, kept-tail replay, `tokensBefore` (session-context.ts replays from firstKeptEntryId).
- Non-Anthropic providers (OpenAI V1/V2/Codex lanes, Gemini) keep today's behavior; do not redefine `usesCachePreservingPrefix`, add a distinct state if needed.
- Only when the summarizer model equals the main model and the full live list fits `livePrefixFits`; otherwise keep today's path.
- Native Anthropic compaction lane (`compaction.instructions`): same idea, the cutoff is a soft instruction (there is no API parameter for it); stop slicing by `retainedTailLength` only if the cache reasoning holds there too.
- turn-prefix scope (split turn) must not regress; state explicitly which scopes you converted and why.
Fold-in windows (`planSummaryWindows`) must not silently break byte identity: when the full list does not fit, fall back and log a trace field naming the reason.

## Acceptance criteria
- [x] AC1: a liveness gate with a cache SIMULATOR: main-chain requests write entries at their two tail markers with timestamps and a 1h TTL; lookup at each breakpoint with a 20-block lookback. Replaying the incident shape (main tail markers advancing by +2, an entry at the summarize boundary written 2h earlier and expired) the OLD builder yields cacheRead about head-only / cacheWrite about the whole prefix (red), the NEW builder yields cacheRead about the whole live list and cacheWrite about the instruction only (green).
- [x] AC2: a real-data leg: from the archived main request 0840 and `compaction-payload-latest.json` shape, the new request's messages[0..432] equal 0840's messages[0..432] (cache_control stripped) and the last two breakpoints are `[432, 433]` (or equivalent: 432 equals the main chain's last tail marker).
- [x] AC3: kept tail invariants gate still passes (firstKeptEntryId, recentEntryIds, tokensBefore unchanged), existing compaction gates updated where they pinned the truncated request (`verify-anthropic-native-compaction-live-context.ts:200-205`, `verify-prefix-cache-compaction.ts`).
- [x] AC4: new tail layer (0086 for 18.4.4; finalized layers are immutable, do not edit 0035/0066/0067) registered in `apply.sh` plan and `verify-patch-family-rollups.sh` `EXPECTED_PLAN_1844`, ledger `PATCHES.md` section + gate row, ASCII only in added patch lines.
- [x] AC5: fail-closed full pristine replay in the sandbox (`research/final-1844.sh` pattern) green: plan 52 layers, apply#2 all SKIP, `--check` 52 APPLIED, revert equals pristine.
- [x] AC6: independent `trellis-check` review, then Phase 3.3 spec update (`verification-gate-contracts.md`: gates for cache behavior must model entry liveness, byte identity is necessary not sufficient).
- [x] AC7 (post-deploy, MEASURED 2026-09-30T18:15Z pid 3834259: usesLiveChainReplay true, no liveChainFallback, cacheRead 162688 / cacheWrite 2473, $0.134): the next real compaction shows cacheRead about live prefix and cacheWrite small in `compaction-trace.log` `summarize.usage`. [INFERENCE until observed]

## Out of scope
Audit extension changes, B growth anchor, D audit-repro.

## Outcome
Final state: layer 0089 (capacity gate deleted) on top of the 0088 rollup; 53 layers live. AC4/AC5 numbers moved from 52 to 53 layers. First compaction after 0088 (16:43Z) still failed live (capacity-unattested); first compaction after 0089 hit the cache. See implement.md.
