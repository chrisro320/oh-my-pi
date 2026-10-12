import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "omp-anthropic-audit-verify-"));
process.env.PI_CODING_AGENT_DIR = root;
delete process.env.PI_PROFILE;
delete process.env.OMP_PAYLOAD_ARCHIVE_OFF;
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const AGENT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
// 18.3.5 moved prompt-cache warming out of the provider stream options into
// pi-coding-agent's session-level CacheWarmer, so only trees at or above that
// version can produce a warm replay. The branch keys on the selected pi-ai
// version and then requires the warmer module, so a 18.4.x tree that lost it
// fails closed instead of silently skipping the case.
const aiPackage: unknown = JSON.parse(readFileSync(join(AI, "package.json"), "utf8"));
const aiVersion =
	aiPackage && typeof aiPackage === "object" && "version" in aiPackage && typeof aiPackage.version === "string"
		? aiPackage.version
		: "";
const [aiMajor, aiMinor, aiPatch] = aiVersion.split(".").map(Number);
const hasSessionCacheWarmer =
	aiMajor > 18 || (aiMajor === 18 && (aiMinor > 3 || (aiMinor === 3 && aiPatch >= 5)));
const { streamAnthropic } = await import(`${AI}/src/providers/anthropic.ts`);
const { createAnthropicRequestAudit } = await import(`${AI}/src/providers/anthropic-request-audit.ts`);
const { getBundledModel } = await import(`${CATALOG}/src/models.ts`);
const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model);
const wire: string[] = [];
const usage = { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 19, cache_creation_input_tokens: 23, iterations: [{ type: "compaction", input_tokens: 7, output_tokens: 3 }] };
const sink = async (_input: unknown, init?: RequestInit) => {
	assert.ok(typeof init?.body === "string" || init?.body instanceof Uint8Array);
	wire.push(typeof init!.body === "string" ? init!.body : new TextDecoder().decode(init!.body as Uint8Array));
	const events = [
		{ type: "message_start", message: { id: "msg_offline", type: "message", role: "assistant", model: model.id, content: [], usage } },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
		{ type: "message_stop" },
	];
	return new Response(events.map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "request-id": "req_offline" } });
};
const originalFetch = globalThis.fetch;
// Fail closed: any missed injection still lands in this offline sink.
globalThis.fetch = sink as typeof fetch;
const dir = join(root, "payloads", "audit-session", "anthropic-wire");
const metas = () => readdirSync(dir).filter(name => name.endsWith(".meta.json")).map(name => ({ name, data: JSON.parse(readFileSync(join(dir, name), "utf8")) }));
const baselinePointer = () => {
	const names = readdirSync(dir).filter(name => name.endsWith(".baseline.json"));
	assert.equal(names.length, 1, "one ordinary lineage must own one baseline");
	return readFileSync(join(dir, names[0]), "utf8");
};
async function send(compact = false, changed = false, side = false) {
	const before = wire.length;
	const result = await streamAnthropic(model, { systemPrompt: "Stable rules", messages: [{ role: "user", content: [{ type: "text", text: "Stable input" }], timestamp: 1 }] }, {
		apiKey: "sk-ant-oat01-offline-audit-fixture", sessionId: "audit-session", fetch: sink,
		maxTokens: 16, maxRetries: 0, cacheRetention: "long", initiatorOverride: side ? "agent" : undefined,
		...(compact && ["18.10.0", "18.10.1"].includes(aiVersion) ? { anthropicCompaction: { instructions: "Summarize this fixture." } } : {}),
		onPayload(payload: any) {
			if (changed) payload.messages[0].content[0].text = "Changed input";
			if (compact) {
				if (!["18.10.0", "18.10.1"].includes(aiVersion)) {
					payload.context_management = { edits: [{ type: "compact_20260112", pause_after_compaction: true, trigger: { type: "input_tokens", value: 100000 } }] };
				}
				payload.messages.push({ role: "assistant", content: [{ type: "text", text: "Tail append" }] });
			}
		},
	}).result();
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.equal(wire.length, before + 1);
	if (compact && ["18.10.0", "18.10.1"].includes(aiVersion)) {
		assert.equal(JSON.parse(wire[before]).compaction?.type, "summarize", "the actual provider builder must emit the native envelope");
	}
	const entry = metas().find(entry => readFileSync(join(dir, entry.name.replace(".meta.json", ".body.json")), "utf8") === wire[before]);
	assert.ok(entry, "archive must match actual final fetch bytes, including OAuth cch and onPayload changes");
	const events = readFileSync(join(dir, entry.name.replace(".meta.json", ".usage.jsonl")), "utf8").trim().split("\n").map(line => JSON.parse(line));
	assert.ok(events.some(event => event.requestId === "req_offline"));
	assert.ok(events.some(event => JSON.stringify(event.usage) === JSON.stringify(usage)), "raw usage including iterations must survive");
	assert.ok(events.every(event => event.id === entry.data.id));
	assert.ok(!JSON.stringify(entry.data).includes("offline-audit-fixture"), "headers must not archive credentials");
	return entry.data;
}
try {
	await send();
	const ordinaryBaseline = baselinePointer();
	await send(false, true, true); // Side traffic must not replace the primary baseline.
	assert.equal(baselinePointer(), ordinaryBaseline, "side traffic must not advance the ordinary baseline");
	const equal = await send(true);
	assert.equal(equal.kind, "native-compaction");
	assert.equal(equal.comparison.status, "prefix-equal");
	assert.equal(baselinePointer(), ordinaryBaseline, "native compaction must not advance the ordinary baseline");
	const different = await send(true, true);
	assert.equal(different.kind, "native-compaction");
	assert.equal(different.comparison.status, "prefix-different");
	assert.equal(different.comparison.firstDifference, "messages[0].content[0].text");
	assert.notEqual(equal.id, different.id);
	assert.equal(baselinePointer(), ordinaryBaseline, "a changed native prefix must not replace the ordinary baseline");
	// Exercise failure isolation and session isolation without provider traffic.
	const other = createAnthropicRequestAudit({ sessionId: "other", provider: "anthropic", sideRequest: true, refresh: false });
	await other.wrapFetch(sink)("https://example.invalid/v1/messages", { body: wire[2], method: "POST" });
	const otherDir = join(root, "payloads", "other", "anthropic-wire");
	const otherMeta = JSON.parse(readFileSync(join(otherDir, readdirSync(otherDir).find(name => name.endsWith(".meta.json"))!), "utf8"));
	assert.equal(otherMeta.comparison.status, "no-baseline");
	writeFileSync(join(root, "payloads", "blocked"), "not a directory");
	const broken = createAnthropicRequestAudit({ sessionId: "blocked", provider: "anthropic", sideRequest: false, refresh: false });
	const before = wire.length;
	assert.equal((await broken.wrapFetch(sink)("https://example.invalid/v1/messages", { body: wire[0], method: "POST" })).status, 200);
	assert.equal(wire.length, before + 1, "archive failure must not skip or duplicate transport");
	const originalError = new Error("offline transport failure");
	await assert.rejects(broken.wrapFetch(async () => { throw originalError; })("https://example.invalid/v1/messages", { body: wire[0] }), error => error === originalError);
	// --- A real cache-warmer replay must not replace the main baseline ----------
	// pi-ai 18.3.5 removed StreamOptions.anthropicCacheRefreshRequest, so the audit
	// can no longer read a refresh marker off the stream options. The replacement
	// session warmer replays through this same provider entry point with the armed
	// request's own options and exactly one override -- `maxTokens: 1` -- so that cap
	// is the only signal pi-ai receives (cache-warmer.ts:476-486). Drive the real
	// warmer, capture the options object it hands its stream dependency, and send
	// exactly that object through streamAnthropic. A genuine one-token turn is
	// indistinguishable and is classified as a refresh, which is the safe direction:
	// a refresh can only fail to advance the baseline, never corrupt it.
	if (hasSessionCacheWarmer) {
		const warmerModule = join(AGENT, "src/session/cache-warmer.ts");
		assert.ok(
			existsSync(warmerModule),
			`pi-ai ${aiVersion} ships the session cache warmer; ${warmerModule} must exist`,
		);
		const warmSession = "warm-session";
		const warmDir = join(root, "payloads", warmSession, "anthropic-wire");
		const warmEntries = () =>
			readdirSync(warmDir)
				.filter(name => name.endsWith(".meta.json"))
				.map(name => ({
					name,
					bodyFile: join(warmDir, name.replace(".meta.json", ".body.json")),
					kind: (JSON.parse(readFileSync(join(warmDir, name), "utf8")) as { kind: string }).kind,
				}));
		const entryFor = (body: string) => warmEntries().find(entry => readFileSync(entry.bodyFile, "utf8") === body);
		const baselineFile = () => {
			const name = readdirSync(warmDir).find(entry => entry.endsWith(".baseline.json"));
			assert.ok(name, "a main request must have written a baseline pointer");
			return (JSON.parse(readFileSync(join(warmDir, name), "utf8")) as { file: string }).file;
		};
		const sendMain = async (text: string) => {
			const before = wire.length;
			const result = await streamAnthropic(
				model,
				{ systemPrompt: "Stable rules", messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }] },
				{
					apiKey: "sk-ant-oat01-offline-audit-fixture",
					sessionId: warmSession,
					fetch: sink,
					maxTokens: 16,
					maxRetries: 0,
					cacheRetention: "long",
				},
			).result();
			assert.equal(result.stopReason, "stop", result.errorMessage);
			assert.equal(wire.length, before + 1);
			const entry = entryFor(wire[before]);
			assert.ok(entry, "a main request must be archived");
			return entry;
		};

		const firstMain = await sendMain("baseline one");
		assert.equal(firstMain.kind, "main");
		assert.equal(baselineFile(), firstMain.bodyFile, "the main request must own the baseline");

		const { CacheWarmer } = await import(warmerModule);
		let warmOptions: Record<string, unknown> | undefined;
		const warmer = new CacheWarmer({
			// Hold the replay open so the warmer's abort controller is still live when
			// the captured options are fed back to the provider, exactly as a real
			// refresh would see them.
			stream: (_m: unknown, _c: unknown, options: Record<string, unknown>) => {
				warmOptions = options;
				return {
					[Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => {}) }),
					result: () => new Promise<never>(() => {}),
				} as never;
			},
			getPromptTokens: () => 100_000,
			getMode: () => "idle",
			decide: async () => ["18.7.0", "18.10.0", "18.10.1"].includes(aiVersion) ? "warm" : true,
		} as never);
		warmer.start(
			{
				// The bundled model's real cache lifetimes are minutes long; an 11s entry
				// makes the 90% schedule fire a one-second timer so the gate stays fast.
				model: { ...(model as unknown as Record<string, unknown>), promptCache: { short: 11, long: 11 } } as never,
				context: {
					systemPrompt: "Stable rules",
					messages: [{ role: "user", content: [{ type: "text", text: "baseline one" }], timestamp: 1 }],
				} as never,
				options: {
					apiKey: "sk-ant-oat01-offline-audit-fixture",
					sessionId: warmSession,
					fetch: sink,
					maxTokens: 16,
					maxRetries: 0,
					cacheRetention: "long",
				} as never,
			} as never,
			() => true,
		);
		for (let i = 0; i < 600 && !warmOptions; i++) await Bun.sleep(10);
		assert.ok(warmOptions, "the real warmer must replay through its stream dependency");
		assert.equal(warmOptions.maxTokens, 1, "the warmer's only override is the one-token cap");
		assert.equal(warmOptions.sessionId, warmSession, "a warm replay keeps the live session identity");

		const beforeWarm = wire.length;
		const warmResult = await streamAnthropic(
			model,
			{
				systemPrompt: "Stable rules",
				messages: [{ role: "user", content: [{ type: "text", text: "baseline one" }], timestamp: 1 }],
			},
			{ ...warmOptions, fetch: sink },
		).result();
		assert.equal(warmResult.stopReason, "stop", warmResult.errorMessage);
		assert.equal(wire.length, beforeWarm + 1);
		const warmEntry = entryFor(wire[beforeWarm]);
		assert.ok(warmEntry, "the warm replay must be archived");
		assert.equal(
			warmEntry.kind,
			"cache-refresh",
			"the real warmer's one-token replay must be classified as a cache refresh",
		);
		assert.equal(baselineFile(), firstMain.bodyFile, "a cache refresh must not replace the last-main baseline");
		warmer.cancel();

		const secondMain = await sendMain("baseline two");
		assert.equal(
			baselineFile(),
			secondMain.bodyFile,
			"an ordinary main request must still replace the baseline",
		);
	} else {
		console.log(
			`pi-ai ${aiVersion} predates the session cache warmer: legacy stream-level refresh classification unchanged`,
		);
	}
	process.env.OMP_PAYLOAD_ARCHIVE_OFF = "1";
	assert.equal(createAnthropicRequestAudit({ sessionId: "disabled", provider: "anthropic", sideRequest: false, refresh: false }), undefined);
	console.log("PASS Anthropic final-wire audit: exact OAuth bytes, native prefix diff, side/session isolation, raw usage/request ID, real cache-warmer baseline isolation, I/O failure isolation, opt-out; zero network");
} finally {
	globalThis.fetch = originalFetch;
	rmSync(root, { recursive: true, force: true });
}
