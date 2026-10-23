import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const extensionPath = resolve(process.env.OMP_TRELLIS_EXTENSION ?? ".omp/extensions/trellis/index.ts");
// Runtime selection loads the saved pre-fix control with the same behavioral assertions.
const { default: loadExtension } = await import(pathToFileURL(extensionPath).href);
const root = mkdtempSync(join(tmpdir(), "omp-trellis-refill-"));
const originalAgent = process.env.PI_BLOCKED_AGENT;
type Message = { role: string; timestamp: number; content: string | { type: string; text: string }[] };
type Entry = { type: string; id: string; [key: string]: unknown };
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const sessionId = "refill-fixture";
const contextKey = `omp_${sessionId}`;
const task = ".trellis/tasks/refill";
const anchorPath = join(root, ".trellis/.runtime/omp-anchors", `${contextKey}.json`);
let branch: Entry[] = [];
let leafId = "leaf";
let aborts = 0;
const ctx = {
	cwd: root,
	abort() { aborts++; },
	ui: { notify() {} },
	sessionManager: {
		getSessionId: () => sessionId,
		getBranch: () => branch,
		getLeafId: () => leafId,
		getEntries: () => branch,
	},
};

function put(path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

function anchorKey(message: Message): string {
	const signature = createHash("sha256")
		.update(typeof message.content === "string" ? message.content : JSON.stringify(message.content))
		.digest("hex").slice(0, 16);
	return `${message.role}:${message.timestamp}:${signature}`;
}

async function harness(agent?: string) {
	if (agent) process.env.PI_BLOCKED_AGENT = agent;
	else delete process.env.PI_BLOCKED_AGENT;
	const harnessCtx = agent ? {
		...ctx,
		sessionManager: { ...ctx.sessionManager, getSessionId: () => `${sessionId}-${agent}` },
	} : ctx;
	if (agent) put(`.trellis/.runtime/sessions/omp_${sessionId}-${agent}.json`, JSON.stringify({ current_task: task }));
	const handlers = new Map<string, Handler[]>();
	loadExtension({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
	});
	async function emit(name: string, event: Record<string, unknown> = {}) {
		let result: unknown;
		for (const handler of handlers.get(name) ?? []) result = await handler(event, harnessCtx);
		return result;
	}
	await emit("session_start");
	return {
		emit,
		async project(messages: Message[]) {
			const result = await emit("context", { messages }) as { messages?: Message[] } | undefined;
			return result?.messages ?? messages;
		},
	};
}

try {
	put(`${task}/task.json`, JSON.stringify({ status: "in_progress", title: "Refill fixture" }));
	put(".trellis/.runtime/sessions/" + contextKey + ".json", JSON.stringify({ current_task: task }));
	put(".trellis/workflow.md", "[workflow-state:in_progress]\nContinue the fixture.\n[/workflow-state:in_progress]\n");
	put(`${task}/prd.md`, "PRIVATE_PRD_BODY\n".repeat(20_000));
	put(`${task}/info.md`, "PRIVATE_INFO_BODY\n".repeat(20_000));
	put(".trellis/spec/huge.md", "PRIVATE_SPEC_BODY\n".repeat(40_000));
	put(".trellis/spec/implement-only.md", "IMPLEMENT_ONLY_BODY");
	put(".trellis/spec/check-only.md", "CHECK_ONLY_BODY");
	put(`${task}/implement.jsonl`, [
		{ file: ".trellis/spec/huge.md", reason: "Implementation contract" },
		{ file: ".trellis/spec/implement-only.md", reason: "Implementation-only contract" },
	].map(row => JSON.stringify(row)).join("\n"));
	put(`${task}/check.jsonl`, [
		{ file: "./.trellis/spec/huge.md", reason: "Review contract" },
		{ file: ".trellis/spec/check-only.md", reason: "Review-only contract" },
		{ file: "/etc/passwd", reason: "REJECTED_OUTSIDE_PROJECT" },
	].map(row => JSON.stringify(row)).join("\n"));

	const user: Message = { role: "user", timestamp: 100, content: "Keep this user instruction exactly." };
	const first = await harness();
	const projected = await first.project([user]);
	const text = JSON.stringify(projected);
	assert.ok(Buffer.byteLength(text) < 16_384, "main context must not inline huge referenced files or artifacts");
	assert.ok(!text.includes("PRIVATE_SPEC_BODY") && !text.includes("PRIVATE_PRD_BODY") && !text.includes("PRIVATE_INFO_BODY"));
	assert.ok(text.includes(".trellis/spec/huge.md") && text.includes(`${task}/prd.md`));
	assert.ok(text.includes("Implementation contract") && text.includes("Review contract"), "deduplication must retain both manifest reasons");
	assert.equal(text.split(".trellis/spec/huge.md").length - 1, 1, "duplicated main manifest references must appear once");
	assert.ok(!text.includes("/etc/passwd") && !text.includes("REJECTED_OUTSIDE_PROJECT"), "main index must preserve trusted-root containment");
	assert.equal(projected.length, 1);
	assert.equal(projected[0].role, "user");
	assert.ok(text.includes("Keep this user instruction exactly."));
	console.log("PASS bounded main context with huge duplicated specs and artifacts");

	const continuation: Message = { role: "assistant", timestamp: 101, content: "tool continuation" };
	put(".trellis/spec/huge.md", "CHANGED_SPEC_BODY\n".repeat(40_000));
	const continued = await first.project([user, continuation]);
	assert.deepEqual(continued[0], projected[0], "tool continuation must preserve the established anchor bytes");
	const resumed = await harness();
	assert.deepEqual((await resumed.project([user, continuation]))[0], projected[0], "fresh extension must replay persisted anchor bytes");

	const afterCancelled: Message = { role: "user", timestamp: 102, content: "Continue after cancelled compaction." };
	await first.emit("session_before_compact");
	assert.deepEqual(
		await first.project([user, continuation, afterCancelled]),
		await resumed.project([user, continuation, afterCancelled]),
		"cancelled compaction must not force a full reinjection on the next user message",
	);
	console.log("PASS cancelled compaction does not rearm next-user injection");
	console.log("PASS continuation and fresh resume preserve established prefix");

	const child = await harness("trellis-implement");
	const childUser: Message = { role: "user", timestamp: 200, content: "Implement fixture." };
	const childText = JSON.stringify(await child.project([childUser]));
	assert.ok(childText.includes("CHANGED_SPEC_BODY") && childText.includes("IMPLEMENT_ONLY_BODY"));
	assert.ok(!childText.includes("CHECK_ONLY_BODY"), "implementation child must not load the reviewer-only manifest");
	console.log("PASS role-filtered subagent context remains available");

	const legacyText = `<task-context>\n## implement.jsonl\n\n### .trellis/spec/huge.md\n\n${"LEGACY_SPEC_BODY\n".repeat(40_000)}\n</task-context>`;
	const legacyUser: Message = { role: "user", timestamp: 300, content: "Retain my request across compaction." };
	put(".trellis/.runtime/omp-anchors/" + contextKey + ".json", JSON.stringify({ [anchorKey(legacyUser)]: legacyText }));
	const legacy = await harness();
	const legacyProjected = await legacy.project([legacyUser]);
	assert.ok(JSON.stringify(legacyProjected).includes("LEGACY_SPEC_BODY"), "an ordinary active segment must not rewrite legacy prefix bytes");
	await legacy.emit("session_before_compact");
	assert.deepEqual(await legacy.project([legacyUser, continuation]), [...legacyProjected, continuation], "cancelled compaction must preserve every established byte");
	console.log("PASS cancelled compaction preserves legacy prefix");

	const compaction: Entry = { type: "compaction", id: "compaction-1", timestamp: new Date().toISOString(), firstKeptEntryId: "user-300", summary: "Fixture summary", tokensBefore: 180_000 };
	branch = [compaction];
	leafId = compaction.id;
	await legacy.emit("session_compact", { compactionEntry: compaction, fromExtension: false });
	const recovered = await legacy.project([legacyUser]);
	const recoveredText = JSON.stringify(recovered);
	assert.ok(Buffer.byteLength(recoveredText) < 16_384 && !recoveredText.includes("LEGACY_SPEC_BODY"));
	assert.ok(recoveredText.includes("Retain my request across compaction.") && recoveredText.includes(".trellis/spec/huge.md"));
	assert.ok(!readFileSync(anchorPath, "utf8").includes("LEGACY_SPEC_BODY"), "retired legacy content must not remain in the persisted replay map");
	console.log("PASS committed compaction retires expanded legacy anchors");

	const recoveredResume = await harness();
	assert.deepEqual(await recoveredResume.project([legacyUser]), recovered, "same committed segment must resume byte-identically");
	await recoveredResume.emit("session_before_compact");
	assert.deepEqual(await recoveredResume.project([legacyUser]), recovered, "cancelled compaction must not change compact anchors either");
	console.log("PASS recovered segment resumes exactly and survives cancelled compaction");

	// Simulate a successful compaction while this extension process was absent.
	const previousReceipt = JSON.parse(readFileSync(anchorPath, "utf8"));
	put(".trellis/.runtime/omp-anchors/" + contextKey + ".json", JSON.stringify({ ...previousReceipt, anchors: { [anchorKey(legacyUser)]: legacyText } }));
	branch = [{ ...compaction, id: "compaction-2" }];
	leafId = "compaction-2";
	const boundaryResume = await harness();
	const resumedBoundaryText = JSON.stringify(await boundaryResume.project([legacyUser]));
	assert.ok(Buffer.byteLength(resumedBoundaryText) < 16_384 && !resumedBoundaryText.includes("LEGACY_SPEC_BODY"), "a newly committed boundary must recover legacy anchors on fresh resume");
	console.log("PASS fresh resume detects a newly committed compaction boundary");

	branch = [{ ...compaction, id: "compaction-3" }];
	leafId = "compaction-3";
	await boundaryResume.emit("session_compact", { compactionEntry: branch[0], fromExtension: false });
	const beforeFirstRequestResume = await harness();
	const beforeFirstText = JSON.stringify(await beforeFirstRequestResume.project([legacyUser]));
	assert.ok(beforeFirstText.includes(".trellis/spec/huge.md") && !beforeFirstText.includes("LEGACY_SPEC_BODY"), "resume between commit and first request must restore the full compact index");
	console.log("PASS process restart between compaction and first context retains compact index");

	// Old receipts with no segment marker cannot prove the historical compaction is new.
	put(".trellis/.runtime/omp-anchors/" + contextKey + ".json", JSON.stringify({ [anchorKey(legacyUser)]: legacyText }));
	const ambiguousResume = await harness();
	const ambiguous = await ambiguousResume.project([legacyUser]);
	assert.ok(JSON.stringify(ambiguous).includes("LEGACY_SPEC_BODY"), "old historical compaction alone must not authorize rewriting an unmarked legacy prefix");
	const ambiguousAgain = await harness();
	assert.deepEqual(await ambiguousAgain.project([legacyUser]), ambiguous, "recording the old segment must not rewrite it on the next resume");
	console.log("PASS unmarked legacy resume preserves prefix despite historical compaction");

	const malformedReceipt = JSON.parse(readFileSync(anchorPath, "utf8"));
	delete malformedReceipt.compactionId;
	writeFileSync(anchorPath, JSON.stringify(malformedReceipt));
	const malformedResume = await harness();
	assert.deepEqual(await malformedResume.project([legacyUser]), ambiguous, "a structurally invalid segment marker must preserve the established prefix");
	console.log("PASS malformed segment marker cannot authorize a prefix rewrite");

	// Obstruct temp creation and atomic rename separately; the old receipt must
	// remain intact, and the current process must abort rather than send drift.
	for (const failure of ["write", "rename"] as const) {
		const active = await harness();
		await active.project([legacyUser]);
		const before = readFileSync(anchorPath, "utf8");
		const blockedPath = failure === "write" ? dirname(anchorPath) : anchorPath;
		const backup = `${blockedPath}.backup`;
		renameSync(blockedPath, backup);
		if (failure === "write") writeFileSync(blockedPath, "obstruct directory");
		else mkdirSync(blockedPath);
		branch = [{ ...compaction, id: `compaction-failure-${failure}` }];
		try {
			await assert.rejects(active.emit("session_compact", { compactionEntry: branch[0] }));
			const priorAborts = aborts;
			await assert.rejects(active.project([legacyUser]));
			assert.equal(aborts, priorAborts + 1, "unpersisted context must abort the active request");
			assert.equal(readFileSync(failure === "write" ? join(backup, `${contextKey}.json`) : backup, "utf8"), before, "failed receipt commit must leave old anchors/state/segment intact");
		} finally {
			rmSync(blockedPath, { recursive: true, force: true });
			renameSync(backup, blockedPath);
		}
		const retried = await active.project([legacyUser]);
		assert.ok(JSON.stringify(retried).includes(".trellis/spec/huge.md") && !JSON.stringify(retried).includes("LEGACY_SPEC_BODY"));
		const afterFailureResume = await harness();
		assert.deepEqual(await afterFailureResume.project([legacyUser]), retried, "retry must commit exact resume bytes before returning");

		const nextUser: Message = { role: "user", timestamp: failure === "write" ? 501 : 502, content: `Persist ${failure} projection before sending.` };
		const established = readFileSync(anchorPath, "utf8");
		renameSync(blockedPath, backup);
		if (failure === "write") writeFileSync(blockedPath, "obstruct directory");
		else mkdirSync(blockedPath);
		try {
			await assert.rejects(afterFailureResume.project([legacyUser, nextUser]));
			assert.equal(readFileSync(failure === "write" ? join(backup, `${contextKey}.json`) : backup, "utf8"), established);
		} finally {
			rmSync(blockedPath, { recursive: true, force: true });
			renameSync(backup, blockedPath);
		}
		const restartBeforeRetry = await harness();
		const afterRestart = await restartBeforeRetry.project([legacyUser, nextUser]);
		assert.deepEqual(afterRestart[0], retried[0], "failed tail projection must not alter the established prefix on restart");
		assert.deepEqual(await afterFailureResume.project([legacyUser, nextUser]), afterRestart, "dirty retry and fresh resume must choose identical tail bytes");
		console.log(`PASS atomic receipt ${failure} failure aborts, preserves old state and retries across resume`);
	}

	const snapshotPath = join(dirname(anchorPath), `${contextKey}.snapshot.md`);
	rmSync(snapshotPath, { force: true });
	mkdirSync(snapshotPath);
	const snapshotFailure = await harness();
	branch = [{ ...compaction, id: "compaction-snapshot-failure" }];
	await snapshotFailure.emit("session_compact", { compactionEntry: branch[0] });
	const fallback = await snapshotFailure.project([legacyUser]);
	assert.ok(JSON.stringify(fallback).includes(".trellis/spec/huge.md"), "snapshot failure must send the full compact index, not a dead pointer");
	assert.equal(JSON.parse(readFileSync(anchorPath, "utf8")).lastFullContent, "", "snapshot failure must not advance last-full state");
	rmSync(snapshotPath, { recursive: true });
	const retryUser: Message = { role: "user", timestamp: 400, content: "Retry snapshot." };
	const retriedSnapshot = await snapshotFailure.project([legacyUser, retryUser]);
	assert.ok(JSON.stringify(retriedSnapshot[1]).includes(".trellis/spec/huge.md"));
	assert.ok(readFileSync(snapshotPath, "utf8").includes(".trellis/spec/huge.md"));
	console.log("PASS snapshot failure keeps full index and retries without advancing last-full state");
} finally {
	if (originalAgent === undefined) delete process.env.PI_BLOCKED_AGENT;
	else process.env.PI_BLOCKED_AGENT = originalAgent;
	rmSync(root, { recursive: true, force: true });
}
