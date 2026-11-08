import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { homedir } from "node:os";

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { streamDevin } = await import(`${AI_ROOT}/src/providers/devin.ts`);
const {
	AssignModelRequestSchema, AssignModelResponseSchema,
	GetChatMessageRequestSchema, GetChatMessageResponseSchema, GetUserJwtResponseSchema,
} = await import(`${CATALOG_ROOT}/src/discovery/devin-proto.ts`);
const { create, fromBinary, toBinary } = await import(`${CATALOG_ROOT}/src/discovery/protobuf.ts`);
const { logger } = await import(`${NM}/pi-utils/src/index.ts`);
import type { AssistantMessageEventStream, Context, Model } from "@oh-my-pi/pi-ai";

console.log("=== Testing Devin auth cache + turn timing (0055) ===");

const fakeModel = {
	id: "swe-2",
	name: "SWE-2",
	api: "devin-agent",
	provider: "devin",
	baseUrl: "https://server.codeium.com",
	reasoning: true,
	input: ["text"],
	supportsTools: true,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262000,
	maxTokens: 128000,
	compat: { supportsParallelToolCalls: true, modelRouter: false },
	requestModelId: "swe-2-high",
} as unknown as Model<"devin-agent">;

const fakeContext: Context = {
	systemPrompt: "test",
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }],
};

function makeJwt(expSeconds: number): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
	return `${b64({ alg: "none" })}.${b64({ exp: expSeconds })}.sig`;
}

function streamBody(frames: object[]): Uint8Array {
	const parts: Buffer[] = [];
	for (const f of frames) {
		const payload = gzipSync(
			Buffer.from(toBinary(GetChatMessageResponseSchema, create(GetChatMessageResponseSchema, f as never))),
		);
		const head = Buffer.alloc(5);
		head[0] = 0x01; // compressed
		head.writeUInt32BE(payload.length, 1);
		parts.push(head, payload);
	}
	const trailer = Buffer.from("{}");
	const tail = Buffer.alloc(5);
	tail[0] = 0x02; // end-of-stream
	tail.writeUInt32BE(trailer.length, 1);
	parts.push(tail, trailer);
	return Buffer.concat(parts);
}

const AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const ASSIGN_PATH = "/exa.api_server_pb.ApiServerService/AssignModel";

function chatRequest(init?: RequestInit) {
	const body = init?.body as Uint8Array;
	const length = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1);
	const payload = body.subarray(5, 5 + length);
	return fromBinary(GetChatMessageRequestSchema, body[0] & 0x01 ? gunzipSync(payload) : payload);
}

function makeFetch(opts: { jwt: string; failFirstChat?: boolean }) {
	const calls = { auth: 0, chat: 0 };
	let chatAttempts = 0;
	const impl = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
		const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		if (u.endsWith(AUTH_PATH)) {
			calls.auth++;
			return new Response(
				toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: opts.jwt })) as never,
			);
		}
		if (u.endsWith(CHAT_PATH)) {
			calls.chat++;
			chatAttempts++;
			if (opts.failFirstChat && chatAttempts === 1) {
				return new Response("unauthorized", { status: 401 });
			}
			return new Response(
				streamBody([
					{ messageId: "bot-x", requestId: "r1", latency: 0.05 },
					{ deltaText: "OK", deltaTokens: 1, latency: 0.12 },
				]) as never,
			);
		}
		return new Response("not found", { status: 404 });
	};
	return { impl: impl as unknown as typeof fetch, calls };
}

async function drain(stream: AssistantMessageEventStream) {
	let last: { type: string } | undefined;
	for await (const ev of stream) last = ev;
	return last;
}

// --- Scenario 1: two turns share one GetUserJwt -----------------------------
{
	const { impl, calls } = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) });
	const s1 = await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k1" }));
	const s2 = await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k1" }));
	assert.equal(s1?.type, "done");
	assert.equal(s2?.type, "done");
	assert.equal(calls.auth, 1, "second turn must reuse cached JWT");
	assert.equal(calls.chat, 2);
}

// --- Scenario 2: 401 forces one refresh + retry ------------------------------
{
	const { impl, calls } = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600), failFirstChat: true });
	const s = await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k2" }));
	assert.equal(s?.type, "done", "401 must be recovered by one auth refresh");
	assert.equal(calls.auth, 2, "401 must trigger exactly one extra GetUserJwt");
	assert.equal(calls.chat, 2);
}

// --- Scenario 3: expired JWT is not served from cache ------------------------
{
	const { impl, calls } = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) - 10) });
	await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k3" }));
	await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k3" }));
	assert.equal(calls.auth, 2, "expired JWT must not be cached");
}

// --- Scenario 4: timing log carries the phase breakdown ----------------------
{
	const events: { message: string; context?: Record<string, unknown> }[] = [];
	const dispose = logger.registerLogSink((e) => {
		if (e.message.startsWith("devin:")) events.push({ message: e.message, context: e.context });
	});
	try {
		const { impl } = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) });

		await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k4" }));
	} finally {
		dispose();
	}
	const timing = events.find((e) => e.message === "devin: turn timing");
	assert.ok(timing, "turn timing log must be emitted");
	const ctx = timing.context!;
	for (const key of ["authMs", "headersMs", "firstFrameMs", "serverLatencyMs", "ttftMs", "durationMs"]) {
		assert.ok(key in ctx, `turn timing must include ${key}`);
	}
	assert.equal(ctx.serverLatencyMs, 120, "server latency must come from the frame's latency field");
}

// --- Scenario 5: different fetch transports share the cache ------------------
// The JWT is a bearer token bound to (apiKey, baseUrl), not to the transport
// that carried the auth request. streamSimple rebuilds its wrapper every turn,
// so transport-keyed caching would never hit.
{
	const a = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) });
	const b = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) });
	await drain(streamDevin(fakeModel, fakeContext, { fetch: a.impl, apiKey: "k5" }));
	await drain(streamDevin(fakeModel, fakeContext, { fetch: b.impl, apiKey: "k5" }));
	assert.equal(a.calls.auth, 1);
	assert.equal(b.calls.auth, 0, "a JWT minted through fetch A must be served to fetch B (same apiKey+baseUrl)");
}

// --- Scenario 6: double 401 invalidates; next turn on same transport re-auths
{
	const { impl, calls } = makeFetch({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) });
	let chatN = 0;
	const flaky = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		if (u.endsWith(AUTH_PATH)) return impl(url, init);
		if (u.endsWith(CHAT_PATH)) {
			chatN++;
			if (chatN <= 2) return new Response("unauthorized", { status: 401 });
			return impl(url, init);
		}
		return new Response("not found", { status: 404 });
	};
	const s = await drain(streamDevin(fakeModel, fakeContext, { fetch: flaky as unknown as typeof fetch, apiKey: "k6" }));
	assert.equal(s?.type, "error");
	assert.equal(calls.auth, 2, "double 401 = one initial auth + one forced refresh");
	// The rejected JWT was invalidated; the next turn on the SAME transport must re-auth.
	const s2 = await drain(streamDevin(fakeModel, fakeContext, { fetch: flaky as unknown as typeof fetch, apiKey: "k6" }));
	assert.equal(s2?.type, "done");
	assert.equal(calls.auth, 3, "post-401 turn must re-authenticate, not reuse the rejected JWT");
}

// --- Scenario 7: JWT without exp is never cached -----------------------------
{
	const noExp = `${Buffer.from('{"a":1}').toString("base64url")}.${Buffer.from("{}").toString("base64url")}.s`;
	const { impl, calls } = makeFetch({ jwt: noExp });
	await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k7" }));
	await drain(streamDevin(fakeModel, fakeContext, { fetch: impl, apiKey: "k7" }));
	assert.equal(calls.auth, 2, "JWT without exp must not be cached");
}

// --- Scenario 8: a slow normal auth must not overwrite a force-refreshed JWT --
{
	const jwtOld = makeJwt(Math.floor(Date.now() / 1000) + 3600) + "-old";
	const jwtNew = makeJwt(Math.floor(Date.now() / 1000) + 3600) + "-new";
	const authResolvers: ((r: Response) => void)[] = [];
	const chatJwts: string[] = [];
	let chatN = 0;
	const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		if (u.endsWith(AUTH_PATH)) {
			return new Promise<Response>((resolve) => authResolvers.push(resolve));
		}
		if (u.endsWith(CHAT_PATH)) {
			chatN++;
			const req = chatRequest(init);
			chatJwts.push(req.metadata?.userJwt ?? "");
			if (chatN === 1) return new Response("unauthorized", { status: 401 });
			return new Response(
				streamBody([{ deltaText: "OK", deltaTokens: 1, latency: 0.1 }]) as never,
			);
		}
		return new Response("not found", { status: 404 });
	};
	const opts = { fetch: impl as unknown as typeof fetch, apiKey: "k8" };

	// Turn 1: auth request goes out and stays pending.
	const t1 = drain(streamDevin(fakeModel, fakeContext, opts));
	while (authResolvers.length === 0) await Bun.sleep(1);
	// Turn 2: its auth also goes out pending (no inflight sharing).
	const t2 = drain(streamDevin(fakeModel, fakeContext, opts));
	while (authResolvers.length === 1) await Bun.sleep(1);
	// Turn 2's auth resolves first with jwtNew; its chat then 401s → invalidate +
	// force-refresh, which resolves with jwtNew again and retries OK.
	authResolvers[1](
		new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: jwtNew })) as never),
	);
	while (authResolvers.length === 2) await Bun.sleep(1);
	authResolvers[2](
		new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: jwtNew })) as never),
	);
	await t2;
	// Now turn 1's stale auth finally resolves with jwtOld — it must NOT be cached.
	authResolvers[0](
		new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: jwtOld })) as never),
	);
	await t1;
	// Turn 3 must hit the cache holding jwtNew, not the stale jwtOld.
	await drain(streamDevin(fakeModel, fakeContext, opts));
	assert.equal(chatJwts.at(-1), jwtNew, "stale in-flight auth must not overwrite the refreshed JWT");
}

// --- Scenario 9: normal-normal race — latest-issued auth wins the cache ------
{
	const jwtOld = makeJwt(Math.floor(Date.now() / 1000) + 3600) + "-old";
	const jwtNew = makeJwt(Math.floor(Date.now() / 1000) + 3600) + "-new";
	const authResolvers: ((r: Response) => void)[] = [];
	const chatJwts: string[] = [];
	const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		if (u.endsWith(AUTH_PATH)) {
			return new Promise<Response>((resolve) => authResolvers.push(resolve));
		}
		if (u.endsWith(CHAT_PATH)) {
			chatJwts.push(chatRequest(init).metadata?.userJwt ?? "");
			return new Response(
				streamBody([{ deltaText: "OK", deltaTokens: 1, latency: 0.1 }]) as never,
			);
		}
		return new Response("not found", { status: 404 });
	};
	const opts = { fetch: impl as unknown as typeof fetch, apiKey: "k9" };

	const t1 = drain(streamDevin(fakeModel, fakeContext, opts));
	while (authResolvers.length === 0) await Bun.sleep(1);
	const t2 = drain(streamDevin(fakeModel, fakeContext, opts));
	while (authResolvers.length === 1) await Bun.sleep(1);
	// Resolve the LATER-issued auth first, then the earlier one. Without the
	// epoch guard the earlier response would overwrite the newer entry.
	authResolvers[1](
		new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: jwtNew })) as never),
	);
	authResolvers[0](
		new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: jwtOld })) as never),
	);
	await t1;
	await t2;
	await drain(streamDevin(fakeModel, fakeContext, opts));
	assert.equal(chatJwts.at(-1), jwtNew, "latest-issued auth must win the cache slot");
}

// R12: assignment and chat consume one shared two-attempt recovery budget.
// AssignModel intentionally has no userJwt; only GetChatMessage carries it.
for (const scenario of [
	{ name: "assignment-401", assignmentStatus: 401, chatStatus: 200, outcome: "done" },
	{ name: "assignment-403-then-chat-401", assignmentStatus: 403, chatStatus: 401, outcome: "error" },
	{ name: "assignment-500", assignmentStatus: 500, chatStatus: 200, outcome: "error" },
] as const) {
	const calls = { auth: 0, assignment: 0, chat: 0 };
	const jwts: string[] = [];
	const chatJwts: string[] = [];
	const cascades: string[] = [];
	const router = { ...fakeModel, id: "adaptive", requestModelId: "adaptive",
		compat: { ...fakeModel.compat, modelRouter: true } } as Model<"devin-agent">;
	const transport = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		if (address.endsWith(AUTH_PATH)) {
			calls.auth++;
			const userJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600) + `-${calls.auth}`;
			jwts.push(userJwt);
			return new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt })) as never);
		}
		if (address.endsWith(ASSIGN_PATH)) {
			calls.assignment++;
			const request = fromBinary(AssignModelRequestSchema, init?.body as Uint8Array);
			assert.equal(request.metadata?.userJwt ?? "", "", "assignment must retain its API-key-only metadata contract");
			cascades.push(request.cascadeId);
			if (calls.assignment === 1) return new Response("assignment rejected", { status: scenario.assignmentStatus });
			return new Response(toBinary(AssignModelResponseSchema, create(AssignModelResponseSchema, {
				assignment: { modelUid: "swe-2-high", assignmentJwt: "synthetic-assignment" },
			})) as never);
		}
		if (address.endsWith(CHAT_PATH)) {
			calls.chat++;
			const request = chatRequest(init);
			chatJwts.push(request.metadata?.userJwt ?? "");
			cascades.push(request.cascadeId);
			assert.equal(request.chatModelUid, "swe-2-high", "chat must use the assigned concrete model");
			assert.equal(request.modelAssignmentJwt, "synthetic-assignment", "chat must carry the assignment JWT");
			if (calls.chat === 1 && scenario.chatStatus !== 200) return new Response("chat rejected", { status: scenario.chatStatus });
			return new Response(streamBody([{ deltaText: "OK", deltaTokens: 1 }]) as never);
		}
		throw new Error(`Unexpected Devin fixture endpoint: ${address}`);
	};
	const options = { fetch: transport as typeof fetch, apiKey: `r12-${scenario.name}` };
	const result = await drain(streamDevin(router, fakeContext, options));
	assert.equal(result?.type, scenario.outcome, scenario.name);
	if (scenario.assignmentStatus === 500) {
		assert.deepEqual(calls, { auth: 1, assignment: 1, chat: 0 }, "non-auth assignment failures must not refresh or retry");
	} else {
		assert.deepEqual(calls, { auth: 2, assignment: 2, chat: 1 }, "assignment and chat must share exactly two attempts");
		assert.equal(chatJwts[0], jwts[1], "chat must use the freshly recovered JWT");
		assert.notEqual(chatJwts[0], jwts[0], "the rejected generation cannot reach chat");
		assert.equal(new Set(cascades).size, 1, "assignment and chat retries keep one cascade identity");
		if (scenario.chatStatus === 401) {
			const next = await drain(streamDevin(router, fakeContext, options));
			assert.equal(next?.type, "done");
			assert.equal(calls.auth, 3, "a terminal auth rejection must invalidate the cache for the next turn");
			assert.equal(chatJwts.at(-1), jwts[2], "the next turn must carry its newly fetched JWT");
		}
	}
}

console.log("PASS verify-devin-auth-cache: cache epochs and shared assignment/chat recovery");
