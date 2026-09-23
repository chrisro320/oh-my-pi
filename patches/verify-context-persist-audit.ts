// Verify context-persist-audit: a context message that exists only in memory
// is reported on the request that first carries it, while the not-yet-persisted
// input tail (newest user prompt / tool result) is not.
//
// Sessions are real in-memory SessionManagers rebuilt with the same
// `buildSessionContext` the extension uses. The retry reminder leg uses the
// exact message shape turn-recovery appends before `scheduleAgentContinue`
// (18.2.10 `turn-recovery.ts` empty-stop / unexpected-stop paths): role
// `developer`, `attribution: "agent"`, never persisted. No provider traffic.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const EXTENSION = process.env.OMP_CONTEXT_AUDIT_EXTENSION ?? join(import.meta.dir, "context-persist-audit-extension.ts");

const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
// Bind the extension's package imports to AGENT_ROOT: resolved from this repo,
// the bare specifiers would pick up whatever version the repo's own install has.
const bound = join(mkdtempSync(join(tmpdir(), "cpa-ext-")), "extension.ts");
writeFileSync(
	bound,
	readFileSync(EXTENSION, "utf8").replace(
		/"@oh-my-pi\/pi-coding-agent\/(session\/[a-z-]+)"/g,
		(_match, sub: string) => JSON.stringify(`${AGENT_ROOT}/src/${sub}.ts`),
	),
);
const { auditContext, loadTrellisAnchors } = await import(bound);

type Msg = Record<string, unknown> & { role: string };
let clock = 1_000;
const user = (text: string): Msg => ({ role: "user", content: [{ type: "text", text }], timestamp: clock++ });
const assistant = (text: string): Msg => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "verify",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: clock++,
});
const retryReminder = (): Msg => ({
	role: "developer",
	content: [{ type: "text", text: "<system-reminder>Your previous turn stopped unexpectedly. Continue.</system-reminder>" }],
	attribution: "agent",
	timestamp: clock++,
});

function persisted(messages: Msg[]) {
	const manager = SessionManager.inMemory("/tmp");
	for (const message of messages) manager.appendMessage(message);
	return { manager, file: buildSessionContext(manager.getEntries(), manager.getLeafId()).messages as Msg[] };
}

// 1. Brand-new session, first request: the prompt is not in the entries yet.
{
	const prompt = user("hello");
	const { file } = persisted([]);
	const result = auditContext([prompt], file);
	assert.equal(result.status, "ok");
	assert.equal(result.pendingTail, 1);
}

// 2. Tool continuation: the newest tool result is the only unpersisted tail.
{
	const prompt = user("run it");
	const call = { ...assistant("calling"), content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] };
	const toolResult: Msg = {
		role: "toolResult",
		toolCallId: "t1",
		toolName: "bash",
		content: [{ type: "text", text: "done" }],
		isError: false,
		timestamp: clock++,
	};
	const { file } = persisted([prompt, call]);
	const result = auditContext([...file, toolResult], file);
	assert.equal(result.status, "ok");
	assert.equal(result.pendingTail, 1);
}

// 3. Retry reminder: reported on the very request that carries it.
const prompt = user("do the thing");
const reminder = retryReminder();
{
	const { file } = persisted([prompt]);
	const result = auditContext([...file, reminder], file);
	assert.equal(result.status, "live-extra", "a memory-only developer reminder at the tail must be reported");
	assert.equal(result.index, 1);
	assert.equal(result.live?.role, "developer");
	assert.equal(JSON.stringify(result).includes("unexpectedly"), false, "results must not carry message content");
}

// 4. Same reminder once the retry's reply is persisted behind it.
{
	const reply = assistant("continued");
	const { file } = persisted([prompt, reply]);
	const result = auditContext([...file.slice(0, 1), reminder, file[1]], file);
	assert.equal(result.status, "diverged");
	assert.equal(result.index, 1);
}

// 5. Unknown text appended to a persisted user message is drift, not an injection.
{
	const { file } = persisted([user("question"), assistant("answer"), user("follow-up")]);
	const live = file.map(message => ({ ...message }));
	live[2] = { ...live[2], content: [...(live[2].content as unknown[]), { type: "text", text: "memory-only" }] };
	const result = auditContext(live, file);
	assert.equal(result.status, "diverged");
	assert.equal(result.index, 2);
}

// 6. Trellis: only the exact anchored text is exempt; a corrupt anchor file throws for the caller.
{
	const root = mkdtempSync(join(tmpdir(), "cpa-verify-"));
	try {
		const { manager, file } = persisted([user("question"), assistant("answer"), user("follow-up")]);
		const target = file[2];
		const { createHash } = await import("node:crypto");
		const signature = createHash("sha256").update(JSON.stringify(target.content)).digest("hex").slice(0, 16);
		const key = `user:${target.timestamp}:${signature}`;
		const anchorsDir = join(root, ".trellis", ".runtime", "omp-anchors");
		mkdirSync(anchorsDir, { recursive: true });
		const anchorFile = join(anchorsDir, `omp_${manager.getSessionId()}.json`);
		writeFileSync(anchorFile, JSON.stringify({ [key]: "<trellis-state>x</trellis-state>" }));
		const anchors = loadTrellisAnchors(root, manager.getSessionId());
		const injected = file.map(message => ({ ...message }));
		injected[2] = {
			...injected[2],
			content: [...(injected[2].content as unknown[]), { type: "text", text: "<trellis-state>x</trellis-state>" }],
		};
		const exact = auditContext(injected, file, anchors);
		assert.equal(exact.status, "ok");
		assert.equal(exact.trellisInjected, 1);
		assert.equal(auditContext(file, file, anchors).status, "ok", "expansion must not depend on extension order");
		const wrong = file.map(message => ({ ...message }));
		wrong[2] = { ...wrong[2], content: [...(wrong[2].content as unknown[]), { type: "text", text: "<trellis-state>y</trellis-state>" }] };
		assert.equal(auditContext(wrong, file, anchors).status, "diverged");
		writeFileSync(anchorFile, "{broken");
		assert.throws(() => loadTrellisAnchors(root, manager.getSessionId()));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

rmSync(dirname(bound), { recursive: true, force: true });
console.log("context-persist-audit: ALL PASS");
