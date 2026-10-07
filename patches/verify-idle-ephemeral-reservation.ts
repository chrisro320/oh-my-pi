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
// (`#beginSessionTransition`), so the two lifecycle legs guarded by
// `hasSubmissionWindow` run only where those APIs are the real contract.
// An unrecognized version fails closed — it is never a skip.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
// Type-only imports may use the bare specifier: they are erased at runtime, so
// they never resolve against the install cache and cannot read the wrong tree.
// (Runtime imports below are absolute precisely because they must NOT do that.)
import type { ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const agentVersion: string = JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version;
assert.ok(
	["18.1.14", "18.1.18", "18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(agentVersion),
	`verify-idle-ephemeral-reservation: unsupported selected tree version ${agentVersion}`,
);
const hasSubmissionWindow = ["18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(agentVersion);

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
	if (["18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(agentVersion)) authStorage.keys.setRuntime("mock", "test");
	else authStorage.setRuntimeApiKey("mock", "test");
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

	if (hasSubmissionWindow) {
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
						events.push("side-settled");
						return { throw: "aborted" };
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
				// The reservation must not outlive transition entry. Nothing else can
				// abort this request, so observing its abort here proves entry did it,
				// and the dispatch count proves entry aborted rather than awaited.
				await sideAborted;
				assert.equal(
					model.calls.length,
					dispatchCallsBeforeTransition,
					"transition entry must not dispatch anything new",
				);
				const [idleResult] = await Promise.all([idle, transition]);
				assert.equal(idleResult, undefined);
				assert.deepEqual(events, ["side-dispatch", "side-abort", "side-settled"]);
				assert.equal(await session.prompt("after transition"), true);
				assert.deepEqual(events, [
					"side-dispatch",
					"side-abort",
					"side-settled",
					"post-transition-main-dispatch",
				]);
			} finally {
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
	} else {
		console.log(
			`note: ${agentVersion} has no admitted-submission window or session-transition funnel; ` +
				"those legs run on 18.2.3/18.2.10 only",
		);
	}

	// Two scheduled continuations must share the attempt published while an
	// aborted idle transport is still settling, rather than dispatch twice.
	if (hasSubmissionWindow) {
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
	}

	console.log(`idle ephemeral reservation verification: ok (${agentVersion})`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
