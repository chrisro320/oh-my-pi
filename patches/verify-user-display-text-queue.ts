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
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const NM = process.env.OMP_PATCH_VERIFY_NM;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
assert.ok(AI_ROOT, "OMP_PATCH_VERIFY_AI_ROOT must point to the pi-ai tree under test");
assert.ok(NM, "OMP_PATCH_VERIFY_NM must point to the @oh-my-pi node_modules tree under test");

const agentVersion = String(
	(JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version,
);
// removeQueuedMessage (the queue identity leg) exists from 18.4.4; the resume leg
// is version independent. A tree outside the supported set must fail, never skip.
assert.ok(
	["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion),
	`user display text gate: unsupported selected tree version ${agentVersion}`,
);
const hasQueueRemoval = ["18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion);

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
			// The provider tail (date/cwd reminder) is appended on the wire only.
			assert.ok(
				textOf((model.calls[0].context.messages as UserLike[])[0].content).startsWith(liveText),
				"wire carries the model-side content",
			);

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
	if (hasQueueRemoval) {
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
	}
	console.log(`verify-user-display-text-queue: PASS (${agentVersion}${hasQueueRemoval ? ", queue identity" : ", resume only"})`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
