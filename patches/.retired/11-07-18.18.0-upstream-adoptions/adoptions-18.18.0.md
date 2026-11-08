# Upstream adoptions carried by the 18.18.0 plan — re-verification record

This is the durable evidence the 18.18.0 family manifest points at
(`patches/.18.18.0-families/manifest.json`, `upstream_adoptions[*].evidence`).
Paths in that manifest are relative to `patches/`; paths below follow the same
rule unless they start with `.trellis/`, which is repository-relative.

Why it lives here: the adoption record used to point into a task's `research/`
directory, which moves when the task is archived. Evidence a release depends on
belongs with the release bytes, which is how this tree already keeps retired
revisions (`.retired/<date>-<slug>/`) and native build provenance
(`native/18.18.0/overlay.json`).

An adoption is declared only after the pristine release runs the consumer
contract green and a single-fault copy turns it red. The capability keeps a gate
through the `PLAN_CAPABILITIES[<id>]` marker, so an adopted capability is never
silently ungated.

## Rows (18.18.0 pristine vs the recorded contract)

| ID | Still holds | 18.18.0 evidence (file:line) | Gate | Note |
|---|---|---|---|---|
| 0017 | yes | `pi-ai/src/providers/openai-responses.ts:505` (`nativeHistoryReplayWarmed: !compat.connectionBoundNativeHistory`), `:519` (`close()` clears), `:1462` (set on the first success when `closeCount` is unchanged), `:1797` (`shouldReplayNativeHistory` read). Compat still declared: `pi-catalog/src/types.ts:1182`, `compat/axes.ts:185`, `compat/resolve.ts:806,874` | `verify-prefix-cache-compaction.ts:794-885` (reasoning item present on ordinary turn 1; connection-bound history only from turn 2) | Code line-for-line equal to 18.16.0. 18.18.0 only wraps the stream in `withReplaySafeStreamRetry` (`:1572-1582`); replay semantics unchanged. No `evidence` row: the contract is proven by the gate, not by a document |
| 0078 | yes | `pi-coding-agent/src/eval/py/runner.py:1932-1955` (`_value_image`: matplotlib/PIL PNG → `_repr_png_` → `_repr_jpeg_`), `:2301-2304` (one image per display event), frame wire `:1867-1873` | `verify-python-display-mime-preference.ts` (drives the real runner.py NDJSON) | Producer body identical to 18.16.0; 18.18.0 added the `_emit_image_dict`/`__omp_emit_*` prelude only. Original record: `.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/mime-adoption-0078.md` |
| 0066 | yes | `pi-agent-core/src/compaction/compaction.ts:706-712` (`buildProviderContext` including the 4th `model` argument), `:1758` (passthrough), `:2221-2227` (Anthropic native lane uses it; the `remoteSystemPrompt` + `summaryOptions.tools` fallback stays) | `verify-anthropic-native-compaction-live-context.ts:274-291` (live context obtained exactly once; system/tools/messages byte-equal) | Unchanged vs 18.16.0 |
| 0072 | yes | `pi-coding-agent/src/modes/controllers/selector-controller.ts:154-162` (`loadProviderAuthUi` awaits `Promise.all([import(...)])`), `:2365-2385` (`showSessionPinSelector` awaits it); no `require(` left in the file | `verify-session-pin-static-auth-ui.ts:90-101` (real pin overlay renders and Escapes after the legacy shim install) | Byte-identical to 18.16.0, +3 lines offset |
| 0079 | yes (narrowed) | `pi-tui/src/chat/tool-execution.ts:1093-1099`: the barrier is still `#kittyConversionsAwaited.size > 0 \|\| #figure?.pending`, plus the new `#presentation.shown.mode === "full"` term (`:1096`) | `verify-kitty-conversion-finalization.ts:26-31` (`isFinalized() && !isPending` before retirement) | Implementing code changed upward (the mode term). `render()` in `hidden` mode returns no rows and in `compact` mode emits text only (`tool-execution.ts:1682-1694`), so a compact or hidden card cannot lose a Kitty row |
| 0062 | yes (changed implementation) | `pi-coding-agent/src/session/session-maintenance.ts:2742-2760` (baseline credits the live compaction summary), `:2769-2772` `#replacesStandingSummary`, `:4087-4114` projection, `:3990-3997` per-reader frame price, manual `:1491-1498`, auto `:5641-5650` | `verify-snapcompact-frame-reprice.ts:194-213` (priced successor commits; the ceiling-priced twin is rejected) | 18.16.0's inline `carriesStandingSummary` + `archiveSourceText()` became a previous-summary projection. A pre-16.1 text-less archive loses the standing-summary credit, so a second snapcompact pass is rejected only when its projection does not reduce context (`:1491-1498`); a large enough new region can still reduce and pass |
| 0054 | yes | see its own consumer-proof record: `.retired/11-07-0054-upstream-adopted/consumer-proof-0054.md` | `verify-antigravity-envelope.ts` (its `:42` assertion is the negative control) | New in 18.18.0: the family's hunks left `family-antigravity-wire` in one atomic change |

No adoption is broken. `0017`, `0066`, `0072` and `0062` needed their gate arms
extended for the 18.18.0 version; each of them failed closed or silently dropped
its adoption leg before the work in the 18.18.0 implementation task.

## Provenance

- 18.16.0 whole-ID adoption and retirement record (archived task, kept in the
  repository): `.trellis/tasks/archive/2026-11/11-03-omp-18160-upgrade-plan/research/m5-adoptions.md`.
- 18.18.0 re-verification gathered for the upgrade plan:
  `.tasks/stage/11-07-omp-18180-upgrade-plan/research/adoptions-recheck.md`
  (the source of the file:line column above; superseded here once that task is
  archived).
- 18.18.0 implementation evidence for 0054 (consumer proof and negative control,
  ring segment R1) and for the gate arms: the implementation task record
  `.tasks/11-07-omp-18180-implement/TASK.md`, receipts under
  `.tasks/11-07-omp-18180-implement/research/`.
