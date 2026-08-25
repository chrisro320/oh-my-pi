import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { createMockModel, registerMockApi } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/mock.ts";
import {
	createAgentSession,
	discoverAuthStorage,
} from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/sdk.ts";
import type { ExtensionFactory } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts";
import { SessionManager } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-manager.ts";

const root = `/tmp/omp-idle-reservation-test-${process.pid}`;
mkdirSync(root, { recursive: true });
registerMockApi("idle-reservation-test");

async function createTestSession(
	name: string,
	model: ReturnType<typeof createMockModel>,
	extensions: ExtensionFactory[] = [],
) {
	const cwd = `${root}/${name}`;
	mkdirSync(cwd, { recursive: true });
	const agentDir = `${cwd}/agent`;
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.setRuntimeApiKey("mock", "test");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		model,
		extensions,
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
		restrictToolNames: extensions.length === 0,
	});
	return session;
}

try {
	{
		const events: string[] = [];
		let sideTransportActive = false;
		const { promise: sideStarted, resolve: resolveSideStarted } = Promise.withResolvers<void>();
		const model = createMockModel({
			responses: [
				async (_context, options) => {
					events.push("side-dispatch");
					sideTransportActive = true;
					const signal = options?.signal;
					assert.ok(signal, "idle request must carry an abort signal");
					const { promise: aborted, resolve: resolveAborted } = Promise.withResolvers<void>();
					signal.addEventListener(
						"abort",
						() => {
							events.push("side-abort");
							resolveAborted();
						},
						{ once: true },
					);
					resolveSideStarted();
					await aborted;
					await Bun.sleep(100);
					sideTransportActive = false;
					events.push("side-settled");
					return { throw: "aborted" };
				},
				() => {
					events.push("main-dispatch");
					assert.equal(sideTransportActive, false, "main provider dispatch overlapped the idle request");
					return { content: ["main"] };
				},
			],
		});
		const session = await createTestSession("ordered", model);
		try {
			const idle = session.runIdleEphemeralTurn({ promptText: "guarded-keepalive" });
			await sideStarted;
			const main = session.prompt("main");
			const [idleResult] = await Promise.all([idle, main]);
			assert.equal(idleResult, undefined);
			assert.deepEqual(events, ["side-dispatch", "side-abort", "side-settled", "main-dispatch"]);
			assert.equal(model.calls.length, 2);
			assert.doesNotMatch(JSON.stringify(session.messages), /guarded-keepalive/);
			assert.doesNotMatch(JSON.stringify(session.sessionManager.getEntries()), /guarded-keepalive/);
		} finally {
			await session.dispose();
		}
	}

	{
		const events: string[] = [];
		const idleProbeResults: unknown[] = [];
		const { promise: sideStarted, resolve: resolveSideStarted } = Promise.withResolvers<void>();
		const { promise: sideAborted, resolve: resolveSideAborted } = Promise.withResolvers<void>();
		const { promise: releaseSide, resolve: resolveReleaseSide } = Promise.withResolvers<void>();
		const model = createMockModel({
			responses: [
				async (_context, options) => {
					events.push("side-dispatch");
					const signal = options?.signal;
					assert.ok(signal);
					signal.addEventListener(
						"abort",
						() => {
							events.push("side-abort");
							resolveSideAborted();
						},
						{ once: true },
					);
					resolveSideStarted();
					await sideAborted;
					await releaseSide;
					events.push("side-settled");
					return { throw: "aborted" };
				},
				() => {
					events.push("replacement-main-dispatch");
					return { content: ["replacement"] };
				},
			],
		});
		const epochProbe: ExtensionFactory = pi => {
			pi.on("before_agent_start", async (_event, ctx) => {
				idleProbeResults.push(await ctx.runIdleEphemeralTurn({ promptText: "epoch-probe" }));
			});
		};
		const session = await createTestSession("superseded", model, [epochProbe]);
		try {
			const idle = session.runIdleEphemeralTurn({ promptText: "guarded-keepalive" });
			await sideStarted;
			const supersededMain = session.prompt("superseded main");
			await sideAborted;
			await session.abort();
			const replacementMain = session.prompt("replacement main");
			resolveReleaseSide();
			const [idleResult] = await Promise.all([idle, supersededMain, replacementMain]);
			assert.equal(idleResult, undefined);
			assert.deepEqual(events, ["side-dispatch", "side-abort", "side-settled", "replacement-main-dispatch"]);
			assert.deepEqual(idleProbeResults, [undefined]);
			assert.equal(model.calls.length, 2, "only the guarded side request and replacement main may dispatch");
		} finally {
			resolveReleaseSide();
			await session.dispose();
		}
	}

	{
		const events: string[] = [];
		const { promise: sideStarted, resolve: resolveSideStarted } = Promise.withResolvers<void>();
		const model = createMockModel({
			responses: [
				async (_context, options) => {
					events.push("side-dispatch");
					const signal = options?.signal;
					assert.ok(signal);
					const { promise: aborted, resolve: resolveAborted } = Promise.withResolvers<void>();
					signal.addEventListener(
						"abort",
						() => {
							events.push("side-abort");
							resolveAborted();
						},
						{ once: true },
					);
					resolveSideStarted();
					await aborted;
					events.push("side-settled");
					return { throw: "aborted" };
				},
			],
		});
		const session = await createTestSession("dispose", model);
		const idle = session.runIdleEphemeralTurn({ promptText: "dispose-keepalive" });
		await sideStarted;
		const dispose = session.dispose();
		const [idleResult] = await Promise.all([idle, dispose]);
		assert.equal(idleResult, undefined);
		assert.deepEqual(events, ["side-dispatch", "side-abort", "side-settled"]);
	}

	{
		const model = createMockModel({ responses: [{ content: ["must not dispatch"] }] });
		const session = await createTestSession("tree-entry-gate", model);
		try {
			const navigation = session.navigateTree("missing-entry");
			const idleResult = await session.runIdleEphemeralTurn({ promptText: "tree-entry-probe" });
			assert.equal(idleResult, undefined);
			await assert.rejects(navigation, /Entry missing-entry not found/);
			assert.equal(model.calls.length, 0);
		} finally {
			await session.dispose();
		}
	}

	{
		const events: string[] = [];
		let rawSideActive = false;
		const { promise: rawStarted, resolve: resolveRawStarted } = Promise.withResolvers<void>();
		const { promise: releaseRaw, resolve: resolveReleaseRaw } = Promise.withResolvers<void>();
		const model = createMockModel({
			responses: [
				async () => {
					events.push("raw-side-dispatch");
					rawSideActive = true;
					resolveRawStarted();
					await releaseRaw;
					rawSideActive = false;
					events.push("raw-side-settled");
					return { content: ["raw"] };
				},
				() => {
					events.push("main-dispatch");
					assert.equal(rawSideActive, true, "raw runEphemeralTurn must remain concurrent with main turns");
					return { content: ["main"] };
				},
			],
		});
		const session = await createTestSession("raw-concurrent", model);
		try {
			const raw = session.runEphemeralTurn({ promptText: "raw-side" });
			await rawStarted;
			await session.prompt("main");
			assert.deepEqual(events, ["raw-side-dispatch", "main-dispatch"]);
			resolveReleaseRaw();
			await raw;
			assert.deepEqual(events, ["raw-side-dispatch", "main-dispatch", "raw-side-settled"]);
			assert.doesNotMatch(JSON.stringify(session.messages), /raw-side/);
		} finally {
			resolveReleaseRaw();
			await session.dispose();
		}
	}

	console.log("idle ephemeral reservation verification: ok");
} finally {
	rmSync(root, { recursive: true, force: true });
}
