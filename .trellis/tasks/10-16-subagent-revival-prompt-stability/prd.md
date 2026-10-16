# Subagent idle-park revival keeps the persisted system prompt

## Problem (evidence)
- `createWarmSubagentReviver` (src/task/executor.ts ~3770-3825) re-renders the subagent system prompt through `buildSubagentSessionOptions`, so the IRC peer roster (`collectIrcPeerRoster`, `ircParkedCount`, `ircOmittedCount`) and `workPoolYieldItems` drift. System block 3 changes, the whole prompt cache after it misses.
- 27/27 revivals in 5 days (openai-codex, cline-pass deepseek, anthropic): first post-revival request hit 2-9% vs 94-100% before; ~4.4M tokens re-billed; one case 251K cacheWrite ~ $1.0. A 23 s gap also missed, so it is not TTL. No mid-session drops without revival.
- `createPersistedSubagentReviverFactory` (src/task/persisted-revive.ts:234) already reuses `init.systemPrompt` verbatim.
- Full research: research/revival-prompt-research.md.

## Goal
Idle-park revival reuses the persisted `session_init.systemPrompt` bytes (research option A). No second `session_init` is appended when nothing but the roster changed. Peer routing (`agent://<id>`) is unaffected.

## Acceptance (machine-checkable)
- A real-SDK verifier (private HOME, MockModel, no network) parks and revives a subagent after the roster changed and asserts: system prompt bytes identical before/after, one `session_init`, first post-revival request prefix equal (no cache break at the system block); fails on the unpatched runtime.
- Representation oracle (26 families / 61 capabilities) passes; owner family chosen deliberately (executor.ts lives in family-compaction; family-persistent-prefix-resume is the thematic owner): decide and record in DECISIONS.md.
- No deployment.

## Out of scope
Deployment; changing roster content; the cache-prefix-audit extension misattribution (separate follow-up).

## Dependencies
Starts after task 10-16-compact-context-notes-mode finishes (same patch family regeneration).
