# ClinePass Translator Cache Affinity

## Scope and evidence level

Investigated on 2026-09-28 for the session input translator planning task. No product implementation, deployment, live credential/database access, or inference request was performed. The user prefers ClinePass DeepSeek V4.1 Flash; this is a preferred candidate, not a hardcoded-only model requirement.

## Model identity and low reasoning

- The public authoritative roster at <https://api.cline.bot/api/v1/ai/cline/recommended-models> lists `cline-pass/deepseek-v4.1-flash` in the `clinePass` bucket. It also lists a separate free-tier id; do not silently substitute that tier.
- Installed `pi-catalog/src/cline-pass-model-id.ts:3-10` adds/removes only the `cline-pass/` wire prefix. OMP selection is provider `cline-pass`, model id `deepseek-v4.1-flash`.
- Executed the installed `clinePassModelManagerOptions().fetchDynamicModels()` in Bun with a temporary HOME, XDG roots, Bun cache and TMPDIR; the child environment contained no inherited provider credentials. The call exited 0 and returned the preferred model with `api: openai-completions`, `reasoning: true`, `contextWindow: 1000000`, `thinking.mode: effort`, and discovery efforts `low/medium/high/xhigh`.
- `pi-catalog/src/compat/rules/classes/deepseek.kdl:18-29` also includes `low` in the Flash family effort ladder. The discovery record is not proof of final wire emission or server acceptance; verify both in the implementation acceptance run.
- The curated metadata table is not the authoritative membership source. Dynamic resolution is documented at `pi-catalog/src/provider-models/openai-compat.ts:2731-2750`; the public roster and enrichment execute at `2673-2728`. Do not reject this candidate merely because an older curated table contains only `deepseek-v4-flash`.

All installed paths above are under `/home/chris/.bun/install/global/node_modules/@oh-my-pi/`. They are read-only evidence from the current installation, not proposed editing locations.

## Existing affinity path

1. `pi-ai/src/providers/openai-shared.ts:473-485` normalizes the cache key and chooses `options.promptCacheKey ?? options.sessionId`. Setting cache retention to `none` suppresses this key.
2. `pi-ai/src/providers/openai-completions.ts:796-804` passes that resolved key into request setup.
3. `pi-ai/src/providers/openai-completions.ts:1655-1683` selects `clinePassClientHeaders(promptCacheSessionId)` for ClinePass.
4. `pi-catalog/src/wire/cline-pass.ts:18-34` documents the stable session/cache identity and emits it as `X-Task-ID` when present. A local call with `translator-affinity-probe` returned the same `X-Task-ID` value.

This establishes an existing client-side affinity hook. It does not prove that Cline pins a backend, retains cache across restarts, or guarantees hits. No measured TTL or hit-rate claim is available.

## Proposed cache-friendly behavior

These are technical proposals supporting the user's explicit cache-affinity requirement; final planning approval is still required.

- Use a translator-owned stable cache/session identity, distinct from the main agent's identity. Preserve it with the corresponding OMP session across process restarts. Do not generate a fresh identity for each translation.
- Reuse the native OMP provider path so the Cline identity headers and supported reasoning parameters are not lost in a hand-written generic fetch wrapper.
- Keep translation instructions and model settings stable. No per-turn date, cwd, task state, dynamic glossary insertion, main model replies, or tool results in the translator prefix.
- Append newly committed original/translation turns without rewriting the retained history. Do not introduce a rolling window that drops the first messages on every turn merely to keep a small prompt.
- Preserve the protocol-relevant assistant response representation needed by the selected provider. On success, only translated text goes to the main model; hidden reasoning/protocol fields must not leak into that text. Whether the Cline adapter replays reasoning fields must be verified rather than guessed.
- The main model also needs prefix stability: the selected core-supported design persists canonical English on the actual user message with separate original-display metadata. Reuse that content across later requests/resume; do not retranslate history or add a historical context-mapping hook.
- Do not add idle cron, cache warmup bursts, forced-provider routing, automatic retry loops, or a gateway modification under the label of cache affinity. The user subsequently specified manual failure handling in PRD R10: Esc retries the same translation, while Enter explicitly sends the original once. Preserve the stable translation identity on retry and persist an original-send decision so later context construction never retroactively translates that historical message.
- The user chose existing soft compaction at the translator's usable context limit (PRD R12), superseding the proposed batch-trimming alternative. Retain full local history but replay the committed summary and kept tail. This is an explicit translation-context rewrite boundary, not a promise to preserve the old full KV prefix; the main model's canonical historical messages remain unchanged.

## Acceptance evidence to collect later

- Capture effective outbound headers and payload, not only extension-level objects. `.trellis/spec/guides/prompt-cache-diagnosis-guide.md:195-211` explains why adapter/fetch shaping can change the final wire bytes.
- Across multiple real translation turns, compare stable instructions, retained message prefix, actual model/effort fields, absence of tools, and `X-Task-ID`.
- Repeat in a new OMP process after resuming the same session; retain the history and identity and compare the previously retained wire prefix. A new unrelated session must use isolated history and identity.
- Inspect main-model requests separately to prove that UI-original/history-translated mapping does not rewrite earlier English messages or historical original-send decisions.
- Collect actual provider cache-read usage and latency without promising a hit rate in advance. `pi-ai/src/providers/openai-completions.ts:2015-2048` recognizes `prompt_cache_hit_tokens`, `prompt_tokens_details.cached_tokens`, and related accounting fields. Missing cache telemetry is unknown, not evidence of a hit.
- The public catalog probe does not satisfy real translation quality, inference latency, cache hit-rate, or cross-process plugin acceptance. Those remain unverified.
- Exercise soft compaction, then a process restart and a second compaction. Verify committed summary/boundary reuse, term and constraint retention, no main-session compaction, explicit low reasoning, and no tool definitions. Compression failures must not commit partial state or silently fall back to truncation.

## Existing soft compaction: implementation evidence

- `pi-coding-agent/src/session/compact-modes.ts:40-55` distinguishes `soft` (LLM text summary, `methodOrder: [\"soft\"]`) from `snapcompact` (bitmap archive without an LLM call). The user's requested soft mode is not image compression.
- `pi-coding-agent/src/session/compaction-methods.ts:79-100` maps soft to `strategy: \"context-full\"` and `remoteEnabled: false`.
- Reusable core APIs are in `pi-agent-core/src/compaction/compaction.ts`: `prepareCompaction` at 1531-1536, `generateSummary` at 889-897, and `compact` at 1786-1793. Do not invoke the primary host's compaction wrapper: `pi-coding-agent/src/session/session-maintenance.ts:3445-3491,3519-3539` binds it to the primary branch, model, tools and cache identity.
- Core `SummaryOptions` at 683-738 accepts a provider-ready cache-preserving context callback, thinking level, session id, prompt-cache key and fetch transport. Its comment at 716-724 warns that omitting thinking level falls back to High; explicitly thread the translator's low setting into maintenance.
- `generateSummary` separates summary targets from the live wire prefix at 901-925 and only uses the full cached prefix if it fits. The summary request appends maintenance instructions at 1074-1099 and forwards reasoning/session/cache options at 1143-1156. Provide translator-owned context with no tools, never the main agent's context.
- Translation-only instructions must be compatible with explicitly authorized internal maintenance. Real acceptance must show that the model summarizes translation history rather than merely translating the maintenance instruction, while ordinary user text requesting summaries remains translation data.
- `compact` additionally generates a short UI summary at 2347-2353. The design should select the narrowest suitable public soft engine entry point rather than assuming compaction always costs exactly one request or copying the engine.
- Budget policy at 195-210,336-341,370-373 reserves space for the next prompt/response. A temporary, credential-free Bun probe executed the current soft mode and default SDK budget policy, exit 0: with an illustrative 1,000,000-token window, reserve was 150,000; `shouldCompact(850000)` was false, `shouldCompact(850001)` and `shouldCompact(1000000)` were true. This did not read user settings and does not choose a new product threshold.
- No actual summary generation, translation after compaction, or Cline cache reuse after a summary has been measured. Persist the summary and boundary before using them in later turns; restore that exact active state on resume instead of re-expanding archived originals.


## Relevant project contracts

- `.trellis/spec/backend/context-plugin-eval.md:7-8,25-28`: isolated context-wire evaluation; do not touch live agent.db/models.db/auth.json; inspect cross-turn byte stability.
- `.trellis/spec/backend/extension-runtime-contracts.md:75-82,99-100`: idle ephemeral calls inherit main model/system/tools/history and are therefore not a ready-made isolated translator; positive cache-read evidence is required before reporting a hit.
- `.trellis/spec/guides/prompt-cache-diagnosis-guide.md:225-243`: a few cold short requests do not establish provider cache behavior. The examples concern other gateways and are not Cline TTL guarantees.
