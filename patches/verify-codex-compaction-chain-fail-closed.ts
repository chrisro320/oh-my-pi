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
const scratch = mkdtempSync(join(tmpdir(), "omp-0070-gate-"));
const savedEnv = {
	HOME: process.env.HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
	OMP_COMPACTION_TRACE_OFF: process.env.OMP_COMPACTION_TRACE_OFF,
};
Object.assign(process.env, {
	HOME: scratch,
	XDG_CONFIG_HOME: scratch,
	XDG_CACHE_HOME: scratch,
	OMP_COMPACTION_TRACE_OFF: "1",
});

try {
	// 0070 is bound by both plans that carry the Codex V2 compaction lane.
	// Selecting explicitly keeps an unknown tree failing closed rather than
	// running the transport assertions against a tree without the patch.
	const aiVersion = JSON.parse(readFileSync(`${AI_ROOT}/package.json`, "utf8")).version;
	assert.ok(
		["18.1.18", "18.2.3", "18.2.10"].includes(aiVersion),
		`unsupported 0070 transport gate version: ${aiVersion}`,
	);
	const supportsChainRecovery = ["18.2.3", "18.2.10"].includes(aiVersion);
	const ai = await import(`${AI_ROOT}/src/providers/openai-codex-responses.ts`);
	const core = await import(`${CORE_ROOT}/src/compaction/compaction-v2-streaming.ts`);
	const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
	const bundled = getBundledModel("openai-codex", "gpt-6-astra");
	assert.ok(bundled, "fixture model must exist in the selected catalog");
	const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "full history" }] }];
	const request = { body: { model: bundled.id }, input, retainedMessageBudget: 1000, sessionId: "gate-0070" };
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

	type Frame = {
		socket: number;
		body: { generate?: boolean; previous_response_id?: string; input: Array<{ type: string }>; client_metadata?: Record<string, string> };
	};
	let mode = "success";
	let sequence = 0;
	let socketSequence = 0;
	let compactionSends = 0;
	let frames: Frame[] = [];
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
			if (server.upgrade(req, { data: { id: ++socketSequence } })) return;
			return new Response("WebSocket only", { status: 400 });
		},
		websocket: {
			message(ws, data) {
				const body: Frame["body"] = JSON.parse(String(data));
				frames.push({ socket: ws.data.id, body });
				if (body.generate === false) {
					assert.equal(body.previous_response_id, undefined, "recovery must establish a fresh baseline");
					assert.deepEqual(body.input, input, "recovery must preserve the supplied history without its trigger");
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
 void openCodexCompactionEventStream(model, body, { apiKey: "fixture", requestDiagnostics: {}, onAccept(commit) { commit({ turnState: "ok", providerSessionState: new Map() }); } });
 applyOpenAICodexCompactionResponseMetadata({ modelsEtag: "ok" }, { turnState: {}, websocketState: {} });
 // @ts-expect-error A primitive cannot store accepted metadata.
 applyOpenAICodexCompactionResponseMetadata({ modelsEtag: "ok" }, { turnState: {}, websocketState: 1 });
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
