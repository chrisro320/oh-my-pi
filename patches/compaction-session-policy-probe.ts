// Invoked by the target-key gate before it installs its compact() recorder.
// Real SDK/session entry points; loopback WebSocket and an exact synthetic HTTP
// endpoint are the only transports. Child-only loader mutations leave the tree read-only.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const AGENT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT!;
const CORE = process.env.OMP_PATCH_VERIFY_CORE_ROOT!;
const NM = dirname(AGENT);
assert.ok(AGENT && CORE, "the probe requires selected runtime roots");
const plan = resolvePlan({ gate: "verify-remote-compaction-target-key", roots: [AGENT, CORE] });
const selected = process.env.OMP_COMPACTION_POLICY_CASE;
const mutation = process.env.OMP_COMPACTION_POLICY_MUTATION;
interface CompactionEntry {
	type: string;
	summary: string;
	shortSummary?: string;
	preserveData?: { openaiRemoteCompaction?: { version?: string } };
}
interface PayloadExtension {
	on(name: "before_provider_request", handler: (event: { payload: unknown }) => Record<string, unknown>): void;
	on(name: "session_before_compact", handler: (event: { preparation: { settings: { remoteEnabled?: boolean } } }) => void): void;
}
interface WireBody {
	input?: Array<{ type: string }>;
	previous_response_id?: string;
}
const marker = "COMPACTION_SESSION_POLICY_OK";
const failures: Record<string, string> = {
	"reject-remote": "compatible reader must retain the remote method",
	"ignore-override": "incompatible reader must receive a readable local summary",
	"ignore-provider": "incompatible reader must receive a readable local summary",
	"drop-host-hook": "every generic summary request must pass payload inspection",
	"drop-summary-hook": "every generic summary request must pass payload inspection",
	"drop-history-hook": "every generic summary request must pass payload inspection",
	"drop-short-hook": "every generic summary request must pass payload inspection",
};

if (!selected) {
	if (plan.since("18.18.2")) {
		const cases = [
			["compatible", "reject-remote"],
			["override-compatible", "reject-remote"],
			["wrong-api", "ignore-override"],
			["wrong-provider", "ignore-provider"],
			["payload", "drop-host-hook"],
			["payload", "drop-summary-hook"],
			["payload", "drop-history-hook"],
			["payload", "drop-short-hook"],
		];
		const positives = new Set<string>();
		for (const [name, fault] of cases) {
			for (const negative of [false, true]) {
				if (!negative && positives.has(name)) continue;
				const home = join(homedir(), `policy-${name}-${negative ? fault : "positive"}`);
				mkdirSync(home, { recursive: true });
				const child = Bun.spawnSync([process.execPath, import.meta.path], {
					env: {
						PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8",
						XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
						XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"),
						OMP_PATCH_VERSION: plan.version, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT,
						OMP_PATCH_VERIFY_CORE_ROOT: CORE, OMP_COMPACTION_TRACE_OFF: "1",
						OMP_COMPACTION_POLICY_CASE: name,
						...(negative ? { OMP_COMPACTION_POLICY_MUTATION: fault } : {}),
					},
					timeout: 30_000,
				});
				const text = child.stdout.toString() + child.stderr.toString();
				if (negative) {
					assert.notEqual(child.exitCode, 0, `${fault}: mutation must turn red`);
					assert.ok(text.includes(failures[fault]), `${fault}: mutation must fail at its behaviour assertion:\n${text}`);
					console.log(`PASS policy mutation ${fault}: child exit ${child.exitCode}; ${failures[fault]}`);
				} else {
					process.stdout.write(text);
					assert.equal(child.exitCode, 0, `${name}: public-session policy probe failed`);
					assert.ok(text.includes(`${marker} ${name}`), "the positive must reach its assertions");
					positives.add(name);
				}
				rmSync(home, { recursive: true, force: true });
			}
		}
	}
} else {
	const coreFile = join(CORE, "src/compaction/compaction.ts");
	const hostFile = join(AGENT, "src/session/session-maintenance.ts");
	const changes: Record<string, [string, string, string]> = {
		"reject-remote": [hostFile,
			'method => method !== "remote" || !readerModel || canReplayRemoteCompactionFrom(activeModel, readerModel)',
			'method => method !== "remote" || !readerModel'],
		"ignore-override": [coreFile,
			'!isOpenAiRemoteCompactionApi(compactor.remoteCompaction?.api ?? compactor.api)',
			'!isOpenAiRemoteCompactionApi(compactor.api)'],
		"ignore-provider": [coreFile,
			'(compactor.provider === reader.provider && isOpenAiRemoteCompactionApi(reader.api))',
			'isOpenAiRemoteCompactionApi(reader.api)'],
		"drop-host-hook": [hostFile,
			'onPayload: this.#host.extensionRunner?.hasHandlers("before_provider_request")',
			'onPayload: false'],
		"drop-summary-hook": [coreFile, 'onPayload: options?.onPayload,', 'onPayload: undefined,'],
		"drop-history-hook": [coreFile, 'apiKey: key, onPayload: options.onPayload', 'apiKey: key, onPayload: undefined'],
		"drop-short-hook": [coreFile, 'apiKey: key, onPayload: options?.onPayload', 'apiKey: key, onPayload: undefined'],
	};
	let mutations = 0;
	if (mutation) {
		assert.ok(changes[mutation], `unknown mutation ${mutation}`);
		Bun.plugin({
			name: "compaction-session-policy-control",
			setup(build) {
				build.onLoad({ filter: /\/(compaction\/compaction|session\/session-maintenance)\.ts$/ }, args => {
					const [file, from, to] = changes[mutation];
					let contents = readFileSync(args.path, "utf8");
					if (args.path === file) {
						assert.equal(contents.split(from).length, 2, `${mutation}: unique mutation anchor`);
						contents = contents.replace(from, to);
						mutations++;
					}
					return { contents, loader: "ts" };
				});
			},
		});
	}
	const httpBodies: Record<string, unknown>[] = [];
	let forbiddenHttp = 0;
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		if (selected !== "payload" || String(url) !== "http://compaction.invalid/summary") {
			forbiddenHttp++;
			throw new Error(`uninjected transport forbidden: ${String(url)}`);
		}
		httpBodies.push(JSON.parse(String(init?.body)));
		return Response.json({ summary: httpBodies.length === 1 ? "FULL_HISTORY_SUMMARY" : "SHORT_DISPLAY_SUMMARY" });
	}) as typeof fetch;

	// The selected runtime and its loader mutations cannot bind a statically imported SDK.
	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT}/src/sdk.ts`);
	const { Settings } = await import(`${AGENT}/src/config/settings.ts`);
	const { SessionManager } = await import(`${AGENT}/src/session/session-manager.ts`);
	const { ModelRegistry } = await import(`${AGENT}/src/config/model-registry.ts`);
	const { initializeExtensions } = await import(`${AGENT}/src/modes/runtime-init.ts`);
	const { createMockModel, registerMockApi } = await import(`${NM}/pi-ai/src/providers/mock.ts`);
	const { streamOpenAICodexResponses } = await import(`${NM}/pi-ai/src/providers/openai-codex-responses.ts`);
	const { getBundledModel } = await import(`${NM}/pi-catalog/src/models.ts`);
	registerMockApi("compaction-session-policy");
	const frames: Array<{ socket: number; body: WireBody }> = [];
	let sockets = 0;
	let responses = 0;
	const server = Bun.serve<{ id: number }>({
		hostname: "127.0.0.1", port: 0,
		fetch(req, server) {
			if (server.upgrade(req, { data: { id: ++sockets } })) return;
			forbiddenHttp++;
			return new Response("WebSocket only", { status: 400 });
		},
		websocket: {
			message(ws, data) {
				const body: WireBody = JSON.parse(String(data));
				frames.push({ socket: ws.data.id, body });
				const id = ++responses;
				const compaction = body.input?.at(-1)?.type === "compaction_trigger";
				const item = compaction
					? { type: "compaction", id: `cmp_${id}`, encrypted_content: "OFFLINE_REMOTE_SUMMARY" }
					: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "LIVE_BASELINE", annotations: [] }] };
				const send = (event: unknown) => ws.send(JSON.stringify(event));
				send({ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
				if (!compaction) send({ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "LIVE_BASELINE" });
				send({ type: "response.output_item.done", output_index: 0, item });
				send({ type: "response.completed", response: { id: `resp_${id}`, status: "completed", output: [item], usage: { input_tokens: 1000, output_tokens: 10, total_tokens: 1010, input_tokens_details: { cached_tokens: 900 } } } });
			},
		},
	});
	const model = createMockModel({ id: "policy-active", handler: () => ({ content: ["LOCAL_READABLE_SUMMARY"] }) });
	if (selected !== "payload") {
		Object.assign(model, {
			...getBundledModel("openai-codex", "gpt-6-astra"),
			id: model.id, api: model.api, provider: model.provider,
			baseUrl: `http://127.0.0.1:${server.port}`,
			preferWebsockets: true,
			remoteCompaction: { enabled: true, api: "openai-codex-responses", v2StreamingEnabled: true },
		});
	}
	if (selected === "compatible") Object.assign(model, { api: "openai-codex-responses" });
	const cwd = join(homedir(), "project");
	mkdirSync(cwd);
	const agentDir = join(homedir(), "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "offline-fixture-key");
	const registry = new ModelRegistry(authStorage);
	registry.getAvailable = () => [model];
	registry.find = (provider: string, id: string) => provider === model.provider && id === model.id ? model : undefined;
	registry.hasConfiguredAuth = () => true;
	const manager = SessionManager.create(cwd, join(homedir(), "sessions"));
	for (const content of ["OLD_USER", "RECENT_USER"]) {
		manager.appendMessage({ role: "user", content, timestamp: Date.now() });
		manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "OLD_ASSISTANT" }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(), usage: { input: 1000, output: 10, cacheRead: 900, cacheWrite: 0, totalTokens: 1910, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
	}
	let inspections = 0;
	const preparations: boolean[] = [];
	const notices: string[] = [];
	const { session } = await createAgentSession({
		cwd, agentDir, authStorage, modelRegistry: registry, model, sessionManager: manager,
		settings: Settings.isolated({
			"memory.backend": "off", "computer.enabled": false, "advisor.enabled": false,
			"compaction.experimentalContextManagement": false, "compaction.autoContinue": false,
			"compaction.methodOrder": ["remote", "soft"], "compaction.keepRecentTokens": 1,
			...(selected === "payload" ? { "compaction.remoteEndpoint": "http://compaction.invalid/summary" } : {}),
		}),
		preloadedPreparedExtensions: [{ path: "policy-probe", resolvedPath: "policy-probe", error: null, factory: (pi: PayloadExtension) => {
			pi.on("session_before_compact", event => {
				preparations.push(event.preparation.settings.remoteEnabled === true);
			});
			if (selected === "payload") pi.on("before_provider_request", event => {
				assert.ok(event.payload !== null && typeof event.payload === "object", "generic payload must be an object");
				inspections++;
				return { ...event.payload, inspection: inspections };
			});
		} }],
		enableLsp: false, enableMCP: false, skipPythonPreflight: true,
		disableExtensionDiscovery: true, additionalExtensionPaths: [], skills: [], rules: [],
		promptTemplates: [], slashCommands: [], contextFiles: [], noContextFiles: true,
		toolNames: [], restrictToolNames: true, cacheWarming: false, autoTitle: false,
		hasUI: false, interactivePrompts: false,
	});
	try {
		session.subscribe((event: { type: string; message?: string }) => {
			if (event.type === "notice" && event.message) notices.push(event.message);
		});
		await initializeExtensions(session, {
			mode: "print", reportSendError: (_action: string, error: Error) => { throw error; },
			reportRuntimeError: (error: Error) => { throw error; },
		});
		if (selected === "payload") {
			await session.compact(undefined, { suppressContinuation: true });
			assert.equal(httpBodies.length, 2, "history and display summaries must use the generic endpoint");
			assert.deepEqual(httpBodies.map(body => body.inspection), [1, 2], failures["drop-host-hook"]);
			assert.equal(inspections, 2, "the extension sees both requests exactly once");
			const entry = manager.getBranch().findLast((entry: CompactionEntry) => entry.type === "compaction");
			assert.ok(entry.summary.includes("FULL_HISTORY_SUMMARY"));
			assert.equal(entry.shortSummary, "SHORT_DISPLAY_SUMMARY");
		} else {
			// Seed the effective remote adapter through its real public transport,
			// using the session's public state store. The active mock adapter lets
			// us count any unwanted soft fallback without an external API.
			assert.equal(session.model.remoteCompaction?.api, "openai-codex-responses", "the SDK must retain the configured remote adapter");
			const effective = { ...model, api: "openai-codex-responses" };
			const seed = await streamOpenAICodexResponses(effective, {
				systemPrompt: ["LIVE_POLICY_PREFIX"], messages: [{ role: "user", content: "SEED", timestamp: 1 }],
			}, { apiKey: "offline-fixture-key", sessionId: session.sessionId, providerSessionState: session.providerSessionState, preferWebsockets: true }).result();
			assert.equal(seed.stopReason, "stop", seed.errorMessage);
			assert.equal(frames.length, 1, "fixture must establish one real remote baseline");
			const reader = { ...model, id: "policy-reader", api: selected === "wrong-api" ? "mock" : "openai-responses", provider: selected === "wrong-provider" ? "other-provider" : model.provider };
			const result = await session.compact(undefined, { readerModel: reader, suppressContinuation: true });
			const entry = manager.getBranch().findLast((entry: CompactionEntry) => entry.type === "compaction");
			console.log(JSON.stringify({ case: selected, activeApi: session.model.api, remoteApi: session.model.remoteCompaction.api, preparations, frames: frames.length, local: model.calls.length, notices }));
			if (selected === "compatible") {
				assert.deepEqual(preparations, [true], failures["reject-remote"]);
				assert.equal(entry.preserveData?.openaiRemoteCompaction?.version, "v2", failures["reject-remote"]);
				assert.equal(model.calls.length, 0, "compatible reader must not trigger local summarization");
				assert.equal(frames.length, 2, "cached remote compaction needs exactly one appended frame");
				assert.equal(frames[1].socket, frames[0].socket, "the reader filter must keep the live socket");
				assert.equal(frames[1].body.previous_response_id, "resp_1", "compaction retains the live response ID");
				assert.deepEqual(frames[1].body.input, [{ type: "compaction_trigger" }]);
				await session.setModel(reader);
				assert.equal(session.model.id, reader.id, "the /compact caller can switch to its reader");
			} else if (selected === "override-compatible") {
				assert.deepEqual(preparations, [true, false], failures["reject-remote"]);
				assert.ok(notices.some(notice => notice.includes("configured Codex V2 endpoint cannot use the live WebSocket chain")), "the override is refused by the pre-existing transport guard, not the reader filter");
				assert.equal(frames.length, 1, "the unsupported override must not send a compaction frame");
				assert.equal(model.calls.length, 3, "the documented ladder falls back to split-turn local summarization");
			} else {
				assert.deepEqual(preparations, [false], failures["ignore-override"]);
				assert.ok(!entry.preserveData?.openaiRemoteCompaction && result.summary.includes("LOCAL_READABLE_SUMMARY"), failures["ignore-override"]);
				assert.equal(frames.length, 1, "an incompatible reader must not consume the remote baseline");
				assert.equal(model.calls.length, 3, "incompatible reader uses history, split-prefix and display local summaries");
			}
		}
		assert.equal(forbiddenHttp, 0, "no SSE, V1 or external HTTP may escape");
		if (mutation) assert.equal(mutations, 1, "the selected mutation must be loaded");
		console.log(`${marker} ${selected}; frames=${frames.length}; local=${model.calls.length}; inspected=${inspections}`);
	} finally {
		await session.dispose();
		server.stop(true);
	}
}
