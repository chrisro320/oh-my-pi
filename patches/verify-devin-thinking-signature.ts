import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { homedir } from "node:os";

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { streamDevin } = await import(`${AI_ROOT}/src/providers/devin.ts`);
const { GetChatMessageRequestSchema, GetChatMessageResponseSchema, GetUserJwtResponseSchema } = await import(
	`${CATALOG_ROOT}/src/discovery/devin-proto.ts`
);
const { create, fromBinary, toBinary } = await import(`${CATALOG_ROOT}/src/discovery/protobuf.ts`);
import type { AssistantMessageEventStream, Context, Model } from "@oh-my-pi/pi-ai";

console.log("=== Testing Devin thinking signature capture + replay (0058) ===");

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
		head[0] = 0x01;
		head.writeUInt32BE(payload.length, 1);
		parts.push(head, payload);
	}
	const trailer = Buffer.from("{}");
	const tail = Buffer.alloc(5);
	tail[0] = 0x02;
	tail.writeUInt32BE(trailer.length, 1);
	parts.push(tail, trailer);
	return Buffer.concat(parts);
}

const AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";

const SIG = "sealed.v1.abc123";

// Fetch that returns a thinking delta followed by a STANDALONE signature frame
// (deltaThinking empty) — the wire shape the server actually sends.
function makeFetch(capture: { lastChatBody?: Uint8Array }) {
	const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
		if (u.endsWith(AUTH_PATH)) {
			return new Response(
				toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: makeJwt(9999999999) })) as never,
			);
		}
		if (u.endsWith(CHAT_PATH)) {
			if (init?.body instanceof Uint8Array || Buffer.isBuffer(init?.body)) {
				const frame = init.body as Uint8Array;
				// strip 5-byte connect frame header, gunzip
				capture.lastChatBody = gunzipSync(frame.subarray(5));
			}
			return new Response(
				streamBody([
					{ messageId: "bot-x", requestId: "r1", latency: 0.05 },
					{ deltaThinking: "thinking...", latency: 0.1 },
					{ deltaText: "OK", deltaTokens: 1, latency: 0.12 },
					// signature arrives AFTER deltaText closed the thinking block —
					// this is the wire shape that requires lastThinkingBlock.
					{ deltaSignature: SIG, latency: 0.13 },
				]) as never,
			);
		}
		return new Response("not found", { status: 404 });
	};
	return impl as unknown as typeof fetch;
}

async function drain(stream: AssistantMessageEventStream) {
	let message: { content?: unknown[] } | undefined;
	for await (const ev of stream) {
		if (ev && typeof ev === "object" && "message" in ev) {
			const m = ev.message;
			if (m && typeof m === "object") message = m as { content?: unknown[] };
		}
	}
	return message?.content ?? [];
}

// --- Scenario 1: standalone signature frame attaches to the thinking block ---
{
	const capture: { lastChatBody?: Uint8Array } = {};
	const stream = await streamDevin(fakeModel, fakeContext, {
		apiKey: "test-key",
		fetch: makeFetch(capture),
	});
	const content = (await drain(stream)) as { type: string; thinkingSignature?: string }[];
	const thinking = content.find((c) => c.type === "thinking");
	assert.ok(thinking, "expected a thinking block");
	assert.equal(thinking.thinkingSignature, SIG, "standalone deltaSignature frame must attach to the thinking block");
}

// --- Scenario 2: replayed history carries signature + signatureType=sealed ---
{
	const capture: { lastChatBody?: Uint8Array } = {};
	const ctx: Context = {
		systemPrompt: "test",
		messages: [
			{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
			{
				role: "assistant",
				api: "devin-agent",
				provider: "devin",
				model: "swe-2",
				responseId: "bot-prev",
				content: [
					{ type: "thinking", thinking: "prev thought", thinkingSignature: SIG },
					{ type: "text", text: "prev answer" },
				],
				timestamp: Date.now(),
			} as never,
			{ role: "user", content: [{ type: "text", text: "next" }], timestamp: Date.now() },
		],
	};
	const stream = await streamDevin(fakeModel, ctx, {
		apiKey: "test-key",
		fetch: makeFetch(capture),
	});
	await drain(stream);
	assert.ok(capture.lastChatBody, "chat request body captured");
	const req = fromBinary(GetChatMessageRequestSchema, capture.lastChatBody) as {
		chatMessagePrompts?: { signature?: string; signatureType?: string; thinking?: string }[];
	};
	const assistant = (req.chatMessagePrompts ?? []).find((p) => p.thinking === "prev thought");
	assert.ok(assistant, "replayed assistant prompt found");
	assert.equal(assistant.signature, SIG, "replayed prompt carries the signature");
	assert.equal(assistant.signatureType, "sealed", "replayed prompt marks signatureType=sealed");
}

console.log("PASS verify-devin-thinking-signature: all 0058 assertions ok!");
