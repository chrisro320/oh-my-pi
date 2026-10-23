# WORK ORDER CONTEXT: cache-prefix-audit Devin adapter port (verbatim specs embedded per trellis handbook section 2)

## A. Nearest AGENTS.md (/home/chris/orca/projects/omp-move/AGENTS.md), original text

<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.
<!-- TRELLIS:END -->

## Trellis spec mechanism (mandatory when rotating between models)

- **A work order must embed the original text of two specs**: the nearest `AGENTS.md` for the target package + the relevant `.trellis/spec/` index.
- **Specs must be machine-checkable** (attach the grep command, run it before delivery and again at review time); relying on discipline alone always drifts.
- **Formatting fixes belong to the reviewer-of-record, not the auditor** — letting the auditing role edit code destroys independence.
- **Do not skip Phase 3.3 `trellis-update-spec`** (required): this batch's specs are written back so the next batch inherits them automatically.
- Deep usage (skills list / spec mechanism / migration criteria / review blind spots) → `/home/chris/orca/projects/trellis/shared/rules/trellis-handbook-omp.md`, **do not `@`-preload it**. Three moments where it must be read: ① before entering the planning phase of a new trellis task ② before handing work to another model ③ before closing out a batch.
- **Formal pause (mandatory)**: stopping mid-way through a trellis task **must use `/trellis:paused-work`** (commit + RESUME anchor + no archiving).


## B. Global AGENTS.md (~/.omp/agent/AGENTS.md), original text


# Avoid instruction-to-output leakage

- Distinguish instructions from deliverable content. Embody the requirements.
- do NOT update `AGENTS.md` on your own.

## Context budget

- Strictly prohibit blind full-file reads or batch file scanning: always prioritize using LSP/grep or sub-agents to precisely locate line number ranges.

## Collaboration & tone

- Stand by your ideas and dare to challenge users.
- Answers: **conclusion first**
- Forever minimal changes

## This machine's tooling

- sudo password: `8871353Aa.`
- Favor cost-effective delegation matched to agent strengths, supported by detailed, self-contained briefs and strong independent review. The main agent focuses on decisions, design, taste, and production operations, aligns scope and granularity with the user, and coordinates execution, review, and refinement through final acceptance, integration, and delivery. Keep its context focused and clean.


## C. Spec scenario (.trellis/spec/backend/extension-runtime-contracts.md lines 270-390), original text

## Scenario: Prompt cache prefix audit & cross-process miss attribution

### 1. Scope / Trigger

Apply this contract when developing or modifying prompt-cache diagnostic extensions,
payload interceptors, or cross-process session state monitors that observe
`before_provider_request` and `message_end` hooks.

The extension must remain strictly observational: never mutate outgoing payloads,
never throw into runtime hook lifecycles, normalize across heterogeneous provider
wire schemas (Anthropic/OpenAI top-level vs Google Antigravity/Gemini nested
`request.contents`), and isolate persisted comparison state per session to prevent
false drift alarms under concurrent multi-process execution.

### 2. Signatures

```ts
interface Fingerprint {
  at: string;
  pid: number;
  model: string;
  system: string[];
  tools: string;
  messages: string[];
  breakpoints: string[];
  envelope: string;
  sessionId: string;
  samples: string[];
  headers?: string;
}

type DiffKind =
  | "IDENTICAL"
  | "APPEND_ONLY"
  | "SYSTEM_DRIFT"
  | "TOOLS_DRIFT"
  | "HISTORY_REWRITE"
  | "TRUNCATED"
  | "ENVELOPE_DRIFT";

interface Diff {
  kind: DiffKind;
  index?: number;
  detail?: string;
  ttlShift?: string;
}
```

### 3. Contracts

- **Wire-Format Normalization**: `extractPayloadSections()` must support top-level
  Anthropic/OpenAI Chat (`messages`, `system`, `tools`), OpenAI Responses
  (`input`, `instructions`, `tools`), and nested Google formats
  (`request.contents`, `request.systemInstruction`, `request.tools`). It must
  never return `undefined` for a valid conversation payload.
- **Responses item identity**: role/content items hash normalized content.
  Role-less Responses items such as `function_call` and
  `function_call_output` hash the complete wire item except `cache_control` and
  use `type` as their label. Changing `arguments` or `output` at the same index
  must produce `HISTORY_REWRITE`; changing only the marker remains `IDENTICAL`.
- **Session Isolation**: State is persisted per session
  (`cache-prefix-state-<safeSessionId>.json`). Distinct session IDs must produce
  non-colliding file names by appending a short SHA hash suffix
  (`${clean}-${sha(sessionId).slice(0, 8)}`). Fallback when unresolvable is
  `pid-${process.pid}`, never a shared static key.
- **Schema Validation**: `loadState()` must validate the full structural schema
  (`isFingerprint()` with deep string array checks `isStringArray()`) before assigning
  restored state to prevent runtime exceptions in `diff()`.
- **Dynamic Tracking Exclusion**: Per-turn transport tracking fields (`requestId`,
  `sessionId`, `labels.last_step_index`, `labels.last_execution_id`) are excluded from
  `envelope` hashing. Conversation-level metadata (`labels.trajectory_id`,
  `labels.model_enum`, `labels.used_claude`, `generationConfig`) remains strictly
  tracked for drift.
- **Diagnostics & Rotation**: Diagnostics append to
  `~/.omp/agent/cache-prefix-audit.log` (JSONL, 2 MiB rotation).
  `OMP_CACHE_AUDIT_STATE_DIR` and `OMP_CACHE_AUDIT_LOG` overrides must be supported for
  test isolation.
- **Diagnostic Privacy**: Persist only message lengths and content hashes, never
  message/reasoning excerpts or signatures. Strip legacy sample prose on restore;
  diffs must also suppress legacy excerpts without hiding `HISTORY_REWRITE`.
- **Mirror Parity**: `patches/cache-prefix-audit-extension.ts` and
  `~/.omp/agent/extensions/cache-prefix-audit.ts` must maintain 100% byte parity.
- **Persistence Audit Presentation**: `context-persist-audit-extension.ts` is
  log-only by user decision (2026-10-12). Preserve divergence classification,
  side-request exclusion and the content-free rotating audit log; never mutate
  session history or notify the UI. Disabling its notification is not a drift fix.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Google Antigravity payload (`request.contents`) | Extracted without `undefined`; parts normalized |
| Anthropic/OpenAI payload (`messages`) | Extracted with blocks normalized |
| OpenAI Responses payload (`input`, `instructions`) | Map to messages/system; exclude both keys from envelope hashing |
| Role-less Responses call/output changes in place | Flag as `HISTORY_REWRITE`; never collapse to `?:sha(undefined)` |
| Non-conversation payload | Return `undefined` without error |
| Multiple OMP processes run concurrently | Isolated to separate state files; zero cross-session drift |
| Session ID contains slashes or special characters | Sanitized and hash-suffixed; no filesystem escape or collision |
| State file is corrupt, partial, or contains invalid element types | Ignored; re-seeded on the next request without throwing |
| `labels.last_step_index` increments | Diff remains `APPEND_ONLY` or `IDENTICAL` |
| `labels.trajectory_id` changes | Flagged as `ENVELOPE_DRIFT` |

### 5. Good / Base / Bad Cases

- **Good:** Consecutive Antigravity turns produce `APPEND_ONLY` and log `verdict: "hit"`.
- **Good:** Four OMP processes run concurrently without cross-process diff pollution.
- **Base:** A resumed session loads its previous process's state and compares across processes (`crossProcess = true`).
- **Bad:** Hardcoding `messages in target` causes all Google Antigravity requests to be ignored and misreported as `MISS (prefix intact)`.
- **Bad:** Hashing only `role` plus `content` maps role-less Responses tool
  items to the same fingerprint and hides argument/output rewrites.
- **Bad:** Completely omitting `labels` hides actual `trajectory_id` or model drift.

### 6. Tests Required

Run these assertion points for changes to this contract:

```sh
bun patches/verify-cache-prefix-audit.ts
cmp patches/cache-prefix-audit-extension.ts ~/.omp/agent/extensions/cache-prefix-audit.ts
```


## D. PATCHES.md audit bullets (lines 1267-1276), original text


- `patches/cache-prefix-audit-extension.ts` (deployment mirror: `~/.omp/agent/extensions/cache-prefix-audit.ts`): read-only request-prefix observations and measured cache usage; never mutates provider payloads.
  - Request fingerprints cover system blocks, tools and messages across Anthropic/OpenAI, Responses and nested Google wire formats. State is isolated by session; request baselines and the six-entry history window are isolated by wire model. Distinct requests are deduplicated by object identity, not millisecond timestamps.
  - Request rows retain `APPEND_ONLY`, `SYSTEM_DRIFT`, `TOOLS_DRIFT`, `HISTORY_REWRITE`, `TRUNCATED`, `ENVELOPE_DRIFT` and diagnostic-only `ttlShift`, with `correlation: "request-only"`. These observations do not establish the cause of a provider cache miss.
  - Completion rows contain measured `input`, `cacheRead`, `cacheWrite`, `cacheStatus` and `strictHitRate`. The strict hit threshold remains `cacheRead / (cacheRead + cacheWrite + input) >= 0.5`; zero total input usage is `unknown`.
  - `message_end` has no shared request ID. Its rows therefore use `correlation: "unavailable", cause: "unknown"` and never borrow a request diff, header fingerprint, response-header fingerprint or originating session ID. `observedSessionId` records the hook's current context only.
  - Historical behavior from August–September 2026 paired completion usage with the latest per-model diff and emitted `MISS CAUSED BY ...`. That causal contract is superseded: same-model main/title/keepalive requests can overlap, so a per-model slot is insufficient. Request-only per-model comparisons and `altBaseline.likelyVirtualTail` remain useful observations.
  - Verification: `bun patches/verify-cache-prefix-audit.ts` covers wire normalization, session/model isolation, cross-process baselines and populated same-model header overlap. The repaired handler passes; a disposable header-only borrowing mutation fails the forbidden-header assertion.
  - Log: `~/.omp/agent/cache-prefix-audit.log` (JSONL, 2 MiB rotation). State: `~/.omp/agent/cache-prefix-state-<sessionId>.json`. `/cacheaudit` displays the latest ten rows. Repository verification does not imply that the live extension mirror has been replaced.


## E. Devin adapter as it exists ONLY in the live mirror (~/.omp/agent/extensions/cache-prefix-audit.ts lines 833-930), original text. Port this, do not copy the causal usage pairing.

/** Devin Cascade wire shape: `{ prompt, chatMessagePrompts[], cascadeId, chatModelUid, tools[] }`.
 *  It has no `messages`/`contents`, so `extractPayloadSections` skipped every
 *  Devin request and its verdicts silently borrowed another lane's diff.
 *  Re-express it in the generic shape so it fingerprints like any other lane.
 *  `messageId` is part of each prompt's hashed content: Devin seeds it from
 *  cascadeId + index + role, so an id drift surfaces as HISTORY_REWRITE at the
 *  first renamed prompt, and a cascadeId change surfaces as ENVELOPE_DRIFT.
 *  `metadata` (credentials), `executionId` (random per request) and
 *  `modelAssignmentJwt` are never read. Only hashes are kept, never prose. */
interface DevinSnapshot {
	cascadeId: string;
	ids: string[];
	bodies: string[];
}

const devinLast = new Map<string, DevinSnapshot>();
/** Newest per-request Devin record per session+model lane, so the usage
 *  (verdict) row that arrives later carries the same identity data as the
 *  request row it answers. In-memory: it only needs to outlive one response. */
const devinRecordByModel = new Map<string, Record<string, unknown>>();

function bigintSafe(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value ?? null, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

function adaptDevinPayload(raw: unknown): { adapted: Record<string, unknown>; snapshot: DevinSnapshot } | undefined {
	if (!isRecord(raw) || !Array.isArray(raw.chatMessagePrompts) || typeof raw.cascadeId !== "string") return undefined;
	const ids: string[] = [];
	const bodies: string[] = [];
	const messages = raw.chatMessagePrompts.map((entry: unknown) => {
		const p = isRecord(entry) ? entry : {};
		const id = typeof p.messageId === "string" ? p.messageId : "";
		const body = {
			prompt: p.prompt,
			thinking: p.thinking,
			signature: sha(p.signature ?? ""),
			toolCallId: p.toolCallId,
			toolResultIsError: p.toolResultIsError,
			toolCalls: Array.isArray(p.toolCalls) ? p.toolCalls.map(call => bigintSafe(call)) : [],
			images: Array.isArray(p.images)
				? p.images.map(img => (isRecord(img) ? `${String(img.mimeType)}:${sha(img.base64Data)}` : "?"))
				: [],
		};
		ids.push(id);
		bodies.push(sha(body));
		return { role: `src${String(p.source)}`, content: [{ type: "devin-prompt", id, body }] };
	});
	// maxTokens shrinks with every request (window minus usage) without
	// touching the cache, so it would flag ENVELOPE_DRIFT on every turn.
	const { maxTokens: _maxTokens, ...configuration } = (bigintSafe(raw.configuration) ?? {}) as Record<string, unknown>;
	const adapted: Record<string, unknown> = {
		// chatModelUid carries the thinking-effort suffix (`gemini-4-argon-high`)
		// while the response's `message.model` does not; strip it so the usage
		// row pairs with this request's diff slot.
		model:
			typeof raw.chatModelUid === "string"
				? raw.chatModelUid.replace(/-(minimal|low|medium|high|xhigh|max)$/, "")
				: "unknown",
		system: raw.prompt,
		tools: raw.tools,
		messages,
		cascadeId: raw.cascadeId,
		requestType: raw.requestType,
		plannerMode: raw.plannerMode,
		toolChoice: bigintSafe(raw.toolChoice),
		systemPromptCacheOptions: bigintSafe(raw.systemPromptCacheOptions),
		disableParallelToolCalls: raw.disableParallelToolCalls,
		configuration,
	};
	return { adapted, snapshot: { cascadeId: raw.cascadeId, ids, bodies } };
}

/** First index inside the shared length where the two lists differ. A plain
 *  append is not drift, so only the overlapping range is compared. */
function firstDriftWithin(a: string[], b: string[]): number | undefined {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
	return undefined;
}

/** Per-request Devin identity record for the log, against the previous request
 *  of the same session and model lane. */
function devinDrift(key: string, now: DevinSnapshot, model: string): Record<string, unknown> {
	const slot = `${key}\0${model}`;
	const before = devinLast.get(slot);
	devinLast.set(slot, now);
	const record = {
		cascadeId: now.cascadeId,
		prompts: now.ids.length,
		idsSha: sha(now.ids),
		cascadeChanged: before ? before.cascadeId !== now.cascadeId : undefined,
		firstIdDrift: before ? firstDriftWithin(before.ids, now.ids) : undefined,
		firstBodyDrift: before ? firstDriftWithin(before.bodies, now.bodies) : undefined,
		prevPrompts: before?.ids.length,
	};
	devinRecordByModel.set(slot, record);
	return record;
}

## F. Live wiring lines to translate into request-only form (live mirror lines 945-948 and 1011-1013)

			if (rawPayload === null || typeof rawPayload !== "object") return undefined;
			const devin = adaptDevinPayload(rawPayload);
			const payload = devin?.adapted ?? (rawPayload as Record<string, unknown>);

					diff: d,
					devin: devin ? devinDrift(sessionKey, devin.snapshot, next.model) : undefined,
					// A rewrite against the predecessor that is a clean append
