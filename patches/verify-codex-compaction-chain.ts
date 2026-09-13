/**
 * verify-codex-compaction-chain.ts — Codex V2 remote compaction prefix-cache gate
 *
 * Locks the invariant that a Codex V2 remote compaction request reaches the
 * live turn's WebSocket append baseline instead of replaying the whole
 * transcript at 0% cache.
 *
 * Measured failure (2026-09-13, sessions 01a09b46 / 01a09b50, model
 * gpt-6-astra): every `type:"compaction"` entry recorded
 * `cachedInputTokens: 0` with `inputTokens ≈ 236k` while the same session's
 * live turns ran `input ≈ 0.8–2.1k / cacheRead ≈ 139k–390k`. Two independent
 * causes:
 *
 *   1. `:lite` transport split. The compaction paths passed
 *      `responsesLite: model.useResponsesLite` (true for every bundled
 *      openai-codex model) while live turns never opt in. Lite is
 *      connection-scoped and appends `:lite` to the WebSocket session key, so
 *      compaction dialled a second, empty socket with no append state.
 *   2. Rebuilt prefix vs injected context. Compaction rebuilds its input from
 *      the persisted transcript, which deliberately excludes per-turn injected
 *      context (session anchors, date/cwd stamps). A rebuilt prefix can never
 *      be byte-equal to what the live socket already sent, so
 *      `buildResponsesDeltaInput` returned null and the chain was reset.
 *
 * The consumer assertion is behavioural: `buildCodexChainedRequestBody` is
 * driven with a compaction-shaped body and must return the live baseline plus
 * a one-item trigger. The producer assertion (both compaction call sites pin
 * `responsesLite: false`) is text-level because the WebSocket session key is
 * not reachable without a live handshake; it names the observable it defends.
 *
 * Zero provider calls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;

// Runtime-selected specifier is required: the verify-gate contract forbids
// absolute-path imports, because a gate that reads `<ROOT>` text but imports
// from live silently validates the wrong tree under sandbox isolation.
// Fail closed: a module that cannot be imported must abort the gate.
const { buildCodexChainedRequestBody } = await import(`${AI_ROOT}/src/providers/openai-codex-responses.ts`);

type WsState = {
	disableWebsocket: boolean;
	canAppend: boolean;
	fallbackCount: number;
	prewarmed: boolean;
	stats: { fullContextRequests: number; deltaRequests: number; lastInputItems: number };
	lastRequest?: Record<string, unknown>;
	lastResponseId?: string;
	lastResponseItems?: Array<Record<string, unknown>>;
};

/** The live turn's recorded baseline: full-protocol shape, no lite rewrite. */
const LIVE_BASELINE = {
	model: "gpt-6-astra",
	store: false,
	stream: true,
	instructions: "live system prompt",
	tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
	include: ["reasoning.encrypted_content"],
	reasoning: { effort: "high", summary: "auto" },
	input: [
		{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
	],
};

function makeState(overrides: Partial<WsState> = {}): WsState {
	return {
		disableWebsocket: false,
		canAppend: true,
		fallbackCount: 0,
		prewarmed: false,
		stats: { fullContextRequests: 1, deltaRequests: 0, lastInputItems: 2 },
		lastRequest: structuredClone(LIVE_BASELINE),
		lastResponseId: "resp_live_1",
		lastResponseItems: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }],
		...overrides,
	};
}

// --- 1. Compaction body chains onto the live baseline, trigger-only delta ---
// The compaction body is REBUILT from disk (different instructions/tools and a
// different prefix), which is exactly why the strict delta check cannot apply.
const compactionBody = {
	model: "gpt-6-astra",
	store: false,
	stream: true,
	instructions: "summarization prompt (rebuilt)",
	tools: [],
	parallel_tool_calls: false,
	input: [
		{ type: "additional_tools", role: "developer", tools: [] },
		{ type: "message", role: "user", content: [{ type: "input_text", text: "test" }] },
		{ type: "compaction_trigger" },
	],
	client_metadata: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }) },
};

const chained = buildCodexChainedRequestBody(compactionBody, makeState() as never) as Record<string, unknown>;
assert.equal(chained.previous_response_id, "resp_live_1", "compaction must carry the live previous_response_id");
assert.deepEqual(
	chained.input,
	[{ type: "compaction_trigger" }],
	"compaction delta must be the trigger only; a full replay means the live prefix was not reused",
);
// Every top-level field the server caches must come from the live baseline, not
// from the disk-rebuilt body (a rebuilt prefix cannot hit the server-side cache).
for (const key of ["instructions", "tools", "include", "reasoning"]) {
	assert.deepEqual(chained[key], LIVE_BASELINE[key as keyof typeof LIVE_BASELINE], `${key} must be inherited from the live baseline`);
}
// The compaction identity rides on client_metadata, which the delta comparison
// excludes — so request_kind:"compaction" survives the baseline swap.
assert.equal(
	(chained.client_metadata as Record<string, string>)["x-codex-turn-metadata"],
	compactionBody.client_metadata["x-codex-turn-metadata"],
	"compaction request metadata must survive (otherwise the server sees a plain turn)",
);

// --- 2. Negative control: a non-compaction body must NOT take the baseline branch ---
// Without the trailing trigger this is an ordinary turn, so the strict check
// still governs it and a mismatching history must replay rather than chain.
const replay = buildCodexChainedRequestBody(
	{ ...compactionBody, input: compactionBody.input.slice(0, 2) },
	makeState() as never,
) as Record<string, unknown>;
assert.equal(replay.previous_response_id, undefined, "a non-compaction body must never adopt the baseline");

// A matching ordinary turn keeps the normal delta behaviour (no regression).
const ordinary = buildCodexChainedRequestBody(
	{
		model: "gpt-6-astra",
		store: false,
		stream: true,
		instructions: LIVE_BASELINE.instructions,
		tools: LIVE_BASELINE.tools,
		include: LIVE_BASELINE.include,
		reasoning: LIVE_BASELINE.reasoning,
		input: [
			...LIVE_BASELINE.input,
			...makeState().lastResponseItems!,
			{ type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
		],
	},
	makeState() as never,
) as Record<string, unknown>;
assert.equal(ordinary.previous_response_id, "resp_live_1", "ordinary turns must still chain on a matching prefix");
assert.equal((ordinary.input as unknown[]).length, 1, "ordinary turns must still send a delta, not the full input");

// --- 3. Cold start (no baseline) must fall back to a full replay, not crash ---
const cold = buildCodexChainedRequestBody(
	compactionBody,
	makeState({ canAppend: false, lastRequest: undefined, lastResponseId: undefined, lastResponseItems: undefined }) as never,
) as Record<string, unknown>;
assert.equal(cold.previous_response_id, undefined, "cold start has no baseline to chain onto");
assert.deepEqual(cold.input, compactionBody.input, "cold start must replay the rebuilt input unchanged");

// --- 4. Producer wiring: both Codex V2 compaction call sites pin lite off ---
// Observable defended: the WebSocket session key carries no `:lite` suffix, so
// compaction dials the same socket the live turn used.
const coreSrc = readFileSync(`${CORE_ROOT}/src/compaction/compaction.ts`, "utf8");
assert.match(
	coreSrc,
	/forceReasoningOff: summaryOptions\.thinkingLevel === ThinkingLevel\.Off,\s*\n\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*responsesLite: false,/,
	"compaction.ts codex V2 body must pin responsesLite:false (else the :lite session key splits the socket)",
);
assert.doesNotMatch(
	coreSrc,
	/buildTransformedCodexRequestBody\([\s\S]{0,600}?responsesLite: model\.useResponsesLite/,
	"compaction.ts must not key the codex compaction request onto the lite socket",
);
const v2Src = readFileSync(`${CORE_ROOT}/src/compaction/compaction-v2-streaming.ts`, "utf8");
assert.match(
	v2Src,
	/preferWebsockets: options\.preferWebsockets,\s*\n\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*responsesLite: false,/,
	"compaction-v2-streaming.ts must pin responsesLite:false on the codex provider transport",
);

console.log("verify-codex-compaction-chain: live baseline reuse + lite-off wiring hold");
