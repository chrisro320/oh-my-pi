#!/usr/bin/env bun
// Q6 replay — 0062 snapcompact standing-summary credit vs the local reprice.
//
// The capability under test (0062, on top of 0045): a second snapcompact pass
// that folds and replaces an archive already in the session must not be
// rejected as "would not reduce context". Upstream 18.16.0 is claimed to own
// the contract through two mechanisms that 0062 wrote by hand:
//
//   1. the reduction baseline credits the live standing `compactionSummary`
//      message (`carriesStandingSummary` in
//      `SessionMaintenance.#projectPreSnapcompactContextTokens`), and
//   2. frames are priced per reader (tokenizer `frameBilling`), falling back to
//      the cross-shape ceiling only for readers without a billing rule.
//
// This replay pins a synthetic second-compaction boundary (fixtures/0062-
// boundary.json, derived from the 0062 incident shape) and runs the real
// projection twice on the same session state:
//
//   leg=shape    the reader has an image-tokenization rule (3 136/frame here):
//                the new archive is a net reduction -> the pass must COMMIT.
//   leg=ceiling  the same reader geometry with no billing rule (5 024/frame,
//                `FRAME_TOKEN_ESTIMATE`): the same archive must still be
//                REJECTED with the guard's message.
//
// Neither verdict may come from a second implementation of the guard: both legs
// call `session.compact({ mode: "snapcompact" })` and read the outcome. The
// token figures printed alongside are measurements (public tokenizer, public
// archive helpers) reported for the record, never used as the decision.
//
// usage:
//   bun snapcompact-standing-summary-replay.ts --tree <RUNTIME|SOURCE> \
//       --fixture fixtures/0062-boundary.json [--json] [--keep <dir>]
//
// <RUNTIME> is a gate runtime root (holding node_modules/@oh-my-pi) or the
// @oh-my-pi directory itself; both are what gate-runtime-18.16.0.sh emits.
// Exits 0 only when every leg matches the fixture's expectation.

import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

interface Args {
	tree: string;
	fixture: string;
	json: boolean;
	keep?: string;
}

function parseArgs(argv: readonly string[]): Args {
	let tree = "";
	let fixture = "";
	let json = false;
	let keep: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--tree") tree = argv[++i] ?? "";
		else if (arg === "--fixture") fixture = argv[++i] ?? "";
		else if (arg === "--json") json = true;
		else if (arg === "--keep") keep = argv[++i] ?? "";
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!tree) throw new Error("--tree is required");
	if (!fixture) throw new Error("--fixture is required");
	return { tree: resolve(tree), fixture: resolve(fixture), json, ...(keep ? { keep: resolve(keep) } : {}) };
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

interface ModelRow {
	provider: string;
	id: string;
	api: string;
}

interface Fixture {
	id: string;
	capability: string;
	model: {
		base: { provider: string; id: string };
		contextWindow: number;
		maxOutputTokens: number;
		rows: { shape: ModelRow; ceiling: ModelRow };
	};
	settings: Record<string, unknown>;
	text: { recipe: string; weights: { word: number; identifier: number; number: number; long: number } };
	session: {
		standingArchive: { chars: number; seed: number };
		boundary: {
			archivedRegionChars: number;
			archivedRegionSeed: number;
			keptTailChars: number;
			keptTailSeed: number;
		};
	};
	expect: {
		standingFrames: number;
		archiveFrames: number;
		archivedRegionTokens: { value: number; tolerance: number };
		keptTailTokens: { value: number; tolerance: number };
		summaryTokens: { value: number; tolerance: number };
		framePrices: { shape: number; ceiling: number };
		legs: { shape: "accept" | "reject"; ceiling: "accept" | "reject" };
	};
}

async function loadFixture(path: string): Promise<Fixture> {
	const text = await Bun.file(path).text();
	const parsed: unknown = JSON.parse(text);
	if (!parsed || typeof parsed !== "object") throw new Error(`fixture is not an object: ${path}`);
	const fixture = parsed as Fixture;
	for (const key of ["standingArchive", "boundary"] as const)
		if (!fixture.session?.[key]) throw new Error(`fixture.session.${key} missing`);
	return fixture;
}

// ---------------------------------------------------------------------------
// runtime roots
// ---------------------------------------------------------------------------

/** `<RUNTIME>/node_modules/@oh-my-pi`, an `@oh-my-pi` dir, or its parent. */
function resolvePackageRoot(tree: string): string {
	const candidates = [join(tree, "node_modules", "@oh-my-pi"), join(tree, "@oh-my-pi"), tree];
	for (const candidate of candidates) {
		if (Bun.file(join(candidate, "pi-coding-agent", "src", "sdk.ts")).size > 0 &&
			Bun.file(join(candidate, "snapcompact", "src", "snapcompact.ts")).size > 0)
			return candidate;
	}
	throw new Error(`no @oh-my-pi packages under ${tree} (looked for pi-coding-agent/src/sdk.ts and snapcompact/src/snapcompact.ts)`);
}

/** Package entry points resolve from the runtime root at run time, so the
 * module specifiers are untyped and picked by `--tree` (the patch-verify
 * convention every gate in patches/verify-*.ts follows). */
async function loadPackages(root: string) {
	const agentRoot = `${root}/pi-coding-agent`;
	const coreRoot = `${root}/pi-agent-core`;
	const catalogRoot = `${root}/pi-catalog`;
	const snapRoot = `${root}/snapcompact`;
	const sdk = await import(`${agentRoot}/src/sdk.ts`);
	const settings = await import(`${agentRoot}/src/config/settings.ts`);
	const registry = await import(`${agentRoot}/src/config/model-registry.ts`);
	const session = await import(`${agentRoot}/src/session/session-manager.ts`);
	const tokenizer = await import(`${coreRoot}/src/tokenizer.ts`);
	const compaction = await import(`${coreRoot}/src/compaction/compaction.ts`);
	const messages = await import(`${coreRoot}/src/compaction/messages.ts`);
	const taxonomy = await import(`${catalogRoot}/src/compat/taxonomy.ts`);
	const models = await import(`${catalogRoot}/src/models.ts`);
	const snapcompact = await import(`${snapRoot}/src/snapcompact.ts`);
	return {
		createAgentSession: sdk.createAgentSession as (options: unknown) => Promise<{ session: Session }>,
		discoverAuthStorage: sdk.discoverAuthStorage as (agentDir: string) => Promise<AuthStorage>,
		Settings: settings.Settings as SettingsCtor,
		ModelRegistry: registry.ModelRegistry as new (auth: AuthStorage, path: string, options: unknown) => unknown,
		SessionManager: session.SessionManager as SessionManagerCtor,
		Tokenizer: tokenizer.Tokenizer as new (model: unknown) => Tokenizer,
		prepareCompaction: compaction.prepareCompaction as (...args: unknown[]) => Preparation | undefined,
		createCompactionSummaryMessage: messages.createCompactionSummaryMessage as (...args: unknown[]) => unknown,
		classifyModel: taxonomy.classifyModel as (provider: string, id: string, options?: unknown) => unknown,
		getBundledModel: models.getBundledModel as (provider: string, id: string) => Record<string, unknown> | undefined,
		snapcompact: {
			getPreservedArchive: snapcompact.getPreservedArchive as (data: unknown) => Archive | undefined,
			historyBlocks: snapcompact.historyBlocks as (archive: Archive, options?: unknown) => Block[],
			frameBilling: snapcompact.frameBilling as (target: unknown) => unknown,
			frameTokens: snapcompact.frameTokens as (billing: unknown, size: { width: number; height: number }) => number,
			frameDataBytesBudget: snapcompact.frameDataBytesBudget as (model: unknown) => number,
			FRAME_TOKEN_ESTIMATE: snapcompact.FRAME_TOKEN_ESTIMATE as number,
			geometry: snapcompact.geometry as (shape: unknown) => { cols: number; rows: number; capacity: number },
			resolveShape: snapcompact.resolveShape as (model: unknown, variant?: string) => unknown,
		},
	};
}

type Packages = Awaited<ReturnType<typeof loadPackages>>;

// ---------------------------------------------------------------------------
// runtime value shapes (only what this replay reads)
// ---------------------------------------------------------------------------

interface Block {
	type: string;
	data?: string;
}

interface Archive {
	frames: { data: string; chars: number }[];
	text?: string;
	textHead?: string;
	textTail?: string;
	totalChars: number;
	truncatedChars: number;
}

interface Preparation {
	firstKeptEntryId: string;
	messagesToSummarize: unknown[];
	turnPrefixMessages: unknown[];
	recentMessages: unknown[];
	tokensBefore: number;
	previousSummary?: string;
	previousPreserveData?: Record<string, unknown>;
}

interface Tokenizer {
	countMessage(message: unknown, options?: unknown): number;
	countMessages(messages: readonly unknown[], options?: unknown): number;
}

interface AuthStorage {
	keys: { setRuntime(provider: string, value: string): void };
}

interface SettingsCtor {
	loadIsolated(options: unknown): Promise<unknown>;
}

interface SessionManager {
	getBranch(): { type: string; id?: string; preserveData?: Record<string, unknown>; summary?: string; tokensBefore?: number }[];
	appendMessage(message: unknown): void;
	getSessionFile(): string | undefined;
	buildSessionContext(): { messages: { role: string }[] };
}

interface SessionManagerCtor {
	create(cwd: string, sessionsDir: string): SessionManager;
	open(file: string): Promise<SessionManager>;
}

interface Session {
	compact(instructions: undefined, options: { mode: string }): Promise<unknown>;
	dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// deterministic fixture text
// ---------------------------------------------------------------------------

const WORDS = ["ledger", "buffer", "session", "archive", "prefix", "token", "window", "provider",
	"request", "compact", "summary", "frame", "budget", "schema", "branch", "checkpoint", "retry",
	"stream", "socket", "handler", "policy", "counter", "parser", "fixture", "ingest", "transform"];
const LONG_WORDS = ["continuation", "reconciliation", "instrumentation", "deterministic", "recomputation",
	"thresholding", "serialization", "revalidation", "categorization", "synchronization"];
const IDENTIFIERS = ["ctxTokens", "snapFrame", "cacheRead", "preserveData", "frameTokens", "countMessage",
	"buildProviderContext", "applyPromptCacheBoundaries", "sessionMaintenance", "historyBlocks",
	"archiveSourceText", "projectedForReduction", "reductionBaseline", "firstKeptEntryId", "tokensBefore"];
const NUMBER_WORDS = ["window", "limit", "reserve", "trigger"];

/** Fixture text: a fixed vocabulary drawn by a seeded LCG (~3.4 chars/token
 * under this fixture's reader, between the ceiling's 2.77 and the shape price's 4.44). */
function fixtureText(
	chars: number,
	seed: number,
	weights: Fixture["text"]["weights"],
): string {
	const order: (keyof typeof weights)[] = ["word", "identifier", "number", "long"];
	const total = order.reduce((sum, key) => sum + weights[key], 0);
	let state = seed;
	const pieces: string[] = [];
	let length = 0;
	while (length < chars) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		let pick = (state >>> 16) % total;
		let which = 0;
		while (pick >= weights[order[which]]) {
			pick -= weights[order[which]];
			which += 1;
		}
		const kind = order[which];
		const piece =
			kind === "word"
				? WORDS[(state >>> 8) % WORDS.length]
				: kind === "identifier"
					? IDENTIFIERS[(state >>> 8) % IDENTIFIERS.length]
					: kind === "number"
						? `${NUMBER_WORDS[state % NUMBER_WORDS.length]}=${state % 100000}`
						: LONG_WORDS[(state >>> 8) % LONG_WORDS.length];
		pieces.push(piece);
		length += piece.length + 1;
	}
	return pieces.join(" ").slice(0, chars);
}

// ---------------------------------------------------------------------------
// measurement (reporting only — never the verdict)
// ---------------------------------------------------------------------------

interface Measured {
	frames: number;
	summaryTextTokens: number;
	archivedRegionTokens: number;
	keptTailTokens: number;
	standingFrames: number;
	framePrice: number;
	baselineCredited: number;
	projected?: number;
}

const COUNT_OPTIONS = { excludeEncryptedReasoning: true } as const;

function measureSummary(
	packages: Packages,
	tokenizer: Tokenizer,
	entry: { summary?: string; tokensBefore?: number; preserveData?: Record<string, unknown> },
	model: unknown,
): { frames: number; textTokens: number; archive: Archive | undefined } {
	const archive = packages.snapcompact.getPreservedArchive(entry.preserveData);
	const blocks = archive
		? packages.snapcompact.historyBlocks(archive, {
				maxFrameDataBytes: packages.snapcompact.frameDataBytesBudget(model),
			})
		: [];
	const textOnly = packages.createCompactionSummaryMessage(entry.summary ?? "", entry.tokensBefore ?? 0,
		new Date(0).toISOString(), { blocks: [] });
	return {
		frames: blocks.filter(block => block.type !== "text").length,
		textTokens: tokenizer.countMessage(textOnly, COUNT_OPTIONS),
		archive,
	};
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

interface LegResult {
	leg: "shape" | "ceiling";
	expected: "accept" | "reject";
	outcome: "accept" | "reject";
	ok: boolean;
	error?: string;
	message?: string;
	measured: Measured;
}

function buildModel(
	base: Record<string, unknown>,
	row: ModelRow,
	identity: unknown,
	fixture: Fixture,
): Record<string, unknown> {
	return {
		...base,
		id: row.id,
		provider: row.provider,
		api: row.api,
		identity,
		contextWindow: fixture.model.contextWindow,
		maxOutputTokens: fixture.model.maxOutputTokens,
		baseUrl: "http://127.0.0.1:1/offline-fixture",
	};
}

async function replay(
	args: Args,
	fixture: Fixture,
): Promise<{ ok: boolean; legs: LegResult[]; note: string[]; info: string[] }> {
	const notes: string[] = [];
	const packageRoot = resolvePackageRoot(args.tree);
	const packages = await loadPackages(packageRoot);
	const workRoot = args.keep ?? mkdtempSync(join(tmpdir(), "omp-0062-replay-"));
	const cwd = join(workRoot, "work");
	const agentDir = join(workRoot, "agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });

	let networkAttempts = 0;
	globalThis.fetch = (() => {
		networkAttempts += 1;
		throw new Error("the 0062 replay forbids provider requests");
	}) as typeof fetch;

	const base = packages.getBundledModel(fixture.model.base.provider, fixture.model.base.id);
	if (!base) throw new Error(`catalog base model missing: ${fixture.model.base.provider}/${fixture.model.base.id}`);
	// The catalog row's own `identity` must not leak into the synthetic rows:
	// it would override the provider/api cascade that decides frame billing.
	const models = {
		shape: buildModel(base, fixture.model.rows.shape,
			packages.classifyModel(fixture.model.rows.shape.provider, fixture.model.rows.shape.id, { lenient: true }),
			fixture),
		ceiling: buildModel(base, fixture.model.rows.ceiling,
			packages.classifyModel(fixture.model.rows.ceiling.provider, fixture.model.rows.ceiling.id, { lenient: true }),
			fixture),
	};
	const settings = await packages.Settings.loadIsolated({
		cwd,
		agentDir,
		overrides: {
			"memory.backend": "off",
			"computer.enabled": false,
			"secrets.enabled": false,
			"compaction.enabled": false,
			...fixture.settings,
		},
	});
	const authStorage = await packages.discoverAuthStorage(agentDir);
	for (const row of Object.values(fixture.model.rows)) authStorage.keys.setRuntime(row.provider, "offline-fixture");
	const modelRegistry = new packages.ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

	const open = async (manager: SessionManager, model: Record<string, unknown>): Promise<Session> =>
		(await packages.createAgentSession({
			cwd, agentDir, settings, authStorage, modelRegistry, model, sessionManager: manager,
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
			preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
		})).session;
	const usage = {
		input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const userMessage = (text: string, timestamp: number) => ({ role: "user", content: [{ type: "text", text }], timestamp });
	const assistantMessage = (text: string, timestamp: number, model: Record<string, unknown>) => ({
		role: "assistant", content: [{ type: "text", text }], timestamp,
		api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop",
	});

	// 1. A session that already holds one archive (the standing summary).
	let manager = packages.SessionManager.create(cwd, join(workRoot, "sessions"));
	manager.appendMessage(userMessage(fixtureText(fixture.session.standingArchive.chars,
		fixture.session.standingArchive.seed, fixture.text.weights), 1));
	manager.appendMessage(assistantMessage("Recorded the standing archive.", 2, models.shape));
	let session = await open(manager, models.shape);
	await session.compact(undefined, { mode: "snapcompact" });
	const standing = manager.getBranch().findLast(entry => entry.type === "compaction");
	if (!standing) throw new Error("the standing snapcompact pass committed nothing");
	const standingArchive = packages.snapcompact.getPreservedArchive(standing.preserveData);
	if (!standingArchive) throw new Error("the standing pass committed no archive");
	if (standingArchive.frames.length !== fixture.expect.standingFrames)
		throw new Error(`standing archive has ${standingArchive.frames.length} frames, fixture pins ${fixture.expect.standingFrames}`);
	const standingFile = manager.getSessionFile();
	if (!standingFile) throw new Error("the session file was not written");
	await session.dispose();

	// 2. The boundary: a region to archive plus the kept tail, appended and
	//    persisted once so every leg replays byte-identical state.
	const boundaryManager = await packages.SessionManager.open(standingFile);
	boundaryManager.appendMessage(userMessage(fixtureText(fixture.session.boundary.archivedRegionChars,
		fixture.session.boundary.archivedRegionSeed, fixture.text.weights), 11));
	boundaryManager.appendMessage(assistantMessage("Recorded the archived region.", 12, models.shape));
	boundaryManager.appendMessage(assistantMessage(fixtureText(fixture.session.boundary.keptTailChars,
		fixture.session.boundary.keptTailSeed, fixture.text.weights), 13, models.shape));
	const boundaryFile = boundaryManager.getSessionFile() ?? standingFile;

	// 3. Measure the boundary once (the region cut is model-independent; the
	//    token count is not, so it is re-measured per leg below).
	const shape = packages.snapcompact.resolveShape(models.shape, fixture.settings["snapcompact.shape"] as string);
	const frameSize = (shape as { frameSize: number }).frameSize;
	const shapeTokenizer = new packages.Tokenizer(models.shape);
	const shapePrep = packages.prepareCompaction(boundaryManager.getBranch(),
		{ enabled: true, strategy: "snapcompact", keepRecentTokens: fixture.settings["compaction.keepRecentTokens"] },
		models.shape, shapeTokenizer);
	if (!shapePrep) throw new Error("the boundary produced no compaction preparation");
	const standingMeasurement = measureSummary(packages, shapeTokenizer, standing, models.shape);
	const budget = (value: number, expected: { value: number; tolerance: number }) => ({
		value,
		expected: expected.value,
		tolerance: expected.tolerance,
		ok: Math.abs(value - expected.value) <= Math.abs(expected.value) * expected.tolerance,
	});

	const legs: LegResult[] = [];
	const infos: string[] = [];
	for (const leg of ["shape", "ceiling"] as const) {
		const model = models[leg];
		const tokenizer = new packages.Tokenizer(model);
		const preparation = leg === "shape"
			? shapePrep
			: packages.prepareCompaction(boundaryManager.getBranch(),
					{ enabled: true, strategy: "snapcompact", keepRecentTokens: fixture.settings["compaction.keepRecentTokens"] },
					model, tokenizer);
		if (!preparation) throw new Error(`leg ${leg}: the boundary produced no compaction preparation`);
		const archivedRegionTokens =
			tokenizer.countMessages(preparation.messagesToSummarize, COUNT_OPTIONS) +
			tokenizer.countMessages(preparation.turnPrefixMessages, COUNT_OPTIONS);
		const keptTailTokens = tokenizer.countMessages(preparation.recentMessages, COUNT_OPTIONS);
		const previousArchive = packages.snapcompact.getPreservedArchive(preparation.previousPreserveData);
		const previousFrames = previousArchive?.frames.length ?? 0;
		const previousSummary = measureSummary(packages, tokenizer, {
			summary: preparation.previousSummary,
			tokensBefore: preparation.tokensBefore,
			preserveData: preparation.previousPreserveData,
		}, model);
		const framePrice = packages.snapcompact.frameTokens(
			packages.snapcompact.frameBilling(model),
			{ width: frameSize, height: frameSize },
		);
		const baselineCredited = previousSummary.textTokens + previousFrames * framePrice +
			archivedRegionTokens + keptTailTokens;

		// Replay on a private copy of the prepared state.
		const legDir = join(workRoot, `leg-${leg}`, "sessions");
		mkdirSync(dirname(legDir), { recursive: true });
		cpSync(dirname(boundaryFile), legDir, { recursive: true });
		const legManager = await packages.SessionManager.open(join(legDir, boundaryFile.slice(dirname(boundaryFile).length + 1)));
		const legSession = await open(legManager, model);
		let outcome: "accept" | "reject" = "accept";
		let message: string | undefined;
		try {
			await legSession.compact(undefined, { mode: "snapcompact" });
		} catch (error) {
			outcome = "reject";
			message = error instanceof Error ? error.message : String(error);
		}
		const committed = legManager.getBranch().findLast(entry => entry.type === "compaction");
		const committedMeasurement = measureSummary(packages, tokenizer, committed ?? {}, model);
		const frames = outcome === "accept" ? committedMeasurement.frames : 0;
		// No entry was committed on rejection, so there is no archive to price.
		const projected = outcome === "accept"
			? committedMeasurement.textTokens + frames * framePrice + keptTailTokens
			: undefined;
		await legSession.dispose();

		const expected = fixture.expect.legs[leg];
		legs.push({
			leg,
			expected,
			outcome,
			ok: outcome === expected,
			...(message ? { error: message } : {}),
			...(outcome === "accept" ? { message: `committed frames=${frames}` } : {}),
			measured: {
				frames,
				summaryTextTokens: committedMeasurement.textTokens,
				archivedRegionTokens,
				keptTailTokens,
				standingFrames: previousFrames,
				framePrice,
				baselineCredited,
				...(projected === undefined ? {} : { projected }),
			},
		});
		// Fixture honesty: the boundary must be the shape the fixture pins.
		const region = budget(archivedRegionTokens, fixture.expect.archivedRegionTokens);
		const tail = budget(keptTailTokens, fixture.expect.keptTailTokens);
		const summary = budget(standingMeasurement.textTokens, fixture.expect.summaryTokens);
		if (outcome === "accept" && frames !== fixture.expect.archiveFrames)
			notes.push(`leg ${leg}: committed ${frames} frames, fixture pins ${fixture.expect.archiveFrames}`);
		// Token pins describe the boundary; they are recorded, not enforced: the
		// contract under test is the accept/reject pair, and a token count drifts
		// with the reader's tokenizer without changing that pair.
		if (!region.ok) infos.push(`leg ${leg}: archived region ${archivedRegionTokens} tokens outside ${JSON.stringify(fixture.expect.archivedRegionTokens)}`);
		if (!tail.ok) infos.push(`leg ${leg}: kept tail ${keptTailTokens} tokens outside ${JSON.stringify(fixture.expect.keptTailTokens)}`);
		if (!summary.ok) infos.push(`leg ${leg}: standing summary ${standingMeasurement.textTokens} tokens outside ${JSON.stringify(fixture.expect.summaryTokens)}`);
		if (framePrice !== fixture.expect.framePrices[leg])
			notes.push(`leg ${leg}: frame price ${framePrice}, fixture pins ${fixture.expect.framePrices[leg]}`);
		if (networkAttempts !== 0) notes.push(`leg ${leg}: ${networkAttempts} provider request(s) attempted`);
	}

	if (!args.keep) rmSync(workRoot, { recursive: true, force: true });
	return { ok: legs.every(leg => leg.ok) && notes.length === 0, legs, note: notes, info: infos };
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const fixture = await loadFixture(args.fixture);
const result = await replay(args, fixture);
const verdictOk = result.ok && result.legs.every(leg => leg.ok);

if (args.json) {
	console.log(JSON.stringify({ fixture: fixture.id, capability: fixture.capability, ok: verdictOk,
		legs: result.legs, info: result.info, notes: result.note }, null, 2));
} else {
	console.log(`0062 replay — ${fixture.id} (${fixture.capability})`);
	for (const leg of result.legs) {
		const m = leg.measured;
		console.log(
			`${leg.ok ? "PASS" : "FAIL"} leg=${leg.leg} expected=${leg.expected} outcome=${leg.outcome}` +
				` frames=${m.frames} archivedRegion=${m.archivedRegionTokens} keptTail=${m.keptTailTokens}` +
				` standingFrames=${m.standingFrames} framePrice=${m.framePrice}` +
				` baselineCredited=${m.baselineCredited} projected=${m.projected ?? "-"}` +
				(leg.error ? ` error=${JSON.stringify(leg.error)}` : ""),
		);
	}
	for (const info of result.info) console.log(`INFO ${info}`);
	for (const note of result.note) console.log(`NOTE ${note}`);
	console.log(verdictOk ? "PASS 0062 replay: every leg matched the fixture" : "FAIL 0062 replay: at least one leg disagreed");
}
process.exit(verdictOk ? 0 : 1);
