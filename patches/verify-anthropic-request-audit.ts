import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const root = mkdtempSync(join(tmpdir(), "omp-anthropic-audit-verify-"));
process.env.PI_CODING_AGENT_DIR = root;
delete process.env.PI_PROFILE;
delete process.env.OMP_PAYLOAD_ARCHIVE_OFF;
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const AGENT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const CORE = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
// Fail closed on a version the registry does not list; branch on the pi-ai
// tree's release (OMP_PATCH_VERSION, when set, must agree with it). Every
// supported release ships the session-level CacheWarmer (18.3.5 moved prompt-cache
// warming there), so the warm-replay section below always runs and fails closed
// if the warmer module is missing.
const plan = resolvePlan({ gate: "verify-anthropic-request-audit", roots: [AI] });
// Worker embeddings may preload pi-utils before this fixture sets its HOME;
// every registered plan ships the session-level CacheWarmer the fixture drives.
const { refreshDirsFromEnv } = await import(Bun.resolveSync("@oh-my-pi/pi-utils", AI));
refreshDirsFromEnv();
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
		onPayload(payload: any) {
			if (changed) payload.messages[0].content[0].text = "Changed input";
			if (compact) {
				payload.context_management = { edits: [{ type: "compact_20260112", pause_after_compaction: true, trigger: { type: "input_tokens", value: 100000 } }] };
				payload.messages.push({ role: "assistant", content: [{ type: "text", text: "Tail append" }] });
			}
		},
	}).result();
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.equal(wire.length, before + 1);
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
	{ // every supported release ships the session CacheWarmer, so this proof never skips
		const warmerModule = join(AGENT, "src/session/cache-warmer.ts");
		assert.ok(
			existsSync(warmerModule),
			`pi-ai ${plan.version} ships the session cache warmer; ${warmerModule} must exist`,
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
			decide: async () => "warm",
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
			// `change: () => PromptCacheChange | undefined` (the signature every
			// registered plan ships): a non-undefined change stops warming, so the
			// fixture returns undefined and keeps warming.
			() => undefined,
		);
		for (let i = 0; i < 600 && !warmOptions; i++) await Bun.sleep(10);
		assert.ok(warmOptions, "the real warmer must replay through its stream dependency");
		assert.equal(warmOptions.maxTokens, 1, "the warmer's only override is the one-token cap");
		assert.equal(warmOptions.sessionId, warmSession, "a warm replay keeps the live session identity");
		assert.equal(warmOptions.requestPurpose, "side", "the real warmer declares its replay side work, whatever options it was armed with");

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
	}
	// Request compression (gzip, bodies of 1 KiB or more to the official host) must not blind the audit: the archive
	// holds the uncompressed logical body, byte for byte what the compressor was given, while the wire stays compressed.
	const compressionSession = "audit-compression-session";
	const compressionDir = join(root, "payloads", compressionSession, "anthropic-wire");
	const sent: { body: Uint8Array; headers: Headers }[] = [];
	const compressedSink = async (input: unknown, init?: RequestInit) => {
		assert.ok(init?.body instanceof Uint8Array, "a body of 1 KiB or more to the official host leaves compressed");
		sent.push({ body: init.body, headers: new Headers(init.headers) });
		return sink(input, { ...init, body: gunzipSync(init.body).toString("utf8") });
	};
	const compressed = await streamAnthropic(model, { systemPrompt: "Stable rules ".repeat(400), messages: [{ role: "user", content: [{ type: "text", text: "large body" }], timestamp: 1 }] }, {
		apiKey: "sk-ant-oat01-offline-audit-fixture", sessionId: compressionSession, fetch: compressedSink as typeof fetch, maxTokens: 16, maxRetries: 0, cacheRetention: "long",
	}).result();
	assert.equal(compressed.stopReason, "stop", compressed.errorMessage);
	assert.equal(sent.length, 1, "one request reaches the transport");
	assert.equal(sent[0]!.headers.get("content-encoding"), "gzip", "the wire body stays compressed");
	const logical = gunzipSync(sent[0]!.body).toString("utf8");
	assert.ok(logical.length >= 1024, "the fixture body is large enough to compress");
	assert.ok(existsSync(compressionDir), "the audit must see the uncompressed body: a compressed request left no archive");
	const metaNames = readdirSync(compressionDir).filter(name => name.endsWith(".meta.json"));
	assert.equal(metaNames.length, 1, "the compressed request is archived, not lost to a parse failure");
	const archived = readFileSync(join(compressionDir, metaNames[0]!.replace(".meta.json", ".body.json")), "utf8");
	assert.equal(archived, logical, "the archive holds the uncompressed logical body exactly as it was compressed for the wire");
	const compressedMeta: { kind: string; wire: { bytes: number; logicalBytes: number; encoding: string; sends: number; truncated: boolean } } = JSON.parse(readFileSync(join(compressionDir, metaNames[0]!), "utf8"));
	assert.equal(compressedMeta.kind, "main", "a compressed primary request keeps its classification");
	assert.equal(readdirSync(compressionDir).filter(name => name.endsWith(".baseline.json")).length, 1, "a compressed primary request still advances the baseline");
	// meta.wire.bytes is what the transport was actually handed: the gzip byte array, not the JSON it came from.
	assert.equal(compressedMeta.wire.bytes, sent[0]!.body.byteLength, "meta.wire.bytes is the length of the real gzip byte array");
	assert.ok(compressedMeta.wire.bytes < Buffer.byteLength(logical), "the gzip body is smaller than the logical body, so the two lengths cannot be confused");
	assert.equal(compressedMeta.wire.logicalBytes, Buffer.byteLength(logical), "the logical (pre-compression) length is kept separately");
	assert.equal(compressedMeta.wire.encoding, "gzip", "the record names the encoding the bytes were sent in");
	assert.equal(compressedMeta.wire.sends, 1, "one send reached the transport");

	// Side work sharing the session id and model never replaces the baseline, whatever its transport: a compressed
	// `requestPurpose: "side"` request is side work, while an unmarked request is the session's own main turn.
	const readMetaKind = (file: string): string => {
		const meta: { kind: string } = JSON.parse(readFileSync(file, "utf8"));
		return meta.kind;
	};
	const readPointerFile = (file: string): string => {
		const pointer: { file: string } = JSON.parse(readFileSync(file, "utf8"));
		return pointer.file;
	};
	const pointerOf = () => readFileSync(join(compressionDir, readdirSync(compressionDir).find(name => name.endsWith(".baseline.json"))!), "utf8");
	const compressedKinds = () => readdirSync(compressionDir).filter(name => name.endsWith(".meta.json")).map(name => readMetaKind(join(compressionDir, name))).sort();
	const compressedBaseline = pointerOf();
	const sendSide = async (purpose: "side" | undefined) => {
		const beforeSent = sent.length;
		const result = await streamAnthropic(model, { systemPrompt: "Stable rules ".repeat(400), messages: [{ role: "user", content: [{ type: "text", text: `side work ${beforeSent}` }], timestamp: 1 }] }, {
			apiKey: "sk-ant-oat01-offline-audit-fixture", sessionId: compressionSession, fetch: compressedSink as typeof fetch, maxTokens: 16, maxRetries: 0, cacheRetention: "long",
			...(purpose ? { requestPurpose: purpose } : {}),
		}).result();
		assert.equal(result.stopReason, "stop", result.errorMessage);
		assert.equal(sent.length, beforeSent + 1, "the request reaches the transport once, compressed");
	};
	await sendSide("side");
	assert.deepEqual(compressedKinds(), ["main", "side"], "an explicit side request is archived as side work");
	assert.equal(pointerOf(), compressedBaseline, "a compressed same-session side request must not replace the main baseline");
	await sendSide(undefined);
	assert.deepEqual(compressedKinds(), ["main", "main", "side"], "an unmarked request is the session's own main turn");
	assert.notEqual(pointerOf(), compressedBaseline, "an unmarked compressed request advances the baseline");

	// `statefulResponses: false` only chooses the transport's threading: an unmarked request that sends in full is
	// still a main turn and owns the baseline, and the same option on an explicit side request is still side work.
	const statelessSession = "audit-stateless-main-session";
	const statelessDir = join(root, "payloads", statelessSession, "anthropic-wire");
	const sendStateless = async (text: string, purpose: "side" | undefined) => {
		const before = wire.length;
		const result = await streamAnthropic(model, { systemPrompt: "Stable rules", messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }] }, {
			apiKey: "sk-ant-oat01-offline-audit-fixture", sessionId: statelessSession, fetch: sink, maxTokens: 16, maxRetries: 0, cacheRetention: "long",
			statefulResponses: false, ...(purpose ? { requestPurpose: purpose } : {}),
		}).result();
		assert.equal(result.stopReason, "stop", result.errorMessage);
		assert.equal(wire.length, before + 1);
		const name = readdirSync(statelessDir).filter(file => file.endsWith(".meta.json")).find(file => readFileSync(join(statelessDir, file.replace(".meta.json", ".body.json")), "utf8") === wire[before]);
		assert.ok(name, "the stateless request is archived");
		return { kind: readMetaKind(join(statelessDir, name)), bodyFile: join(statelessDir, name.replace(".meta.json", ".body.json")) };
	};
	const baselineOf = () => readPointerFile(join(statelessDir, readdirSync(statelessDir).find(name => name.endsWith(".baseline.json"))!));
	const statelessFirst = await sendStateless("stateless one", undefined);
	assert.equal(statelessFirst.kind, "main", "a stateless main turn is archived as main");
	assert.equal(baselineOf(), statelessFirst.bodyFile, "a stateless main turn establishes the baseline");
	const statelessSecond = await sendStateless("stateless two", undefined);
	assert.equal(baselineOf(), statelessSecond.bodyFile, "a stateless main turn advances the baseline");
	assert.equal((await sendStateless("stateless side", "side")).kind, "side", "an explicit side request is side work even when it sends in full");
	assert.equal(baselineOf(), statelessSecond.bodyFile, "an explicit side request never replaces the baseline");
	// Producers, through their real entry points. An unmarked request is the session's own main turn (the pre-change
	// default); every same-session side producer declares itself side. A real standalone `pi-agent-core` Agent turn
	// through the built-in Anthropic provider establishes the baseline; local summaries, edit auto-repair, a memory job
	// and a cache-warmer replay, all on that session id and model, must each be archived as non-main work and leave the
	// baseline alone. Run over a loopback endpoint (plain body) and against the official host (gzip body).
	const { Agent } = await import(`${CORE}/src/agent.ts`);
	const { compact, prepareCompaction } = await import(`${CORE}/src/compaction/compaction.ts`);
	const { Settings: ProducerSettings } = await import(`${AGENT}/src/config/settings.ts`);
	const { attemptEditAutoRepair } = await import(`${AGENT}/src/edit/auto-repair.ts`);
	const { startMemoryStartupTask } = await import(`${AGENT}/src/memories/index.ts`);
	const { CacheWarmer: ProducerWarmer } = await import(`${AGENT}/src/session/cache-warmer.ts`);
	const { streamSimple } = await import(`${AI}/src/stream.ts`);
	const { chatTextBackend } = await import(`${AI}/src/judgment/chat.ts`);
	const producerKey = "sk-ant-oat01-offline-audit-fixture";
	const runProducerLineage = async (label: string, baseUrl: string | undefined) => {
		const compressed = baseUrl === undefined;
		const lineModel = { ...(model as Record<string, unknown>), ...(baseUrl ? { baseUrl } : {}) } as typeof model;
		const lineOrigin = new URL(lineModel.baseUrl).origin;
		const sessionId = `audit-producers-${label}`;
		const lineDir = join(root, "payloads", sessionId, "anthropic-wire");
		const records = () => existsSync(lineDir)
			? readdirSync(lineDir).filter(name => name.endsWith(".meta.json")).sort().map(name => {
				const meta: { kind: string; wire?: { encoding?: string } } = JSON.parse(readFileSync(join(lineDir, name), "utf8"));
				return { kind: meta.kind, encoding: meta.wire?.encoding };
			})
			: [];
		const pointer = () => {
			const name = existsSync(lineDir) ? readdirSync(lineDir).find(entry => entry.endsWith(".baseline.json")) : undefined;
			return name ? readFileSync(join(lineDir, name), "utf8") : undefined;
		};
		let transportFailure: unknown;
		const lineageFetch = (async (input: string | URL | Request, init?: RequestInit) => {
			try {
				const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
				assert.equal(url.origin, lineOrigin, `${label}: every request goes to the lineage endpoint`);
				if (!compressed) assert.ok(url.hostname === "127.0.0.1", `${label}: the loopback lineage stays on loopback`);
				const gzip = new Headers(init?.headers).get("content-encoding") === "gzip";
				assert.equal(gzip, compressed, `${label}: the body is ${compressed ? "gzip-compressed" : "sent plain"}`);
				const body = init?.body instanceof Uint8Array ? (gzip ? gunzipSync(init.body).toString("utf8") : new TextDecoder().decode(init.body)) : init?.body;
				return await sink(input, { ...init, body });
			} catch (error) {
				transportFailure = error;
				throw error;
			}
		}) as typeof fetch;
		globalThis.fetch = lineageFetch;
		// The official host is reached by the provider's own https transport, never the global fetch, so the producers
		// that expose a fetch seam (the Agent's stream function, summaries, the warmer's stream) receive the stub there.
		const seam = compressed ? { fetch: lineageFetch } : {};
		// One producer step: it must add records, all of `kind`, in the transport's encoding, and leave the baseline alone.
		const sideStep = async (what: string, kind: string, produce: () => Promise<unknown> | void, waitForSend = false) => {
			const recordsBefore = records().length;
			const wireBefore = wire.length;
			const baselineBefore = pointer();
			await produce();
			if (waitForSend) {
				for (let i = 0; i < 1000 && wire.length === wireBefore; i++) await Bun.sleep(10);
				await Bun.sleep(300);
			}
			const added = records().slice(recordsBefore);
			assert.ok(added.length > 0, `${label}: ${what} must reach the provider`);
			assert.deepEqual(added.map(record => record.kind), added.map(() => kind), `${label}: ${what} is archived as ${kind} work`);
			assert.ok(added.every(record => record.encoding === (compressed ? "gzip" : "identity")), `${label}: ${what} leaves the transport ${compressed ? "gzip-compressed" : "uncompressed"}`);
			assert.equal(pointer(), baselineBefore, `${label}: ${what} must not replace the main baseline`);
		};

		const agent = new Agent({
			initialState: { systemPrompt: ["Producer rules. ".repeat(120)], model: lineModel, tools: [] }, sessionId, getApiKey: () => producerKey,
			...(compressed ? { streamFn: (streamModel: never, streamContext: never, streamOptions: Record<string, unknown>) => streamSimple(streamModel, streamContext, { ...streamOptions, ...seam } as never) } : {}),
		});
		const mainTurn = async (text: string) => {
			await agent.prompt(text);
			await agent.waitForIdle();
			const last = agent.state.messages.at(-1) as { stopReason?: string; errorMessage?: string };
			assert.equal(last.stopReason, "stop", `${last.errorMessage} ${String(transportFailure)}`);
		};
		await mainTurn("main turn one");
		assert.deepEqual(records().map(record => record.kind), ["main"], `${label}: an unmarked standalone Agent turn is archived as main`);
		const baselineOne = pointer();
		assert.ok(baselineOne, `${label}: the standalone Agent turn establishes the baseline`);

		// Local compaction summaries (history summary + short summary).
		const entries = [
			{ type: "message", id: "e1", parentId: null, timestamp: 1, message: { role: "user", content: "first question", timestamp: 1 } },
			{ type: "message", id: "e2", parentId: "e1", timestamp: 2, message: { role: "assistant", content: [{ type: "text", text: "first answer" }], timestamp: 2, usage: { input: 5, output: 2 } } },
			{ type: "message", id: "e3", parentId: "e2", timestamp: 3, message: { role: "user", content: "second question", timestamp: 3 } },
			{ type: "message", id: "e4", parentId: "e3", timestamp: 4, message: { role: "user", content: "third question", timestamp: 4 } },
		];
		const prepared = prepareCompaction(entries as never, { enabled: true, keepRecentTokens: 1, remoteEnabled: false } as never, lineModel as never);
		assert.ok(prepared, "the fixture must prepare a compaction");
		await sideStep("a local summary", "side", () => compact(
			{ ...prepared, isSplitTurn: false, messagesToSummarize: [entries[0]!.message, entries[1]!.message], recentMessages: [entries[1]!.message, entries[2]!.message] } as never,
			lineModel as never, producerKey, undefined, undefined, { sessionId, ...seam } as never,
		));

		// Edit auto-repair and the memory job reach the provider only through its own transport (no fetch seam), so they
		// run over the loopback endpoint; the classification they declare is independent of the body's encoding.
		if (!compressed) {
			// Edit auto-repair: a committed edit that broke the parse, repaired by the smol role on this session id.
			const repairFile = join(root, `repair-${label}.js`);
			const before = Array.from({ length: 60 }, (_, i) => `const value${i} = ${i} + 1;`).join("\n") + "\n";
			const after = before.replace("const value30 = 30 + 1;", "const value30 = (30 + ;");
			assert.notEqual(after, before);
			writeFileSync(repairFile, after);
			const repairSettings = ProducerSettings.isolated({ "edit.autoRepair.enabled": true, "memory.backend": "off" });
			repairSettings.overrideModelRoles({ smol: `${lineModel.provider}/${lineModel.id}` });
			const registry = { getAvailable: () => [lineModel], getAll: () => [lineModel], getApiKey: async () => producerKey, resolver: () => producerKey };
			await sideStep("edit auto-repair", "side", () => attemptEditAutoRepair({
				session: { settings: repairSettings, modelRegistry: registry, getSessionId: () => sessionId } as never,
				snapshot: { path: repairFile, prev: before, next: after },
				writethrough: (async () => undefined) as never,
			}));

			// Memory job: stage-1 extraction of an older rollout, sharing this session's id.
			const memoryRoot = join(root, `memory-${label}`);
			const memorySessions = join(memoryRoot, "sessions");
			mkdirSync(memorySessions, { recursive: true });
			mkdirSync(join(memoryRoot, "agent"), { recursive: true });
			const rollout = join(memorySessions, "old-thread.jsonl");
			writeFileSync(rollout, [
				{ type: "session", id: "old-thread", cwd: memoryRoot },
				{ type: "message", message: { role: "user", content: "remember the deploy checklist", timestamp: 1 } },
				{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "noted" }], timestamp: 2 } },
			].map(row => JSON.stringify(row)).join("\n") + "\n");
			const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
			utimesSync(rollout, longAgo, longAgo);
			const memorySettings = ProducerSettings.isolated({ "memory.backend": "local" });
			memorySettings.overrideModelRoles({ default: `${lineModel.provider}/${lineModel.id}` });
			await sideStep("a memory job", "side", () => startMemoryStartupTask({
				session: {
					settings: memorySettings, model: lineModel, sessionId, isDisposed: false, agent: { metadataForProvider: () => undefined },
					sessionManager: { getSessionFile: () => join(memorySessions, "current.jsonl"), getSessionDir: () => memorySessions, getCwd: () => memoryRoot, getSessionId: () => sessionId },
				} as never,
				settings: memorySettings, modelRegistry: registry as never, agentDir: join(memoryRoot, "agent"), taskDepth: 0,
			}), true);

			// A chat-model judgment (smol/tiny judge) on the same session id and model.
			await sideStep("a same-session judgment", "side", () => chatTextBackend(lineModel, { apiKey: producerKey, sessionId }).complete({ system: "Judge rules. ".repeat(120), user: "state: ok" }, {}));
		}

		// Cache-warmer replay through the real `streamSimple`.
		let replay: Record<string, unknown> | undefined;
		const warmer = new ProducerWarmer({
			stream: (warmModel: never, warmContext: never, warmOptions: Record<string, unknown>) => { replay = warmOptions; return streamSimple(warmModel, warmContext, { ...warmOptions, ...seam } as never); },
			getPromptTokens: () => 100_000, getMode: () => "idle", decide: async () => "warm",
		} as never);
		try {
			await sideStep("a cache-warmer replay", "cache-refresh", () => {
				warmer.start({
					model: { ...(lineModel as Record<string, unknown>), promptCache: { short: 11, long: 11 } } as never,
					context: { systemPrompt: "Producer rules. ".repeat(120), messages: [{ role: "user", content: [{ type: "text", text: "main turn one" }], timestamp: 1 }] } as never,
					options: { apiKey: producerKey, sessionId, maxTokens: 16, maxRetries: 0, cacheRetention: "long" } as never,
				} as never, () => undefined);
			}, true);
		} finally {
			warmer.cancel();
		}
		assert.equal(replay?.requestPurpose, "side", `${label}: the warm replay declares itself side work`);

		// An unmarked turn after all that side work is still a main turn and advances the baseline.
		await mainTurn("main turn two");
		assert.equal(records().at(-1)?.kind, "main", `${label}: the next unmarked Agent turn is archived as main`);
		assert.notEqual(pointer(), baselineOne, `${label}: the next main turn advances the baseline`);
	};
	try {
		await runProducerLineage("loopback", "http://127.0.0.1:47836");
		await runProducerLineage("official", undefined);
	} finally {
		globalThis.fetch = sink as typeof fetch;
	}
	// Producers, through the real session: its own agent-loop turn carries no purpose (an unmarked request is main),
	// and the real side-channel path (an ephemeral turn on the same session) declares itself side. The mock provider
	// records the options each request reached the provider with.
	const { Settings } = await import(`${AGENT}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${AGENT}/src/config/model-registry.ts`);
	const { SessionManager } = await import(`${AGENT}/src/session/session-manager.ts`);
	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT}/src/sdk.ts`);
	const { createMockModel, registerMockApi } = await import(`${AI}/src/providers/mock.ts`);
	registerMockApi("audit-request-purpose");
	const purposeDir = join(root, "purpose-session");
	mkdirSync(purposeDir, { recursive: true });
	const authStorage = await discoverAuthStorage(join(purposeDir, "agent"));
	authStorage.keys.setRuntime("mock", "fixture");
	const mock = createMockModel({ id: "audit-request-purpose", handler: () => ({ content: ["ok"] }) });
	const modelRegistry = new ModelRegistry(authStorage);
	modelRegistry.find = (provider: string, id: string) => (provider === "mock" && id === mock.id ? mock : undefined);
	modelRegistry.getAvailable = () => [mock];
	modelRegistry.hasConfiguredAuth = () => true;
	const { session } = await createAgentSession({
		cwd: purposeDir, agentDir: join(purposeDir, "agent"), authStorage, modelRegistry, model: mock, systemPrompt: "PURPOSE",
		settings: Settings.isolated({ "memory.backend": "off", "computer.enabled": false }), sessionManager: SessionManager.inMemory(purposeDir),
		enableMCP: false, enableLsp: false, enableIrc: false, cacheWarming: false, autoTitle: false, disableExtensionDiscovery: true,
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
	});
	try {
		await session.prompt("main turn");
		await session.waitForIdle();
		assert.equal(mock.calls.length, 1, "the main turn reaches the provider once");
		assert.notEqual(mock.calls[0]!.options?.requestPurpose, "side", "the session's own agent-loop turn is not side work");
		await session.runEphemeralTurn({ promptText: "side question" });
		assert.equal(mock.calls.length, 2, "the ephemeral side turn reaches the provider once");
		assert.equal(mock.calls[1]!.options?.requestPurpose, "side", "a same-session side-channel turn declares itself side work");
	} finally {
		await session.dispose();
	}
	process.env.OMP_PAYLOAD_ARCHIVE_OFF = "1";
	assert.equal(createAnthropicRequestAudit({ sessionId: "disabled", provider: "anthropic", sideRequest: false, refresh: false }), undefined);
	console.log("PASS Anthropic final-wire audit: exact OAuth bytes, native prefix diff, side/session isolation, raw usage/request ID, real cache-warmer baseline isolation, I/O failure isolation, opt-out; zero network");
} finally {
	globalThis.fetch = originalFetch;
	rmSync(root, { recursive: true, force: true });
}
// The 0074 thread fixture (all eight legs, including these audit-history/
// hooks-vs-wire/record-safety/mutation/disabled legs) is selected on its own by
// the controller; running it here again was a second identical 935-line process
// per batch.
