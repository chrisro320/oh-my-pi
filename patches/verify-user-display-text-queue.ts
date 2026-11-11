// Verify 0082: a prepared submission keeps the model text in `content` and the
// operator's original text in `displayText`, across queueing and resume.
//
// Drives a real `AgentSession` over a file-backed session manager and a mock
// model. No provider traffic; every dynamic import is runtime-selected from the
// OMP_PATCH_VERIFY_* roots so a static import cannot resolve the live install.
//
// Legs:
//   1. resume: a prepared prompt is persisted with content = model text and
//      displayText = original; a reopened session rebuilds the same `content`
//      (the model-side wire) and the same displayText.
//   2. queue identity (18.4.4 `removeQueuedMessage`, matched on the queued
//      message's raw identity first): a prepared follow-up whose model text
//      equals another queued message's original text must be removed by its own
//      original text, never by the other message's text. Negative control: with
//      the prepared message's raw identity recorded as its model text, removing
//      "hello" deletes the prepared message first and this gate fails.
//   3. abort drain (18.10.1+ queue-policy split): a steer queued during a
//      streaming turn that the user aborts is drained by exactly one
//      continuation. Runs in a child with a deadline because the regression is
//      a synchronous reschedule livelock that starves this process's timers.
//      Negative control: keeping `if (this.isStreaming) return false;` inside
//      `#canContinueQueuedMessages` (the 18.12.6 rebase defect) times out.
//   4. history listing: scanLines recovers the original past the bounded head;
//      an explicitly empty original in either the head or recovered gap remains
//      authoritative. Each case has a child-only source mutation control.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const NM = process.env.OMP_PATCH_VERIFY_NM;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
assert.ok(AI_ROOT, "OMP_PATCH_VERIFY_AI_ROOT must point to the pi-ai tree under test");
assert.ok(NM, "OMP_PATCH_VERIFY_NM must point to the @oh-my-pi node_modules tree under test");

const plan = resolvePlan({ gate: "verify-user-display-text-queue", roots: [AGENT_ROOT] });
// Queue identity, queue-policy split and the date/cwd reminder are common to
// every registered plan. The later scan-recovery cases are selected separately.
const ABORT_DRAIN_MARKER = "QUEUE_ABORT_DRAIN_OK";
const LISTING_MARKER = "DISPLAY_LISTING_OK";
const listingCase = process.env.OMP_VERIFY_DISPLAY_LISTING_CASE;
if (listingCase) {
	assert.ok(plan.since("18.18.2"), "scan recovery is selected by the registered plan");
	const listingFile = join(AGENT_ROOT, "src/session/session-listing.ts");
	const mutation = process.env.OMP_VERIFY_DISPLAY_LISTING_MUTATION === "1";
	const controls: Record<string, [string, string][]> = {
		"prefix-empty": [
			["let needPrompt = !firstPromptResolved && !firstMessage;", "let needPrompt = !firstMessage;"],
			["if (text || message.displayText !== undefined) {", "if (text) {"],
		],
		"recovered-original": [[
			'userDisplayText(message, " ").slice(0, SESSION_LIST_PREFIX_BYTES)',
			'textContent(message.content, " ").slice(0, SESSION_LIST_PREFIX_BYTES)',
		]],
		"recovered-empty": [[
			'if (!firstPromptResolved) firstMessage ||= extractFirstDisplayMessageFromPrefix(content) ?? "";',
			'firstMessage ||= extractFirstDisplayMessageFromPrefix(content) ?? "";',
		]],
	};
	assert.ok(controls[listingCase], `unknown listing case: ${listingCase}`);
	let loads = 0;
	// The runner mounts this gate's runtime read-only. Transform only the selected
	// module in this child, so the fault cannot leak into another case or gate.
	Bun.plugin({
		name: "display-listing-control",
		setup(build) {
			build.onLoad({ filter: /\/session\/session-listing\.ts$/ }, args => {
				assert.equal(args.path, listingFile, "the control must load the selected runtime");
				loads++;
				let contents = readFileSync(args.path, "utf8");
				if (mutation) {
					for (const [from, to] of controls[listingCase]) {
						assert.equal(contents.split(from).length, 2, "a listing mutation must match exactly once");
						contents = contents.replace(from, to);
					}
				}
				return { contents, loader: "ts" };
			});
		},
	});
	const { SessionManager: ListingManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const fixtures = join(tmpdir(), `omp-display-listing-${process.pid}`);
	const sessionDir = join(fixtures, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	try {
		const user = (content: string, displayText?: string) => ({
			type: "message", message: { role: "user", content, ...(displayText === undefined ? {} : { displayText }) },
		});
		const padding = (length: number) => ({ type: "custom", customType: "padding", data: "x".repeat(length) });
		const assistant = { type: "message", message: { role: "assistant", content: "SCAN-REPLY" } };
		const first = listingCase === "prefix-empty" ? user("HIDDEN-MODEL-TEXT", "") : undefined;
		const entries = [
			{ type: "session", id: listingCase, cwd: fixtures, timestamp: "2026-11-01T00:00:00.000Z" },
			...(first ? [first] : [{
				type: "message", message: { role: "developer", content: "PREFIX-FALLBACK" },
			}]),
			padding(6_000),
			user("LATER-MODEL-TEXT", listingCase === "recovered-original" ? "原始提問" : undefined),
			...(listingCase === "recovered-empty" ? [user("NOT-THE-FIRST-ORIGINAL", "later original")] : []),
			assistant,
			padding(40_000),
		];
		if (listingCase === "recovered-empty") {
			entries[3] = user("LATER-MODEL-TEXT", "");
		}
		const body = `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`;
		assert.ok(body.indexOf("LATER-MODEL-TEXT") > 4_096, "the recovered prompt must lie beyond the head");
		assert.ok(body.indexOf("SCAN-REPLY") < body.length - 32_768, "the assistant must lie before the tail");
		writeFileSync(join(sessionDir, `${listingCase}.jsonl`), body);
		const rows = await ListingManager.list(fixtures, sessionDir);
		assert.equal(rows.length, 1, "the public listing returns the synthetic session");
		assert.equal(loads, 1, "the selected listing source must be loaded once");
		assert.equal(rows[0].assistantTurns, 1, "the gap scan must retain upstream assistant recovery");
		const expected = listingCase === "recovered-original" ? "原始提問" : "(no messages)";
		assert.equal(rows[0].firstMessage, expected, `displayText authority: ${listingCase}`);
		assert.ok(!rows[0].allMessagesText.includes("HIDDEN-MODEL-TEXT"), "listing search never exposes the hidden prefix model text");
		if (listingCase === "recovered-original") {
			assert.ok(!rows[0].allMessagesText.includes("LATER-MODEL-TEXT"), "recovered search text stays original");
		}
		console.log(`${LISTING_MARKER} ${listingCase}`);
	} finally {
		rmSync(fixtures, { recursive: true, force: true });
	}
	process.exit(0);
}

const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);

const root = join(tmpdir(), `omp-display-text-test-${process.pid}`);
mkdirSync(root, { recursive: true });
registerMockApi("display-text-test");

type UserLike = { role: string; content: unknown; displayText?: string };

async function createTestSession(name: string, model: MockModel, manager: InstanceType<typeof SessionManager>) {
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
		getApiKey: () => "test",
		systemPrompt: "Test only.",
		sessionManager: manager,
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

if (process.env.OMP_VERIFY_QUEUE_ABORT_DRAIN_CHILD === "1") {
	const cwd = join(root, "abort-drain");
	mkdirSync(cwd, { recursive: true });
	const model = createMockModel({
		responses: [() => ({ delayMs: 5_000, content: ["held"] }), () => ({ content: ["steered"] })],
	});
	const session = await createTestSession("abort-drain", model, SessionManager.inMemory(cwd));
	try {
		const held = session.prompt("hold");
		while (model.calls.length === 0) await Bun.sleep(10);
		await session.steer("steer after abort");
		await session.abort();
		await held.catch(() => {});
		await session.waitForIdle();
		assert.equal(model.calls.length, 2, "the queued steer drains in exactly one continuation");
		assert.ok(
			JSON.stringify(model.calls[1].context.messages).includes("steer after abort"),
			"the continuation carries the queued steer",
		);
		assert.equal(session.agent.hasQueuedMessages(), false, "nothing stays queued");
		console.log(ABORT_DRAIN_MARKER);
	} finally {
		await session.dispose();
		rmSync(root, { recursive: true, force: true });
	}
	process.exit(0);
}

function userMessages(messages: UserLike[]): UserLike[] {
	return messages.filter(message => message.role === "user");
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	return (content as { type: string; text?: string }[])
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("");
}

/**
 * 18.18.0 prepends the date/cwd reminder to the first user turn of a request
 * (`date-cwd-reminder.ts`: `[{type:"text", text: reminder}, ...content]`).
 * Validate that known prefix — including the fixture cwd — and return the model
 * text that follows it, so the wire assertion stays a `startsWith`: an
 * unexpected prefix still fails instead of being tolerated.
 */
function stripDateCwdReminder(wire: string, expectedCwd: string): string {
	const open = "<system-reminder>\nToday: ";
	assert.ok(
		wire.startsWith(open),
		`the wire must begin with the date/cwd reminder: ${JSON.stringify(wire.slice(0, 160))}`,
	);
	const rest = wire.slice(open.length);
	const separator = "; current working directory: ";
	const at = rest.indexOf(separator);
	assert.ok(at > 0, `the date/cwd reminder has no cwd separator: ${JSON.stringify(rest.slice(0, 160))}`);
	assert.match(rest.slice(0, at), /^\d{4}-\d{2}-\d{2}$/, "the date/cwd reminder date must be YYYY-MM-DD");
	const tail = rest.slice(at + separator.length);
	const expectedTail = `'${expectedCwd}'. Do not repeat this information in your reply.\n</system-reminder>`;
	assert.ok(
		tail.startsWith(expectedTail),
		`the date/cwd reminder must name the fixture cwd ${expectedCwd}: ${JSON.stringify(tail.slice(0, 200))}`,
	);
	const body = tail.slice(expectedTail.length);
	return body.startsWith("\n\n") ? body.slice(2) : body;
}

try {
	// ── 1. resume keeps model text and display text ─────────────────────────
	{
		const cwd = join(root, "resume");
		mkdirSync(cwd, { recursive: true });
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const model = createMockModel({ responses: [() => ({ content: ["ok"] })] });
		const session = await createTestSession("resume", model, manager);
		try {
			await session.prompt("hello", { displayText: "\u4f60\u597d" });
			const liveUser = userMessages(session.agent.state.messages as UserLike[]);
			assert.equal(liveUser.length, 1);
			const liveText = textOf(liveUser[0].content);
			assert.equal(liveText, "hello", "live content is the model text");
			assert.ok(!liveText.includes("\u4f60\u597d"), "the original text never reaches the model-side content");
			assert.equal(liveUser[0].displayText, "\u4f60\u597d", "live displayText is the original");
			// The date/cwd reminder rides the wire only. 18.18.0 stamps it onto the
			// first user turn (prepended text block, date-cwd-reminder.ts:126-132),
			// which the admission above guarantees. Validate and strip it, then
			// assert the original prefix contract again: a garbage or unexpected
			// prefix must go red.
			const wireText = textOf((model.calls[0].context.messages as UserLike[])[0].content);
			const wireModelText = stripDateCwdReminder(wireText, cwd);
			assert.ok(wireModelText.startsWith(liveText), "wire model text starts with the model-side content");
			assert.ok(!wireText.includes("\u4f60\u597d"), "the original text never reaches the provider wire");

			const sessionFile = manager.getSessionFile();
			assert.ok(sessionFile, "session must be file-backed");
			await manager.flush();
			const reopened = await SessionManager.open(sessionFile);
			const rebuilt = userMessages(buildSessionContext(reopened.getEntries(), reopened.getLeafId()).messages as UserLike[]);
			assert.equal(rebuilt.length, 1);
			assert.equal(textOf(rebuilt[0].content), liveText, "rebuilt content equals the live model text byte for byte");
			assert.equal(rebuilt[0].displayText, "\u4f60\u597d", "rebuilt displayText equals the original");
		} finally {
			await session.dispose();
		}
	}

	// ── 2. queue identity: prepared vs plain message with equal model text ──
	const cwd = join(root, "queue");
	mkdirSync(cwd, { recursive: true });
	const release = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	const model = createMockModel({
		responses: [
			async () => {
				started.resolve();
				await release.promise;
				return { content: ["held"] };
			},
			() => ({ content: ["a"] }),
			() => ({ content: ["b"] }),
		],
	});
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const session = await createTestSession("queue", model, manager);
	try {
		const held = session.prompt("hold");
		await started.promise;
		await session.followUp("hello", undefined, { displayText: "\u4f60\u597d" });
		await session.followUp("hello");
		const users = () =>
			(session.agent.peekFollowUpQueue() as UserLike[]).filter(message => message.role === "user");
		assert.equal(users().length, 2, "both follow-ups queued");

		assert.equal(session.removeQueuedMessage("hello", "followUp"), true);
		const afterPlain = users();
		assert.equal(afterPlain.length, 1);
		assert.equal(afterPlain[0].displayText, "\u4f60\u597d", "removing the typed text 'hello' must delete the plain message, not the prepared one");

		assert.equal(session.removeQueuedMessage("\u4f60\u597d", "followUp"), true);
		assert.equal(users().length, 0, "the prepared message is removable by its original text");
		assert.equal(session.removeQueuedMessage("\u4f60\u597d", "followUp"), false, "nothing left to remove");
		release.resolve();
		await held;
	} finally {
		release.resolve();
		await session.dispose();
	}

	// ── 3. abort with a queued steer drains once (child, bounded) ────────────
	const child = Bun.spawnSync([process.execPath, import.meta.path], {
		env: { ...process.env, OMP_PATCH_VERSION: plan.version, OMP_VERIFY_QUEUE_ABORT_DRAIN_CHILD: "1" },
		timeout: 30_000,
		// The livelocked child never yields to its SIGTERM handler.
		killSignal: "SIGKILL",
	});
	const output = `${child.stdout.toString()}${child.stderr.toString()}`;
	assert.ok(
		child.exitCode === 0 && output.includes(ABORT_DRAIN_MARKER),
		`queued steer after abort must drain once (exit ${child.exitCode}, signal ${child.signalCode ?? "none"}; a timeout is the drain livelock): ${output.slice(-600)}`,
	);
	if (plan.since("18.18.2")) {
		for (const name of ["prefix-empty", "recovered-original", "recovered-empty"]) {
			const run = (mutation: boolean) => Bun.spawnSync([process.execPath, import.meta.path], {
				env: {
					...process.env,
					OMP_VERIFY_DISPLAY_LISTING_CASE: name,
					OMP_VERIFY_DISPLAY_LISTING_MUTATION: mutation ? "1" : "0",
				},
				timeout: 30_000,
				killSignal: "SIGKILL",
			});
			const positive = run(false);
			const output = positive.stdout.toString() + positive.stderr.toString();
			assert.equal(positive.exitCode, 0, `listing ${name} must pass: ${output}`);
			assert.ok(output.includes(`${LISTING_MARKER} ${name}`), "the listing case must finish its assertions");
			const negative = run(true);
			const detail = negative.stdout.toString() + negative.stderr.toString();
			assert.notEqual(negative.exitCode, 0, `listing ${name} mutation must fail`);
			assert.ok(
				detail.includes(`displayText authority: ${name}`),
				`listing ${name} must fail at display authority, not a loader or fixture error: ${detail}`,
			);
			console.log(`PASS listing ${name}; MUTATION RED exit ${negative.exitCode}\n${detail}`);
		}
	}
	console.log(`verify-user-display-text-queue: PASS (${plan.version}, queue identity, abort drain)`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
