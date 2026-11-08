// Consumer regression for 0045/0062: actual manual snapcompact must admit
// reducing archives and reject an inflating successor.
// 18.7.0 prices frames in Tokenizer itself; no second subtraction is needed.
// 18.16.0 re-bases the pair on the reader's frame price (upstream #17490 credits
// the live standing summary into the baseline): the SAME second-compaction state
// must commit under a priced reader and stay rejected under an unpriced one,
// where every frame costs the cross-shape ceiling. The retired local reprice
// doubled that credit, which admitted the ceiling-priced case as well.
// Never inspect private source or reproduce the guard's decision formula.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`;
// Root overrides select isolated package modules at runtime.
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { getPreservedArchive } = await import(`${SNAP_ROOT}/src/snapcompact.ts`);
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { classifyModel } = await import(`${CATALOG_ROOT}/src/compat/taxonomy.ts`);
const VERSION: string = JSON.parse(readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
// 18.16.0 owns the contract upstream; older plans still carry 0045/0062, and
// 18.18.0 re-bases the same reader-priced pair (adoptions-recheck 0062).
const PRICED_PAIR = ["18.16.0", "18.18.0"].includes(VERSION);
const root = mkdtempSync(join(tmpdir(), "omp-snapcompact-consumer-"));
const cwd = join(root, "work");
const agentDir = join(root, "agent");
mkdirSync(cwd);
mkdirSync(agentDir);
const originalFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("Network forbidden in snapcompact consumer gate");
}) as typeof fetch;

function denseText(chars: number, seed: number): string {
	let state = seed;
	let text = "";
	while (text.length < chars) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		text += `${(state % 1296).toString(36).padStart(2, "0")} `;
	}
	return text.slice(0, chars);
}

// 18.16.0 priced pair: the boundary is the 0062 incident shape at a size the
// credit control can attribute - the region must fit inside the frame-growth
// window (F-N) x shapePrice < region <= F x shapePrice, and the text must be
// denser than capacity/ceilingPrice = 13 916/5 024 = 2.77 chars/token for the
// ceiling leg to reject at all. This vocabulary prices at ~2.5 chars/token
// under the gate's reader. The derivation is recorded with the task fixture
// (research/fixtures/0062-boundary.json); the gate keeps its own numbers so it
// stays self-contained wherever the plan ships.
const PROSE_WORDS = ["ledger", "buffer", "session", "archive", "prefix", "token", "window", "provider",
	"request", "compact", "summary", "frame", "budget", "schema", "branch", "checkpoint", "retry",
	"stream", "socket", "handler", "policy", "counter", "parser", "fixture", "ingest", "transform"];
const PROSE_IDENTIFIERS = ["ctxTokens", "snapFrame", "cacheRead", "preserveData", "frameTokens", "countMessage",
	"buildProviderContext", "applyPromptCacheBoundaries", "sessionMaintenance", "historyBlocks",
	"archiveSourceText", "projectedForReduction", "reductionBaseline", "firstKeptEntryId", "tokensBefore"];
function proseText(chars: number, seed: number): string {
	const weights = [1, 1, 2];
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	let state = seed;
	const pieces: string[] = [];
	let length = 0;
	while (length < chars) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		let pick = (state >>> 16) % total;
		let which = 0;
		while (pick >= weights[which]) {
			pick -= weights[which];
			which += 1;
		}
		const piece = which === 0
			? PROSE_WORDS[(state >>> 8) % PROSE_WORDS.length]
			: which === 1
				? PROSE_IDENTIFIERS[(state >>> 8) % PROSE_IDENTIFIERS.length]
				: `(${(state >>> 8) % 4096})`;
		pieces.push(piece);
		length += piece.length + 1;
	}
	return pieces.join(" ").slice(0, chars);
}

const bundled = getBundledModel("google", "gemini-3.8-flash");
assert.ok(bundled, "fixture model must exist in the selected catalog");
// 18.16.0 prices frames per reader: an anthropic-messages gateway row bills
// 3 136/frame at the 11on16-bw geometry, its unpriced twin 5 024.
const pricedReader = {
	...bundled,
	id: "synthetic-gateway-model",
	provider: "anthropic",
	api: "anthropic-messages",
	identity: classifyModel("anthropic", "synthetic-gateway-model", { lenient: true }),
	baseUrl: "http://127.0.0.1:1/never",
};
const model = PRICED_PAIR ? pricedReader : { ...bundled, baseUrl: "http://127.0.0.1:1/never" };
// The unpriced twin keeps the same rendered geometry and loses only the frame
// billing rule, so each frame costs FRAME_TOKEN_ESTIMATE (5 024).
const unpricedModel = PRICED_PAIR
	? { ...pricedReader, api: "synthetic-unpriced-wire" }
	: {
			...model,
			api: "synthetic-unpriced-wire",
			identity: classifyModel("google", "synthetic-unknown-gateway", { lenient: true }),
		};
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function seedTurn(manager: InstanceType<typeof SessionManager>, chars: number, seed: number) {
	manager.appendMessage({ role: "user", content: [{ type: "text", text: denseText(chars, seed) }], timestamp: seed });
	manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Recorded." }], timestamp: seed + 1,
		api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop" });
}

interface FixtureSession {
	compact(instructions: undefined, options: { mode: string }): Promise<unknown>;
	dispose(): Promise<void>;
}
let session: FixtureSession | undefined;
try {
	const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
		"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false,
		"compaction.enabled": false, "compaction.keepRecentTokens": 2000,
		// One geometry for both legs: the variant decides the frame grid, the
		// model's catalog rule decides only its price.
		...(PRICED_PAIR ? { "snapcompact.shape": "11on16-bw" } : {}),
	} });
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("google", "offline-fixture");
	authStorage.keys.setRuntime("anthropic", "offline-fixture");
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
	let manager = SessionManager.create(cwd, join(root, "sessions"));
	const seedProse = (chars: number, seed: number, trailing: "user" | "assistant") => {
		const text = proseText(chars, seed);
		if (trailing === "user") {
			manager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: seed });
			manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Recorded." }],
				timestamp: seed + 1, api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop" });
			return;
		}
		manager.appendMessage({ role: "assistant", content: [{ type: "text", text }], timestamp: seed,
			api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop" });
	};
	// 18.16.0: one standing archive (160k chars -> ~10 frames) and a boundary
	// whose region (108k) plus kept tail (73k) re-renders it into 18 frames.
	// Older plans: 24 seeded turns, then an 80k+12k or 30k+12k successor.
	if (PRICED_PAIR) seedProse(160_000, 0x5eed, "user");
	else for (let i = 0; i < 24; i++) seedTurn(manager, 18_000, 0x5eed + i);
	const open = async (forManager = manager, forModel = model) => (await createAgentSession({
		cwd, agentDir, settings, authStorage, modelRegistry, model: forModel, sessionManager: forManager,
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
	})).session;
	session = await open();
	await session.compact(undefined, { mode: "snapcompact" });
	const first = manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction");
	assert.ok(first && getPreservedArchive(first.preserveData)?.frames.length > 0,
		"first reduction must commit an image archive, not fall back to text summarization");
	const sessionFile = manager.getSessionFile();
	assert.ok(sessionFile, "the standing pass must persist its session");
	await session.dispose();
	session = undefined;
	// The second-compaction state, prepared once and replayed per leg.
	const boundarySessionFile = join(root, "boundary.jsonl");
	copyFileSync(sessionFile, boundarySessionFile);
	manager = await SessionManager.open(boundarySessionFile);
	// This region is smaller than the archive it supersedes: dropping the
	// standing-summary credit rejects a genuine reduction on the second pass.
	if (PRICED_PAIR) {
		seedProse(108_000, 0xbeef, "user");
		seedProse(73_000, 0xcafe, "assistant");
	} else {
		seedTurn(manager, 80_000, 0xbeef);
		seedTurn(manager, 12_000, 0xcafe);
	}
	const secondPassFile = manager.getSessionFile();
	assert.ok(secondPassFile, "the second-compaction state must be persistable");

	if (PRICED_PAIR) {
		// Each leg replays its own copy: a commit is append-only, so the twin must
		// not see the priced leg's new entry.
		const pricedFile = join(root, "priced.jsonl");
		const ceilingFile = join(root, "ceiling.jsonl");
		copyFileSync(secondPassFile, pricedFile);
		copyFileSync(secondPassFile, ceilingFile);

		// Priced reader: the archive re-renders under the shape's own frame price,
		// so the standing-summary credit makes this a reduction. It must commit.
		manager = await SessionManager.open(pricedFile);
		session = await open(manager);
		await session.compact(undefined, { mode: "snapcompact" });
		const priced = manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction");
		assert.ok(priced && priced.id !== first.id, "a priced successor reduction must commit a new entry");
		assert.ok(getPreservedArchive(priced.preserveData)?.frames.length > 0, "the priced successor must stay image-backed");
		await session.dispose();
		session = undefined;

		// Unpriced reader, identical state and geometry: every frame costs the
		// cross-shape ceiling, so the same successor must stay rejected. A guard
		// that admits it is not reducing anything - it is crediting twice.
		manager = await SessionManager.open(ceilingFile);
		session = await open(manager, unpricedModel);
		await assert.rejects(session.compact(undefined, { mode: "snapcompact" }), /would not reduce context/);
		assert.equal(manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction")?.id,
			first.id, "the ceiling-priced successor must leave the committed archive unchanged");
		await session.dispose();
		session = undefined;

		// 0062 legacy-archive legs (plan §2.2): a pre-16.1 frames-only archive
		// carries no text fields, so its source text cannot be reconstructed. The
		// pass may still commit when the projection genuinely reduces, and the
		// unreconstructable frame content is counted as truncated.
		const legacyText = readFileSync(sessionFile, "utf8");
		const legacyFile = join(root, "legacy.jsonl");
		writeFileSync(legacyFile, legacyText.split("\n").filter(Boolean).map(line => {
			const entry = JSON.parse(line) as { type?: string; preserveData?: { snapcompact?: Record<string, unknown> } };
			const slot = entry.preserveData?.snapcompact;
			if (entry.type !== "compaction" || !slot) return line;
			delete slot.text;
			delete slot.textHead;
			delete slot.textTail;
			return JSON.stringify(entry);
		}).join("\n") + "\n");
		// (a) A large enough new region still reduces: the legacy pass commits.
		const legacyReducing = join(root, "legacy-reducing.jsonl");
		copyFileSync(legacyFile, legacyReducing);
		manager = await SessionManager.open(legacyReducing);
		seedProse(240_000, 0xdead, "user");
		seedProse(40_000, 0xd00d, "assistant");
		session = await open(manager);
		await session.compact(undefined, { mode: "snapcompact" });
		const legacyPass = manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction");
		assert.ok(legacyPass && legacyPass.id !== first.id, "a legacy archive with a large reducing region must commit");
		const legacyArchive = getPreservedArchive(legacyPass.preserveData);
		assert.ok(legacyArchive && legacyArchive.frames.length > 0, "the legacy successor stays image-backed");
		assert.ok((legacyArchive?.truncatedChars ?? 0) > 0, "unreconstructable legacy frame content counts as truncated");
		await session.dispose();
		session = undefined;
		// (b) A small region cannot reconstruct the lost credit: the explicit mode
		// rejects and names the next configured manual method (pinned order).
		const legacyRejecting = join(root, "legacy-rejecting.jsonl");
		copyFileSync(legacyFile, legacyRejecting);
		manager = await SessionManager.open(legacyRejecting);
		seedProse(12_000, 0xbead, "user");
		session = await open(manager);
		await assert.rejects(
			session.compact(undefined, { mode: "snapcompact" }),
			/snapcompact would not reduce context\. Run \/compact soft instead\./,
		);
		assert.equal(manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction")?.id,
			first.id, "the rejected legacy pass must leave the committed archive unchanged");
		await session.dispose();
		session = undefined;
		// (c) Pinned order with no fallback method: configured as snapcompact-only,
		// a non-explicit pass rejects without advertising a `/compact` mode.
		const pinnedSettings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
			"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false,
			"compaction.enabled": false, "compaction.keepRecentTokens": 2000,
			"compaction.methodOrder": ["snapcompact"], "snapcompact.shape": "11on16-bw",
		} });
		const pinnedFile = join(root, "legacy-pinned.jsonl");
		copyFileSync(legacyFile, pinnedFile);
		manager = await SessionManager.open(pinnedFile);
		seedProse(12_000, 0xfeed, "user");
		session = (await createAgentSession({
			cwd, agentDir, settings: pinnedSettings, authStorage, modelRegistry, model,
			sessionManager: manager, skills: [], rules: [], contextFiles: [], promptTemplates: [],
			slashCommands: [], disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
			preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
		})).session;
		await assert.rejects(session.compact(undefined, {}), (error: Error) => {
			assert.match(error.message, /snapcompact would not reduce context/);
			assert.ok(!error.message.includes("Run /compact"), "a snapcompact-only plan has no fallback mode to advertise");
			return true;
		});
		await session.dispose();
		session = undefined;
	} else {
		session = await open();
		await session.compact(undefined, { mode: "snapcompact" });
		const second = manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction");
		assert.ok(second && second.id !== first.id, "successor reduction must commit a new compaction entry");
		assert.ok(getPreservedArchive(second.preserveData)?.frames.length > 0, "successor must remain image-backed");
		await session.dispose();
		session = undefined;

		const inflatingSessionFile = join(root, "inflating.jsonl");
		copyFileSync(sessionFile, inflatingSessionFile);
		manager = await SessionManager.open(inflatingSessionFile);
		seedTurn(manager, 30_000, 0xbeef);
		seedTurn(manager, 12_000, 0xcafe);
		session = await open();
		await assert.rejects(session.compact(undefined, { mode: "snapcompact" }), /would not reduce context/);
		assert.equal(manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction")?.id,
			first.id, "an inflating successor must leave the committed archive unchanged");
		await session.dispose();
		session = undefined;
	}
	assert.equal(fetchAttempts, 0, "local compaction must not request a provider fallback");
	console.log(PRICED_PAIR
		? "PASS: session.compact admits the priced successor and rejects its ceiling-priced twin without provider requests"
		: "PASS: session.compact admits reductions and rejects inflation without provider requests");
} finally {
	await session?.dispose();
	globalThis.fetch = originalFetch;
	rmSync(root, { recursive: true, force: true });
}
