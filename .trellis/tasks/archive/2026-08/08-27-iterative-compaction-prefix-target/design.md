# Design: iterative compaction prefix/target separation

## Problem

`prepareCompaction()` currently gives local summarization only the entries after the previous compaction marker. The live Agent context, however, begins with the previous `compactionSummary` and the messages retained by that previous compaction. Re-running the session/provider pipeline on the post-marker slice therefore:

1. omits the live wire prefix;
2. injects date/cwd on the slice's first user message instead of the live first user message;
3. omits previously retained messages when a later compaction finally discards them.

The first Opus compaction did not expose this because no previous compaction marker existed.

## Terms

- **History target**: messages that this local summary must fold into the durable summary.
- **Live prefix**: provider-visible context from the current live context start through the last entry represented by one summary call.
- **Retained tail**: entries kept verbatim after the new compaction.
- **Prior retained range**: messages retained by the previous local compaction but discarded by the current one.

## Decision

Use two explicit ranges connected by stable session-entry boundaries.

### Preparation data

Extend `CompactionPreparation` with:

```ts
previousRetainedMessages: AgentMessage[];
historyPrefixEntryId: string;
turnPrefixEntryId?: string;
```

Names may be adjusted to existing style, but the semantics are fixed:

- `previousRetainedMessages` is populated only for a readable local textual/snapcompact compaction whose retained entries are not already represented by provider-native replacement history.
- local history target is:
  `previousRetainedMessages + messagesToSummarize`;
- `historyPrefixEntryId` is the stable leaf immediately before the newly retained tail;
- `turnPrefixEntryId` is the stable leaf immediately before the retained suffix of a split turn.

### Cache callback contract

The cache callback receives a logical scope instead of assuming its target array is the live prefix:

```ts
type CachePreservingSummaryScope = "history" | "turn-prefix";

interface CachePreservingSummaryContext {
  context: Context;
  previousSummaryInPrefix: boolean;
}
```

The owning host captures the branch leaf when it creates the callback. For the requested scope it rebuilds model context at the preparation's stable entry id, runs the owning conversion/provider pipeline, and rechecks model plus branch leaf before returning.

No message-count subtraction and no independently reconstructed system/tools/provider transform are allowed.

### Core data flow

```text
history target AgentMessage[]
  -> target conversion
  -> serialization + token/window planning

stable prefix entry id
  -> owning buildSessionContext(..., leaf)
  -> owning convertMessagesToLlm()
  -> owning Agent.buildSideRequestContext()
  -> provider-ready live prefix
```

For a fitting single-window request:

```text
provider-ready live prefix + one summary instruction tail
```

For iterative structured history, the first live-prefix message already carries the prior `<summary>` context. Use a structured-update prompt that references that prefix summary; do not append a second copy of its body. Flat fallback and later fold windows retain the existing `<previous-summary>` tag contract because they do not carry the live prefix.

### Split turn

- History call target: prior retained range plus ordinary discarded history.
- History prefix leaf: entry immediately before the split turn begins.
- Turn-prefix target: only the discarded prefix of the split turn.
- Turn-prefix prefix leaf: entry immediately before the retained split-turn suffix.
- A fitting structured turn-prefix request refers to the final incomplete turn already present in the live prefix instead of serializing a duplicate conversation into the tail.

### Multi-window

Window planning is based only on target messages. Before using the live prefix, verify the full prefix fits the request's summary input budget.

- Fitting prefix: use exact live prefix and claim cache-preserving structure.
- Prefix cannot fit: fold target windows with provider-ready system/tools, but do not label a target-only window as a preserved live prefix.
- Later windows carry the generated prior window summary and cannot read the original live-history prefix.

## Alternatives rejected

### Return full live Context and use it as the target

Solves cache identity with minimal code, but re-summarizes the previous summary, changes token/window planning, and conflates retained context with the actual fold target.

### Slice `agent.state.messages` by retained-message count

Small implementation, but unsafe. Session entries and runtime Agent messages are not one-to-one because compaction summaries, custom messages, retry filtering, and reconstruction can insert, omit, or recreate messages.

### Rebuild only the previous summary in core

Still misses previously retained messages, snapcompact/provider payload semantics, date/cwd placement, extension transforms, and provider normalization.

### OpenAI wire splice

Would patch the observed provider only, bypass the owning session pipeline, and leave Anthropic/advisor/split-turn behavior inconsistent.

### Keep flat iterative fallback

Preserves current target semantics but cannot meet the required cache hit rate; retained only as the safe identity-failure path.

## File boundary

Expected production changes:

- `pi-agent-core/src/compaction/compaction.ts`
  - preparation ranges;
  - target-only planning;
  - live-prefix structured request selection;
  - split-turn scope;
  - non-duplicating structured update prompt.
- `pi-agent-core/src/compaction/prompts/`
  - one structured iterative update instruction if existing templates cannot express the no-duplicate contract.
- `pi-coding-agent/src/session/session-maintenance.ts`
  - primary branch/leaf-owned prefix builder for manual and auto paths.
- `pi-coding-agent/src/session/session-advisors.ts`
  - advisor synthetic-branch-owned prefix builder.
- `patches/verify-prefix-cache-compaction.ts`
  - iterative preparation, exact OpenAI wire prefix, reminder placement, split range, drift/fallback, and sensitivity assertions.

Expected unchanged files:

- `agent-session.ts`: existing conversion host wiring is sufficient.
- `session-provider-boundary.ts`: exact candidate identity gate remains authoritative unless a small shared type location is required.
- provider cache retention/TTL and OpenAI native replay code.

## Risks and controls

| Risk | Control |
|---|---|
| Reconstructed prefix uses a stale branch | Capture and recheck current leaf before and after async conversion |
| Previous remote replacement is duplicated | Do not populate prior retained target when provider-native preserve owns history |
| Target planning counts prefix-only messages | Keep target conversion independent from returned prefix Context |
| Previous summary sent twice | Dedicated structured update instruction; retain tags only for fallback/fold windows |
| Split-turn summarizes old history | Separate scope, target, and prefix leaf |
| Multi-window falsely claims cache identity | Record whether the actual request used the verified prefix |
| Different candidate borrows active Context | Preserve exact runtime-object and wire-id gate |

## Verification evidence required

A mock proves routing only. Final acceptance requires a fresh patched process and the matching real `gpt-5.6-sol` `summarize.request`, `summarize.wire`, and `summarize.usage`. Later ordinary-turn audit hits and advisor/Luna usages are irrelevant.