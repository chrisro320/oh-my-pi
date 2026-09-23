# OMP 18.2.6 migration research

## Evidence boundary

- Installed deployment: `omp/18.2.3`; `patches/PATCHES.md` also records 18.2.3 as current deployment.
- Upstream comparison target: official npm 18.2.6 packages, extracted under `/tmp/omp-18.2.6/`.
- Official archives verified against registry SHA-512 integrity for `pi-coding-agent`, `pi-ai`, `pi-agent-core`, `snapcompact`, `pi-catalog`, and `pi-tui`.
- No live install, Bun cache, database, credential, or repository patch was modified during research.

## Ordered replay result

The 18.2.3 physical plan has 37 patches (38 logical semantics because 0041 is folded into 0037). Ordered `patch --dry-run --fuzz=0` probing against isolated 18.2.6 roots produced:

- CLEAN (19): 0014, 0036, 0017, 0025, 0026, 0031, 0032, 0038, 0044, 0052, 0057, 0046, 0048, 0054, 0047, 0056, 0058, 0063, 0069.
- CONFLICT (18): 0033, 0004, 0034, 0037, 0010, 0035, 0030, 0043, 0045, 0050, 0055, 0060, 0062, 0065, 0066, 0067, 0068, 0070.
- Whole-patch reverse identification did not prove any current physical patch fully adopted. This is a textual result, not a semantic conclusion.

## Source-level dispositions already established

### Partial upstream overlap

- Hindsight: 18.2.6 freezes mental-model content within the transcript lifecycle and treats recall as a volatile Anthropic system suffix. It still has no `hindsight_recall_snippet` or `hindsight_mental_models_snippet` custom-entry persistence, so 0034's cross-process byte-stable resume contract remains local.
- Repeated local compaction: `prepareCompaction()` walks back to the prior `firstKeptEntryId`, covering the retained-tail correctness part of 0035. Upstream still lacks `CachePreservingSummaryScope`, `buildCachePreservingContext`, the `live` scope, and the local compaction trace contract.
- Native compaction: upstream preserves prior local summaries and messages appended after a speculative snapshot. Requests still use `summaryOptions.remoteSystemPrompt`, `summaryOptions.tools`, and manually converted messages, not the host's provider-ready live context required by 0066/0067.
- CommandCode: upstream contains image input and effort settings for DeepSeek v4.1 Flash, but lacks `supports-strict-mode #true` and `supports-multiple-system-messages #false`; 0065 remains as a reduced wire-parity patch.

### Still missing upstream

- Status line: `token_total` still excludes `cacheRead`; no `cache_turn`; usage refresh remains a five-minute TTL and refresh completion still triggers branch repaint. 0004/0033 become TUI-only candidates. 0037 becomes a cross-package `NM` candidate because TUI owns cadence/repaint while coding-agent must bridge the provider list into pi-ai's existing 0026 filter. None is retired.
- Snapcompact: fixed `FRAME_DATA_BYTES_ESTIMATE` remains; no per-shape measured byte budget or provider+wire-API fallback. The budget/repricing/reduction-baseline family remains required.
- Devin: auth metadata is fetched each turn, catalog metadata remains `3000.6.2`, and `deltaSignature` is still captured only under `deltaThinking`. 0055/0056/0058/0060 remain required.
- Goal visibility: SDK still filters `goal` and interactive mode dynamically adds/removes it. 0032 remains required.
- Codex: the transport builds/chooses chained request state before obtaining the actual WebSocket connection. Upstream has no `CodexCompactionChainLostError` and no local fail-closed retry/fallback contract. 0068/0069/0070 remain required.
- Snapcompact repeated reduction: upstream carries prior retained messages into compaction, but reduction projection still lacks the replaced previous archive credit supplied by 0062.

## Previously retired upstream adoptions

- 0011: upstream 18.0.9 daily quota implementation.
- 0051: upstream 18.1.17 `prompt_eval_cached_count → cacheRead`; confirmed present in 18.2.6.
- 0019 and 0042: retired with their removed upstream mechanism.

## Migration risk concentration

1. `0004`/`0033`/`0037`: first-class TUI controller/sandbox/gate root; 0004/0033=`TUI`, cross-package 0037=`NM`, and selected-root behavior verification across TUI→agent→pi-ai.
2. `0034`/`0035`/`0062`/`0066`/`0067`: partial adoption requires semantic subtraction rather than blind replay.
3. `0068 → 0069 → 0070`: connection identity, effort persistence, retry/fallback, and public type behavior form one high-risk ordered contract.
4. Controller/verifiers: `apply.sh` currently supports only 18.1.14, 18.1.18, and 18.2.3; installing 18.2.6 before adding a verified plan must fail closed.
