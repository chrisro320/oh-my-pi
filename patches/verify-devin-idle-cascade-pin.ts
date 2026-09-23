// Verify 0060: the guarded idle keepalive pins Devin's conversationId
// (cascade_id) to the main session so it warms the same cache chain, while
// concurrent-capable side turns (/btw, /omfg via runEphemeralTurn) keep a
// unique `:side:` identity and no conversationId, and non-devin providers
// never receive the field (cursor keys append-only state off it).
//
// The three legs are generic behaviours, not 18.2.3-specific: they hold on
// every plan that carries 0060 (18.1.18 and 18.2.3). The version predicate is
// therefore a fail-closed membership check for the plans that own this patch,
// never a silent skip — an unrecognized selected tree is an error.
//
// Root selection mirrors the other gates: OMP_PATCH_VERIFY_<AGENT|AI>_ROOT,
// then OMP_PATCH_VERIFY_NM, then the live install. Every runtime import is
// absolute and resolved through those roots (never a bare specifier) so an
// isolated sandbox tree cannot fall back to the install cache's pristine copy.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;

const agentVersion: string = JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version;
assert.ok(
	["18.1.18", "18.2.3", "18.2.10"].includes(agentVersion),
	`verify-devin-idle-cascade-pin: 0060 is not part of the ${agentVersion} plan`,
);

const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);

const root = join(tmpdir(), `omp-devin-cascade-test-${process.pid}`);
mkdirSync(root, { recursive: true });
registerMockApi("idle-cascade-test");

async function createTestSession(name: string, model: MockModel) {
	const cwd = join(root, name);
	mkdirSync(cwd, { recursive: true });
	const agentDir = join(cwd, "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.setRuntimeApiKey("mock", "test");
	authStorage.setRuntimeApiKey("devin", "test");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		model,
		getApiKey: () => "test",
		systemPrompt: "Test only.",
		sessionManager: SessionManager.inMemory(cwd),
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		disableExtensionDiscovery: true,
		enableMCP: false,
		preloadedCustomToolPaths: [],
		enableLsp: false,
		skipPythonPreflight: true,
		toolNames: [],
		restrictToolNames: true,
	});
	return session;
}

const okResponse = { content: ["."], stopReason: "stop" as const };

try {
	// devin provider: the guarded idle keepalive pins conversationId to the main
	// session while keeping its unique routing identity — and concurrently
	// capable side turns do neither.
	{
		const seen: SimpleStreamOptions[] = [];
		const model = createMockModel({
			provider: "devin",
			handler: (_ctx, options) => {
				seen.push(options!);
				return okResponse;
			},
		});
		const session = await createTestSession("devin", model);
		try {
			const result = await session.runIdleEphemeralTurn({ promptText: "keepalive" });
			assert(result, "idle keepalive should run on an idle session");
			assert.equal(seen.length, 1);
			assert.equal(
				seen[0]!.conversationId,
				session.sessionId,
				"idle keepalive must pin the main conversation cascade",
			);
			assert.ok(
				(seen[0]!.sessionId ?? "").startsWith(`${session.sessionId}:side:`),
				"routing identity must stay unique per side request",
			);

			// Concurrent-capable side turn (/btw path): no conversationId.
			await session.runEphemeralTurn({ promptText: "btw" });
			assert.equal(seen.length, 2);
			assert.equal(
				seen[1]!.conversationId,
				undefined,
				"runEphemeralTurn must not share the main cascade",
			);
			assert.ok(
				(seen[1]!.sessionId ?? "").startsWith(`${session.sessionId}:side:`),
				"the /btw side turn keeps its own :side: lineage",
			);
		} finally {
			await session.dispose();
		}
	}

	// non-devin provider: the guarded idle path never pins, so cursor (which
	// keys append-only state off conversationId) keeps its per-request chain.
	{
		const seen: SimpleStreamOptions[] = [];
		const model = createMockModel({
			handler: (_ctx, options) => {
				seen.push(options!);
				return okResponse;
			},
		});
		const session = await createTestSession("other", model);
		try {
			await session.runIdleEphemeralTurn({ promptText: "keepalive" });
			assert.equal(seen.length, 1);
			assert.equal(
				seen[0]!.conversationId,
				undefined,
				"non-devin providers keep the unique side identity",
			);
		} finally {
			await session.dispose();
		}
	}

	// Forwarding layer: the provider only sees `conversationId` if
	// `mapOptionsForApi` copies it off SimpleStreamOptions. The mock handler
	// above runs *before* that mapping, so on its own it cannot catch a pin
	// that survives `runEphemeralTurn` yet is dropped in `stream.ts` — which is
	// exactly how 0060 shipped as a no-op. Assert the mapping directly.
	{
		const { mapOptionsForApi } = await import(`${AI_ROOT}/src/stream.ts`);
		assert.equal(
			typeof mapOptionsForApi,
			"function",
			"stream.ts must export the option mapper for this gate",
		);
		// `mapOptionsForApi` dispatches on the model's `api`, so this leg needs a
		// real devin model shape — the mock api has no branch there.
		const devinModel = { provider: "devin", api: "devin-agent", id: "swe-2" };
		const mapped: unknown = mapOptionsForApi(devinModel as never, {
			sessionId: "main-session",
			conversationId: "main-session",
		});
		assert.equal(
			mapped && typeof mapped === "object" && "conversationId" in mapped ? mapped.conversationId : undefined,
			"main-session",
			"mapOptionsForApi must forward conversationId or the provider never receives the pin",
		);
		const unpinned: unknown = mapOptionsForApi(devinModel as never, { sessionId: "main-session" });
		assert.equal(
			unpinned && typeof unpinned === "object" && "conversationId" in unpinned
				? unpinned.conversationId
				: undefined,
			undefined,
			"absent conversationId must stay absent",
		);
	}

	console.log(`devin idle cascade pin verification: ok (${agentVersion})`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
