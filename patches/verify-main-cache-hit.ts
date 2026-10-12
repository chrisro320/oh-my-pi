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
const { StatusLineComponent } = await import(`${TUI_ROOT}/src/status-line/component.ts`);
const { Reconciler } = await import(`${TUI_ROOT}/src/native/reconcile.ts`);
const { formatNumber } = await import(`${NM}/pi-utils/src/index.ts`);
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

// R09/R10: drive the actual native status surface, including wire materialization,
// against the ANSI border with the same real persisted usage accounting.
function assertStatusSurfaces(manager: Manager, expectedTokens: number) {
	const messages = manager.getBranch()
		.filter((entry: { type: string }) => entry.type === "message")
		.map((entry: { message: unknown }) => entry.message);
	const settings = { preset: "custom", leftSegments: ["cache_turn", "cache_hit", "token_total"], rightSegments: [], showHookStatus: false };
	const session = {
		sessionManager: manager,
		state: { messages },
		messages,
		isStreaming: false,
		isAutoThinking: false,
		modelRegistry: { isUsingOAuth: () => false },
		getContextUsage: () => undefined,
		autoResolvedThinkingLevel: () => undefined,
		isFastModeActive: () => false,
		getAsyncJobSnapshot: () => null,
		getGoalModeState: () => undefined,
	};
	const status = new StatusLineComponent(session, {
		getSettings: () => settings,
		gitEnabled: () => false,
		codexResetFireworksEnabled: () => false,
		getSettingsRevision: () => 0,
		getSessionSettingsIdentity: () => undefined,
		getSessionSettingsRevision: () => 0,
		goalStatusInFooter: () => false,
		activeAccount: () => undefined,
		canFetchUsageReports: () => false,
		fetchUsageReports: async () => { throw new Error("Usage requests forbidden in status gate"); },
		resolveActiveRepo: () => null,
		lookupPullRequest: async () => { throw new Error("Repository lookup forbidden in status gate"); },
		calculateTokensPerSecond: () => null,
		limitMatchesActiveAccount: () => false,
		computeCompactionBoundaries: () => null,
	});
	type WireNode = { k: string; p?: { role?: string; spans?: { t: string }[] }; c?: WireNode[] };
	const labels: Record<string, string> = {};
	const collect = (node: WireNode) => {
		if (node.k === "seg" && node.p?.role) labels[node.p.role] = (node.p.spans ?? []).map(span => span.t).join("");
		for (const child of node.c ?? []) collect(child);
	};
	try {
		const ops = new Reconciler("cache-gate").reconcile({
			main: [], dock: [status.describePreview()], layer: [],
		}, { cols: 160, dark: true, reduceMotion: true, supports: () => true, feature: () => false });
		for (const op of ops) if (op[0] === "add") collect(op[4]);
		assert.equal(labels["omp.status.cache_hit"], "90.00%", "native hit rate must exclude auxiliary calls");
		assert.equal(labels["omp.status.cache_turn"], "90.0% /90.00%", "native cache_turn must pair the settled turn with the main-session rate");
		assert.equal(labels["omp.status.token_total"], formatNumber(expectedTokens), "native total includes cache and orchestration reads");
		const ansi = status.getTopBorder(160).content.replace(/\x1b\[[0-9;]*m/g, "");
		for (const label of Object.values(labels)) assert.ok(ansi.includes(label), `ANSI border must agree with native value ${label}`);
	} finally {
		status.dispose();
	}
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
		usage: { ...usage(9000, 0), orchestration: { input: 100, output: 50, cacheRead: 1000 } },
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
	assert.equal(manager.getUsageStatistics().orchestrationCacheRead, 1000, "the fixture includes orchestration cache reads");
	assertStatusSurfaces(manager, 11170);
	appendAssistant(manager, 2);
	assert.match(footer(manager).content, /90\.00%/, "subsequent primary messages extend the primary-only ratio");
	await manager.ensureOnDisk();
	await manager.flush();
	const reopened = await SessionManager.open(manager.getSessionFile()!);
	assert.match(footer(reopened).content, /90\.00%/, "reloading the session rebuilds the primary-only ratio");
	assert.equal(reopened.getUsageStatistics().input, 9200, "reloading preserves aggregate billing usage");
	assertStatusSurfaces(reopened, 12180);
	console.log("verify-main-cache-hit: ANSI/native main-only cache rate and cache-inclusive totals survive reload");
} finally {
	rmSync(root, { recursive: true, force: true });
}
