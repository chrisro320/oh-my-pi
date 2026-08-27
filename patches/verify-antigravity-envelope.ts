import assert from "node:assert/strict";
import { buildRequest } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/google-gemini-cli.ts";
import type { Context, Model } from "@oh-my-pi/pi-ai";

console.log("=== Testing Antigravity Request Envelope (0014) ===");

const fakeModel: Model<"google-gemini-cli"> = {
	id: "gemini-3.7-flash",
	provider: "google-antigravity",
	api: "google-gemini-cli",
	input: ["text"],
} as unknown as Model<"google-gemini-cli">;

const fakeContext: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [
		{
			role: "user",
			content: [{ type: "text", text: "Hello, what is 1+1?" }],
			timestamp: Date.now(),
		},
	],
};

// 1. Regular Antigravity request
const req1 = buildRequest(fakeModel, fakeContext, "test-project-123", { sessionId: "session-abc-1" }, true);

assert.ok(req1.requestId, "req1.requestId must exist");
assert.match(req1.requestId, /^agent\/[0-9a-f-]{36}\/\d+\/[0-9a-f-]{36}\/\d+$/, "requestId must follow structured format");
assert.ok(req1.request.sessionId, "req1.request.sessionId must exist");
assert.ok(req1.request.sessionId.startsWith("-"), "Antigravity sessionId must be signed decimal");
assert.equal(req1.userAgent, "antigravity");
assert.equal(req1.requestType, "agent");

// 2. Deterministic session identity across separate calls with same sessionId
const req1Repeat = buildRequest(fakeModel, fakeContext, "test-project-123", { sessionId: "session-abc-1" }, true);
assert.equal(req1.request.sessionId, req1Repeat.request.sessionId, "same sessionKey must yield identical deterministic sessionId");

// 3. Ephemeral side-channel turn (:side:)
const reqSide = buildRequest(fakeModel, fakeContext, "test-project-123", { sessionId: "session-abc-1:side:cron" }, true);
assert.ok(reqSide.requestId, "side-channel req.requestId must exist");
assert.equal(reqSide.request.sessionId, req1.request.sessionId, "side-channel must share the base session identity");

// 4. Session state advance with providerSessionState
const providerSessionState = new Map();
const reqTurn1 = buildRequest(fakeModel, fakeContext, "test-project-123", { sessionId: "session-state-1", providerSessionState }, true);
const reqTurn2 = buildRequest(fakeModel, fakeContext, "test-project-123", { sessionId: "session-state-1", providerSessionState }, true);

assert.ok(reqTurn1.requestId, "turn 1 requestId must exist");
assert.ok(reqTurn2.requestId, "turn 2 requestId must exist");
assert.notEqual(reqTurn1.requestId, reqTurn2.requestId, "step must advance between turns");

console.log("PASS verify-antigravity-envelope: all 0014 assertions ok!");
