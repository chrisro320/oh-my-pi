# Parent review notes (authoritative qualifications)

- 0045 is a strong **retirement candidate**, not an approved or runtime-proven retirement. The parent independently read tokenizer.ts:332-360 and local 0045:47-54: new tokenizer pricing plus the old subtraction would double-correct the estimate. Prove actual consumer counts before omitting it from the target plan.
- Prefer the upstream unified native context API, but local summarize scope and native scope differ; do not force both through a narrowed API or discard advisor/previous-summary/live-chain behavior.
- No generic claim that the local measured byte table is strictly better than upstream area-scaling/re-rendering has been accepted. Compare actual payload limits, sentinel retention and bounded behavior; use the better proven result.
- Absence of local symbol names is not by itself proof of missing behavior. Keep the report's source-path comparisons and consumer acceptance probes alongside those searches.
- No changes or behavioral tests were run by this research agent.
- Historical acceptance correction: `.trellis/tasks/09-30-omp-1844-compaction-cache/prd.md:30` records a real 18.4.4 post-0089 hit (cacheRead 162688, cacheWrite 2473), corroborated by its implement.md:10. Old PATCHES.md “not measured live” text is stale. This is historical evidence, not a newly executed measurement or proof for 18.7.0.

---

## 1. Conclusion and severity-ranked risks

**Bottom line:** the upgrade is a port, not a drop-in. Upstream 18.7.0 gives two genuine improvements that *partially* cover local work (native-Anthropic live context; catalog-driven snapcompact frame pricing) and **zero** coverage for the families that carry the user's cache contract (0035/0088/0089) or the custom-gateway budget semantics (0044/0052/0057). 0089's contract (no local capacity pre-flight; provider rejection is the only capacity authority) is intact as a *local-only* invariant: upstream has no live chain to gate, so it neither implements nor contradicts it — it must be re-expressed on top of whatever 0035 port survives.

Severity-ranked risks:
1. **R1 (critical) — local summarize-lane cache preservation is upstream-absent.** Upstream's local summarizers still send `[SUMMARIZATION_SYSTEM_PROMPT]` (compaction.ts:1015, 1227, 2178) and never expose a cache-preserving hook there; the new `buildProviderContext` is consumed *only* by the native-Anthropic branch (compaction.ts:1989-1996). If a migration assumes upstream's cache work covers 0088/0089, both would be silently deleted. Evidence: absence of `buildCachePreservingContext|CachePreservingSummaryScope|liveChain|cacheColdReason|previousSummaryInPrefix` anywhere in 18.7.0 pristine.
2. **R2 (high) — 0045 double-subtraction after the upgrade.** Upstream moved per-frame pricing into the tokenizer (`Tokenizer.#frameTokens` → `snapcompact.frameTokens(frameBilling, size)`; tokenizer.ts:359-360, snapcompact.ts:247-277). Local 0045 subtracts `frameCount*(FRAME_TOKEN_ESTIMATE - frameTokenEstimate)` on the reduction projection (0045 patch hunks on `#projectSnapcompactContextTokens`); ported verbatim on 18.7.0 it would subtract a correction the tokenizer already applies → under-count → compaction accepted that does not reduce. This is the single highest-probability *silent* breakage.
3. **R3 (high) — native-Anthropic API shape changed under 0066/0035.** `AnthropicNativeCompactionRequest` lost `{systemPrompt,messages,tools}` for `{context: Context, filesDueBefore?}` (anthropic.ts), and `SummaryOptions` gained `buildProviderContext` exactly where 0035/0066 insert `buildCachePreservingContext` (replay: 0035 hunk#5 FAILED at compaction.ts:689; 0066 hunk#1 FAILED at compaction.ts:667). A text-only port is impossible; the local hook must be re-expressed as a `buildProviderContext` implementation.
4. **R4 (medium-high) — custom-gateway image budgets still fall to floor 5.** Upstream `providerImageBudget(provider)`/`providerFrameBudget(provider)` keep single-arg signatures and `PROVIDER_IMAGE_BUDGETS` has no api-family, `devin`, or `commandcode*` keys (snapcompact.ts:543-566; call sites session-maintenance.ts:3594,3644,4025,4050). The user's `pixel`/`pqh`/`wanzhao`/`commandcode-custom`/`devin` providers would regress to the 5-image floor, evicting the oldest snapcompact frame and rewinding a mid-history tool result — the exact prefix-cache break 0044/0052/0057 fixed.
5. **R5 (medium) — Command Code DeepSeek frame pricing likely mis-priced by the catalog fallback.** Upstream prices via `resolveImageTokenization` (catalog lineage → wire-api fallback `openai-patch`/`anthropic-patch`, providers/image-tokenization.kdl) with no commandcode rule; local 0052 measured `deepseek-v4-pro` at ~6 and `deepseek-v4-flash-fast` at ~0 visual tokens, versus ~2,400 for an openai-patch 1568px frame. Upstream's formula is more principled but can over-charge exactly the models local 0052 measured cheap, re-triggering 'would not reduce' rejections.
6. **R6 (medium) — Codex family (0063/0067/0068/0069/0070) unaddressed; partial replay conflicts.** Upstream has no `CodexCompactionChainLostError`/`isCodexCompactionV2Lane`/`prepareCompactionRecovery`; 0067/0068/0070 fail on compaction.ts hunks, so these need fresh candidates. Upstream's #14247 (`isUserAuthored`/`retainedUserItems`) and #14245 (V1-fallback warning) are adjacent but not the same contract.
7. **R7 (low-medium) — stale local invariants.** 0046's suffix gate is contradicted only in spirit by upstream's new `tools/read-supersede.ts` (selector-aware completeness); upstream kept `DEFAULT_SUFFIX_TOKEN_LIMIT=8000` (pruning.ts:160,364) so 0046 still applies. 0062 still applies (upstream `#projectPreSnapcompactContextTokens` unchanged). No retirement is approved by this assessment.

## 2. Evidence-backed matrix (assigned families)

Legend: rec = recommendation candidate (no retirement approved yet).

### 0035 — compaction prefix rollup (root NM; replay **blocked**, hunk#5 FAILED @compaction.ts:689)
- Local contract: adds `CachePreservingSummaryScope = "history"|"turn-prefix"` + `CachePreservingSummaryContext` + SummaryOptions.buildCachePreservingContext; turns `generateSummary`/`generateShortSummary`/`generateTurnPrefixSummary` into "fold the history target onto a verified live prefix" (patch hunks at compaction.ts:668-703, generateSummary 890-955; new prompts compaction-turn-prefix-from-prefix.md / compaction-update-summary-from-prefix.md).
- Upstream change: `SummaryOptions` now carries `buildProviderContext?: (summarized, retained, signal) => Promise<Context>` (compaction.ts:686-690) for the **native Anthropic lane only**; local summarizers stay `[SUMMARIZATION_SYSTEM_PROMPT]` (1015/1227/2178).
- Overlap/conflict: direct textual conflict at the SummaryOptions insertion point; API-level divergence (scope enum vs `(summarized,retained)`). Semantically upstream covers *none* of the local summarize-lane cache prefix.
- Rec: **retain + port** (needs a new candidate on 18.7.0). Do not treat upstream's hook as replacement; it is a different input range (native prefix only).
- Evidence: patch 0035 lines cited; 18.7.0 compaction.ts:686-690,1015,1989-1996; replay-1870.json 0035.

### 0036 — image/frame budget rollup (NM; replay **blocked**)
- Local contract: per-variant `FRAME_DATA_BYTES_PER_SHAPE` measured byte table, `shedFramesOverBudget(frames)`, `maxFramesForDataBudget(maxFrameDataBytes?, shape?)`, `providerImageBudget(provider, api?)`/`providerFrameBudget(provider, api?)`; call sites pass `(FRAME_DATA_BYTES_BUDGET, shape)` and `(provider, api)` (0036 patch on provider-image-budget.ts:72, session-maintenance.ts:3576/3622/3969/3993, snapcompact-inline.ts:318/459, snapcompact.ts:480-591,2274).
- Upstream change: `maxFramesForDataBudget(shape: ShapeGeometry)` area-scaled off `AREA_PRICED_VARIANTS` (snapcompact.ts:510-529); the byte budget is enforced at rebuild time by `imagesWithinBudget`/`omittedFrameNotice` (snapcompact.ts:1845-1932); no `FRAME_DATA_BYTES_PER_SHAPE`, no `shedFramesOverBudget` (grep absent).
- Overlap: concept (shape-aware frame cap + budget enforcement) overlaps; the measured per-variant byte table and render-time shed are local-only and strictly more precise than area scaling.
- Rec: **partial upstream replacement candidate** — adopt upstream's `maxFramesForDataBudget(shape)` unified signature, but keep the per-shape byte table / shed logic if measured payloads still exceed 3 MB. Blocked hunks confirm a fresh candidate is required.
- Evidence: 0036 patch; 18.7.0 snapcompact.ts:510-529,1845-1932; replay-1870.json 0036 (provider-image-budget h1, session-maintenance h1-4, snapcompact h2, .d.ts h1 all FAILED).

### 0044 — image budget wire-api family (NM; replay **blocked**, snapcompact h2 FAILED)
- Local contract: add wire-api keys (`anthropic-messages`, `bedrock-converse-stream`, `openai-responses`, `openai-codex-responses`, `azure-openai-responses`, `google-generative-ai`) + api fallback so hand-written gateway providers (`pixel`,`pqh`,`wanzhao`) do not fall to floor 5 (0044 patch, 43 lines).
- Upstream change: none — `PROVIDER_IMAGE_BUDGETS` has only provider ids and `providerImageBudget(provider)` stays single-arg (snapcompact.ts:543-566); grep finds no `api` fallback.
- Rec: **retain + port** (independent of 0036's mechanism; needs new candidate against upstream's reworded block).
- Evidence: 0044 patch; 18.7.0 snapcompact.ts:543-566; replay-1870.json 0044.

### 0045 — snapcompact frame reprice (AGENT; replay **clean**)
- Local contract: on the reduction-side projection, subtract `frameCount*(FRAME_TOKEN_ESTIMATE - shape.frameTokenEstimate)` (0045 patch on session-maintenance.ts:1350-1360, 3651-3688, 4750).
- Upstream change: the tokenizer now prices each frame at the reading model's catalog price (`snapcompact.frameTokens(frameBilling, size)`; tokenizer.ts:359-360) using `frameBilling`/`frameTokens`/`priceShape` from `resolveImageTokenization` (snapcompact.ts:247-277); CHANGELOG pi-agent-core 18.6.3 #14291/#14286, snapcompact 18.6.3.
- Overlap: upstream **fully covers** the pricing contract. Local's subtraction becomes a double-correction and would under-count.
- Rec: **full replacement candidate** — drop 0045 (and its `modelFrameTokenEstimate` subtraction) rather than replaying it. Verify Step 5 probe below before retiring.
- Evidence: 0045 patch; 18.7.0 tokenizer.ts:359-360, snapcompact.ts:247-277; replay-1870.json 0045 (clean but on a root where 0036 was skipped).

### 0046 — supersede warm-prefix guard (AGENT; replay **clean**)
- Local contract: set `suffixTokenLimit: 0` unconditionally in the `pruneSupersededToolResults` call so every supersede rewrite defers to the idle flush (0046 patch, session-maintenance.ts:715-735).
- Upstream change: `DEFAULT_SUFFIX_TOKEN_LIMIT=8000` and the 'suffix is small' rationale are unchanged (pruning.ts:160,364); 18.5.1 added `tools/read-supersede.ts` for selector-aware supersede *keys* (orthogonal to the limit).
- Rec: **retain + port** (low conflict; watch interaction with the new read-supersede key semantics).
- Evidence: 0046 patch; 18.7.0 pruning.ts:160,364, tools/read-supersede.ts; replay-1870.json 0046.

### 0052 — snapcompact model billing + commandcode budget (NM; replay **blocked**, 4/4 hunks FAILED)
- Local contract: `modelFrameTokenEstimate`/`MODEL_FRAME_TOKEN_STEPS` measured per-model override applied in `resolveShape`, keyed by exact model id (not prefix); plus `COMMAND_CODE_NAMESPACE` regex + `COMMAND_CODE_IMAGE_BUDGET=200` in `providerImageBudget`.
- Upstream change: replaces family formulas with catalog `frameBilling`/`frameTokens`; `PROVIDER_IMAGE_BUDGETS` still has no `commandcode*` key and `providerImageBudget(provider)` has no namespace/api fallback.
- Overlap: pricing half is a **partial** replacement (catalog-based) but with a real limitation: no commandcode/deepseek lineage rule → wire-api fallback over-prices the models local 0052 measured at ~6/~0 tokens. Count-budget half is not covered upstream.
- Rec: **partial upstream replacement candidate** — adopt catalog pricing where it matches measurements; retain the measured override + Command-Code namespace budget.
- Evidence: 0052 patch (modelFrameTokenEstimate); 18.4.4 pristine snapcompact.ts:238-256 (family formulas); 18.7.0 snapcompact.ts:247-277,543-566, providers/image-tokenization.kdl:36; replay-1870.json 0052.

### 0057 — devin image budget 200 (NM; replay **blocked**, h1 FAILED)
- Local contract: add `devin:200`, `devin-agent:200` to `PROVIDER_IMAGE_BUDGETS`.
- Upstream change: none — no devin keys in 18.7.0 `PROVIDER_IMAGE_BUDGETS` (snapcompact.ts:543-555); only the *frame-token* fallback for `devin-agent` exists (image-tokenization.kdl:36).
- Rec: **retain + port** (devin/devin-agent still fall to floor 5 upstream).
- Evidence: 0057 patch; 18.7.0 snapcompact.ts:543-566, image-tokenization.kdl:36; replay-1870.json 0057.

### 0062 — snapcompact reduction-baseline previous archive (AGENT; replay **clean**)
- Local contract: credit the superseded previous archive (summary text + re-attached frames at the live shape's price) into `#projectPreSnapcompactContextTokens` (0062 patch on session-maintenance.ts:1379, 2510-2545, 4822-4833).
- Upstream change: `#projectPreSnapcompactContextTokens(preparation)` is unchanged and still excludes the previous compaction record (session-maintenance.ts:2500-2527 pre-patch shape); the baseline call sites (1378, 4754-4762) take no frame estimate. `prepareCompaction`'s v2-preserve exclusion is byte-identical in 18.4.4 and 18.7.0.
- Rec: **retain + port** (upstream still misclassifies 2nd+ passes as 'would not reduce').
- Evidence: 0062 patch; 18.7.0 session-maintenance.ts:1378,2500-2527,4754-4762; prepareCompaction identical (18.7.0:1359-1501 vs 18.4.4:1340-1482); replay-1870.json 0062.

### 0063 — Codex V2 remote compaction live chain (NM; replay **clean**)
- Local contract: codex V2 compaction rides the live transport (no `:lite` empty-socket key; on-disk prefix rebuild mismatch fixed) (0063 patch on openai-codex-responses.ts, compaction.ts:1724, compaction-v2-streaming.ts:355).
- Upstream change: `applyCodexResponsesLiteShape` still applied for `model.useResponsesLite` (compaction-v2-streaming.ts:215-217); 18.6.3 added `compat.statefulResponses` (adjacent, not covering the lite-key/prefix-rebuild defect); the codex request-context construction was refactored (18.4.4 compaction-v2-streaming.ts:273-277 absent in 18.7.0).
- Rec: **retain + port** pending a focused Codex review; text-clean replay but semantic coverage unproven.
- Evidence: 0063 patch; 18.7.0 compaction-v2-streaming.ts:215-217,350-354; replay-1870.json 0063.

### 0066 — Anthropic native compaction live context (NM; replay **blocked**, compaction.ts 3/3 FAILED)
- Local contract: introduce scope `"live"` and feed the native Anthropic request the live context truncated by `retainedTailLength`; use `liveContext.systemPrompt`/`tools` (0066 patch on compaction.ts:667/2121/2132, session-maintenance.ts:3439-3459, session-advisors.ts:1976).
- Upstream change: **same slot, better API** — SummaryOptions.buildProviderContext + host `buildLiveProviderContext(summarized, retained, signal)` (agent-session.ts:2237-2263) converts live history+retained through `buildSideRequestContext`, then cuts at the summarized prefix while skipping date/cwd reminder controls; native branch calls it with the summarized/retained split (compaction.ts:1989-1996) and falls back to `remoteSystemPrompt`/`convertToLlm`/`tools`. Motive: signed-thinking validity (#14251).
- Overlap: **partial upstream replacement candidate** — upstream's API removes the fragile `retainedTailLength` arithmetic and is cache-prefix-shaped (same `buildSideRequestContext` primitive), but (a) it is wired only for the primary session, not advisors (session-advisors.ts:2479-2491 still uses `remoteSystemPrompt`), and (b) its `previousSummaryInPrefix` predicate is not surfaced (local previous-summary-in-prefix handling must be re-grafted).
- Rec: **partial upstream replacement candidate** — re-implement local 0066's intent via `buildProviderContext`, retain the previous-summary-in-prefix predicate and the advisor wiring.
- Evidence: 0066 patch; 18.7.0 compaction.ts:686-690,1907-1935,1986-1996, anthropic.ts (context request), agent-session.ts:2237-2263, session-advisors.ts:2479-2491; replay-1870.json 0066.

### 0067 — remote lane trace + live tools (NM; replay **blocked**, 4/13 FAILED)
- Local contract: Codex V2 / V1 remote lanes take tools/system from the live context (normalizeTools with intent `i`), plus per-lane `summarize.request`/`summarize.usage` instrumentation (0067 patch on compaction.ts).
- Upstream change: V2 now sends `retainedUserItems`/`isUserAuthored` (compaction.ts:1705-1761) and keeps `remoteSystemPrompt`/`tools` (1710/1723); no live-context tools injection for the remote lanes, no lane trace.
- Rec: **retain + port**; the #14247 retention work is complementary, not equivalent.
- Evidence: 0067 patch; 18.7.0 compaction.ts:1705-1761; replay-1870.json 0067.

### 0068 — Codex stale-baseline chain (NM; replay **blocked**, compaction.ts 3/4 FAILED)
- Local contract: move chain decision after connection (prev_id is connection-scoped); chain-link diagnostics per attempt.
- Upstream change: none found (no equivalent symbols); pi-ai 18.7.0 only added `compat.statefulResponses` and replay image-detail handling.
- Rec: **retain + port**.
- Evidence: 0068 patch; 18.7.0 grep (no match); replay-1870.json 0068.

### 0069 — Codex effort history resume (AI; replay **clean**)
- Local contract: persist the real wire effort baseline + history-switch insertion point across resume.
- Upstream change: 18.6.3 added `SessionInitEntry.systemPrompt` blocks and `Agent.setOnModelCallSystemPrompt`; not the effort baseline. Adjacent but not covering.
- Rec: **retain + port** (medium confidence; needs a focused Codex-effort probe).
- Evidence: 0069 patch; pi-agent-core CHANGELOG 18.6.3 (#14338); replay-1870.json 0069.

### 0070 — Codex V2 compaction fail-closed (NM; replay **blocked**, many hunks)
- Local contract: chain-only (no silent 3-layer degradation); `CodexCompactionChainLostError`, `isCodexCompactionV2Lane`, `prepareCompactionRecovery`, initiator/session attribution.
- Upstream change: none — symbols absent in 18.7.0; only the #14245 warning-text fix (`shouldUseOpenAiRemoteCompaction(model) ? 'falling back to V1' : ...`, compaction.ts:1827-1831).
- Rec: **retain + port** (upstream even only fixed the message, not the fail-closed policy).
- Evidence: 0070 patch; 18.7.0 compaction.ts:1827-1831, grep absent; replay-1870.json 0070.

### 0088 — compaction cache liveness (NM; replay **blocked**, many hunks)
- Local contract: the *local summarize request* rides the main chain's live cache entries (live scope in generateSummary), with unconditional overflow→cold retry, previous-summary-in-prefix predicate, whole-live-chain note and a dedicated live-chain instructions prompt (0088 patch: anthropic.ts, compaction.ts:114-115/710/972-1127/1231-1521/2640-2740, new prompts/anthropic-compaction-instructions-live-chain.md, session-maintenance.ts:3533+, session-advisors.ts:1992+).
- Upstream change: **none** for the local summarize lane — no `CachePreservingSummaryScope`, no live scope, no overflow-retry, no `cacheColdReason` (grep absent across 18.7.0); upstream only added the native-lane `buildProviderContext`.
- Rec: **retain + port** (no upstream replacement). Must be re-based on 0035's port; note the native-lane half of 0088 partly overlaps upstream's buildProviderContext and should be re-expressed as 0066's port.
- Evidence: 0088 patch headers/diff; 18.7.0 grep absent; replay-1870.json 0088.

### 0089 — drop live-chain capacity gate (NM; replay **blocked**, 12/12 FAILED)
- Local contract (spec-mandated): no local capacity pre-flight for the live chain; ship whenever the host vouches and the prior summary is absent/inside it; provider rejection is the only capacity authority and MUST recover (clear live context, name `live-chain-overflow-retry`, replan the cold target with the ordinary cold plan via shared `planColdWindows`) — deletes `liveChainFit`/`findProviderInputAttestation`/`isControlOnlyCarrier`/`usageReportsNoTokens`/`ATTESTATION_COHERENCE_FLOOR` and the `capacity-unattested`/`live-chain-over-capacity`/`native-*` reasons (0089 patch; verification-gate-contracts.md:153-172,205-209).
- Upstream change: none — no live-chain, no gate, no `cacheColdReason`. Upstream does not contradict the invariant; it simply has no subject for it.
- Rec: **retain + port** (re-express on the 0088 port). No upstream cache fix covers 0088/0089 — confirmed: all cache-related upstream fixes (#14251, #14247, #14495, #14260) are about thinking-signature validity, V2 retention, OAuth billing-header stability, and image-window estimation, never the summarize-request cache anchor.
- Evidence: 0089 patch; verification-gate-contracts.md:153-172; 18.7.0 grep absent; replay-1870.json 0089.

### 0092 / 0090 (context, out of this slice but binding)
- 0092: upstream cache-warmer keeps the hard-coded `MAX_IDLE_WARMING_AGE_MS = 30min`; no equivalent change (PATCHES.md:853-856) → retain. 0090: see verification-gate-contracts.md:773-810; upstream 18.7.0 pi-ai added `getOAuthCredentialProvider()` and an auth-broker sweep fix only; token-receipt→durable-save/lease/CAS semantics unchanged → retain (owner of that slice confirmed blocked replay).

## 3. Upstream improvements worth showing (with limitations)

1. **Catalog-driven frame pricing** (`frameBilling`/`frameTokens`/`priceShape`; snapcompact.ts:247-277 + tokenizer.ts:359-360). Replaces the fixed `familyBilling` formulas (18.4.4 snapcompact.ts:238-256) with per-model lineage rules and the real base64 image size, and the *tokenizer* now uses it — so context count, auto-compaction trigger, divider and RPC all agree (CHANGELOG #14291/#14286). Limitation: no commandcode/deepseek lineage rule → wire-api fallback over-prices the models local 0052 measured near-zero; also drives the 0045 double-subtraction if ported naively.
2. **`buildProviderContext(summarized, retained)` + host `buildLiveProviderContext`** (compaction.ts:686-690, agent-session.ts:2237-2263). A clean, correct-by-construction native-Anthropic live prefix (skips date/cwd reminder controls, preserves the live summary message identity, reuses `buildSideRequestContext`) that supersedes local 0066's `retainedTailLength` truncation. Limitations: wired for the primary session only (advisors excluded, session-advisors.ts:2479-2491), motivated by thinking signatures not caching, and it does not surface `previousSummaryInPrefix`.
3. **V2 remote-compaction retention** (`isUserAuthored`/`retainedUserItems`, compaction.ts:1705-1761) keeps user-written turns (`/skill:`, collab prompts) next to the compaction item (#14247) — a real correctness gain for post-compact message persistence; complementary to (not a replacement for) local Codex 0063/0067/0068/0070.
4. **Shape-aware frame cap** `maxFramesForDataBudget(shape)` (snapcompact.ts:510-529) + rebuild-time `imagesWithinBudget`/`omittedFrameNotice` (1845-1932): fixes the 17-frame cliff at 1568px (#14277). Limitation: area-scaled, coarser than local 0036's measured `FRAME_DATA_BYTES_PER_SHAPE`; still single-arg `providerFrameBudget`.
5. **Signed-thinking preservation across Anthropic native compaction** (#14251, compaction.ts:1907-1935; anthropic.ts payload `retainedFiles`/`exactTail`) — valuable, but orthogonal to the cache contract.

## 4. Missing runtime evidence + concrete acceptance probes (for later implementation)

No cache-hit, credential-safety, or compaction-correctness claim is grounded by this read-only pass. Probes:

- **P1 (R2) 0045 obsolescence:** build a throwaway harness that renders one snapcompact archive of N frames for an OpenAI-family `8on22-bw` shape on 18.7.0 and asserts the reduction-side projection equals the window-fit projection scaled by the shape's real per-frame price (i.e. no residual `FRAME_TOKEN_ESTIMATE` charge). Re-add 0045 and assert the projection does NOT drop by `N*(5024-frameTokenEstimate)`. Retire 0045 only if the first passes and the second would under-count.
- **P2 (R1/R3) summarize-lane cache shape:** run the existing `bun patches/verify-prefix-cache-compaction.ts` and `verify-compaction-cache-liveness.ts` against a freshly ported 18.7.0 tree; require the live-chain request to be a byte-prefix of the preceding live request and to carry exactly one prior-summary occurrence. Then, with `OMP_PATCH_OFFLINE_VERIFY=1`, assert `cacheColdReason` names only real abandonments.
- **P3 (R4) gateway budget floor:** with an isolated `models.yml` provider (`api: openai-responses`, unknown provider id) and a 6-frame archive, assert the outgoing request keeps all 6 frames (not 5) and `providerFrameBudget(provider, api)` resolves to 200; assert `devin` resolves to 200.
- **P4 (R5) Command Code pricing:** for `commandcode-custom` DeepSeek models, assert the frame token charge matches the measured 0052 values, not the openai-patch fallback; fail the probe if only the wire-api rule applies.
- **P5 (0089 contract) no-capacity-gate machine check:** `grep -nE 'liveChainFit|ATTESTATION_COHERENCE_FLOOR|capacity-unattested' <core>/src/compaction/compaction.ts` MUST print nothing (verification-gate-contracts.md:165), and a synthetic provider context-overflow on the live chain MUST produce `cacheColdReason = 'live-chain-overflow-retry'` with the cold plan equal to the ordinary cold plan.
- **P6 (Codex) chain-only:** `bun patches/verify-codex-compaction-chain.ts` and the fail-closed fault fixtures (`verify-codex-compaction-chain-fail-closed-faults.sh`) after porting 0063/0067/0068/0070; require no silent degradation.
- **P7 (0062) second-pass reduction:** re-run `bun patches/verify-snapcompact-reduction-baseline.ts`; require a genuinely-reducing 2nd+ pass to be accepted.

## 5. Conflicts to watch during port (high-risk points)

- SummaryOptions slot (compaction.ts ~686): local `buildCachePreservingContext` and upstream `buildProviderContext` cannot coexist as inserted by 0035/0066; re-express local as an upstream `buildProviderContext` implementation.
- `AnthropicNativeCompactionRequest` shape change (anthropic.ts) invalidates 0066's native callsite.
- `maxFramesForDataBudget` signature: local `(bytes, shape)` vs upstream `(shape)`; 0036's callsite rewrite must be inverted.
- Tokenizer frame pricing: 0045 must be dropped, not replayed.
- `providerImageBudget`/`providerFrameBudget` arity: 0036/0044/0057 widen to `(provider, api?)`; upstream call sites pass one arg.
- Advisor lane: upstream left `session-advisors.ts` on `remoteSystemPrompt`/`tools`; local 0066/0088 patch it — the port must not assume upstream covered the advisor path.

No code, patches, tasks, specs, credentials, or live state were modified.
