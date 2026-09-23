import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

interface CapturedPrompt {
	prompt: string;
	toolCallId: string;
	thinking?: string;
	signature?: string;
	signatureType?: string;
	toolCalls?: Array<{ id: string }>;
}
interface CapturedRequest {
	cascadeId: string;
	chatModelUid?: string;
	observedField6?: string;
	chatMessagePrompts: CapturedPrompt[];
}

// Selected roots are mandatory: never fall through to a live install during a fault probe.
const NM = process.env.OMP_PATCH_VERIFY_NM;
assert(NM, "OMP_PATCH_VERIFY_NM must select a dependency-complete isolated package tree");
const root = resolve(NM);
if (!process.env.OMP_FUSION_SCENARIO && !process.env.OMP_FUSION_RESTORE_FILE) {
	for (const mode of ["protocol", "blocking", "background", "failure", "cancel", "boundaries", "restore-window", "update-window"]) {
		const child = Bun.spawn([process.execPath, import.meta.path], {
			env: { ...process.env, OMP_FUSION_SCENARIO: mode },
			stdout: "inherit", stderr: "inherit",
		});
		assert.equal(await child.exited, 0, `Fusion ${mode} acceptance failed`);
	}
	console.log("PASS native Fusion SDK lifecycle suite");
	process.exit(0);
}
const agentRoot = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? join(root, "pi-coding-agent");
const aiRoot = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? join(root, "pi-ai");
const catalogRoot = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? join(root, "pi-catalog");
const restoreFile = process.env.OMP_FUSION_RESTORE_FILE;
const scenario = process.env.OMP_FUSION_SCENARIO ?? "blocking";
assert(["protocol", "blocking", "background", "failure", "cancel", "boundaries", "restore-window", "update-window"].includes(scenario), `unknown Fusion scenario ${scenario}`);
const readStarted = Promise.withResolvers<void>();
const childHeld = Promise.withResolvers<void>();
const releaseChild = Promise.withResolvers<void>();
let readExecutions = 0;
let deniedExecutions = 0;
let passed = false;
/** Set when a scenario already spawned and awaited its own restart process. */
let handoffVerified = false;
const workspace = process.env.OMP_FUSION_WORKSPACE ?? await mkdtemp(join(tmpdir(), "fusion-gate-"));
const requests: Array<{ method: string; body: CapturedRequest }> = [];
let leadStep = 0;
let childStep = 0;
let phase: "blocking" | "repeat" = "blocking";
let repeatStarted = false;
const composite = "fusion-gpt-5-6-sol-xhigh-sidekick-swe-2-high";
// Deliberately unrelated to the composite's embedded names: assignments own routing.
const leadUid = "controlled-lead-model";
const childUid = "controlled-child-model";
let boundaryStage = "ORIGINAL";

// Install the network guard before importing the SDK or constructing registries.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	return await transport(url, init);
}) as typeof fetch;

const p = await import(join(catalogRoot, "src/discovery/devin-proto.ts"));
const { create, fromBinary, toBinary } = await import(join(catalogRoot, "src/discovery/protobuf.ts"));
const { fetchDevinModels } = await import(join(catalogRoot, "src/discovery/devin.ts"));
const { mapOptionsForApi } = await import(join(aiRoot, "src/stream.ts"));
const { buildModel } = await import(join(catalogRoot, "src/build.ts"));

function unary(schema: unknown, value: object): Response {
	return new Response(toBinary(schema, create(schema, value)), { headers: { "content-type": "application/proto" } });
}

function streamResponse(...values: object[]): Response {
	const frames = values.flatMap(value => {
		const body = Buffer.from(toBinary(p.GetChatMessageResponseSchema, create(p.GetChatMessageResponseSchema, value)));
		const header = Buffer.alloc(5);
		header.writeUInt32BE(body.length, 1);
		return [header, body];
	});
	return new Response(Buffer.concat([...frames, Buffer.from([2, 0, 0, 0, 2, 123, 125])]), {
		headers: { "content-type": "application/connect+proto" },
	});
}

function streamError(message: string): Response {
	const payload = Buffer.from(JSON.stringify({ error: { code: "invalid_argument", message } }));
	const header = Buffer.alloc(5);
	header[0] = 2;
	header.writeUInt32BE(payload.length, 1);
	return new Response(Buffer.concat([header, payload]), { headers: { "content-type": "application/connect+proto" } });
}

function toolResponse(id: string, name: string, args: object): Response {
	return streamResponse({
		deltaToolCalls: [create(p.ChatToolCallSchema, { id, name, argumentsJson: JSON.stringify(args) })],
		stopReason: 10,
	});
}

async function transport(url: string, init?: RequestInit): Promise<Response> {
	const method = new URL(url).pathname.split("/").at(-1)!;
	if (method === "GetCliModelConfigs") {
		return unary(p.GetCliModelConfigsResponseSchema, {
			clientModelConfigs: [create(p.ClientModelConfigSchema, {
				label: "Synthetic native Fusion",
				modelUid: composite,
				maxTokens: 200000,
				modelInfo: create(p.ModelInfoSchema, { isModelRouter: true, harnessUids: ["fusion", "gpt-5p6"], modelFamilyUid: "fusion", displayOption: 3 }),
			})],
		});
	}
	if (method === "GetUserJwt") {
		return unary(p.GetUserJwtResponseSchema, { userJwt: "synthetic-fusion-auth" });
	}
	if (method === "AssignModel") {
		const bytes = new Uint8Array(init!.body as ArrayBuffer);
		const request = fromBinary(p.AssignModelRequestSchema, bytes);
		// Independently inspect field 6 rather than trusting codec round-trip symmetry.
		let offset = 0;
		let field6: string | undefined;
		let hasPromptField = false;
		const varint = () => {
			let result = 0;
			let shift = 0;
			while (true) {
				const byte = bytes[offset++];
				assert(byte !== undefined, "truncated protobuf");
				result += (byte & 127) * 2 ** shift;
				if (!(byte & 128)) return result;
				shift += 7;
			}
		};
		while (offset < bytes.length) {
			const tag = varint();
			if ((tag & 7) === 2) {
				const length = varint();
				if ((tag >> 3) === 6) field6 = new TextDecoder().decode(bytes.subarray(offset, offset + length));
				if ((tag >> 3) === 5) hasPromptField = true;
				offset += length;
			} else if ((tag & 7) === 0) varint();
			else throw new Error(`unexpected assignment wire type ${tag & 7}`);
		}
		requests.push({ method, body: { ...request, observedField6: field6 } });
		if (!hasPromptField) assert.equal(field6, composite, "internal assignment must encode router UID in raw field 6");
		assert.equal(request.modelRouterUid, composite);
		if (field6 !== undefined) {
			assert.equal(field6, composite);
			assert.equal(hasPromptField, false, "native child assignment omits field 5 on the wire");
			const leadAssignment = requests.findLast(r => r.method === "AssignModel" && !r.body.observedField6);
			assert(leadAssignment, "child assignment follows lead assignment");
			assert.equal(request.cascadeId, leadAssignment.body.cascadeId, "child assignment carries its parent cascade");
			assert.equal(request.chatMessagePrompt, undefined);
		}
		return unary(p.AssignModelResponseSchema, { assignment: create(p.ModelAssignmentSchema, {
			assignmentJwt: field6 ? "synthetic-child-assignment" : "synthetic-lead-assignment",
			modelUid: field6 ? childUid : leadUid,
			harnessUids: ["fusion"],
		}) });
	}
	if (method !== "GetChatMessage") throw new Error(`Unexpected external request: ${url}`);
	let bytes = Buffer.from(init!.body as ArrayBuffer);
	const compressed = bytes[0] & 1;
	bytes = bytes.subarray(5, 5 + bytes.readUInt32BE(1));
	if (compressed) bytes = gunzipSync(bytes);
	const request = fromBinary(p.GetChatMessageRequestSchema, bytes);
	requests.push({ method, body: request });
	assert.notEqual(request.chatModelUid, composite, "Fusion composite must be assigned before chat");
	if (request.chatModelUid === leadUid) {
		assert.equal(request.cascadeId, requests.findLast(r => r.method === "AssignModel" && !r.body.observedField6)!.body.cascadeId);
		assert.equal(request.modelAssignmentJwt, "synthetic-lead-assignment");
		leadStep++;
		if (scenario === "update-window") {
			// Two sidekick calls in ONE assistant message. The wrapper runs them
			// concurrently: the first pauses inside `#ensureChild`, so the second
			// reaches `#deliverUpdate` while the child Agent does not exist yet.
			// Only a queued update survives that window.
			if (leadStep === 1) {
				return streamResponse({
					deltaToolCalls: [
						create(p.ChatToolCallSchema, { id: "window-claim", name: "sidekick", argumentsJson: JSON.stringify({ message: "WINDOW_FIRST_BRIEF: read sentinel.txt", block: false }) }),
						create(p.ChatToolCallSchema, { id: "window-update", name: "sidekick", argumentsJson: JSON.stringify({ message: "WINDOW_SECOND_BRIEF: also report the word twice", block: false }) }),
					],
					stopReason: 10,
				});
			}
			if (leadStep === 2) return toolResponse("window-wait", "read_subagent", { block: true });
			return streamResponse({ deltaText: "WINDOW_LEAD_COMPLETE", stopReason: 2 });
		}
		if (scenario === "restore-window") {
			// Parent process: open the handoff, then close the turn with text.
			// Restored process: a single call that continues the retained
			// conversation, so the restored brief must not be mistaken for the
			// original one.
			if (restoreFile) {
				if (leadStep === 1) return toolResponse("window-restore", "sidekick", { message: "WINDOW_RESTORED_BRIEF: continue the retained child conversation", block: true });
				return streamResponse({ deltaText: "WINDOW_LEAD_COMPLETE", stopReason: 2 });
			}
			if (leadStep === 1) return toolResponse("window-start", "sidekick", { message: "WINDOW_BRIEF: read sentinel.txt and report its exact contents", block: true });
			// Terminal text turn: the session must not persist a tail that is still
			// waiting on a tool result, or a reopened process reports its agent busy.
			return streamResponse({ deltaText: "WINDOW_LEAD_COMPLETE", stopReason: 2 });
		}
		if (scenario === "boundaries" || scenario === "protocol") {
			if (leadStep === 1) return toolResponse(`boundary-${boundaryStage}`, "sidekick", { message: `BOUNDARY_${boundaryStage}_BRIEF`, block: true });
			return streamResponse({ deltaText: "BOUNDARY_LEAD_COMPLETE", stopReason: 2 });
		}
		if (scenario === "failure") {
			if (leadStep === 1) return toolResponse("failure-start", "sidekick", { message: "FAILURE_BRIEF", block: true });
			assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("FUSION_CHILD_FAILURE_SENTINEL")), "original child failure reaches lead");
			if (leadStep === 2) return toolResponse("failure-read", "read_subagent", { block: true });
			return streamResponse({ deltaText: "FAILURE_LEAD_CONTINUES", stopReason: 2 });
		}
		if (scenario === "cancel") {
			if (leadStep === 1) return toolResponse("cancel-start", "sidekick", { message: "CANCEL_BRIEF", block: false });
			if (leadStep === 3) return toolResponse("cancel-read", "read_subagent", { block: false });
			assert(!request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("LATE_SUCCESS_SENTINEL")), "late child success must not enter lead context");
			return streamResponse({ deltaText: "CANCEL_LEAD_CONTINUES", stopReason: 2 });
		}
		if (scenario === "background") {
			if (leadStep === 1) return toolResponse("background-start", "sidekick", { message: "BACKGROUND_BRIEF: read the gated file, then exercise the approval boundary", block: false });
			if (leadStep === 2) {
				await readStarted.promise;
				return toolResponse("background-update", "sidekick", { message: "ACTIVE_UPDATE: preserve the in-progress read result", block: false });
			}
			if (leadStep === 3) {
				await writeFile(join(workspace, "read-barrier.fifo"), "BACKGROUND_READ_SENTINEL");
				return toolResponse("background-wait", "read_subagent", { block: true });
			}
			return streamResponse({ deltaText: "BACKGROUND_LEAD_COMPLETE", stopReason: 2 });
		}
		if (leadStep === 1) return toolResponse(restoreFile ? "lead-restored" : "lead-first", "sidekick", { message: restoreFile ? "RESTORED_BRIEF: continue the retained child conversation" : "FIRST_BRIEF: read sentinel.txt and report its exact contents", block: true });
		if (phase === "repeat" && !repeatStarted) {
			repeatStarted = true;
			return toolResponse("lead-second", "sidekick", { message: "SECOND_BRIEF: retain the prior report and finish", block: true });
		}
		return streamResponse({ deltaText: "LEAD_COMPLETE", stopReason: 2 });
	}
	assert.equal(request.chatModelUid, childUid);
	assert(!request.modelAssignmentJwt, "native child chat must not send the lead or child assignment JWT");
	assert.notEqual(request.cascadeId, requests.findLast(r => r.method === "AssignModel" && !r.body.observedField6)!.body.cascadeId, "child history uses a separate cascade");
	childStep++;
	assert(!request.tools.some((t: { name: string }) => t.name === "sidekick"), "child must not recursively expose Fusion handoffs");
	if (scenario === "boundaries" || scenario === "protocol") {
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes(`BOUNDARY_${boundaryStage}_BRIEF`)));
		if (boundaryStage !== "ORIGINAL") assert(!request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("BOUNDARY_ORIGINAL")), "branch/reset must not inherit child state from abandoned history");
		if (boundaryStage === "RESET") assert(!request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("BOUNDARY_BRANCH")), "new session must not inherit previous branch child history");
		return streamResponse({ deltaText: `BOUNDARY_${boundaryStage}_REPORT`, stopReason: 2 });
	}
	if (scenario === "failure") return streamError("FUSION_CHILD_FAILURE_SENTINEL");
	if (scenario === "cancel") {
		childHeld.resolve();
		await releaseChild.promise;
		return streamResponse({ deltaText: "LATE_SUCCESS_SENTINEL", stopReason: 2 });
	}
	if (scenario === "background") {
		if (childStep === 1) return toolResponse("background-read", "gated_read", {});
		const readIndex = request.chatMessagePrompts.findIndex((m: CapturedPrompt) => m.toolCallId === "background-read" && m.prompt.includes("BACKGROUND_READ_SENTINEL"));
		const updateIndex = request.chatMessagePrompts.findIndex((m: CapturedPrompt) => m.prompt.includes("ACTIVE_UPDATE"));
		assert(readIndex >= 0, "in-progress OMP read result reaches the child");
		assert(updateIndex > readIndex, "lead update follows the correlated read result");
		if (childStep === 2) return toolResponse("approval-probe", "approval_required", {});
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.toolCallId === "approval-probe" && /denied|approval|permission|not allowed/i.test(m.prompt)), "background operation is refused without approval");
		return streamResponse({ deltaText: "BACKGROUND_REPORT", stopReason: 2 });
	}
	if (scenario === "update-window") {
		// Both briefs must reach the child on its single cascade: the first as
		// the handoff prompt, the second as the steered update. Exactly once each
		// — a dropped queue loses the update, a double delivery duplicates it.
		const firstBriefs = request.chatMessagePrompts.filter((m: CapturedPrompt) => m.prompt.includes("WINDOW_FIRST_BRIEF"));
		const secondBriefs = request.chatMessagePrompts.filter((m: CapturedPrompt) => m.prompt.includes("WINDOW_SECOND_BRIEF"));
		assert.equal(firstBriefs.length, 1, "child receives the first brief exactly once");
		assert.equal(secondBriefs.length, 1, "update delivered before the child existed reaches it exactly once");
		return streamResponse({ deltaText: "WINDOW_CHILD_REPORT", stopReason: 2 });
	}
	if (scenario === "restore-window") {
		if (!restoreFile) {
			// Parent process: run the handoff to completion so its settle record
			// carries a real transcript (brief, read result, signed reply).
			if (childStep === 1) return toolResponse("window-child-read", "read", { path: join(workspace, "sentinel.txt") });
			assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("WINDOW_BRIEF")), "child receives the first brief");
			return streamResponse(
				{ deltaThinking: "CHILD_THINKING_SENTINEL" },
				{ deltaText: "CHILD_REPORT_FUSION_REAL_FILE_SENTINEL", stopReason: p.StopReason.STOP_PATTERN },
				{ deltaSignature: "child-signature" },
			);
		}
		// Restored process: the delivered-marker record for that handoff was
		// written with no child Agent present, yet the transcript must survive.
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("WINDOW_BRIEF")), "restored child keeps the original brief");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("CHILD_REPORT_FUSION_REAL_FILE_SENTINEL")), "restored child keeps the previous reply");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("WINDOW_RESTORED_BRIEF")), "restored child receives its new brief");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.toolCallId === "window-child-read" && m.prompt.includes("FUSION_REAL_FILE_SENTINEL")), "restored tool result retains its correlation and output");
		return streamResponse({ deltaText: "WINDOW_RESTORED_REPORT", stopReason: 2 });
	}
	if (restoreFile) {
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("FIRST_BRIEF")), "reloaded child receives the original brief");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("CHILD_REPORT_FUSION_REAL_FILE_SENTINEL")), "reloaded child receives the previous reply");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("RESTORED_BRIEF")), "reloaded child receives its new brief");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.thinking === "CHILD_THINKING_SENTINEL" && m.signature === "child-signature" && m.signatureType === "sealed"), "child thinking and signature survive process reload");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.toolCalls?.some(call => call.id === "child-read")), "restored tool result retains its initiating call");
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.toolCallId === "child-read" && m.prompt.includes("FUSION_REAL_FILE_SENTINEL")), "restored tool result retains its correlation and output");
		return streamResponse({ deltaText: "RESTORED_CHILD_COMPLETE", stopReason: 2 });
	}
	if (childStep === 1) return toolResponse("child-read", "read", { path: join(workspace, "sentinel.txt") });
	if (childStep === 2) {
		assert(request.chatMessagePrompts.some((m: CapturedPrompt) => m.toolCallId === "child-read" && m.prompt.includes("FUSION_REAL_FILE_SENTINEL")), "real OMP read output must reach child provider");
	}
	return streamResponse(
		{ deltaThinking: "CHILD_THINKING_SENTINEL" },
		{ deltaText: "CHILD_REPORT_FUSION_REAL_FILE_SENTINEL", stopReason: p.StopReason.STOP_PATTERN },
		{ deltaSignature: "child-signature" },
	);
}

try {
	await writeFile(join(workspace, "sentinel.txt"), "FUSION_REAL_FILE_SENTINEL\n");
	if (scenario === "background") {
		const fifo = Bun.spawn(["mkfifo", join(workspace, "read-barrier.fifo")], { stdout: "inherit", stderr: "inherit" });
		assert.equal(await fifo.exited, 0);
	}
	const discovered = await fetchDevinModels({ apiKey: "synthetic-key", fetch: globalThis.fetch });
	const discoveredSpec = discovered?.find(candidate => candidate.id === composite);
	assert(discoveredSpec?.compat?.nativeFusion, "discovery must preserve native Fusion identity");
	assert(discoveredSpec.compat.modelRouter, "discovery must mark Fusion assignment routing");
	const model = { ...buildModel(discoveredSpec), baseUrl: "https://fusion.invalid" };
	assert(model.compat.nativeFusion && model.compat.modelRouter, "runtime policy resolution must retain discovered Fusion metadata");
	// Public option mapping must retain child-role context, not only direct streamDevin calls.
	const mapped = mapOptionsForApi(model, { apiKey: "synthetic-key", devinFusion: { role: "sidekick", modelRouterUid: composite, parentCascadeId: "parent", handoffId: "child" } });
	assert.equal(mapped.devinFusion?.handoffId, "child", "public stream mapping must preserve child routing");
	if (scenario === "protocol") {
		const { readModelCache, writeModelCache } = await import(join(catalogRoot, "src/model-cache.ts"));
		const cachePath = join(workspace, "models.db");
		writeModelCache("devin", Date.now(), [model], true, "fusion-fixture", cachePath);
		const cached = readModelCache("devin", 60_000, Date.now, cachePath);
		assert(cached?.models[0]?.compat.nativeFusion, "persisted model cache preserves native Fusion metadata");
		const { Database } = await import("bun:sqlite");
		const db = new Database(cachePath);
		try {
			const prior: { materialization_policy: string; models: string } | null =
				db.query("SELECT materialization_policy, models FROM model_cache WHERE provider_id = ?").get("devin");
			assert(prior);
			const oldModels: Array<{ compat: { nativeFusion?: boolean; modelRouter?: boolean } }> = JSON.parse(prior.models);
			delete oldModels[0].compat.nativeFusion;
			oldModels[0].compat.modelRouter = false;
			db.run("UPDATE model_cache SET materialization_policy = ?, models = ? WHERE provider_id = ?",
				[prior.materialization_policy.replace(/builder-\d+:/, "builder-1:"), JSON.stringify(oldModels), "devin"]);
		} finally {
			db.close();
		}
		// Deployment loads the new policy in a fresh process, not an already memoized reader.
		const cacheProbe = join(workspace, "cache-reload.ts");
		await writeFile(cacheProbe, `
import assert from "node:assert/strict";
const { readModelCache } = await import(${JSON.stringify(join(catalogRoot, "src/model-cache.ts"))});
assert.equal(readModelCache("devin", 60_000, Date.now, ${JSON.stringify(cachePath)}), null,
	"pre-Fusion materialized rows must trigger fresh discovery");
`);
		const reloadedCache = Bun.spawnSync([process.execPath, cacheProbe]);
		assert.equal(reloadedCache.exitCode, 0, `cold catalog upgrade failed:\n${reloadedCache.stdout}\n${reloadedCache.stderr}`);
		const { streamDevin } = await import(join(aiRoot, "src/providers/devin.ts"));
		const context = { messages: [{ role: "user", content: "BOUNDARY_ORIGINAL_BRIEF", timestamp: 1 }], tools: [] };
		const state = new Map<string, { close(): void }>();
		const leadOptions = { apiKey: "synthetic-key", sessionId: "lead-cascade", providerSessionState: state };
		for (let i = 0; i < 2; i++) {
			const result = await streamDevin(model, context, leadOptions).result();
			assert.notEqual(result.stopReason, "error", result.errorMessage);
		}
		const childOptions = { ...leadOptions, conversationId: "child-cascade", devinFusion: {
			role: "sidekick", modelRouterUid: composite, parentCascadeId: "lead-cascade",
			handoffId: "handoff-one", trajectoryId: "child-trajectory", stepIndex: 0,
		} };
		for (let i = 0; i < 2; i++) {
			const result = await streamDevin(model, context, childOptions).result();
			assert.notEqual(result.stopReason, "error", result.errorMessage);
		}
		assert.equal(requests.filter(r => r.method === "AssignModel" && !r.body.observedField6).length, 1, "lead assignment must survive repeated requests");
		assert.equal(requests.filter(r => r.method === "AssignModel" && r.body.observedField6).length, 1, "child assignment must survive repeated requests within a handoff");
		const nextChild = await streamDevin(model, context, { ...childOptions, conversationId: "child-two",
			devinFusion: { ...childOptions.devinFusion, handoffId: "handoff-two" } }).result();
		assert.notEqual(nextChild.stopReason, "error", nextChild.errorMessage);
		assert.equal(requests.filter(r => r.method === "AssignModel" && r.body.observedField6).length, 2, "new handoff must obtain its own assignment");
		const changedAuth = await streamDevin(model, context, { ...leadOptions, apiKey: "changed-synthetic-key" }).result();
		assert.notEqual(changedAuth.stopReason, "error", changedAuth.errorMessage);
		assert.equal(requests.filter(r => r.method === "AssignModel" && !r.body.observedField6).length, 2, "changed credentials must invalidate the lead assignment");
		for (const value of state.values()) value.close();
		const reopened = await streamDevin(model, context, { ...leadOptions, apiKey: "changed-synthetic-key" }).result();
		assert.notEqual(reopened.stopReason, "error", reopened.errorMessage);
		assert.equal(requests.filter(r => r.method === "AssignModel" && !r.body.observedField6).length, 3, "closed provider state must not reuse its assignment");
		for (const value of state.values()) value.close();
		const typeProbe = join(workspace, "consumer.ts");
		await writeFile(typeProbe, `
import type { DevinCompat } from ${JSON.stringify(join(catalogRoot, "dist/types/types.js"))};
import type { StreamOptions, SimpleStreamOptions } from ${JSON.stringify(join(aiRoot, "dist/types/types.js"))};
const compat: DevinCompat = { nativeFusion: true, modelRouter: true };
const role: NonNullable<StreamOptions["devinFusion"]> = {
	role: "sidekick", modelRouterUid: "router", parentCascadeId: "lead", handoffId: "child",
	trajectoryId: "trajectory", stepIndex: 1,
};
const full: StreamOptions = { devinFusion: role };
const simple: SimpleStreamOptions = { devinFusion: role };
void [compat, full, simple];
`);
		const compiler = process.env.OMP_FUSION_TSC ?? Bun.which("tsc");
		assert(compiler, "shipped Fusion declarations require an installed TypeScript compiler");
		const checked = Bun.spawnSync([process.execPath, compiler, "--noEmit", "--skipLibCheck", "--strict",
			"--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", typeProbe]);
		assert.equal(checked.exitCode, 0, `Fusion declaration consumer failed:\n${checked.stdout}\n${checked.stderr}`);
		console.log("PASS real Fusion provider: discovery, role routing, handoff/auth/close scopes, shipped types");
	} else {
	// The SDK session scenarios below exercise ordinary tool dispatch, not manually invoked coordinator methods.
	const { createAgentSession } = await import(join(agentRoot, "src/sdk.ts"));
	const { Settings } = await import(join(agentRoot, "src/config/settings.ts"));
	const { AuthStorage } = await import(join(aiRoot, "src/auth-storage.ts"));
	const { ModelRegistry } = await import(join(agentRoot, "src/config/model-registry.ts"));
	const { SessionManager } = await import(join(agentRoot, "src/session/session-manager.ts"));
	const { Type } = await import(join(root, "omptype/dist/js/typebox.js"));
	const customTools = scenario !== "background" ? [] : [
		{
			name: "gated_read", label: "Gated read", description: "Read the controlled local FIFO.",
			parameters: Type.Object({}), approval: "read", loadMode: "essential",
			async execute() {
				readExecutions++;
				const pending = readFile(join(workspace, "read-barrier.fifo"), "utf8");
				readStarted.resolve();
				return { content: [{ type: "text", text: await pending }] };
			},
		},
		{
			name: "approval_required", label: "Approval probe", description: "Requires interactive execution approval.",
			parameters: Type.Object({}), approval: "exec", loadMode: "essential",
			async execute() {
				deniedExecutions++;
				throw new Error("unapproved background execution");
			},
		},
	];
	const agentDir = join(workspace, "agent");
	await mkdir(agentDir, { recursive: true });
	const settings = Settings.isolated({ "startup.quiet": true, "memory.backend": "off", "browser.enabled": false, "lsp.enabled": false, "checkpoint.enabled": false, "externalThinking": false, "todo.enabled": false, "goal.enabled": false, "title.refreshOnReplan": false, "tools.approvalMode": "write" });
	const auth = await AuthStorage.create(join(agentDir, "auth.db"));
	auth.setRuntimeApiKey("devin", "synthetic-key");
	const registry = new ModelRegistry(auth, join(agentDir, "models.yml"), { settings, fetch: globalThis.fetch });
	const manager = restoreFile ? await SessionManager.open(restoreFile) : SessionManager.create(workspace, join(workspace, "sessions"));
	const requestedTools = ["read", "sidekick", "read_subagent", ...customTools.map(tool => tool.name)];
	const useDefaultTools = scenario === "boundaries";
	const { session } = await createAgentSession({ cwd: workspace, agentDir, settings, modelRegistry: registry, model, getApiKey: () => "synthetic-key", sessionManager: manager, systemPrompt: "Execute the requested synthetic Fusion handoff using the supplied tools.", toolNames: useDefaultTools ? undefined : requestedTools, customTools, restrictToolNames: !useDefaultTools, allowRestrictedCustomTools: true, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [], enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true, disableExtensionDiscovery: true, hasUI: false });
	try {
		assert(session.getActiveToolNames().includes("sidekick"), "Fusion lead must expose executable native handoff tool");
		if (scenario === "boundaries") {
			await session.prompt("Run the original-branch handoff.");
			const originalUser = manager.getBranch().find((entry: { id: string; type: string; message?: { role: string } }) => entry.type === "message" && entry.message?.role === "user");
			assert(originalUser, "original prompt must be persisted");
			const navigated = await session.navigateTree(originalUser.id, { summarize: false });
			assert(!navigated.cancelled && !navigated.aborted);
			boundaryStage = "BRANCH";
			leadStep = 0;
			await session.prompt("Run a handoff on the new branch.");
			assert(await session.newSession(), "new-session transition must succeed");
			boundaryStage = "RESET";
			leadStep = 0;
			await session.prompt("Run a handoff in the fresh session.");
			assert.equal(childStep, 3);
			await session.setModelTemporary({ ...model, id: "ordinary-model", compat: { ...model.compat, nativeFusion: false, modelRouter: false } });
			assert(!session.getActiveToolNames().includes("sidekick"), "ordinary model must not expose Fusion handoff");
			assert(!session.getActiveToolNames().includes("read_subagent"), "ordinary model must not expose Fusion read");
			console.log("PASS actual OMP boundaries: selected branch, new session, non-Fusion model tools");
		} else if (scenario === "failure") {
			await session.prompt("Run the failure-preserving Fusion handoff.");
			assert.equal(childStep, 1, "nonretryable child failure must not retry");
			const lastLead = requests.findLast(r => r.body.chatModelUid === leadUid)!.body;
			assert.equal(lastLead.chatMessagePrompts.filter(m => m.prompt.startsWith("<subagent_completion_notification>\n")).length, 1, "one independent failure report per handoff");
			console.log("PASS actual OMP failure: original error, read result, one report, lead continues");
		} else if (scenario === "cancel") {
			await session.prompt("Start the held background Fusion handoff.");
			await childHeld.promise;
			const aborted = session.abort();
			await Promise.resolve();
			releaseChild.resolve();
			await aborted;
			await session.prompt("Read the canceled sidekick without starting a replacement.");
			assert.equal(childStep, 1, "reading canceled work must not restart it");
			const lastLead = requests.findLast(r => r.body.chatModelUid === leadUid)!.body;
			assert(lastLead.chatMessagePrompts.some(m => /cancel/i.test(m.prompt) && m.toolCallId === "cancel-read"), "read exposes cancellation");
			assert(!lastLead.chatMessagePrompts.some(m => m.prompt.includes("LATE_SUCCESS_SENTINEL")));
			console.log("PASS actual OMP cancellation: held response, late success suppressed, no replacement");
		} else if (scenario === "background") {
			await session.prompt("Run the controlled background Fusion handoff.");
			assert.equal(readExecutions, 1, "active update must not duplicate the local read");
			assert.equal(deniedExecutions, 0, "approval-required background operations must not execute");
			assert.equal(childStep, 3);
			const children = requests.filter(r => r.method === "GetChatMessage" && r.body.chatModelUid === childUid);
			assert.equal(new Set(children.map(r => r.body.cascadeId)).size, 1, "active update keeps child cascade");
			assert.equal(requests.filter(r => r.method === "AssignModel" && r.body.observedField6).length, 1, "active update does not assign again");
			console.log("PASS actual OMP background: concurrent lead, in-progress FIFO read, ordered update, permission refusal, one cascade/assignment");
		} else if (scenario === "update-window") {
			await session.prompt("Start a Fusion handoff and update it in the same turn.");
			assert(childStep >= 1, "child runs the handoff");
			const children = requests.filter(r => r.method === "GetChatMessage" && r.body.chatModelUid === childUid);
			assert.equal(new Set(children.map(r => r.body.cascadeId)).size, 1, "concurrent calls collapse onto one handoff cascade");
			assert.equal(requests.filter(r => r.method === "AssignModel" && r.body.observedField6).length, 1, "the update does not start a second handoff");
			assert(!children.some(r => !r.body.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("WINDOW_SECOND_BRIEF"))), "every child request carries the update");
			console.log("PASS actual OMP update window: concurrent calls share one cascade and the update is delivered");
		} else if (scenario === "restore-window" && !restoreFile) {
			await session.prompt("Run the first Fusion handoff to completion.");
			assert(childStep >= 2, "parent process runs the handoff through its read and report");
			// Close the lead's turn so the persisted session does not end on a tail
			// that is still waiting for a tool result.
			await session.prompt("Summarize the completed handoff.");
			// Reproduce the crash window: the completed handoff's settle record
			// carries its transcript, but the process died before delivering its
			// report. On reload `#ensureRestored()` replays that report and marks
			// it delivered — persisting a record for a handoff whose child Agent
			// does not exist yet. That record must not shadow the transcript.
			const { decodeFusionHandoffRecord } = await import(join(agentRoot, "src/session/fusion-handoff-snapshot.ts"));
			const settled = manager.getBranch()
				.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "fusion-sidekick")
				.map((entry: { data: unknown }) => decodeFusionHandoffRecord(entry.data))
				.filter((record: unknown): record is NonNullable<typeof record> => record !== undefined)
				.find((record: { messages: unknown[] }) => record.messages.length > 0);
			assert(settled, "completed handoff persisted its transcript");
			manager.appendCustomEntry("fusion-sidekick", {
				...settled,
				delivered: false,
			});
			const sessionFile = manager.getSessionFile();
			assert(sessionFile, "completed Fusion session must have durable storage");
			await manager.flush();
			// Let the lead's own turn settle before disposing: a session reopened
			// mid-turn reports its agent as busy and refuses the first prompt.
			const settle = Promise.withResolvers<void>();
			setTimeout(settle.resolve, 250);
			await settle.promise;
			await session.dispose();
			auth.close();
			const restarted = Bun.spawn([process.execPath, import.meta.path], {
				env: { ...process.env, OMP_FUSION_RESTORE_FILE: sessionFile, OMP_FUSION_WORKSPACE: workspace, OMP_FUSION_SCENARIO: "restore-window" },
				stdout: "inherit",
				stderr: "inherit",
			});
			assert.equal(await restarted.exited, 0, "restored session must retain the child transcript across the delivered-marker record");
			passed = true;
			handoffVerified = true;
		} else if (restoreFile && scenario === "restore-window") {
			// Restored process: the replayed delivered marker already persisted a
			// record for a handoff with no child Agent. The next handoff must
			// still see the original transcript. The replayed notification queues
			// a drain, so let the session reach idle before driving it.
			await session.waitForIdle();
			await session.prompt("Continue the restored native Fusion session.");
			assert(childStep >= 1, "restored session executes the requested handoff");
			const restoredChild = requests.find(r => r.method === "GetChatMessage" && r.body.chatModelUid === childUid)!.body;
			assert(restoredChild.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("WINDOW_BRIEF")), "restored child keeps the original brief");
			assert(restoredChild.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("CHILD_REPORT_FUSION_REAL_FILE_SENTINEL")), "restored child keeps the previous reply");
			assert(restoredChild.chatMessagePrompts.some((m: CapturedPrompt) => m.prompt.includes("WINDOW_RESTORED_BRIEF")), "restored child receives its new brief");
			console.log("PASS actual OMP crash window: delivered-marker record retains the child transcript");
		} else if (restoreFile) {
			await session.prompt("Continue the restored native Fusion session.");
			assert.equal(childStep, 1, "restored session executes one requested handoff");
			console.log("PASS actual OMP process reload: prior child brief/reply and new brief reach provider");
		} else {
			await session.prompt("Run the first native Fusion handoff.");
			assert.equal(childStep, 2);
			const firstChild = requests.find(r => r.method === "GetChatMessage" && r.body.chatModelUid === childUid)!.body;
			phase = "repeat";
			await session.prompt("Run the next handoff and retain history.");
			const children = requests.filter(r => r.method === "GetChatMessage" && r.body.chatModelUid === childUid);
			const lastChild = children.at(-1)!.body;
			assert.notEqual(lastChild.cascadeId, firstChild.cascadeId);
			assert(lastChild.chatMessagePrompts.some(m => m.prompt.includes("FIRST_BRIEF")));
			assert(lastChild.chatMessagePrompts.some(m => m.prompt.includes("CHILD_REPORT_FUSION_REAL_FILE_SENTINEL")));
			assert(lastChild.chatMessagePrompts.some(m => m.prompt.includes("SECOND_BRIEF")));
			assert(lastChild.chatMessagePrompts.some(m => m.thinking === "CHILD_THINKING_SENTINEL" && m.signature === "child-signature"), "new handoff replays signed child thinking");
			assert.equal(requests.filter(r => r.method === "AssignModel" && !r.body.observedField6).length, 1, "lead assignment is session-scoped");
			assert.equal(requests.filter(r => r.method === "AssignModel" && r.body.observedField6).length, 2, "one child assignment per completed handoff, not per tool step");
			console.log("PASS actual OMP SDK: discovery, role assignment, real read, repeat handoff history, assignment lifetime");
		}
		if (!handoffVerified) await manager.flush();
	} finally {
		if (!handoffVerified) await session.dispose();
		auth.close();
	}
	if (!handoffVerified && !restoreFile && scenario === "blocking") {
		const sessionFile = manager.getSessionFile();
		assert(sessionFile, "completed Fusion session must have durable storage");
		const restarted = Bun.spawn([process.execPath, import.meta.path], {
			env: { ...process.env, OMP_FUSION_RESTORE_FILE: sessionFile, OMP_FUSION_WORKSPACE: workspace },
			stdout: "inherit",
			stderr: "inherit",
		});
		assert.equal(await restarted.exited, 0, "fresh process must restore child provider-visible history");
	}
	}
	passed = true;
} finally {
	const evidenceDir = process.env.OMP_FUSION_EVIDENCE_DIR;
	if (evidenceDir) {
		await mkdir(evidenceDir, { recursive: true });
		await writeFile(join(evidenceDir, `${scenario}${restoreFile ? "-restored" : ""}.json`),
			JSON.stringify({ passed, scenario, restored: Boolean(restoreFile), readExecutions, deniedExecutions, requests },
				(_key, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2));
	}
	if (!restoreFile) await rm(workspace, { recursive: true, force: true });
}
