// One-off pin generator for verify-compaction-cache-liveness.ts (0086 round 3).
//
//   PROBE_ROOT=<NM of a tree> bun .trellis/tasks/09-30-omp-1844-compaction-cache/research/pin-request-fingerprints.ts
//
// Prints two digests over canonicalized (timestamps and cache markers dropped)
// fixture values:
//   instruction -- the summarize instruction text of a NON-live Anthropic
//                  request, i.e. the pre-0086 prompt text; pinned as
//                  PRE_0086_SUMMARY_INSTRUCTION_SHA256.
//   openai      -- the single flat request one non-Anthropic (openai-responses)
//                  compaction sends at the capacity/fold boundary; pinned as
//                  PRE_0086_NON_ANTHROPIC_REQUEST_SHA256.
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

let captured: Array<{ role: string; content: unknown }> | undefined;
async function run(model: unknown, targetMessages: unknown[], liveMessages: unknown[] | undefined) {
	const preparation = {
		firstKeptEntryId: "m0",
		messagesToSummarize: targetMessages,
		turnPrefixMessages: [],
		recentMessages: [],
		recentEntryIds: [],
		isSplitTurn: false,
		tokensBefore: 100_000,
		fileOps: { read: new Set(), edited: new Set(), written: new Set() },
		settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false },
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
			completeImpl: async (requestModel: unknown, context: { messages: unknown[] }) => {
				captured ??= context.messages as never;
				return {
					role: "assistant",
					content: [{ type: "text", text: "STUB_SUMMARY" }],
					api: (requestModel as { api: string }).api,
					provider: (requestModel as { provider: string }).provider,
					model: (requestModel as { id: string }).id,
					stopReason: "stop",
					timestamp: Date.now(),
					usage,
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
