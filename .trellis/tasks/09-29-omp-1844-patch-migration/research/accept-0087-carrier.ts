// Offline real-data acceptance for 0087 (compaction attestation skips a host
// control-only carrier).
//
// No network, no real API calls: the summarize provider call is served by a
// local `completeImpl` stub and every request is captured in memory. The
// reconstruction is a copy of the 0086 diagnosis scripts
// (/tmp/diag0086/probe9.ts + probe11.ts, originals unmodified); the session
// copy, the archived Anthropic wire bodies and the archived usage records are
// read-only inputs. Nothing under ~/.omp is written.
//
// Run from the repository root with the sandbox roots exported:
//   OMP_PATCH_VERIFY_NM=$NM bun <this file>
//
// Data points:
//   (1) 13:12:42Z compaction (session 01a0f047, leaf 24f66c9a): the live chain's
//       last assistant is a host control-only carrier (empty content, zero usage,
//       stopReason "aborted"); the real attested turn is index 414 (usage
//       2/331125/523 = 331,650). The carrier is appended to the reconstructed
//       chain, which is exactly the shape the failing compaction saw.
//   (2) the same chain without the carrier (the persisted shape, control).
//   (3) the earlier data point (leaf 41b1a3c6, archived 07:15 request, attested
//       378,255 = 2/377769/484), whose last assistant carries real usage.
// Each data point is run on BOTH lanes: local (`remoteEnabled: false`) and
// native (`remoteEnabled: true`, the bundled model is native-compaction
// eligible); the trace's `lane` field proves which one answered.
import { readFileSync } from "node:fs";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${process.env.HOME}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT = `${NM}/pi-coding-agent`;
const CORE = `${NM}/pi-agent-core`;
const CATALOG = `${NM}/pi-catalog`;
const SESSION = process.env.OMP_0087_SESSION ?? "/tmp/diag0086/session.jsonl";
const TRACE = process.env.OMP_0087_TRACE ?? "/tmp/accept-0087-trace.log";
const PAYLOADS =
	process.env.OMP_0087_PAYLOADS ??
	"/home/chris/.omp/agent/payloads/01a0f047-74c9-7000-a824-4c2201617a31/anthropic-wire";
process.env.OMP_COMPACTION_TRACE = TRACE;
delete process.env.OMP_COMPACTION_TRACE_OFF;

// The four package roots are RUNTIME-selected from OMP_PATCH_VERIFY_NM (an
// isolated patched tree), so these must be dynamic imports: a static specifier
// would resolve against this repository instead of the tree under test.
const { buildSessionContext } = await import(`${AGENT}/src/session/session-context.ts`);
const { convertToLlm } = await import(`${AGENT}/src/session/messages.ts`);
const { prepareCompaction, compact, DEFAULT_COMPACTION_SETTINGS } = await import(
	`${CORE}/src/compaction/compaction.ts`
);
const { Tokenizer } = await import(`${CORE}/src/tokenizer.ts`);
const { getBundledModel } = await import(`${CATALOG}/src/models.ts`);

const entries = readFileSync(SESSION, "utf8")
	.split("\n")
	.filter(line => line.length > 0)
	.map(line => JSON.parse(line) as Record<string, unknown>);
const byId = new Map<string, Record<string, unknown>>(entries.map(entry => [entry.id as string, entry]));
function branch(leafId: string): Record<string, unknown>[] {
	const path: Record<string, unknown>[] = [];
	let current = byId.get(leafId);
	while (current) {
		path.push(current);
		const parent = current.parentId as string | null | undefined;
		current = parent ? byId.get(parent) : undefined;
	}
	return path.reverse();
}

function headerOf(file: string): { systemPrompt: string[]; tools: unknown[] } {
	const wire = JSON.parse(readFileSync(file, "utf8")) as {
		system: Array<{ text?: string }>;
		tools: Array<{ name: string; description?: string; input_schema?: unknown }>;
	};
	return {
		systemPrompt: wire.system.map(part => (typeof part.text === "string" ? part.text : JSON.stringify(part))),
		tools: wire.tools.map(tool => ({ name: tool.name, description: tool.description ?? "", parameters: tool.input_schema ?? {} })),
	};
}

const WIRE_1312 = `${PAYLOADS}/1790773962067-3464776-b2f8ab36-3429-4bc9-bae4-41938b903216-main.body.json`;
const WIRE_0715 = `${PAYLOADS}/1790752504870-2749314-60553d66-85e6-4fba-babd-c4ef05652289-main.body.json`;
const header1312 = headerOf(WIRE_1312);
const header0715 = headerOf(WIRE_0715);

const bundled = getBundledModel("anthropic", "claude-sonnet-5-5") as Record<string, unknown> | undefined;
if (!bundled) throw new Error("the selected catalog must contain claude-sonnet-5-5");
// The session ran on the 512k deployment window, not the catalog default.
const model = { ...bundled, contextWindow: 512000 } as never;
const tokenizer = new Tokenizer({ tokenizer: "claude-v5-sonnet" } as never);
const baseSettings = { ...DEFAULT_COMPACTION_SETTINGS } as Record<string, unknown>;
const zeroUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const prep1312 = prepareCompaction(branch("24f66c9a") as never, baseSettings as never, model, tokenizer);
const prep0715 = prepareCompaction(branch("41b1a3c6") as never, baseSettings as never, model, tokenizer);
if (!prep1312 || !prep0715) throw new Error("prepareCompaction returned nothing");
// The 07:15 preparation is a split turn, which 0086 refuses on its own named
// condition (`split-turn` / `native-split-turn`) independently of 0087. The
// same chain is therefore also driven as a whole turn, the shape the live lane
// accepts, so the attestation itself is what is measured.
const prep0715WholeTurn = { ...(prep0715 as Record<string, unknown>), isSplitTurn: false, turnPrefixMessages: [] };

const live1312 = convertToLlm(buildSessionContext(entries as never, "24f66c9a", byId as never).messages as never) as unknown as Array<
	Record<string, unknown>
>;
const live0715 = convertToLlm(buildSessionContext(entries as never, "41b1a3c6", byId as never).messages as never) as unknown as Array<
	Record<string, unknown>
>;

function promptTokens(usage: Record<string, number> | undefined): number {
	return (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
}
const attested1312 = promptTokens(live1312[414]?.usage as never);
const attested0715 = promptTokens(live0715[live0715.length - 1]?.usage as never);

const carrier = {
	role: "assistant",
	content: [],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-sonnet-5-5",
	usage: zeroUsage,
	stopReason: "aborted",
	errorMessage: "Request was aborted",
	timestamp: Date.now(),
	requestControls: live1312[414]?.requestControls ?? { messageIndex: 414 },
};

/** One compaction's verdict: the named fallbacks and the shipped request shapes. */
async function run(
	tag: string,
	prep: unknown,
	messages: unknown[],
	header: { systemPrompt: string[]; tools: unknown[] },
	remoteEnabled: boolean,
): Promise<{ tag: string; fallbacks: string[]; shapes: number[] }> {
	const fallbacks: string[] = [];
	const shapes: number[] = [];
	await compact(
		{ ...(prep as Record<string, unknown>), settings: { ...baseSettings, remoteEnabled } } as never,
		model,
		"stub-key",
		undefined,
		undefined,
		{
			convertToLlm: (list: never[]) => convertToLlm(list as never) as never,
			buildCachePreservingContext: async () => ({
				context: { systemPrompt: header.systemPrompt, tools: header.tools, messages } as never,
				previousSummaryInPrefix: true,
			}),
			onCacheFallback: (reason: string) => fallbacks.push(reason),
			completeImpl: async (_requestModel: never, context: never, options: never) => {
				shapes.push((context as { messages: unknown[] }).messages.length);
				if ((options as { anthropicCompaction?: unknown })?.anthropicCompaction) {
					return {
						role: "assistant",
						content: [{ type: "text", text: "" }],
						api: "anthropic-messages",
						provider: "anthropic",
						model: "claude-sonnet-5-5",
						usage: zeroUsage,
						stopReason: "stop",
						stopDetails: { type: "compaction" },
						providerPayload: {
							type: "anthropicCompaction",
							provider: "anthropic",
							content: "OFFLINE_ACCEPTANCE_SUMMARY",
							encryptedContent: "opaque",
							signature: "offline-signed-summary",
						},
						timestamp: Date.now(),
					} as never;
				}
				return {
					role: "assistant",
					content: [{ type: "text", text: "OFFLINE_ACCEPTANCE_SUMMARY" }],
					api: "anthropic-messages",
					provider: "anthropic",
					model: "claude-sonnet-5-5",
					usage: zeroUsage,
					stopReason: "stop",
					timestamp: Date.now(),
				} as never;
			},
		} as never,
	);
	return { tag, fallbacks, shapes };
}

const results = [
	await run("1312-with-carrier/local", prep1312, [...live1312, carrier], header1312, false),
	await run("1312-with-carrier/native", prep1312, [...live1312, carrier], header1312, true),
	await run("1312-without-carrier/local", prep1312, live1312, header1312, false),
	await run("0715-as-prepared-split/local", prep0715, live0715, header0715, false),
	await run("0715-whole-turn/local", prep0715WholeTurn, live0715, header0715, false),
	await run("0715-whole-turn/native", prep0715WholeTurn, live0715, header0715, true),
];

const traceRows = readFileSync(TRACE, "utf8")
	.split("\n")
	.filter(line => line.length > 0)
	.map(line => JSON.parse(line) as Record<string, unknown>)
	.filter(row => row.k === "summarize.request")
	.map(row => ({ lane: row.lane, messages: row.messages, live: row.usesLiveChainReplay, fallback: row.liveChainFallback }));

console.log(
	JSON.stringify(
		{
			chain: {
				live1312Messages: live1312.length,
				chainWithCarrier: live1312.length + 1,
				attested1312,
				live0715Messages: live0715.length,
				attested0715,
			},
			results,
			traceRows,
		},
		null,
		2,
	),
);
