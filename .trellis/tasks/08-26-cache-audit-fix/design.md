# Design: Cache Prefix Audit Google Wire Support & Session Isolation

## 1. Request Structure Normalization
The extension currently assumes OpenAI/Anthropic top-level schema (`target.messages`, `target.system`, `target.tools`).

Google Cloud Code Assist / Antigravity payloads wrap the request inside `target.request`:
```json
{
  "project": "...",
  "requestId": "agent/<agentId>/<ts>/<trajectoryId>/<step>",
  "request": {
    "contents": [
      { "role": "user", "parts": [{ "text": "..." }] },
      { "role": "model", "parts": [{ "text": "..." }] }
    ],
    "systemInstruction": { "role": "user", "parts": [{ "text": "..." }] },
    "tools": [{ "functionDeclarations": [...] }]
  },
  "model": "gemini-3.7-flash-high",
  "userAgent": "antigravity"
}
```

### Extraction Strategy
`extractPayloadSections(target: Record<string, unknown>)`:
1. **Messages**: `target.request?.contents ?? target.contents ?? target.messages`
2. **System**: `target.request?.systemInstruction ?? target.systemInstruction ?? target.system`
3. **Tools**: `target.request?.tools ?? target.tools`
4. **Model**: `target.model ?? target.requestModelId ?? "unknown"`
5. **Envelope**: Hash of top-level and request-level non-prefix properties (`project`, `requestId`, `labels`, `generationConfig`, etc.).

### Content Part Normalization
- Anthropic / OpenAI: `block.type === "text"` -> `block.text`; `block.type === "thinking"` -> `block.thinking`.
- Google: `parts[i].text` / `parts[i].functionCall` / `parts[i].functionResponse`.
- Handles `role: "model"` and `role: "user"` identically without role flipping.

## 2. Session-Scoped State Isolation

### Problem
Previously, a single global file `~/.omp/agent/cache-prefix-state.json` was shared by all running OMP processes. When 4 OMP instances ran simultaneously, each process overwrote the shared state with its own transcript, triggering continuous false `HISTORY_REWRITE` and `TOOLS_DRIFT` alerts.

### Design
- State file naming: `~/.omp/agent/cache-prefix-state-${safeSessionId || `pid-${process.pid}`}.json`.
- State resolution:
  - Extract session ID from `target.request?.sessionId`, `target.sessionId`, `options.sessionId`, or current active context.
  - Read and write exclusively to the session-specific state file.
- Header probe scoping:
  - Associate header observations with the active session ID, preventing cross-process fetch calls from triggering `HEADER_DRIFT`.

## 3. Backward Compatibility & Integrity
- Preserves position-independent `ttlSignature` breakpoint comparison.
- Preserves `contentForHash` (cache_control marker stripping).
- Log output format in `~/.omp/agent/cache-prefix-audit.log` remains standard JSONL with automatic 2 MiB rotation.
