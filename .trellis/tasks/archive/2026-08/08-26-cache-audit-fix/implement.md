# Implementation Plan: Cache Prefix Audit Fix

## Phase 1: Update Extension Core (`patches/cache-prefix-audit-extension.ts`)
1. Implement `extractPayloadSections(target: object)`:
   - Handle Google wire payload: `target.request.contents`, `target.request.systemInstruction`, `target.request.tools`, `target.model`, `target.request.sessionId`.
   - Handle OpenAI/Anthropic wire payload: `target.messages`, `target.system`, `target.tools`, `target.model`.
2. Refactor `fingerprint(target: object, sessionIdOverride?: string)`:
   - Normalize message/content block extraction (`parts` with `text`, `functionCall`, `functionResponse`, `thought`).
   - Extract `systemInstruction` parts or `system` array.
   - Calculate envelope hashes across both top-level and request-level configurations.
3. Refactor state persistence:
   - Resolve session ID from `sessionIdOverride`, `target.request?.sessionId`, `target.sessionId`, or `options.sessionId`.
   - State path format: `~/.omp/agent/cache-prefix-state-${safeSessionId}.json`.
   - Save and read state strictly scoped to that session ID.
4. Refactor header probe:
   - Map header state per `host:sessionId` to prevent cross-process header race conditions.

## Phase 2: Create Comprehensive Test Suite (`patches/verify-cache-prefix-audit.ts`)
1. Test case 1: **Google Antigravity Payload Fingerprinting**:
   - Construct consecutive Antigravity payloads (`contents` + `systemInstruction` + `tools` inside `request`).
   - Verify `fingerprint()` returns valid Fingerprint (non-undefined).
   - Verify diff between Turn 1 and Turn 2 is `APPEND_ONLY` with exact index.
2. Test case 2: **Standard Anthropic/OpenAI Payload**:
   - Verify existing Anthropic `messages` / `system` format continues to work with 100% accuracy.
3. Test case 3: **Multi-Process Session Isolation**:
   - Simulate two distinct sessions (`session-gemini` and `session-opus`) running interleaved turns.
   - Verify neither session causes `HISTORY_REWRITE` or state overwrite in the other.
4. Test case 4: **TTL / Breakpoint and Envelope Drift Detection**:
   - Verify deliberate header or envelope mutations are correctly categorized.

## Phase 3: Execute Verification and Mirror Sync
1. Run test suite: `bun patches/verify-cache-prefix-audit.ts`.
2. Copy `patches/cache-prefix-audit-extension.ts` -> `~/.omp/agent/extensions/cache-prefix-audit.ts`.
3. Update `patches/PATCHES.md` documentation.
