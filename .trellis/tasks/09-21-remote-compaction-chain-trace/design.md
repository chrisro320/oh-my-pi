# Recovery design

Use the existing WebSocket opening path and state rather than a new retry service. Remove the permanent disableWebsocket latch while retaining bounded per-attempt fallback accounting and explicit user/model WS preferences.

After getOrCreate settles a connection, if a compaction request lacks a usable append baseline, send a non-generating response.create warmup containing the cache-preserving request body without the final compaction trigger or previous_response_id. Drain it on that exact socket. Only a successful completed response with a nonempty ID and no model output establishes the baseline. Then build the ordinary incremental compaction frame using that ID. Do not copy generate:false into the stored baseline or compaction request. On cancellation/failure leave no append baseline; subsequent calls may reconnect/retry using existing bounds.

Core supplies a lazy prepareCompactionRecovery callback that serializes the entire liveV2.context only when a baseline is missing. Recovery messages are separate from request.input, which still owns persisted replacement history. This preserves the live prefix without persisting ephemeral context or generating an extra conversational response.

Do not weaken chain-only compaction guards. Warmup is a distinct non-generating state restoration request, not a full-history compaction fallback. Preserve summary validation before metadata commit and baseline invalidation. Existing normal-turn recovery remains independent.

Files: active 18.2.3 0070 candidate (provider + core behavior); existing chain verifier and fault gate where contract changes; PATCHES ledger and backend spec. Frozen 18.1.18 rollback patch is intentionally unchanged.

## Soft fallback addition
Reuse the already configured remote → soft ladder and `/compact remote` override. Each V2 operation retains its initial + two retries; mark only recoverable baseline failures retryable. Exhausted Codex errors leave core without attempting V1, preserving their recoverability for the host's existing automatic retry/model budget. Only after that budget and applicable candidates fail does the method ladder reach soft. Remove the manual terminal interception. Keep method commit ownership and cancellation guards, including cancellation during the awaited automatic fallback event. No new settings, timeout policy, retry service, or provider downgrade.
