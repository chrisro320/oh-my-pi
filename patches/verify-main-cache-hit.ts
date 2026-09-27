// The footer reports primary assistant cache usage, not auxiliary model calls.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { SEGMENTS } = await import(`${TUI_ROOT}/src/status-line/segments.ts`);
// Root-selected imports are required: isolated patch replays must not resolve the live install.
const { ensureThemeSync } = await import(`${TUI_ROOT}/src/theme/theme.ts`);
ensureThemeSync();

type Manager = InstanceType<typeof SessionManager>;

function usage(input: number, cacheRead: number) {
	return {
		input,
		output: 10,
		cacheRead,
		cacheWrite: 0,
		totalTokens: input + cacheRead + 10,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function footer(manager: Manager) {
	return SEGMENTS.cache_hit.render({
		session: { sessionManager: manager },
		usageStats: manager.getUsageStatistics(),
		startupPlaceholder: false,
	} as never);
}

function appendAssistant(manager: Manager, timestamp: number) {
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "openai-completions",
		provider: "test",
		model: "primary",
		usage: usage(100, 900),
		stopReason: "stop",
		timestamp,
	});
}

function appendAuxiliary(manager: Manager) {
	const entryId = manager.appendModelUsage({
		purpose: "find",
		role: "typesafe",
		api: "typesafe",
		provider: "typesafe",
		model: "jev-latest",
		usage: usage(9000, 0),
		stopReason: "stop",
	}, { sessionId: manager.getSessionId(), parentId: manager.getLeafId() });
	assert.ok(entryId, "the auxiliary usage must be journaled");
}

const root = mkdtempSync(join(tmpdir(), "omp-main-cache-hit-"));
try {
	const manager = SessionManager.create(root, join(root, "sessions"));
	assert.equal(footer(manager).visible, false, "no primary cache read hides the footer segment");
	appendAssistant(manager, 1);
	appendAuxiliary(manager);
	assert.match(footer(manager).content, /90\.00%/, "one find call must not dilute the primary cache hit rate");
	assert.equal(manager.getUsageStatistics().input, 9100, "total usage still includes auxiliary input");
	assert.equal(manager.getUsageStatistics().cacheRead, 900);
	appendAssistant(manager, 2);
	assert.match(footer(manager).content, /90\.00%/, "subsequent primary messages extend the primary-only ratio");
	await manager.ensureOnDisk();
	await manager.flush();
	const reopened = await SessionManager.open(manager.getSessionFile()!);
	assert.match(footer(reopened).content, /90\.00%/, "reloading the session rebuilds the primary-only ratio");
	assert.equal(reopened.getUsageStatistics().input, 9200, "reloading preserves aggregate billing usage");
	console.log("verify-main-cache-hit: primary footer ignores auxiliary usage across reload");
} finally {
	rmSync(root, { recursive: true, force: true });
}
