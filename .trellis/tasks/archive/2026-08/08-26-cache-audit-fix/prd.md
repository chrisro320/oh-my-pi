# Fix cache-prefix-audit Google Wire Support and Session Isolation

## Goal
Fix `cache-prefix-audit-extension.ts` to eliminate false `MISS (prefix intact)` alerts on Google Antigravity / Gemini requests and prevent multi-process state collisions when multiple OMP instances run simultaneously.

## Background
1. **Google Wire Incompatibility**: `fingerprint()` only inspects `target.messages`. Google Antigravity requests structure the conversation inside `target.request.contents` (or `target.contents`), causing `fingerprint()` to return `undefined`. Any subsequent `message_end` fallback reports `MISS (prefix intact)` on every turn despite 98%+ server-side cache hit rate.
2. **Multi-process Collision**: State is currently persisted in a single shared file `~/.omp/agent/cache-prefix-state.json`. When multiple OMP instances (e.g. Gemini, Opus, GLM) run concurrently, they overwrite each other's state, leading to bogus `HISTORY_REWRITE`, `TOOLS_DRIFT`, and `HEADER_DRIFT` alerts.

## Requirements
1. **Wire Format Parsing**:
   - Extract messages from `target.request.contents ?? target.contents ?? target.messages`.
   - Extract system prompts from `target.request.systemInstruction ?? target.systemInstruction ?? target.system`.
   - Extract tools from `target.request.tools ?? target.tools`.
2. **Session-Scoped State Isolation**:
   - Store state per-session identifier (e.g. `~/.omp/agent/cache-prefix-state-<sessionId>.json`) or isolate by session/PID.
   - Maintain header audit scoped per session/host to avoid cross-process header overwrite.
3. **Verification**:
   - Create and run an automated test suite covering:
     - Google Antigravity payload fingerprinting and diffing (append-only turn).
     - Standard Anthropic/OpenAI payload fingerprinting and diffing.
     - Multi-process isolation preventing cross-session contamination.
4. **Mirror Sync**:
   - Keep `patches/cache-prefix-audit-extension.ts` and `~/.omp/agent/extensions/cache-prefix-audit.ts` 100% in sync.
   - Update `patches/PATCHES.md` with the updated behavior and notes.

## Acceptance Criteria
- [ ] `fingerprint()` extracts contents, systemInstruction, and tools from Google Antigravity payloads without returning `undefined`.
- [ ] Consecutive Antigravity append turns in `cache-prefix-audit.log` produce `diff.kind: "APPEND_ONLY"` and `verdict: "hit"`.
- [ ] Multi-process test demonstrates two distinct sessions reading/writing separate state files without collision.
- [ ] Test harness passes with 100% exit 0.
- [ ] Mirror in `~/.omp/agent/extensions/cache-prefix-audit.ts` matches `patches/cache-prefix-audit-extension.ts`.
