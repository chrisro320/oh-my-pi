// Patch 0045 regression: snapcompact reduction guard must price archive
// frames at the live shape's per-frame estimate, not the cross-shape
// FRAME_TOKEN_ESTIMATE ceiling.
//
// Two gates, run together:
//   GATE 1 (structure, selected source): the patched guard is a private method
//     (`#projectSnapcompactContextTokens`) — unreachable from outside the
//     class, so like verify-prefix-cache-compaction.ts we assert on the
//     selected `session-maintenance.ts` text: the reprice parameter, the
//     subtraction, and BOTH reduction call sites passing the shape's per-frame
//     estimate. On pristine source (patch missing/reverted) this gate FAILS —
//     that is the negative control.
//   GATE 2 (behavior, decision formula): replay a superseded archive and assert
//     the decision flips: at the 5024 ceiling `S+R >= A+R` (the rejection the
//     overcharge produces), repriced at `shape.frameTokenEstimate`
//     `S_real+R < A+R` (the genuine reduction admitted).
//
// Fixture policy (verification-gate-contracts §3): the boundary is built
// in-process. No workstation session database or request log is read by
// default, and an explicit fixture path is rejected before access when it
// resolves inside a live install or agent-state directory.
//
// Usage:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-snapcompact-frame-reprice.ts
//   OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-snapcompact-frame-reprice.ts <fixture.jsonl>
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Local structural fixture types. A type-only import cannot be root-selected
// (TS needs a literal specifier), and a live-install path would defeat root
// redirection (verification-gate-contracts §3). They describe only the fields
// this fixture builds and the consumers read; every module the gate exercises
// is imported from the selected root below.
interface FixtureTextBlock {
	type: string;
	text?: string;
	[key: string]: unknown;
}
interface AgentMessageFixture {
	role: string;
	content: FixtureTextBlock[];
	timestamp: number;
	[key: string]: unknown;
}
interface SessionEntry {
	type: string;
	id?: string;
	message?: unknown;
	summary?: string;
	firstKeptEntryId?: string;
	preserveData?: Record<string, unknown>;
	[key: string]: unknown;
}
interface Model {
	id: string;
	provider: string;
	api: string;
	contextWindow?: number;
	maxTokens?: number;
	input?: string[];
	[key: string]: unknown;
}
interface SnapcompactModule {
	FRAME_TOKEN_ESTIMATE: number;
	FRAME_DATA_BYTES_BUDGET: number;
	compact(
		preparation: unknown,
		options: unknown,
	): Promise<{ summary: string; shortSummary?: string; preserveData: Record<string, unknown> }>;
	getPreservedArchive(preserveData: unknown): { frames: unknown[] } | undefined;
	historyBlocks(archive: unknown, options: { maxFrameDataBytes: number }): Array<{ type: string }>;
	resolveShape(
		model: Model,
		setting: string,
	): { font: string; variant: string; frameSize: number; frameTokenEstimate: number };
}
interface Tokenizer {
	countMessage(message: unknown, options?: { excludeEncryptedReasoning?: boolean }): number;
	countMessages(messages: readonly unknown[], options?: { excludeEncryptedReasoning?: boolean }): number;
}

// ---------------------------------------------------------------------------
// Selected roots. A dynamic import is required because the specifier is
// runtime-selected; loading is fail-closed so a missing package aborts the
// gate instead of silently measuring the live install.
// ---------------------------------------------------------------------------
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`;

async function loadFromRoot(label: string, specifier: string): Promise<unknown> {
	try {
		return await import(specifier);
	} catch (error) {
		throw new Error(`GATE cannot load ${label} from ${specifier} (${(error as Error).message})`);
	}
}

const snapcompact = (await loadFromRoot("snapcompact", `${SNAP_ROOT}/src/snapcompact.ts`)) as SnapcompactModule;
const tokenizerModule = (await loadFromRoot("pi-agent-core tokenizer", `${CORE_ROOT}/src/tokenizer.ts`)) as {
	Tokenizer: new (model: Model) => Tokenizer;
};
const summaryModule = (await loadFromRoot(
	"pi-agent-core summary builder",
	`${CORE_ROOT}/src/compaction/messages.ts`,
)) as {
	createCompactionSummaryMessage: (
		summary: string,
		tokensBefore: number,
		timestamp: string,
		extras: { shortSummary?: string; blocks?: unknown[] },
	) => AgentMessageFixture;
};
const { Tokenizer } = tokenizerModule;
const { createCompactionSummaryMessage } = summaryModule;

assert.ok(existsSync(`${AGENT_ROOT}/src/session/session-maintenance.ts`), `agent root not found at ${AGENT_ROOT}`);

// ---------------------------------------------------------------------------
// GATE 1: the patch is present in the selected source the runtime executes.
// ---------------------------------------------------------------------------
const maintenanceSource = readFileSync(`${AGENT_ROOT}/src/session/session-maintenance.ts`, "utf8");
assert.match(
	maintenanceSource,
	/#projectSnapcompactContextTokens\([\s\S]*?options\?: MessageCountOptions,\s*\n\t\tframeTokenEstimate\?: number,/,
	"patch 0045 missing: #projectSnapcompactContextTokens has no frameTokenEstimate parameter",
);
assert.match(
	maintenanceSource,
	/tokens -= frameCount \* \(snapcompact\.FRAME_TOKEN_ESTIMATE - frameTokenEstimate\);/,
	"patch 0045 missing: the reduction-side frame reprice subtraction is absent",
);
const reductionCallsites = maintenanceSource.match(/excludeEncryptedReasoning: true,\s*\n\s*\},\s*\n\s*shape\.frameTokenEstimate,\n/g);
assert.equal(
	reductionCallsites?.length,
	2,
	`patch 0045 missing: both reduction call sites must pass shape.frameTokenEstimate (found ${reductionCallsites?.length ?? 0})`,
);
// The window-fit projections must keep the ceiling (no 4th argument).
const windowFitCallsites = maintenanceSource.match(/#projectSnapcompactContextTokens\(preparation, snapcompactResult\);/g);
assert.equal(
	windowFitCallsites?.length,
	2,
	`window-fit calls must stay unrepriced (found ${windowFitCallsites?.length ?? 0} of 2)`,
);

// ---------------------------------------------------------------------------
// Fixture: the boundary the replay window is cut on.
// ---------------------------------------------------------------------------

// The overcharge is family-specific. `FRAME_TOKEN_ESTIMATE` (5024) is the
// cross-shape Anthropic pixel-area ceiling; the reduction side charges every
// re-attached frame that price whatever the target model bills. A
// google-generative-ai wire bills a flat 1,120 per frame, so the same archive
// is priced ~4.5x too high and the guard rejects a genuinely reducing pass —
// the documented case ("a Google one 1,120"). The fixture therefore reads on a
// Google-family model; the archive geometry comes from the same auto shape.
const model = {
	provider: "google",
	api: "google-generative-ai",
	id: "gemini-3.5-pro",
	contextWindow: 1_048_576,
	input: ["text", "image"],
} as unknown as Model;
const tk = new Tokenizer(model);
const opts = { excludeEncryptedReasoning: true } as const;

/** Deterministic dense filler: short renderer-safe tokens, no unrenderable glyphs. */
function denseText(chars: number, seed: number): string {
	let state = seed;
	const word = (): string => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		// Three-character tokens: dense enough that a full frame bills inside
		// the (live shape price, cross-shape ceiling] band this gate needs.
		return `${(state % 1296).toString(36).padStart(2, "0")}`;
	};
	let text = "";
	while (text.length < chars) text += `${word()} ${word()} ${word()} `;
	return text.slice(0, chars);
}

/**
 * Synthetic boundary, built in-process: one committed snapcompact archive that
 * the next pass supersedes. The archived text is dense, so the renderer fits it
 * into full frames whose cross-shape ceiling price (5024/frame) exceeds the
 * text they replace while the live shape price does not — exactly the
 * overcharge the reprice removes. A successor compaction closes the replay
 * window, so the numbers are a function of this fixture rather than of a
 * growing session.
 */
async function syntheticSession(): Promise<SessionEntry[]> {
	const messages: AgentMessageFixture[] = [];
	const ARCHIVED_MESSAGES = 24;
	const CHARS_PER_MESSAGE = 18_000;
	let timestamp = 1_000;
	for (let i = 0; i < ARCHIVED_MESSAGES; i++) {
		messages.push({
			role: i % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `${i}: ${denseText(CHARS_PER_MESSAGE, 0x5eed + i)}` }],
			timestamp: (timestamp += 1000),
		});
	}
	// The retained tail: one large message, so the 20000-token keepRecent split
	// lands inside the region instead of pushing the whole fixture into the
	// kept tail.
	messages.push({
		role: "assistant",
		content: [{ type: "text", text: `tail: ${denseText(60_000, 0xbeef)}` }],
		timestamp: (timestamp += 1000),
	});

	const priorSummary = "PRIOR_SUMMARY";
	const priorPreserveData = (
		await snapcompact.compact(
			{
				firstKeptEntryId: "fixture",
				tokensBefore: 0,
				previousSummary: undefined,
				previousPreserveData: undefined,
				fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
				messagesToSummarize: messages.slice(0, 8),
				turnPrefixMessages: [],
			} as never,
			{ convertToLlm: (m: readonly unknown[]) => m, model, maxFrames: 40, includeThinking: true },
		)
	).preserveData;

	const session: SessionEntry[] = [
		{ type: "message", id: "boundary-first-kept", parentId: null, timestamp: "1", message: messages[0] },
	];
	let parentId = "boundary-first-kept";
	messages.slice(1).forEach((message, index) => {
		const id = `message-${index + 1}`;
		session.push({ type: "message", id, parentId, timestamp: String(index + 2), message });
		parentId = id;
	});
	// The superseded archive: its `firstKeptEntryId` heads the region the next
	// pass re-summarizes.
	session.push({
		type: "compaction",
		id: "superseded-compaction",
		parentId,
		timestamp: "999",
		summary: priorSummary,
		firstKeptEntryId: "boundary-first-kept",
		tokensBefore: 0,
		preserveData: priorPreserveData,
	});
	// The successor that closes the window.
	session.push({
		type: "compaction",
		id: "successor-compaction",
		parentId: "superseded-compaction",
		timestamp: "1000",
		summary: "SUCCESSOR",
		firstKeptEntryId: "message-1",
		tokensBefore: 0,
	});
	return session;
}

// Live-path guard: an explicit fixture is an override, never the default — the
// default is the synthetic session below. The guard runs BEFORE any read, so a
// mistaken path cannot reach a real session database unnoticed.
const LIVE_PATH = /(?:^|\/)(?:\.omp|\.bun|node_modules|\.codex|\.claude)(?:\/|$)/;
const FIXTURE = process.argv[2];
const entries: SessionEntry[] = FIXTURE
	? (() => {
			const absolute = resolve(FIXTURE);
			assert.ok(!LIVE_PATH.test(absolute), `fixture path must not be a live install/state path: ${absolute}`);
			return readFileSync(absolute, "utf8")
				.split("\n")
				.filter(Boolean)
				.flatMap((line) => {
					try {
						return [JSON.parse(line) as SessionEntry];
					} catch {
						return [];
					}
				});
		})()
	: await syntheticSession();

// ---------------------------------------------------------------------------
// GATE 2: replay the boundary; the decision flips under repricing.
// ---------------------------------------------------------------------------

// The documented failure is bound to ONE compaction entry (its `preserveData`
// supplies the previous archive, and the messages after it supply the text that
// must shrink). An append-only session file is therefore never replayed past
// its successor: the replay window ENDS at the next compaction entry, so the
// numbers are a stable function of the fixture instead of the session's current
// length. A boundary with no successor keeps EOF as its end.
// `OMP_PATCH_VERIFY_REPRICE_BOUNDARY=<compaction-id>` pins an entry when more
// than one candidate exists.
const boundaryIndices: number[] = [];
for (let i = entries.length - 1; i >= 0; i--) {
	if (entries[i].type === "compaction") boundaryIndices.push(i);
}
const withArchive = boundaryIndices.filter((i) => snapcompact.getPreservedArchive(entries[i].preserveData));
assert.ok(withArchive.length > 0, "no compaction entry carrying a snapcompact archive; wrong fixture");

const pinned = process.env.OMP_PATCH_VERIFY_REPRICE_BOUNDARY;
let candidates = withArchive;
if (pinned) {
	candidates = withArchive.filter((i) => entries[i].id === pinned);
	assert.ok(
		candidates.length === 1,
		`boundary ${pinned} not found in this fixture (have: ${withArchive.map((i) => entries[i].id).join(", ")})`,
	);
}

/** Index of the next compaction after `compIdx`, or `entries.length`. */
function nextCompactionAfter(compIdx: number): number {
	let next = entries.length;
	for (const i of boundaryIndices) {
		if (i > compIdx && i < next) next = i;
	}
	return next;
}

interface Boundary {
	id: string | undefined;
	frames: number;
	A: number;
	R: number;
	S_ceiling: number;
	S_real: number;
}

async function evaluateBoundary(compIdx: number): Promise<Boundary> {
	const prev = entries[compIdx];
	const endIdx = nextCompactionAfter(compIdx);
	let startIdx = entries.findIndex((e) => e.id === prev.firstKeptEntryId);
	if (startIdx < 0 || startIdx > endIdx) startIdx = compIdx + 1;
	const msgs: AgentMessageFixture[] = [];
	for (let i = startIdx; i < endIdx; i++) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message !== undefined) msgs.push(entry.message as AgentMessageFixture);
	}

	// Mirror prepareCompaction's keepRecentTokens=20000 tail split.
	let cut = msgs.length;
	let recent = 0;
	for (let i = msgs.length - 1; i >= 0; i--) {
		recent += tk.countMessage(msgs[i], opts);
		if (recent > 20_000) {
			cut = i;
			break;
		}
		cut = i;
	}
	const archived = msgs.slice(0, cut);
	const kept = msgs.slice(cut);
	assert.ok(archived.length > 0, "fixture archived no messages; wrong boundary");
	const A = tk.countMessages(archived, opts);
	const R = tk.countMessages(kept, opts);

	const result = await snapcompact.compact(
		{
			firstKeptEntryId: "replay",
			tokensBefore: A + R,
			previousSummary: prev.summary,
			previousPreserveData: prev.preserveData,
			fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
			messagesToSummarize: archived,
			turnPrefixMessages: [],
		} as never,
		{ convertToLlm: (m: readonly unknown[]) => m, model, maxFrames: 40, includeThinking: true },
	);

	const archive = snapcompact.getPreservedArchive(result.preserveData);
	assert.ok(archive && archive.frames.length > 0, "replay produced no frames; nothing to price");
	const blocks = snapcompact.historyBlocks(archive, { maxFrameDataBytes: snapcompact.FRAME_DATA_BYTES_BUDGET });
	const N = blocks.filter((block) => block.type !== "text").length;
	const summaryMsg = createCompactionSummaryMessage(result.summary, 0, new Date().toISOString(), {
		shortSummary: result.shortSummary,
		blocks,
	});
	const S_ceiling = tk.countMessage(summaryMsg, opts);
	const shape = snapcompact.resolveShape(model, "auto");
	// Same delta the patched guard applies: frameCount x (ceiling - shape price).
	const S_real = S_ceiling - N * (snapcompact.FRAME_TOKEN_ESTIMATE - shape.frameTokenEstimate);
	return { id: prev.id, frames: N, A, R, S_ceiling, S_real };
}

// Pick the boundary whose pass was rejected at the ceiling — that rejection is
// the observed incident, so the reprice assertion below tests whether the fix
// flips a real decision. The flip is NOT part of the selection criterion, so it
// remains a genuine assertion.
const tried: string[] = [];
let boundary: Boundary | undefined;
for (const compIdx of candidates) {
	const candidate = await evaluateBoundary(compIdx);
	tried.push(
		`${candidate.id ?? compIdx}: S+R=${candidate.S_ceiling + candidate.R} vs A+R=${candidate.A + candidate.R} frames=${candidate.frames}`,
	);
	if (candidate.S_ceiling + candidate.R >= candidate.A + candidate.R) {
		boundary = candidate;
		break;
	}
}
assert.ok(
	boundary !== undefined,
	`no compaction boundary reproduces the rejection at the 5024 ceiling. Tried: ${tried.join(" | ")}`,
);

const { frames: N, A, R, S_ceiling, S_real } = boundary;
const shape = snapcompact.resolveShape(model, "auto");
console.log(
	`boundary=${boundary.id} frames=${N} shape=${shape.font}/${shape.variant}@${shape.frameSize} per-frame: ceiling=${snapcompact.FRAME_TOKEN_ESTIMATE} real=${shape.frameTokenEstimate}`,
);
console.log(`A=${A} R=${R} S_ceiling=${S_ceiling} S_real=${S_real}`);

// Fixture anchors, pinned. The synthetic boundary is deterministic, so these
// numbers are properties of the fixture and of the selected tree's renderer,
// tokenizer and family table together. A drift here means one of them changed
// under the gate — re-derive the fixture and re-pin, never widen the band.
const ANCHORS = { id: "superseded-compaction", frames: 21, A: 99_022, R: 24_004, S_ceiling: 117_689, S_real: 35_705 };
assert.equal(boundary.id, ANCHORS.id, "synthetic fixture boundary drifted");
assert.equal(N, ANCHORS.frames, `fixture re-attached ${N} frames, pinned ${ANCHORS.frames}`);
assert.equal(A, ANCHORS.A, `fixture archived ${A} tokens, pinned ${ANCHORS.A}`);
assert.equal(R, ANCHORS.R, `fixture retained ${R} tokens, pinned ${ANCHORS.R}`);
assert.equal(S_ceiling, ANCHORS.S_ceiling, `ceiling-priced summary is ${S_ceiling}, pinned ${ANCHORS.S_ceiling}`);
assert.equal(S_real, ANCHORS.S_real, `repriced summary is ${S_real}, pinned ${ANCHORS.S_real}`);

assert.ok(N > 0, "fixture must re-attach at least one frame");
assert.ok(
	shape.frameTokenEstimate < snapcompact.FRAME_TOKEN_ESTIMATE,
	`overcharge premise broken: shape price ${shape.frameTokenEstimate} not below ceiling ${snapcompact.FRAME_TOKEN_ESTIMATE}`,
);
assert.ok(
	S_real + R < A + R,
	`repriced projection does not reduce (S_real+R=${S_real + R} >= A+R=${A + R}) — fix ineffective on the replayed boundary`,
);
console.log(
	"PASS: selected source carries the reprice; 5024 ceiling rejects the reduction, shape repricing admits it",
);
