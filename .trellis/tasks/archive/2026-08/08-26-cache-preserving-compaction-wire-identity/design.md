# Technical Design

## Boundary

The behavior gap is in local soft-summary request construction. `prepareCompaction()` chooses the history window; `pi-agent-core` creates the summary request; `pi-coding-agent` owns the active session's `transformContext`, `convertToLlm`, model state, tools, and provider transform. The fix crosses these two packages but does not change provider wire serializers.

## Preferred design

Add an optional candidate-aware callback to `SummaryOptions`:

```ts
buildCachePreservingContext?: (
  messages: AgentMessage[],
  candidate: Model,
  signal?: AbortSignal,
) => Promise<Context | undefined>;
```

The callback returns a provider-ready `Context` or `undefined`. `generateSummary()` invokes it once for the full `currentMessages` set before summary-window planning. When available, the returned provider-ready messages become the input to serialization and window planning, and its system/tools form the base Context for every structured window; the summary instruction is appended as a new user tail. This preserves structured behavior for multi-window summaries while only the first true live-prefix window is expected to read an existing live cache entry. A single oversized message that cannot retain structured window messages keeps the existing flattened safety fallback.

`SessionMaintenance` binds the callback per compaction candidate. Before binding it, it compares the candidate to the active session model. The conservative first implementation requires `candidate === activeModel` and also verifies provider, api, catalog id, and effective wire model id (`requestModelId ?? id`). Exact object identity proves the same runtime compat/overlay object drives both `Agent.buildSideRequestContext()` and the provider request; the explicit fields make the load-bearing wire condition readable and testable. If any check fails, no callback is passed.

The primary callback uses the complete session conversion path:

```text
AgentMessage[]
  -> AgentSession.convertMessagesToLlm(messages, signal)
     (transformContext + session convertToLlm)
  -> Agent.buildSideRequestContext(llmMessages)
     (active-model message/tool normalization + provider transform)
```

The callback is only bound when the gate proves active/candidate identity. Primary maintenance uses the primary Agent and session context. Advisor maintenance is separate: it uses the advisor message converter plus the advisor Agent's own `buildSideRequestContext`; it never applies the primary Agent's context transform, tools, or model state to advisor history.

## Why not an unconditional Agent API change

`Agent.buildSideRequestContext()` intentionally owns active Agent state. Making it accept arbitrary candidates would require deciding which model-specific tools, dialect, image budget, obfuscation, and provider transform state are valid for a model that is not active. That is a larger public contract. Strictly refusing cache preservation for non-identical candidates is safer and preserves the existing fallback semantics.

## Cache retention

Remove the temporary forced `summaryCacheRetention = "none"` path. Do not pass a compaction-specific override; `completeSimple()` must resolve the configured retention normally, preserving cache-control breakpoints and allowing `cacheRead`.

## Diagnostics and documentation

Keep `summarize.request`, `summarize.wire`, and `summarize.usage` diagnostics, but revise comments and `PATCHES.md`:

- retain the confirmed historical breakpoint evidence;
- state that the zero-network experiment demonstrated the date/cwd message divergence only;
- state that full provider-ready parity and the required real hit rate remain runtime acceptance checks;
- remove the none-retention workaround and its predicted pricing claim.

Runtime acceptance uses the status-line's existing prompt-token formula: `cacheRead / (cacheRead + cacheWrite + input) * 100`. A positive `cacheRead` is evidence of some reuse but is insufficient; the real TUI summary request must exceed 90%.

## Compatibility / failure behavior

- Remote compaction never uses the local cache-preserving callback.
- Multi-window local summaries retain structured provider-ready messages; only the first window is expected to share the live historical prefix. A single oversized message whose structured bytes must be clamped retains the existing flat safety fallback.
- A missing active model, mismatched candidate, or callback error must not route a fallback request through active-model context. Existing compaction error/fallback handling remains authoritative.
- Summary retries reuse the same already-built request context for the same candidate, but must preserve the normal cache retention option.

## Files expected to change

- `~/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction/compaction.ts`: callback type/propagation, structured request construction, remove forced none retention.
- `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-maintenance.ts`: expose full conversion to the host and bind callback only for the active candidate in manual/automatic fallback loops.
- `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/agent-session.ts`: wire the existing full session conversion method into the maintenance host.
- `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-advisors.ts`: bind advisor-owned candidate/context callback under the same strict gate.
- `patches/0013-omp-prefix-cache-preserving-compaction-core.patch`: regenerated source patch.
- `patches/0013-omp-prefix-cache-preserving-compaction-agent.patch`: regenerated source patch.
- `patches/PATCHES.md`: corrected evidence and cache policy.
- A focused verification script may be added under `patches/` only if existing tests have no suitable home.

No other provider implementation is expected to change.
