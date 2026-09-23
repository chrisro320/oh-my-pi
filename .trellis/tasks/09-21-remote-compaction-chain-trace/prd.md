# Recoverable remote compaction

## Approved requirements
User approved the four-point implementation summary with “做”. Earlier read-only investigation restrictions apply to investigation, not this approved implementation.
1. A transient WS failure must not permanently disable this session's WebSocket transport.
2. Remote compaction reconnects and rebuilds a missing chain automatically, without a user turn or process restart.
3. Rebuilding uses the ordinary live cache-preserving context. The compaction frame itself carries only pending tool results and the trigger, never full history.
4. A failed recovery can fail this attempt, but must not prevent a later recovery.

## Approved soft fallback addition
User approved “可以补上，最小修改”: exhaust the bounded remote recovery attempts before falling back to the existing soft method. Cancellation must stop without fallback, permanent errors must not consume transient retries, and fallback must not change future method preferences. Reuse the configured remote → soft ladder and the explicit `/compact remote` mode's existing remote → soft order; do not change global settings or other methods.
Follow-up user clarification: remote compaction must remain robust; soft is an extreme-condition last resort. Do not shorten the existing automatic remote retry/model ladder merely because soft is available.

## Boundaries
Inline implementation; no subagents. Update existing repository patches, not cumulative repair layers. No agent.db/auth writes, external provider probes, timeout tuning, or unrelated worktree changes. User subsequently authorized direct live installation deployment with “直接部署”; only affected package files and matching runtime patch artifacts are in scope.

## Acceptance
- Observe successful reconnect + non-generating warmup + chained compaction on the same replacement socket after loss of the original socket.
- Observe a failed warmup followed by a later successful recovery in the same session.
- Observe a normal turn recover WS after a transport failure that used SSE fallback.
- Healthy compaction remains incremental with no warmup; compaction never silently falls back to SSE/full-history input.
- Warmup preserves the provided live request prefix; contains no compaction trigger and cannot execute/generate tools or text.
- Missing/failed/incomplete warmup response, socket replacement, and cancellation cannot publish a valid baseline.
- Existing accepted-summary metadata commit and unrelated session isolation remain intact.

## Evidence and compatibility
Official Responses WS documentation supports `response.create` with `generate:false`, returning an ID usable by `previous_response_id`: https://developers.openai.com/api/docs/guides/websocket-mode . Local protocol smoke does not claim live Codex endpoint acceptance.
The installed provider initially contained emergency-repair residue and was not a pristine source. Deployment replaced affected files from independently SHA-256-verified official tarballs plus the repository patch chain. Existing 18.1.18 rollback baseline stays frozen; target active 18.2.3 candidate and corresponding shared verifier.
