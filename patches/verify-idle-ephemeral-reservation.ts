// Verify 0010: the guarded idle side channel reserves the session against a
// main turn, and the surrounding lifecycle keeps that reservation honest.
//
// Every leg drives a real `AgentSession` against a scripted mock transport;
// no provider traffic, no persisted session, no live tree writes.
//
// Root selection mirrors the other gates: OMP_PATCH_VERIFY_<AGENT|AI>_ROOT,
// then OMP_PATCH_VERIFY_NM, then the live install. Imports are runtime-selected
// so an isolated sandbox tree cannot silently fall back to live packages.
//
// Version selection is a property of the selected tree, never of whether a
// symbol happens to exist: 18.2.3 added upstream's admitted-submission window
// (`#admitSubmission` around prompt()) and the session-transition funnel
// (`#beginSessionTransition`), both older than every registered release, so the
// two lifecycle legs below always run on the supported range.
// An unrecognized version fails closed — it is never a skip.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
// Type-only imports may use the bare specifier: they are erased at runtime, so
// they never resolve against the install cache and cannot read the wrong tree.
// (Runtime imports below are absolute precisely because they must NOT do that.)
import type { AgentSession, ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";
import type { Model } from "@oh-my-pi/pi-ai";

const plan = resolvePlan({ gate: "verify-idle-ephemeral-reservation", roots: [AGENT_ROOT] });
const agentVersion = plan.version;

const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);

const root = join(tmpdir(), `omp-idle-reservation-test-${process.pid}`);
mkdirSync(root, { recursive: true });
registerMockApi("idle-reservation-test");

async function createTestSession(
	name: string,
	model: MockModel,
	extensions: ExtensionFactory[] = [],
) {
	const cwd = join(root, name);
	mkdirSync(cwd, { recursive: true });
	const agentDir = join(cwd, "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "test");
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
	// A main turn that claims the session while an idle request is dispatching
	// must abort it and wait for it to settle before its own provider call.
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
					// Hold the transport open past the abort. The main turn may only
					// dispatch once this request has fully settled, so a main turn that
					// failed to join the reservation would arrive while this flag is still
					// set and trip the assertion below — the negative control that makes
					// "main waited" observable rather than merely plausible.
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

	// An abort-reset epoch must keep a superseded turn's finalizer from releasing
	// the replacement turn's accounting, and must leave the session usable: the
	// abandoned submitter never dispatches, the replacement does, and the
	// admission ledger drains so a further turn still runs to completion.
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
				() => {
					events.push("post-replacement-main-dispatch");
					return { content: ["post-replacement"] };
				},
			],
		});
		const epochProbe: ExtensionFactory = pi => {
			let probed = false;
			pi.on("before_agent_start", async (_event, ctx) => {
				if (probed) return;
				probed = true;
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
			// The superseded submitter's finally ran after #resetInFlight() bumped the
			// epoch, so its release is discarded while the replacement's is applied.
			// If that pairing were wrong the ledger would be unbalanced here, and the
			// next turn — the observable proof that the session is neither wedged nor
			// spuriously idle — would not reach its provider.
			assert.equal(await session.prompt("post replacement"), true);
			assert.deepEqual(events, [
				"side-dispatch",
				"side-abort",
				"side-settled",
				"replacement-main-dispatch",
				"post-replacement-main-dispatch",
			]);
			assert.equal(session.isStreaming, false, "session must settle after every interleaved turn");
		} finally {
			resolveReleaseSide();
			await session.dispose();
		}
	}

	// Disposal aborts an in-flight reservation instead of leaving it to dispatch
	// into a torn-down session.
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

	// Tree navigation holds the reservation for its whole body, including
	// extension hooks: an idle request arriving mid-navigation is refused.
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

	// Raw side turns keep their concurrency: runEphemeralTurn is the /btw and
	// /omfg path and must not be serialized behind a main turn.
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

	// Admitted-submission window: prompt() increments its admission counter
	// before preprocessing (slash-command dispatch, image normalization, vision
	// description) reaches #beginInFlight(), so for that whole window the
	// session is neither streaming nor in-flight. A guarded idle request must
	// still be refused — otherwise it dispatches a side request concurrently
	// with a submission the host already accepted.
	//
	// The window is held deterministically by an extension command that parks
	// inside #tryExecuteExtensionCommand, which runs from #dispatchPrompt
	// inside #admitSubmission and before any in-flight accounting.
	{
		const { promise: heldEntered, resolve: resolveHeldEntered } = Promise.withResolvers<void>();
		const { promise: releaseHeld, resolve: resolveReleaseHeld } = Promise.withResolvers<void>();
		const holdAdmission: ExtensionFactory = pi => {
			pi.registerCommand("holdadmission", {
				description: "test-only admission window hold",
				handler: async () => {
					resolveHeldEntered();
					await releaseHeld;
				},
			});
		};
		const model = createMockModel({ responses: [{ content: ["must not dispatch"] }] });
		const session = await createTestSession("admission-window", model, [holdAdmission]);
		try {
			const admitted = session.prompt("/holdadmission");
			await heldEntered;
			assert.equal(session.hasAdmittedSubmission, true, "the submission must be admitted but unstarted");
			assert.equal(session.isStreaming, false, "the admission window must look idle to the old gate");
			const idleResult = await session.runIdleEphemeralTurn({ promptText: "admission-probe" });
			assert.equal(idleResult, undefined, "a guarded idle request must not enter an admitted window");
			assert.equal(
				model.calls.length,
				0,
				"no provider dispatch may happen while a submission is admitted",
			);
			resolveReleaseHeld();
			assert.equal(await admitted, false, "the command consumed the submission locally");
			assert.equal(model.calls.length, 0);
		} finally {
			resolveReleaseHeld();
			await session.dispose();
		}
	}

	// Reservation vs transition: an idle reservation acquired before a session
	// transition begins must be aborted synchronously at transition entry —
	// before the transition's first await — so no side dispatch can land in a
	// transcript the transition is about to replace. resetSessionContext is the
	// transition path with no tree/branch framing at all, which is exactly why
	// it must not be missed.
	{
		const events: string[] = [];
		const { promise: sideStarted, resolve: resolveSideStarted } = Promise.withResolvers<void>();
		const { promise: sideAborted, resolve: resolveSideAborted } = Promise.withResolvers<void>();
		const releaseSide = Promise.withResolvers<void>();
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
					await releaseSide.promise;
					events.push("side-settled");
					return { content: ["late canceled idle result"] };
				},
				() => {
					events.push("post-transition-main-dispatch");
					return { content: ["after transition"] };
				},
			],
		});
		const session = await createTestSession("transition-entry", model);
		try {
			const idle = session.runIdleEphemeralTurn({ promptText: "guarded-keepalive" });
			await sideStarted;
			const dispatchCallsBeforeTransition = model.calls.length;
			const transition = session.resetSessionContext();
			assert.deepEqual(
				events,
				["side-dispatch", "side-abort"],
				"transition entry must synchronously abort the idle reservation",
			);
			// Abort is synchronous; history/identity adoption must wait even if
			// the provider eventually produces a successful late completion.
			await sideAborted;
			await Bun.sleep(0);
			assert.equal(
				model.calls.length,
				dispatchCallsBeforeTransition,
				"transition entry must not dispatch anything new",
			);
			releaseSide.resolve();
			const [idleResult] = await Promise.all([idle, transition]);
			assert.equal(idleResult, undefined);
			assert.deepEqual(events, ["side-dispatch", "side-abort", "side-settled"]);
			assert.doesNotMatch(JSON.stringify(session.messages), /late canceled idle result|guarded-keepalive/);
			assert.doesNotMatch(JSON.stringify(session.sessionManager.getEntries()), /late canceled idle result|guarded-keepalive/);
			assert.equal(await session.prompt("after transition"), true);
			assert.deepEqual(events, [
				"side-dispatch",
				"side-abort",
				"side-settled",
				"post-transition-main-dispatch",
			]);
		} finally {
			releaseSide.resolve();
			await session.dispose();
		}
	}

	// A transition awaiting its first reset step must reject newly arriving
	// idle requests even when no previous reservation or main turn exists.
	{
		const model = createMockModel({ responses: [{ content: ["must not dispatch"] }] });
		const session = await createTestSession("transition-window", model);
		try {
			const transition = session.resetSessionContext();
			assert.equal(session.isSessionTransitioning, true);
			const idle = session.runIdleEphemeralTurn({ promptText: "transition-probe" });
			await transition;
			assert.equal(await idle, undefined, "a guarded idle request must not enter a transition window");
			assert.equal(model.calls.length, 0, "transition window must not dispatch idle provider work");
		} finally {
			await session.dispose();
		}
	}

	// Two scheduled continuations must share the attempt published while an
	// aborted idle transport is still settling, rather than dispatch twice.
	const sideStarted = Promise.withResolvers<void>();
	const sideAborted = Promise.withResolvers<void>();
	const releaseSide = Promise.withResolvers<void>();
	let continuationCalls = 0;
	const model = createMockModel({
		responses: [
			{ content: ["seed"] },
			async (_context, options) => {
				assert.ok(options?.signal);
				options.signal.addEventListener("abort", () => sideAborted.resolve(), { once: true });
				sideStarted.resolve();
				await releaseSide.promise;
				return { throw: "aborted" };
			},
			() => {
				continuationCalls++;
				return { content: ["continued"] };
			},
			{ content: ["next ordinary turn"] },
		],
	});
	const session = await createTestSession("scheduled-coalescing", model);
	try {
		await session.prompt("seed");
		// A committed re-answer leaves input awaiting continuation; assistant
		// tails alone are deliberately not continuable by Agent.continue().
		const pendingInput = { role: "user" as const, content: "Revised answer", timestamp: 1 };
		session.agent.appendMessage(pendingInput);
		session.sessionManager.appendMessage(pendingInput);
		const continuationErrors: unknown[] = [];
		const realContinue = session.agent.continue.bind(session.agent);
		session.agent.continue = async signal => {
			try {
				await realContinue(signal);
			} catch (error) {
				continuationErrors.push(error);
				throw error;
			}
		};
		const idle = session.runIdleEphemeralTurn({ promptText: "held side transport" });
		await sideStarted.promise;
		session.resumeAfterAskReanswer();
		await sideAborted.promise;
		session.resumeAfterAskReanswer();
		await Bun.sleep(0);
		assert.equal(continuationCalls, 0, "scheduled continue must wait for idle settlement");
		releaseSide.resolve();
		await idle;
		await session.waitForIdle();
		assert.equal(continuationCalls, 1, "scheduled continuations must coalesce during idle settlement");
		assert.equal(model.calls.length, 3, "only seed, idle and one continuation may dispatch");
		assert.deepEqual(continuationErrors, [], "coalesced requests must not cause busy or invalid-tail failures");
		assert.equal(await session.prompt("next ordinary turn"), true, "continuation accounting must drain");
		assert.equal(model.calls.length, 4);
	} finally {
		releaseSide.resolve();
		await session.dispose();
	}

	// F9/R6: both ask-reanswer (without an explicit scheduler generation) and
	// ordinary prompt admission can pause in real primary restoration. The
	// same held local lookup must lose ownership when navigation commits.

	// Host completeness (extension-runtime-contracts 77-79): every host object
	// that hands extensions `getSystemPrompt` must also hand them the idle
	// side-turn hook, or /cron's keepalive cannot reserve on that surface.
	const HOST_SITES: Array<[string, number]> = [
		["src/modes/runtime-init.ts", 1],
		["src/modes/acp/acp-agent.ts", 1],
		["src/modes/controllers/extension-ui-controller.ts", 2],
		["src/extensibility/extensions/runner.ts", 1],
		["src/session/agent-session.ts", 1],
	];
	let hostSites = 0;
	for (const [relative, expected] of HOST_SITES) {
		const source = readFileSync(join(AGENT_ROOT, relative), "utf8");
		let from = 0;
		for (let site = 0; site < expected; site++) {
			const at = source.indexOf("getSystemPrompt:", from);
			assert.ok(at >= 0, `${relative}: expected ${expected} getSystemPrompt host constructions`);
			const line = source.slice(0, at).split("\n").length;
			assert.ok(
				/runIdleEphemeralTurn(?![A-Za-z])/.test(source.slice(at, at + 2000)),
				`${relative}:${line} getSystemPrompt host lacks runIdleEphemeralTurn`,
			);
			from = at + 1;
			hostSites++;
		}
	}
	assert.equal(hostSites, 6, "the 0010 host surface is five files / six constructions");
	console.log(`idle ephemeral reservation verification: ${hostSites} extension hosts supply runIdleEphemeralTurn`);

	console.log(`idle ephemeral reservation verification: ok (${agentVersion})`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
