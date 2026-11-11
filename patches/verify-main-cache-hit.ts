// The footer reports primary assistant cache usage, not auxiliary model calls.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
const plan = resolvePlan({ gate: "verify-main-cache-hit", roots: [AGENT_ROOT, TUI_ROOT] });
// Local retirements are selected by capability, not an upstream version boundary.
const capabilityMenu = spawnSync("bash", [new URL("./apply.sh", import.meta.url).pathname, "--print-capabilities"], {
	env: { ...process.env, OMP_PATCH_VERSION: plan.version }, encoding: "utf8",
});
assert.equal(capabilityMenu.status, 0, `cannot resolve plan capabilities: ${capabilityMenu.stderr}`);
const countsCacheReads = capabilityMenu.stdout.split(/\s+/).includes("0004");
const { SessionManager, SessionEntryIndex } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
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
		assert.equal(labels["omp.status.token_total"], formatNumber(expectedTokens), "native total must follow the plan's cache-read policy and keep orchestration service work");
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
	assertStatusSurfaces(manager, countsCacheReads ? 11170 : 9270);
	// 0004 counts cache reads; plans that retire it count provider-side service work only.
	const tokenTotal = SEGMENTS.token_total
		.describe({
			usageStats: {
				input: 10,
				output: 20,
				cacheWrite: 30,
				cacheRead: 4_000,
				orchestrationInput: 50,
				orchestrationOutput: 60,
				orchestrationCacheRead: 7_000,
			},
		} as never)
		?.spans?.map((part: { t?: string }) => part.t ?? "")
		.join("");
	assert.equal(tokenTotal, formatNumber(countsCacheReads ? 11170 : 170), "token_total cache reads must follow the plan's 0004 capability");
	appendAssistant(manager, 2);
	assert.match(footer(manager).content, /90\.00%/, "subsequent primary messages extend the primary-only ratio");
	await manager.ensureOnDisk();
	await manager.flush();
	const reopened = await SessionManager.open(manager.getSessionFile()!);
	assert.match(footer(reopened).content, /90\.00%/, "reloading the session rebuilds the primary-only ratio");
	// 0081: the footer is re-targeted onto view sessions whose sessionManager is a
	// hand-written literal; a missing method must hide the segment, never throw.
	const bare = { sessionManager: { getUsageStatistics: () => manager.getUsageStatistics() } };
	const bareHit = SEGMENTS.cache_hit.render({ session: bare, usageStats: manager.getUsageStatistics(), startupPlaceholder: false } as never);
	assert.equal(bareHit.visible, false, "a view mirror without getMainCacheHitRate hides cache_hit instead of throwing");
	const bareTurn = SEGMENTS.cache_turn.render({ session: { ...bare, state: { messages: [] }, messages: [] }, usageStats: manager.getUsageStatistics(), startupPlaceholder: false } as never);
	assert.equal(bareTurn.visible, false, "a view mirror without getMainCacheHitRate hides cache_turn instead of throwing");
	// 0081 mirror leg: RemoteAgentSession answers from its own SessionEntryIndex,
	// so a mirror-shaped manager reports the same primary-only ratio.
	const mirrorIndex = new SessionEntryIndex();
	mirrorIndex.rebuild(manager.getEntries());
	const mirror = {
		getUsageStatistics: () => manager.getUsageStatistics(),
		getMainCacheHitRate: () => mirrorIndex.mainCacheHitRate(),
	};
	const mirrorMessages = manager.getBranch().filter((entry: { type: string }) => entry.type === "message").map((entry: { message: unknown }) => entry.message);
	const mirrorCtx = { session: { sessionManager: mirror, messages: mirrorMessages, state: { messages: mirrorMessages } }, usageStats: manager.getUsageStatistics(), startupPlaceholder: false };
	assert.match(SEGMENTS.cache_hit.render(mirrorCtx as never).content, /90\.00%/, "the worker-session mirror reports the primary-only ratio from its index");
	const mirrorTurn = SEGMENTS.cache_turn.render(mirrorCtx as never).content.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok(mirrorTurn.endsWith("90.0% /90.00%"), `the mirror keeps the settled-turn/main pairing, got ${JSON.stringify(mirrorTurn)}`);
	// 0033: a long git branch keeps both ends within the 16-cell footer budget.
	const longBranch = "feature/very-long-branch-name";
	const gitCtx = { git: { branch: longBranch, status: null }, options: {} };
	const stripped = SEGMENTS.git.render(gitCtx as never).content.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok(stripped.endsWith("feature\u2026nch-name"), `long branch must be middle-truncated at 16 cells, got ${JSON.stringify(stripped)}`);
	assert.ok(!stripped.includes(longBranch), "the full branch name must not survive the footer budget");
	assert.equal(SEGMENTS.git.describe(gitCtx as never)?.spans?.map((part: { t?: string }) => part.t).join(""), "feature\u2026nch-name", "native git twin truncates the same way");
	const shortBranch = { git: { branch: "main", status: null }, options: {} };
	assert.ok(SEGMENTS.git.render(shortBranch as never).content.includes("main"), "a short branch is untouched");
	// 0033: the reset-credit count stays a bare flame glyph + count.
	const credits = { usage: { resetCredits: { bankedCount: 3, redeemableCount: 0 } }, options: {} };
	const creditLine = SEGMENTS.usage.render(credits as never).content.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok(creditLine.endsWith("\u27263"), `reset credits render as a bare glyph count, got ${JSON.stringify(creditLine)}`);
	assert.equal(SEGMENTS.usage.describe(credits as never)?.spans?.map((part: { t?: string }) => part.t).join(""), "\u27263", "native usage twin shows the bare count");
	// 0081: the optional call is the contract; a required call would crash every view mirror.
	const segmentSource = readFileSync(`${TUI_ROOT}/src/status-line/segments.ts`, "utf8");
	assert.equal((segmentSource.match(/getMainCacheHitRate\?\.\(\)/g) ?? []).length, 3, "all three cache reads must optional-call the member");
	assert.ok(!/getMainCacheHitRate\(\)/.test(segmentSource), "no required-call site may survive in the footer");
	const mirrorSource = readFileSync(`${AGENT_ROOT}/src/thread/remote-agent-session.ts`, "utf8");
	assert.ok(mirrorSource.includes("getMainCacheHitRate: () => this.#entryIndex.mainCacheHitRate()"), "RemoteAgentSession must implement the member from its index");
	assert.equal(reopened.getUsageStatistics().input, 9200, "reloading preserves aggregate billing usage");
	assertStatusSurfaces(reopened, countsCacheReads ? 12180 : 9380);
	console.log(`verify-main-cache-hit: ANSI/native main-only cache rate and plan-selected totals survive reload (0004 ${countsCacheReads ? "present" : "absent"})`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
