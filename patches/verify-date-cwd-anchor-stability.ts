/**
 * Regression gate for patch 0047 — date/cwd reminder rides inside the last real
 * user message with a persisted anchor map, instead of a provider-only tail.
 *
 * Zero provider calls.
 *
 * Usage:
 *   OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-date-cwd-anchor-stability.ts
 *
 * Drives the actual reminder injector, then (18.10.0) the session manager's
 * new-ID fork and portable archive consumers. No copied key/adoption formula.
 *
 * Replays the exact failure this patch removes. Session
 * 01a0778e (claude-opus-5, ~620k ctx) reported `HISTORY_REWRITE` every turn
 * with `sharedPrefix` advancing in steps of TWO because the synthetic tail
 * occupied a message slot that the next turn's real assistant reply took over
 * (ROLE FLIP). The assertions below pin the `n-1` pure-tail-append shape and
 * the byte stability of already-stamped history.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const agentRoot = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
if (!agentRoot) throw new Error("OMP_PATCH_VERIFY_AGENT_ROOT must point at the pi-coding-agent package root");

const agentVersion = JSON.parse(readFileSync(join(agentRoot, "package.json"), "utf8")).version;
const privateProcess = process.env.OMP_DURABILITY_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-anchor-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR") delete process.env[key];
}
Object.assign(process.env, {
	HOME: privateHome, XDG_CONFIG_HOME: join(privateHome, "config"),
	XDG_CACHE_HOME: join(privateHome, "cache"), XDG_DATA_HOME: join(privateHome, "data"),
	XDG_STATE_HOME: join(privateHome, "state"),
});
process.on("exit", () => rmSync(privateHome, { recursive: true, force: true }));
// Private HOME must also precede runtime startup (os.homedir may be cached).
if (!privateProcess) {
	const child = Bun.spawnSync([process.execPath, import.meta.path, ...process.argv.slice(2)], {
		env: { ...process.env, OMP_DURABILITY_BOOT: "1", OMP_PATCH_VERIFY_AGENT_ROOT: agentRoot },
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => { throw new Error("Network forbidden in anchor gate"); }) as typeof fetch;

// Dynamic import is required here: the module path is the tree under
// OMP_PATCH_VERIFY_AGENT_ROOT, chosen at runtime so the same script can gate
// the live tree and a pristine sandbox copy. A static import would pin one
// tree and, worse, resolve the package name to bun's install cache (the 0020
// footgun).
const mod = (await import(join(agentRoot, "src/session/date-cwd-reminder.ts"))) as {
	applyDateCwdAnchors: (
		messages: unknown[],
		reminder: string,
		anchors: Record<string, string>,
	) => { messages: { role: string; content: unknown }[]; dirty: boolean };
	dateCwdAnchorKey: (message: unknown, content: string) => string;
	DateCwdReminderInjector: new (
		sessionId?: () => string | undefined,
		anchorRoot?: () => string,
		sessionFile?: () => string | undefined,
	) => {
		transform: (context: unknown, date: string, cwd: string) => { messages: { content: unknown }[] };
	};
};

if (process.argv[2] === "--archive-replay") {
	assert.ok(["18.10.0", "18.10.1"].includes(agentVersion));
	const { SessionManager } = await import(join(agentRoot, "src/session/session-manager.ts"));
	const manager = await SessionManager.open(process.argv[3]);
	try {
		const output = new mod.DateCwdReminderInjector(
			() => manager.getSessionId(), undefined, () => manager.getSessionFile(),
		).transform({ systemPrompt: ["sys"], messages: manager.buildSessionContext().messages }, "2026-09-08", process.argv[5]);
		await Bun.write(process.argv[4], JSON.stringify(output.messages));
	} finally {
		await manager.close();
	}
	process.exit(0);
}

const DAY1 = "<system-reminder> Today: 2026-09-06; cwd: '/repo'";
const DAY2 = "<system-reminder> Today: 2026-09-07; cwd: '/repo'";

const user = (content: string, timestamp: number) => ({ role: "user", content, timestamp });
const assistantMsg = (content: string, timestamp: number) => ({ role: "assistant", content, timestamp });

// Turn N: one user turn already answered, plus the new user message.
const anchors: Record<string, string> = {};
const turnN = [user("first question", 1000), assistantMsg("first answer", 1100), user("second question", 1200)];
const outN = mod.applyDateCwdAnchors(turnN, DAY1, anchors);

assert.equal(outN.messages.length, turnN.length, "message COUNT must never change (no synthetic slot)");
assert.equal(outN.dirty, true, "the newest user message must mint a stamp");
assert.equal(outN.messages[2]!.content, `second question\n\n${DAY1}`, "newest user message must carry the stamp");
assert.equal(outN.messages[0]!.content, "first question", "older unstamped history must stay byte-identical");
assert.equal(outN.messages[1]!.content, "first answer", "assistant messages must never be touched");

// Turn N+1: the previously-newest user message is now mid-history, and a real
// assistant reply plus a fresh user message were appended. This is exactly
// where the old shape produced ROLE FLIP.
const turnN1 = [
	...turnN,
	assistantMsg("second answer", 1300),
	user("third question", 1400),
];
const outN1 = mod.applyDateCwdAnchors(turnN1, DAY1, anchors);

assert.equal(outN1.messages.length, turnN1.length, "message COUNT must never change across turns");
assert.equal(
	outN1.messages[2]!.content,
	outN.messages[2]!.content,
	"a stamped message must keep its ORIGINAL bytes once it moves mid-history",
);
assert.equal(outN1.messages[3]!.content, "second answer", "no assistant message may be re-typed");
assert.equal(outN1.messages[4]!.content, `third question\n\n${DAY1}`, "the new user message gets the stamp");

// Pure tail append: everything before the last message is byte-identical to the
// previous turn's wire. Steps of 1, not 2 — that is the whole point.
const prev = outN.messages.map(m => JSON.stringify(m.content));
const next = outN1.messages.map(m => JSON.stringify(m.content));
let shared = 0;
while (shared < prev.length && prev[shared] === next[shared]) shared++;
assert.equal(shared, prev.length, `sharedPrefix must cover the whole previous wire, got ${String(shared)}/${String(prev.length)}`);
assert.equal(next.length - shared, 2, "only the new assistant+user pair may be new");

// Day rollover: only the NEXT new user message carries the new date. Exactly
// one stale `Today:` line is left behind, by design.
const turnN2 = [...turnN1, assistantMsg("third answer", 1500), user("fourth question", 1600)];
const outN2 = mod.applyDateCwdAnchors(turnN2, DAY2, anchors);
assert.equal(outN2.messages[2]!.content, `second question\n\n${DAY1}`, "rollover must not rewrite old stamps");
assert.equal(outN2.messages[4]!.content, `third question\n\n${DAY1}`, "rollover must not rewrite old stamps");
assert.equal(outN2.messages[6]!.content, `fourth question\n\n${DAY2}`, "only the new message carries the new date");

// A legacy provider-only tail (in-process Context reuse) must be stripped, not
// carried forward as another slot.
const withLegacyTail = [
	...turnN,
	{ role: "user", content: "<system-reminder> stale", providerOnly: true, timestamp: 1250 },
];
const outLegacy = mod.applyDateCwdAnchors(withLegacyTail, DAY1, anchors);
assert.equal(outLegacy.messages.length, turnN.length, "legacy providerOnly tail must be dropped");
assert.ok(
	!JSON.stringify(outLegacy.messages).includes("stale"),
	"legacy providerOnly content must not survive",
);

// Anchor key must be content-derived, not position-derived: two messages minted
// in the same millisecond must not share a stamp (the 0016 collision).
const k1 = mod.dateCwdAnchorKey(user("alpha", 42), "alpha");
const k2 = mod.dateCwdAnchorKey(user("beta", 42), "beta");
assert.notEqual(k1, k2, "same-timestamp messages with different content must get different anchor keys");

// Real sessions carry user messages as content BLOCK ARRAYS ((TextContent|
// ImageContent)[]), not plain strings — the loader path this gate missed on
// 2026-09-06, which silently disabled stamping for every real turn. The stamp
// must ride on the LAST text block and survive turn moves byte-identically.
function textBlocks(message: unknown): { type: string; text: string }[] {
	if (typeof message !== "object" || message === null || !("content" in message)) assert.fail("expected a message with content");
	const content = message.content;
	assert.ok(Array.isArray(content), "array-content message must keep an array content");
	return content.filter(
		(block: unknown): block is { type: string; text: string } =>
			typeof block === "object" && block !== null && "text" in block,
	);
}
const arrayUser = (text: string, timestamp: number) => ({
	role: "user",
	timestamp,
	content: [{ type: "text", text }],
});
const arrAnchors: Record<string, string> = {};
const arrN = [arrayUser("array first", 2000), assistantMsg("a1", 2100), arrayUser("array second", 2200)];
const arrOut = mod.applyDateCwdAnchors(arrN, DAY1, arrAnchors);
assert.equal(arrOut.dirty, true, "array-content messages must mint stamps too");
const arrBlocks = textBlocks(arrOut.messages[2]);
assert.equal(arrBlocks[arrBlocks.length - 1]!.text, `array second\n\n${DAY1}`, "stamp rides the last text block");
assert.equal(textBlocks(arrOut.messages[0])[0]!.text, "array first", "older array messages stay untouched");

// Turn moves + day rollover: the mid-history stamped array message must
// replay byte-identical blocks from the frozen anchor map.
const arrN1 = [...arrN, assistantMsg("a2", 2300), arrayUser("array third", 2400)];
const arrReplay = mod.applyDateCwdAnchors(arrN1, DAY2, arrAnchors);
assert.deepEqual(
	textBlocks(arrReplay.messages[2]),
	arrBlocks,
	"array-content stamps must freeze across turns and day rollovers",
);
const arrNewBlocks = textBlocks(arrReplay.messages[4]);
assert.equal(arrNewBlocks[arrNewBlocks.length - 1]!.text, `array third\n\n${DAY2}`, "newest array message stamps with the new date");

// Cross-process replay: a fresh injector with the same session id must reload
// the map and reproduce identical bytes. The anchor root is injected because
// getAgentDir() is frozen at module load — swapping HOME cannot redirect it.
const anchorRoot = mkdtempSync(join(tmpdir(), "0047-anchor-"));
try {
	const sid = "01a0778e-test";
	const ctx = { systemPrompt: ["sys"], messages: [user("persisted question", 2000)] };
	const first = new mod.DateCwdReminderInjector(
		() => sid,
		() => anchorRoot,
	).transform(ctx, "2026-09-06", "/repo");
	const stamped = first.messages[0]!.content;
	assert.ok(String(stamped).includes("persisted question"), "stamp must append to the original content");
	assert.ok(String(stamped).includes("2026-09-06"), "first stamp must carry the day it was minted");

	// Second "process", later day: the reloaded map must replay the ORIGINAL stamp.
	const second = new mod.DateCwdReminderInjector(
		() => sid,
		() => anchorRoot,
	).transform(ctx, "2026-09-07", "/repo");
	assert.equal(second.messages[0]!.content, stamped, "resume must replay the frozen stamp, not restamp with today");
} finally {
	rmSync(anchorRoot, { recursive: true, force: true });
}

if (["18.10.0", "18.10.1"].includes(agentVersion)) {
	const { SessionManager } = await import(join(agentRoot, "src/session/session-manager.ts"));
	const { packSession, unpackSession } = await import(join(agentRoot, "src/session/session-transfer.ts"));
	const root = mkdtempSync(join(tmpdir(), "omp-anchor-transfer-"));
	const cwd = join(root, "source");
	const targetCwd = join(root, "target");
	mkdirSync(cwd);
	mkdirSync(targetCwd);
	try {
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		manager.appendMessage(user("first anchored question", 10));
		await manager.ensureOnDisk();
		const injector = new mod.DateCwdReminderInjector(
			() => manager.getSessionId(), undefined, () => manager.getSessionFile(),
		);
		const context = () => ({ systemPrompt: ["sys"], messages: manager.buildSessionContext().messages });
		const first = injector.transform(context(), "2026-09-06", cwd);
		manager.appendMessage({
			role: "assistant", content: [{ type: "text", text: "first answer" }], timestamp: 11,
			api: "anthropic-messages", provider: "anthropic", model: "anchor-fixture", stopReason: "stop",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		});
		manager.appendMessage(user("second anchored question", 12));
		const committed = injector.transform(context(), "2026-09-06", cwd);
		assert.deepEqual(committed.messages[0], first.messages[0], "fixture's earlier anchor must already be frozen");
		await manager.flush();
		const oldId = manager.getSessionId();
		const fork = await manager.fork();
		assert.ok(fork, "actual manager must fork the journal");
		assert.notEqual(manager.getSessionId(), oldId, "fork must exercise a different session ID");
		const adopted = new mod.DateCwdReminderInjector(
			() => manager.getSessionId(), undefined, () => manager.getSessionFile(),
		).transform(context(), "2026-09-07", targetCwd);
		assert.deepEqual(adopted.messages, committed.messages, "new-ID adoption preserves every historical stamp byte");
		await manager.close();

		const archive = join(root, "portable.omp-session");
		await packSession(fork.newSessionFile, archive);
		// Only private fixture state is removed. The archive must stand alone,
		// without either source artifacts or workstation-global anchor maps.
		rmSync(join(root, "sessions"), { recursive: true, force: true });
		rmSync(join(privateHome, ".omp", "agent", "date-cwd-anchors"), { recursive: true, force: true });
		const imported = await unpackSession(archive, { cwd: targetCwd, sessionDir: join(root, "imported") });
		const replayPath = join(root, "portable-replay.json");
		const child = Bun.spawnSync([
			process.execPath, import.meta.path, "--archive-replay", imported.sessionFile, replayPath, targetCwd,
		], {
			env: { ...process.env, OMP_PATCH_VERIFY_AGENT_ROOT: agentRoot },
			stdout: "pipe", stderr: "pipe",
		});
		assert.equal(child.exitCode, 0, `portable first-process replay failed: ${child.stderr.toString()}`);
		const replayed = JSON.parse(readFileSync(replayPath, "utf8"));
		assert.equal(JSON.stringify(replayed.slice(0, committed.messages.length)), JSON.stringify(committed.messages),
			"the first process after import must send the same historical stamped bytes");
		const reopened = await SessionManager.open(imported.sessionFile);
		try {
			const portableInjector = new mod.DateCwdReminderInjector(
				() => reopened.getSessionId(), undefined, () => reopened.getSessionFile(),
			);
			const portable = portableInjector.transform(
				{ systemPrompt: ["sys"], messages: reopened.buildSessionContext().messages }, "2026-09-08", targetCwd,
			);
			assert.deepEqual(portable.messages.slice(0, committed.messages.length), committed.messages,
				"portable archive replays exact history without the source anchor store");
			reopened.appendMessage(user("new destination question", 13));
			const next = portableInjector.transform(
				{ systemPrompt: ["sys"], messages: reopened.buildSessionContext().messages }, "2026-09-08", targetCwd,
			);
			assert.deepEqual(next.messages.slice(0, committed.messages.length), committed.messages);
			assert.match(JSON.stringify(next.messages.at(-1)?.content), /2026-09-08/);
			assert.ok(JSON.stringify(next.messages.at(-1)?.content).includes(targetCwd),
				"only new destination history gets the destination cwd");
		} finally {
			await reopened.close();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

console.log("GATE 2 behaviour: PASS");
console.log("PASS date-cwd anchor stability: slot-stable, stamp-frozen, rollover-local, resume-replayable");
