// One-off pin generator for verify-compaction-cache-liveness.ts and
// verify-anthropic-native-compaction-live-context.ts (0086 rounds 3 and 4).
//
//   PROBE_ROOT=<NM of a tree> bun .trellis/tasks/09-30-omp-1844-compaction-cache/research/pin-request-fingerprints.ts
//
// Prints digests over canonicalized (timestamps and cache markers dropped)
// fixture values:
//   instruction      -- the summarize instruction text of a NON-live Anthropic
//                       request, i.e. the pre-0086 prompt text; pinned as
//                       PRE_0086_SUMMARY_INSTRUCTION_SHA256.
//   openai           -- the single flat request one non-Anthropic
//                       (openai-responses) compaction sends at the capacity/fold
//                       boundary; pinned as PRE_0086_NON_ANTHROPIC_REQUEST_SHA256.
//   live-instruction -- the local lane's whole-conversation instruction text for a
//                       request that carries the retained tail; pinned as
//                       LIVE_CHAIN_INSTRUCTION_SHA256. Taken from the reviewed
//                       request bytes, NOT rebuilt from the production note, so a
//                       boundary restriction appended to that note turns the gate
//                       red instead of moving both sides together.
//   native-instruction -- the native lane's rendered compaction instructions for
//                       the same whole-chain shape; pinned as
//                       NATIVE_LIVE_CHAIN_INSTRUCTION_SHA256. The live chain
//                       carries a provider-attested turn, so the lane is selected
//                       by the capacity ruler and not only by the fixture shape.
// Run it against the 0086-reversed tree (the "before" oracle), this layer's
// tree, and the round-2 0086 tree (the regression): before and after must be
// equal and the round-2 value must differ, which is Review3Core MAJOR 7.
// One-off before/after probe: capture the request bytes of two boundary
// fixtures from whichever tree PROBE_ROOT names, so the pinned fingerprints in
// the gate can be proven against the pre-0086 code path instead of trusted.
import { createHash } from "node:crypto";

const ROOT = process.env.PROBE_ROOT;
if (!ROOT) throw new Error("PROBE_ROOT is required");
const { getBundledModel } = await import(`${ROOT}/pi-catalog/src/models.ts`);
const { compact } = await import(`${ROOT}/pi-agent-core/src/compaction/compaction.ts`);
const { Tokenizer } = await import(`${ROOT}/pi-agent-core/src/tokenizer.ts`);

const anthropic = getBundledModel("anthropic", "claude-opus-5");
const openai = getBundledModel("openai", "gpt-5.6");
const SYSTEM = ["Stable project rules.", "Stable session context."];
const TOOLS = [{ name: "inspect", description: "Inspect a value", parameters: { type: "object", properties: {} } }];
const usage = {
	input: 0,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const capacityText = (repeats: number): string =>
	Array.from({ length: repeats }, (_, index) => `capacity-block-${index}`).join(" ");
const canonical = (value: unknown): string =>
	JSON.stringify(value, (key, entry) => (key === "timestamp" || key === "cache_control" ? undefined : entry));
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

/** The model identity the stub response must report, validated at this boundary. */
function requestIdentity(requestModel: unknown): { api: string; provider: string; id: string } {
	if (typeof requestModel !== "object" || requestModel === null) throw new Error("model missing");
	const { api, provider, id } = requestModel as { api?: unknown; provider?: unknown; id?: unknown };
	if (typeof api !== "string" || typeof provider !== "string" || typeof id !== "string") {
		throw new Error("model identity missing");
	}
	return { api, provider, id };
}

let captured: Array<{ role: string; content: unknown }> | undefined;
let capturedOptions: Record<string, unknown> | undefined;
async function run(
	model: unknown,
	targetMessages: unknown[],
	liveMessages: unknown[] | undefined,
	options?: { retainedTail?: unknown[]; remoteEnabled?: boolean },
) {
	const preparation = {
		firstKeptEntryId: "m0",
		messagesToSummarize: targetMessages,
		turnPrefixMessages: [],
		recentEntryIds: [],
		isSplitTurn: false,
		tokensBefore: 100_000,
		fileOps: { read: new Set(), edited: new Set(), written: new Set() },
		recentMessages: (options?.retainedTail ?? []) as never[],
		settings: {
			enabled: true,
			keepRecentTokens: 1,
			reserveTokens: 4096,
			remoteEnabled: options?.remoteEnabled === true,
		},
	};
	const result = await compact(
		preparation as never,
		model as never,
		"test" as never,
		undefined,
		undefined,
		{
			convertToLlm: (current: unknown) => current,
			remoteSystemPrompt: SYSTEM,
			tools: TOOLS as never,
			buildCachePreservingContext: async (scope: string) =>
				scope === "live" && liveMessages === undefined
					? undefined
					: { context: { systemPrompt: SYSTEM, messages: scope === "live" ? liveMessages : targetMessages, tools: TOOLS }, previousSummaryInPrefix: false },
			completeImpl: async (
				requestModel: unknown,
				context: { messages: unknown[] },
				requestOptions?: Record<string, unknown>,
			) => {
				capturedOptions = requestOptions;
				captured ??= context.messages as never;
				const identity = requestIdentity(requestModel);
				const base = {
					role: "assistant",
					content: [{ type: "text", text: "STUB_SUMMARY" }],
					api: identity.api,
					provider: identity.provider,
					model: identity.id,
					stopReason: "stop",
					timestamp: Date.now(),
					usage,
				};
				if (typeof requestOptions?.anthropicCompaction !== "object") return base;
				return {
					...base,
					content: [{ type: "text", text: "" }],
					stopDetails: { type: "compaction" },
					providerPayload: {
						type: "anthropicCompaction",
						provider: base.provider,
						content: "NATIVE_SUMMARY",
						encryptedContent: "opaque",
						signature: "offline-signed-summary",
					},
				};
			},
		},
	);
	return { captured: captured!, details: (result as { details?: unknown }).details };
}

// 1. The Anthropic non-live instruction: the pre-0086 summary prompt text.
captured = undefined;
const instructionRun = await run(
	anthropic,
	Array.from({ length: 4 }, (_, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: [{ type: "text", text: `fixture-message-${index}` }],
		timestamp: index + 1,
	})),
	undefined,
);
const instructions = (instructionRun.captured.at(-1)?.content ?? []) as Array<{ text?: string }>;
const instructionText = instructions.map(block => block.text ?? "").join("");
console.log("instruction", createHash("sha256").update(instructionText).digest("hex"), instructionText.length);

// 2. The non-Anthropic fold boundary: a single big message on a 64k window.
captured = undefined;
const legacyModel = { ...openai, contextWindow: 64_000 };
const legacyTokenizer = new Tokenizer(legacyModel);
const unitTokens = legacyTokenizer.countMessages([
	{ role: "user", content: [{ type: "text", text: capacityText(1_000) }] },
] as never);
const target = [
	{
		role: "user",
		content: [{ type: "text", text: capacityText(Math.ceil((46_000 * 1_000) / unitTokens)) }],
		attribution: "agent",
		timestamp: 1,
	},
];
const openaiRun = await run(legacyModel, target, target);
console.log(
	"openai",
	hash(openaiRun.captured),
	openaiRun.captured.length,
	JSON.stringify(openaiRun.captured).length,
	"api=" + openai.api,
);

// 3. The local lane's whole-conversation instruction, as the reviewed request
// sends it: a live chain the host vouches for, carrying a retained tail (which
// is what makes the request append the note) and a provider-attested turn (which
// is what lets the capacity ruler select the lane at all).
captured = undefined;
const attestedTurn = (tokens: number) => ({
	role: "assistant",
	content: [{ type: "text", text: "sized-response" }],
	api: anthropic.api,
	provider: anthropic.provider,
	model: anthropic.id,
	stopReason: "stop",
	usage: {
		input: 0,
		cacheRead: tokens,
		cacheWrite: 0,
		output: 1,
		totalTokens: tokens + 1,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	timestamp: 1,
});
// The retained tail ends in an assistant turn, as the main chain's own last
// request does: the cut then lands inside the tail, which is what makes the
// request a whole-conversation one carrying the note.
const liveFixture = [
	{ role: "user", content: [{ type: "text", text: "fixture-message-0" }], attribution: "agent", timestamp: 1 },
	attestedTurn(300),
	{ role: "user", content: [{ type: "text", text: "fixture-message-2" }], attribution: "agent", timestamp: 2 },
	attestedTurn(900),
];
const livePreparationMessages = [liveFixture[0], liveFixture[1]];
const liveRetainedTail = [liveFixture[2], liveFixture[3]];
const localRun = await run(anthropic, livePreparationMessages as never[], liveFixture, {
	retainedTail: liveRetainedTail,
});
const localInstruction = ((localRun.captured.at(-1)?.content ?? []) as Array<{ text?: string }>)
	.map(block => block.text ?? "")
	.join("");
console.log(
	"live-instruction",
	createHash("sha256").update(localInstruction).digest("hex"),
	localInstruction.length,
);

// 4. The native lane's rendered instructions for the same whole-chain shape.
captured = undefined;
const nativeRun = await run(anthropic, livePreparationMessages as never[], liveFixture, {
	retainedTail: liveRetainedTail,
	remoteEnabled: true,
});
const nativeCompactionOptions = capturedOptions?.anthropicCompaction;
const nativeInstructions =
	typeof nativeCompactionOptions === "object" &&
	nativeCompactionOptions !== null &&
	"instructions" in nativeCompactionOptions &&
	typeof nativeCompactionOptions.instructions === "string"
		? nativeCompactionOptions.instructions
		: "";
console.log(
	"native-instruction",
	createHash("sha256").update(nativeInstructions).digest("hex"),
	nativeInstructions.length,
);
