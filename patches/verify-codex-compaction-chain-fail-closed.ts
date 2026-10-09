/** 0070: exercise actual Codex transport/collector boundaries without provider calls. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
// Type-only, so Bun's transpiler erases it: nothing is loaded from a package to
// run this gate. The specifier is the package's public subpath rather than a
// machine path, and the runtime imports below resolve through
// OMP_PATCH_VERIFY_*_ROOT, so the gate follows whichever tree it is pointed at.
import type { Model, ProviderSessionState } from "@oh-my-pi/pi-ai/src/types.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const scratch = mkdtempSync(join(tmpdir(), "omp-0070-gate-"));
const savedEnv = {
	HOME: process.env.HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
	OMP_COMPACTION_TRACE_OFF: process.env.OMP_COMPACTION_TRACE_OFF,
	PI_CODEX_WEBSOCKET_RETRY_DELAY_MS: process.env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS,
	PI_CODEX_WEBSOCKET_RETRY_BUDGET: process.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET,
};
Object.assign(process.env, {
	HOME: scratch,
	XDG_CONFIG_HOME: scratch,
	XDG_CACHE_HOME: scratch,
	OMP_COMPACTION_TRACE_OFF: "1",
	// Both knobs are read when the provider module loads, so they must be set
	// before the import below. A small, explicit websocket retry budget keeps the
	// 0096 open-retry regression fast and lets it assert the exact, finite bound
	// the lane consumes before it may fail -- not the production value, which the
	// contract requires to stay unchanged.
	PI_CODEX_WEBSOCKET_RETRY_DELAY_MS: "10",
	PI_CODEX_WEBSOCKET_RETRY_BUDGET: "2",
});

try {
	// 0070 is bound by both plans that carry the Codex V2 compaction lane.
	// Selecting explicitly keeps an unknown tree failing closed rather than
	// running the transport assertions against a tree without the patch.
	const aiVersion = JSON.parse(readFileSync(`${AI_ROOT}/package.json`, "utf8")).version;
	assert.ok(
		["18.1.18", "18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(aiVersion),
		`unsupported 0070 transport gate version: ${aiVersion}`,
	);
	const supportsChainRecovery = ["18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(aiVersion);
	const ai = await import(`${AI_ROOT}/src/providers/openai-codex-responses.ts`);
	const core = await import(`${CORE_ROOT}/src/compaction/compaction-v2-streaming.ts`);
	const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
	const bundled = getBundledModel("openai-codex", "gpt-6-astra");
	assert.ok(bundled, "fixture model must exist in the selected catalog");
	const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "full history" }] }];
	const request = { body: { model: bundled.id }, input, retainedUserItems: input, retainedMessageBudget: 1000, sessionId: "gate-0070" };
	const successEvents = [
		{ type: "response.output_item.done", item: { type: "compaction", encrypted_content: "fixture-summary" } },
		{ type: "response.completed", response: { id: "fixture-response", status: "completed" } },
	];
	const sse = (events: unknown[]) =>
		new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		});

	for (const field of ["v2Endpoint", "streamingEndpoint"]) {
		let sends = 0;
		const model = {
			...bundled,
			baseUrl: "http://127.0.0.1:1",
			remoteCompaction: { enabled: true, [field]: "http://127.0.0.1:1/override" },
		};
		await assert.rejects(
			core.requestCompactionV2Streaming(model, "fixture-key", request, undefined, {
				providerSessionState: new Map(),
				fetch: async () => {
					sends++;
					return sse(successEvents);
				},
				retryWait: async () => {},
			}),
			ai.CodexCompactionChainLostError,
			`${field}: Codex endpoint override must fail closed`,
		);
		assert.equal(sends, 0, `${field}: no full-history HTTP request may escape`);
	}

	// The shared collector must leave ordinary OpenAI/Azure SSE and permanent failures alone.
	const failures: Array<{ event: Record<string, unknown>; code?: string }> = [
		{ event: { type: "error", code: "invalid_request_error", message: "bad schema" }, code: "invalid_request_error" },
		{
			event: {
				type: "response.failed",
				response: { error: { code: "auth_unavailable", message: "No available accounts" } },
			},
			code: "auth_unavailable",
		},
		{
			event: {
				type: "response.failed",
				response: { error: { code: "invalid_api_key", message: "Incorrect API key provided" } },
			},
			code: "invalid_api_key",
		},
		{ event: { type: "response.failed", response: { error: { message: "unsupported model" } } } },
		{ event: { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } } },
	];
	for (const api of ["openai-responses", "azure-openai-responses"] as const) {
		const model = {
			...bundled,
			api,
			provider: "openai",
			baseUrl: "http://127.0.0.1:1/v1",
			remoteCompaction: { enabled: true },
		};
		for (const { event, code } of failures) {
			let sends = 0;
			await assert.rejects(
				core.requestCompactionV2Streaming(model, "fixture-key", request, undefined, {
					fetch: async () => {
						sends++;
						return sse([event]);
					},
					retryWait: async () => {},
				}),
				(error: Error & { code?: string }) => {
					assert.equal(
						error instanceof ai.CodexCompactionChainLostError,
						false,
						"ordinary SSE failure is not a lost Codex chain",
					);
					assert.equal(error.code, code, "only a real provider code may be preserved");
					return true;
				},
			);
			assert.equal(sends, 1, `${api}: permanent or unclassified failure must not retry`);
		}
		let sends = 0;
		const response = await core.requestCompactionV2Streaming(model, "fixture-key", request, undefined, {
			fetch: async () =>
				sse(++sends === 1 ? [{ type: "error", code: "rate_limit_exceeded", message: "try later" }] : successEvents),
			retryWait: async () => {},
		});
		assert.equal(sends, 2, "known transient provider code must retry");
		assert.equal(response.compactionItem.encrypted_content, "fixture-summary");
	}

	// 18.4.1 classifies authentication before its transient HTTP status: a
	// standalone `error` frame that names an unavailable account must reach
	// provider fallback on its first attempt instead of consuming the V2 retry
	// budget. The provider code must still survive on the thrown failure.
	{
		const model = {
			...bundled,
			api: "openai-responses" as const,
			provider: "openai",
			baseUrl: "http://127.0.0.1:1/v1",
			remoteCompaction: { enabled: true },
		};
		let authSends = 0;
		await assert.rejects(
			core.requestCompactionV2Streaming(model, "fixture-key", request, undefined, {
				fetch: async () => {
					authSends++;
					return sse([
						{ type: "error", status: 503, code: "auth_unavailable", message: "No available accounts" },
					]);
				},
				retryWait: async () => {},
			}),
			(error: Error & { code?: string }) => {
				assert.equal(
					error instanceof ai.CodexCompactionChainLostError,
					false,
					"an authentication refusal is not a lost Codex chain",
				);
				assert.equal(error.code, "auth_unavailable", "the provider code must survive an auth refusal");
				return true;
			},
		);
		assert.equal(authSends, 1, "auth failure must not consume the V2 retry budget");
	}

	// The Codex V2 lane is decided by the *effective* API -- `remoteCompaction.api`
	// can select Codex for a model whose own `api` is openai-responses -- or by the
	// provider identity. The host's speculation guards must read the same predicate
	// the transport does: testing `model.api` alone schedules an isolated remote
	// speculation that can only be refused, and the threshold grace path then defers
	// real compaction while that attempt fails.
	if (["18.4.1", "18.4.4", "18.7.0"].includes(aiVersion)) {
		const altLaneModels = [
			{
				label: "remoteCompaction.api",
				model: {
					...bundled,
					api: "openai-responses" as const,
					provider: "openai",
					baseUrl: "http://127.0.0.1:1/v1",
					remoteCompaction: { enabled: true, api: "openai-codex-responses", v2StreamingEnabled: true },
				},
			},
			{
				label: "provider identity",
				model: {
					...bundled,
					api: "openai-responses" as const,
					provider: "openai-codex",
					baseUrl: "http://127.0.0.1:1/v1",
					remoteCompaction: { enabled: true },
				},
			},
		];
		for (const { label, model } of altLaneModels) {
			assert.equal(core.isCodexCompactionV2Lane(model), true, `${label}: effective Codex lane must be recognized`);
			let altSends = 0;
			await assert.rejects(
				core.requestCompactionV2Streaming(model, "fixture-key", request, undefined, {
					fetch: async () => {
						altSends++;
						return sse(successEvents);
					},
					retryWait: async () => {},
				}),
				ai.CodexCompactionChainLostError,
				`${label}: chain-only lane must refuse a chain-less V2 send`,
			);
			assert.equal(altSends, 0, `${label}: no HTTP request may escape the chain-only refusal`);
		}
		const maintenance = readFileSync(`${AGENT_ROOT}/src/session/session-maintenance.ts`, "utf8");
		assert.ok(
			maintenance.includes('if (method === "remote" && isCodexCompactionV2Lane(model)) return;'),
			"speculation start guard must consult the effective Codex lane predicate",
		);
		assert.ok(
			maintenance.includes('if (method === "remote" && isCodexCompactionV2Lane(model)) return false;'),
			"threshold deferral guard must consult the effective Codex lane predicate",
		);
	}

	type Frame = {
		socket: number;
		body: { generate?: boolean; previous_response_id?: string; input: Array<{ type: string }>; client_metadata?: Record<string, string> };
	};
	let mode = "success";
	let sequence = 0;
	let socketSequence = 0;
	let compactionSends = 0;
	let frames: Frame[] = [];
	let onUpgrade = () => {};
	// Open-stage fixtures for the 0096 regression below: a refused upgrade (no 101
	// response) is exactly how a failed handshake -- TLS reset, refused auth, dead
	// route -- reaches the client as `websocket error: ...`, so counting and
	// scripting the refusals is how the open-retry bound gets asserted.
	let upgradeAttempts = 0;
	let pendingRefusals = 0;
	let capacityText: string | undefined;
	const send = (ws: ServerWebSocket<{ id: number }>, event: unknown) => ws.send(JSON.stringify(event));
	function complete(ws: ServerWebSocket<{ id: number }>, compact: boolean) {
		const id = ++sequence;
		const item = compact
			? { type: "compaction", id: `cmp_${id}`, encrypted_content: "fixture-summary" }
			: {
					type: "message",
					id: `msg_${id}`,
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "ok", annotations: [] }],
				};
		send(ws, { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
		if (!compact)
			send(ws, {
				type: "response.output_text.delta",
				item_id: item.id,
				output_index: 0,
				content_index: 0,
				delta: "ok",
			});
		send(ws, { type: "response.output_item.done", output_index: 0, item });
		send(ws, { type: "response.completed", response: { id: `resp_${id}`, status: "completed", output: [item] } });
	}
	const server = Bun.serve<{ id: number }>({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req, server) {
			upgradeAttempts++;
			if (pendingRefusals > 0) {
				pendingRefusals--;
				return new Response("refused", { status: 503 });
			}
			onUpgrade();
			if (server.upgrade(req, { data: { id: ++socketSequence } })) return;
			return new Response("WebSocket only", { status: 400 });
		},
		websocket: {
			message(ws, data) {
				const body: Frame["body"] = JSON.parse(String(data));
				frames.push({ socket: ws.data.id, body });
				if (body.generate === false) {
					assert.equal(body.previous_response_id, undefined, "recovery must establish a fresh baseline");
					if (capacityText !== undefined) {
						assert.ok(JSON.stringify(body.input).includes(capacityText), "recovery must preserve the entire oversized transcript");
					} else {
						assert.deepEqual(body.input, input, "recovery must preserve the supplied history without its trigger");
					}
					if (mode === "recovery-invalid") return complete(ws, false);
					send(ws, { type: "response.completed", response: { id: `resp_${++sequence}`, status: "completed", output: [] } });
					return;
				}
				if (body.input.at(-1)?.type !== "compaction_trigger") return complete(ws, false);
				compactionSends++;
				if (mode === "malformed" && compactionSends === 1) {
					ws.send("{invalid json");
					return;
				}
				if (mode === "closed") {
					ws.close(1011, "fixture close");
					return;
				}
				if (mode === "stale" || (mode === "stale-once" && compactionSends === 1)) {
					send(ws, { type: "error", code: "previous_response_not_found", message: "gone" });
					return;
				}
				if (mode === "permanent") {
					send(ws, { type: "error", code: "invalid_request_error", message: "bad schema" });
					return;
				}
				if (mode === "capacity-overflow") {
					send(ws, { type: "error", code: "context_length_exceeded", message: "fixture provider input limit exceeded" });
					return;
				}
				if (mode === "exhausted" || (mode === "transient" && compactionSends === 1)) {
					send(ws, { type: "error", code: "server_error", message: "temporary failure" });
					return;
				}
				// A metadata frame with no headers must also be harmless.
				send(ws, { type: "response.metadata" });
				send(ws, { type: "response.metadata", headers: { "x-codex-turn-state": "accepted-turn" } });
				if (mode === "invalid-summary") {
					send(ws, {
						type: "response.completed",
						response: { id: `resp_${++sequence}`, status: "completed", output: [] },
					});
					return;
				}
				complete(ws, true);
			},
		},
	});
	console.log("0070 gate: local WebSocket ready");
	try {
		const model: Model<"openai-codex-responses"> = {
			...bundled,
			baseUrl: `http://127.0.0.1:${server.port}`,
			preferWebsockets: true,
		};
		for (const scenario of [
			"cold",
			"sse-disabled",
			"success",
			"transient",
			"malformed",
			"permanent",
			"stale",
			"closed",
			"exhausted",
			"invalid-summary",
			...(supportsChainRecovery ? ["stale-once"] : []),
		]) {
			mode = scenario;
			frames = [];
			compactionSends = 0;
			const states = new Map<string, ProviderSessionState>();
			let httpSends = 0;
			const options = {
				apiKey: "fixture-key",
				sessionId: `gate-${scenario}`,
				providerSessionState: states,
				preferWebsockets: scenario !== "sse-disabled",
				fetch: async () => {
					httpSends++;
					return sse(successEvents);
				},
			};
			try {
				const context = {
					systemPrompt: ["fixture"],
					messages: [{ role: "user", content: [{ type: "text", text: "seed" }], timestamp: 1 }],
				};
				const peerOptions = { ...options, sessionId: `${options.sessionId}-peer`, preferWebsockets: true };
				if (!["cold", "sse-disabled"].includes(scenario)) {
					for (const seedOptions of [peerOptions, options]) {
						const result = await ai.streamOpenAICodexResponses(model, context, seedOptions).result();
						assert.equal(result.stopReason, "stop", result.errorMessage);
					}
				}
				const operation = core.requestCompactionV2Streaming(
					model,
					options.apiKey,
					{ ...request, sessionId: options.sessionId },
					undefined,
					{
						...options,
						timeoutMs: 2000,
						retryWait: async () => {},
					},
				);
				if (["success", "transient", "malformed", "stale-once"].includes(scenario) || (supportsChainRecovery && scenario === "cold")) {
					const result = await operation;
					assert.equal(
						result.compactionItem.encrypted_content,
						"fixture-summary",
						`${scenario}: same-chain recovery must succeed`,
					);
					assert.equal(compactionSends, ["success", "cold"].includes(scenario) ? 1 : 2);
					assert.equal(
						ai.getOpenAICodexTransportDetails(model, options).canAppend,
						false,
						"accepted summary must invalidate its old baseline",
					);
					assert.equal(
						ai.getOpenAICodexTransportDetails(model, options).hasTurnState,
						true,
						"accepted summary must commit metadata",
					);
					assert.equal(
						ai.getOpenAICodexTransportDetails(model, peerOptions).canAppend,
						scenario !== "cold",
						"acceptance must not clear another session's baseline",
					);
					const next = await ai.streamOpenAICodexResponses(model, context, options).result();
					assert.equal(next.stopReason, "stop", next.errorMessage);
					assert.equal(
						frames.at(-1)?.body.previous_response_id,
						undefined,
						"normal turn after accepted rewrite must rebuild",
					);
				} else {
					await assert.rejects(operation, ai.CodexCompactionChainLostError, `${scenario}: failure must stay terminal`);
					assert.equal(
						compactionSends,
						["cold", "sse-disabled"].includes(scenario) ? 0 : scenario === "exhausted" || (supportsChainRecovery && ["closed", "stale"].includes(scenario)) ? 3 : 1,
					);
					if (scenario === "invalid-summary") {
						const details = ai.getOpenAICodexTransportDetails(model, options);
						assert.equal(details.canAppend, true, "rejected summary must retain the baseline");
						assert.equal(details.hasTurnState, false, "rejected summary must not commit metadata");
					}
				}
				assert.equal(httpSends, 0, `${scenario}: no SSE replay may escape`);
				const compactFrames = frames.filter((frame) => frame.body.input.at(-1)?.type === "compaction_trigger");
				for (const frame of compactFrames) {
					assert.ok(frame.body.previous_response_id, `${scenario}: every sent compaction must chain`);
					assert.deepEqual(frame.body.input, [{ type: "compaction_trigger" }]);
					assert.equal(frame.body.generate, undefined, "compaction must generate its summary");
					if (!(supportsChainRecovery && ["closed", "stale", "stale-once"].includes(scenario))) {
						assert.equal(frame.socket, compactFrames[0].socket, "healthy retries must stay on the original socket");
						assert.equal(frame.body.previous_response_id, compactFrames[0].body.previous_response_id, "healthy retries must retain their response baseline");
					}
				}
			} finally {
				for (const state of states.values()) state.close();
			}
		}
		if (["18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(aiVersion)) {
			for (const scenario of ["recovery-invalid", "invalid-summary", "success"]) {
				mode = scenario;
				frames = [];
				compactionSends = 0;
				const states = new Map<string, ProviderSessionState>();
				// Bun does not expose response headers on its client open event.
				// Inject only the handshake write, at the real server upgrade boundary.
				onUpgrade = () => {
					const provider = states.get("openai-codex-responses") as
						| { metadataSessions: Map<string, { turnStates: Map<string, { value?: string }> }> }
						| undefined;
					for (const session of provider?.metadataSessions.values() ?? [])
						for (const cell of session.turnStates.values()) cell.value = "minted-by-101";
				};
				const options = {
					apiKey: "fixture-key", sessionId: `handshake-${scenario}`, providerSessionState: states,
					preferWebsockets: true,
					codexCompaction: ai.createOpenAICodexCompactionRequestContext({ implementation: "responses_compaction_v2" }),
					fetch: async () => { throw new Error("No HTTP replay allowed"); },
				};
				try {
					const operation = core.requestCompactionV2Streaming(model, options.apiKey,
						{ ...request, sessionId: options.sessionId }, undefined,
						{ ...options, timeoutMs: 2000, retryWait: async () => {} });
					if (scenario === "success") await operation;
					else await assert.rejects(operation, ai.CodexCompactionChainLostError);
					const details = ai.getOpenAICodexTransportDetails(model, options);
					assert.equal(details.hasTurnState, scenario === "success",
						`${scenario}: handshake metadata must commit only after accepted compaction`);
					if (scenario === "invalid-summary")
						assert.equal(details.canAppend, true, "collector rejection must retain its baseline");
				} finally {
					onUpgrade = () => {};
					for (const state of states.values()) state.close();
				}
			}
		}
		// 0096: a transient websocket OPEN failure in the chain-only compaction lane
		// must spend the bounded websocket retry budget before the request may fail.
		// Before the fix the lane read the open failure's "fatal" classification --
		// which for ordinary turns only means "stop retrying the socket, replay over
		// SSE" -- as terminal: one refused handshake (TLS reset, dead route, refused
		// upgrade) ended the compaction on its first attempt with `retryable: false`,
		// so the host's configured retry budget never ran and the ladder dropped
		// straight to the expensive soft summarizer. The lane has no SSE to replay,
		// so these scenarios also pin that no HTTP request ever escapes it.
		// Version-gated: 0096 exists only in the 18.7.0 plan, so any other tree must
		// fail here rather than assert against a build that never carried the fix.
		if (aiVersion === "18.7.0") {
			const websocketRetryBudget = Number(process.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET);
			assert.ok(
				Number.isInteger(websocketRetryBudget) && websocketRetryBudget > 0,
				"this gate configures its own websocket retry budget",
			);
			const openCases: Array<{
				label: string;
				refusals: number | "all";
				preferWebsockets?: boolean;
				preAborted?: boolean;
				permanent?: boolean;
				expect:
					| { kind: "success"; upgradeAttempts: number }
					| { kind: "terminal"; retryable: boolean; upgradeAttempts?: number; compactionSends: number };
			}> = [
				// Two refused upgrades, then a healthy socket: the lane must stay remote
				// and must not pay for an SSE replay.
				{ label: "open-transient", refusals: 2, expect: { kind: "success", upgradeAttempts: 3 } },
				// Every upgrade refused: the bounded budget must be spent (the retry
				// budget per attempt, times the caller's own attempts) and the failure
				// must be reported retryable, so the configured budget still runs
				// before any fallback.
				{
					label: "open-exhausted",
					refusals: "all",
					expect: {
						kind: "terminal",
						retryable: true,
						upgradeAttempts: (1 + websocketRetryBudget) * (1 + core.V2_COMPACTION_MAX_RETRIES),
						compactionSends: 0,
					},
				},
				// Explicitly disabled transport: the socket is never even attempted.
				{
					label: "open-disabled",
					refusals: 0,
					preferWebsockets: false,
					expect: { kind: "terminal", retryable: false, upgradeAttempts: 0, compactionSends: 0 },
				},
				// An aborted request is a cancellation, not a transient failure.
				{ label: "open-aborted", refusals: "all", preAborted: true, expect: { kind: "terminal", retryable: false, compactionSends: 0 } },
				// A permanent provider refusal over a healthy socket still stops on the
				// first attempt: healing a broken link must not turn a bad request into
				// a retry storm.
				{ label: "open-permanent", refusals: 0, permanent: true, expect: { kind: "terminal", retryable: false, compactionSends: 1 } },
			];
			for (const testCase of openCases) {
				mode = testCase.permanent ? "permanent" : "success";
				frames = [];
				compactionSends = 0;
				upgradeAttempts = 0;
				pendingRefusals = testCase.refusals === "all" ? Number.POSITIVE_INFINITY : testCase.refusals;
				const states = new Map<string, ProviderSessionState>();
				let httpSends = 0;
				const options = {
					apiKey: "fixture-key",
					sessionId: `gate-${testCase.label}`,
					providerSessionState: states,
					preferWebsockets: testCase.preferWebsockets ?? true,
					signal: testCase.preAborted ? AbortSignal.abort() : undefined,
					fetch: async () => {
						httpSends++;
						return sse(successEvents);
					},
				};
				try {
					const operation = core.requestCompactionV2Streaming(
						model,
						options.apiKey,
						{ ...request, sessionId: options.sessionId },
						options.signal,
						{ ...options, timeoutMs: 2000, retryWait: async () => {} },
					);
					if (testCase.expect.kind === "success") {
						const result = await operation;
						assert.equal(
							result.compactionItem.encrypted_content,
							"fixture-summary",
							`${testCase.label}: a transient open failure must keep the remote lane`,
						);
						assert.equal(
							upgradeAttempts,
							testCase.expect.upgradeAttempts,
							`${testCase.label}: the refused opens must be retried inside the bounded budget`,
						);
						assert.equal(compactionSends, 1, `${testCase.label}: only the accepted attempt may reach the wire`);
						assert.equal(
							ai.getOpenAICodexTransportDetails(model, options).lastTransport,
							"websocket",
							`${testCase.label}: the lane must stay on the socket`,
						);
						assert.ok(
							frames.some(frame => frame.body.generate === false),
							`${testCase.label}: the recovered baseline must be minted over the socket`,
						);
					} else {
						await assert.rejects(operation, (error: Error) => {
							assert.ok(
								error instanceof ai.CodexCompactionChainLostError,
								`${testCase.label}: expected a chain-loss error, got ${error.name}: ${error.message}`,
							);
							assert.equal(
								(error as InstanceType<typeof ai.CodexCompactionChainLostError>).retryable,
								testCase.expect.retryable,
								`${testCase.label}: retryability is what decides whether the configured budget runs`,
							);
							return true;
						});
						if (testCase.expect.upgradeAttempts !== undefined) {
							assert.equal(
								upgradeAttempts,
								testCase.expect.upgradeAttempts,
								`${testCase.label}: the open retries must be finite and exact`,
							);
						}
						assert.equal(compactionSends, testCase.expect.compactionSends, `${testCase.label}: wire traffic`);
					}
					assert.equal(httpSends, 0, `${testCase.label}: no SSE request may escape the chain-only lane`);
				} finally {
					pendingRefusals = 0;
					for (const state of states.values()) state.close();
				}
			}
			// Exercise compact(), not just its transport: the upstream preflight
			// used the standard 272k window as a hard server limit before any I/O.
			const { compact } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);
			const { Tokenizer } = await import(`${CORE_ROOT}/src/tokenizer.ts`);
			const sol = getBundledModel("openai-codex", "gpt-6.1-sol");
			assert.ok(sol, "Sol fixture must exist");
			const capacityModel = { ...sol, baseUrl: model.baseUrl, contextWindow: 272_000, preferWebsockets: true };
			const text = `CAPACITY_START ${"word ".repeat(300_000)}CAPACITY_END`;
			const tokens = new Tokenizer(capacityModel).countTokens(text);
			assert.ok(tokens > 272_000 && tokens < 900_000, `fixture must span the false limit, got ${tokens}`);
			for (const scenario of ["cold-user", "cold-tool", "live-user", "provider-overflow"]) {
				mode = scenario === "provider-overflow" ? "capacity-overflow" : "success";
				capacityText = text;
				frames = [];
				compactionSends = 0;
				const states = new Map<string, ProviderSessionState>();
				let httpSends = 0;
				let softSends = 0;
				const user = { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 };
				const messages = scenario === "cold-tool"
					? [
							{ ...user, content: [{ type: "text" as const, text: "Read the full source." }] },
							{
								role: "assistant" as const,
								content: [{ type: "toolCall" as const, id: "call_capacity", name: "read", arguments: {} }],
								api: capacityModel.api, provider: capacityModel.provider, model: capacityModel.id,
								usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
								stopReason: "toolUse" as const, timestamp: 2,
							},
							{ role: "toolResult" as const, toolCallId: "call_capacity", toolName: "read",
								content: [{ type: "text" as const, text }], isError: false, timestamp: 3 },
						]
					: [user];
				const context = { systemPrompt: ["capacity fixture"], messages };
				const options = {
					apiKey: "fixture-key", sessionId: `capacity-${scenario}`, providerSessionState: states,
					preferWebsockets: true,
					fetch: async () => { httpSends++; throw new Error("Unexpected HTTP fallback"); },
				};
				try {
					if (scenario === "live-user") {
						const seed = await ai.streamOpenAICodexResponses(capacityModel, context, options).result();
						assert.equal(seed.stopReason, "stop", seed.errorMessage);
					}
					const operation = compact({
						firstKeptEntryId: "capacity-boundary", messagesToSummarize: messages, turnPrefixMessages: [],
						recentMessages: [], isSplitTurn: false, tokensBefore: tokens,
						fileOps: { read: new Set(), written: new Set(), edited: new Set() },
						settings: { enabled: true, remoteEnabled: true, remoteStreamingV2Enabled: true },
					}, capacityModel, options.apiKey, undefined, undefined, {
						...options, remoteSystemPrompt: context.systemPrompt,
						buildCachePreservingContext: async () => scenario === "live-user"
							? { context, previousSummaryInPrefix: false } : undefined,
						completeImpl: async () => { softSends++; throw new Error("Unexpected soft fallback"); },
					});
					if (scenario === "provider-overflow") {
						await assert.rejects(operation, /fixture provider input limit exceeded/,
							"the provider's actual capacity rejection must survive");
					} else {
						const result = await operation;
						assert.ok(JSON.stringify(result.preserveData).includes("fixture-summary"),
							"compact must return the accepted native summary");
					}
					assert.equal(compactionSends, 1, `${scenario}: exactly one remote compaction, no overflow retry storm`);
					assert.equal(httpSends, 0, `${scenario}: no HTTP replay`);
					assert.equal(softSends, 0, `${scenario}: no local summarizer`);
					if (scenario === "live-user") {
						assert.ok(frames.at(-1)?.body.previous_response_id, "live compaction must reuse its baseline");
						assert.equal(frames.filter(frame => frame.body.generate === false).length, 0, "live chain needs no recovery");
					}
					console.log(`0096 capacity: ${scenario} PASS (${tokens} tokens; standard window 272000)`);
				} finally {
					capacityText = undefined;
					for (const state of states.values()) state.close();
				}
			}
		}
	} finally {
		server.stop(true);
	}

	// Compile a real consumer of the published declaration; Bun's type stripping cannot prove this contract.
	const typeProbe = join(scratch, "consumer.ts");
	writeFileSync(
		typeProbe,
		`import { openCodexCompactionEventStream, applyOpenAICodexCompactionResponseMetadata } from ${JSON.stringify(`${AI_ROOT}/dist/types/providers/openai-codex-responses.js`)};
 declare const model: Parameters<typeof openCodexCompactionEventStream>[0];
 declare const body: Parameters<typeof openCodexCompactionEventStream>[1];
 void openCodexCompactionEventStream(model, body, { apiKey: "fixture", requestDiagnostics: {}, onAccept(commit${["18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(aiVersion) ? ", rollback" : ""}) { commit({ turnState: "ok", providerSessionState: new Map() }); ${["18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(aiVersion) ? "rollback();" : ""} } });
 applyOpenAICodexCompactionResponseMetadata({ modelsEtag: "ok" }, { turnState: {}, websocketState: {} });
 // @ts-expect-error A primitive cannot store accepted metadata.
 applyOpenAICodexCompactionResponseMetadata({ modelsEtag: "ok" }, { turnState: {}, websocketState: 1 });
 ${["18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(aiVersion) ? `
 import type { SummaryOptions, CachePreservingSummaryScope, CachePreservingSummaryContext } from ${JSON.stringify(`${CORE_ROOT}/dist/types/compaction/compaction.js`)};
 import { buildCodexChainedRequestBody } from ${JSON.stringify(`${AI_ROOT}/dist/types/providers/openai-codex-responses.js`)};
 import { createAnthropicRequestAudit } from ${JSON.stringify(`${AI_ROOT}/dist/types/providers/anthropic-request-audit.js`)};
 import { imageFingerprint, ensurePng, completedPng, pngFailureReason } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`}/dist/types/chat/image-loading.js`)};
 import type { ImageContent } from ${JSON.stringify(`${AI_ROOT}/dist/types/types.js`)};
 declare const image: ImageContent;
 void buildCodexChainedRequestBody({ model: "fixture", input: [] }, undefined);
 void createAnthropicRequestAudit({ provider: "anthropic", sideRequest: false, refresh: false });
 void imageFingerprint(image); void ensurePng(image); void completedPng("hash"); void pngFailureReason("hash");
 ${aiVersion === "18.7.0" ? `
 import { maxFramesForDataBudget, providerImageBudget, providerFrameBudget } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`}/dist/types/snapcompact.js`)};
 import type { ShapeGeometry } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`}/dist/types/snapcompact.js`)};
 declare const shape: ShapeGeometry; void maxFramesForDataBudget(shape);
 ` : `
 import { FRAME_DATA_BYTES_PER_SHAPE, maxFramesForDataBudget, shedFramesOverBudget, providerImageBudget, providerFrameBudget } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`}/dist/types/snapcompact.js`)};
 void FRAME_DATA_BYTES_PER_SHAPE; void maxFramesForDataBudget(1024, undefined); void shedFramesOverBudget([]);
 `}
 void providerImageBudget("anthropic", "anthropic-messages"); void providerFrameBudget("anthropic", "anthropic-messages");
 import type { AgentSession } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`}/dist/types/session/agent-session.js`)};
 import type { SessionProviderBoundary } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`}/dist/types/session/session-provider-boundary.js`)};
 import type { SessionMaintenanceHost } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`}/dist/types/session/session-maintenance.js`)};
 declare const maintenanceHost: SessionMaintenanceHost;
 void maintenanceHost.convertMessagesToLlm([]); void maintenanceHost.convertMessagesToLlmWithSource([]);
 declare const session: AgentSession;
 declare const boundary: SessionProviderBoundary;
 void boundary.convertMessagesToLlmWithSource([]);
 void session.convertMessagesToLlmWithSource([]);
 const liveScope: CachePreservingSummaryScope = "live";
 declare const liveContext: CachePreservingSummaryContext;
 const summaryOptions: SummaryOptions = { buildCachePreservingContext: async (scope, candidate) => {
   const validScope: CachePreservingSummaryScope = scope;
   void validScope; void candidate; return liveContext;
 } };
 void liveScope; void summaryOptions;
 import { mapOptionsForApi } from ${JSON.stringify(`${AI_ROOT}/dist/types/stream.js`)};
 import type { UserMessage, DeveloperMessage } from ${JSON.stringify(`${AI_ROOT}/dist/types/types.js`)};
 import { DateCwdReminderInjector, dateCwdAnchorKey, applyDateCwdAnchors } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`}/dist/types/session/date-cwd-reminder.js`)};
 import type { SessionMemory } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`}/dist/types/session/session-memory.js`)};
 import type { SessionToolsHost } from ${JSON.stringify(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`}/dist/types/session/session-tools.js`)};
 import { traceCompaction } from ${JSON.stringify(`${CORE_ROOT}/dist/types/compaction/compaction-trace.js`)};
 declare const user: UserMessage; declare const developer: DeveloperMessage;
 user.providerOnly = true; developer.providerOnly = true;
 void mapOptionsForApi(model, { conversationId: "fixture" });
 void new DateCwdReminderInjector(() => "fixture", () => "/tmp");
 void dateCwdAnchorKey(user, "fixture"); void applyDateCwdAnchors([], "fixture", {});
 declare const memory: SessionMemory; declare const toolsHost: SessionToolsHost;
 void memory.promotionTail; memory.capturePromotionSnapshot([], "tail"); memory.restorePromotionSnapshot(undefined, "tail");
 void toolsHost.memoryPromotionTail(); toolsHost.captureMemoryPromotionSnapshot([], "tail");
 void session.buildDisplaySessionContext({ persistEvalStateContext: false });
 void session.runIdleEphemeralTurn({ promptText: "fixture" });
 traceCompaction({ k: "type-probe" });
 ` : ""}
 `,
	);
	const checked = Bun.spawnSync([
		"tsc",
		"--noEmit",
		"--skipLibCheck",
		"--strict",
		"--target",
		"ES2022",
		"--module",
		"ESNext",
		"--moduleResolution",
		"Bundler",
		typeProbe,
	]);
	assert.equal(checked.exitCode, 0, `published acceptance API must type-check:\n${checked.stdout}\n${checked.stderr}`);
	console.log("verify-codex-compaction-chain-fail-closed: transport, retry, metadata and public types PASS");
} finally {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(scratch, { recursive: true, force: true });
}
