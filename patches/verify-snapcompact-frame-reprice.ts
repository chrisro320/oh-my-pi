// Patch 0045 regression: snapcompact reduction guard must price archive
// frames at the live shape's per-frame estimate, not the cross-shape
// FRAME_TOKEN_ESTIMATE ceiling.
//
// Two gates, run together:
//   GATE 1 (structure, live source): the patched guard is a private method
//     (`#projectSnapcompactContextTokens`) — unreachable from outside the
//     class, so like verify-prefix-cache-compaction.ts we assert on the live
//     `session-maintenance.ts` text: the reprice parameter, the subtraction,
//     and BOTH reduction call sites passing the shape's per-frame estimate.
//     On pristine source (patch missing/reverted) this gate FAILS — that is
//     the negative control.
//   GATE 2 (behavior, decision formula): replay the real failing boundary and
//     assert the decision flips: at the 5024 ceiling `S+R >= A+R` (the live
//     rejection), repriced at shape.frameTokenEstimate `S_real+R < A+R`
//     (genuine reduction admitted).
//
// Usage:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> \
//     bun patches/verify-snapcompact-frame-reprice.ts <session.jsonl>
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as snapcompact from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts";
import { Tokenizer } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/tokenizer.ts";
import { createCompactionSummaryMessage } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction/messages.ts";
import type { Model } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/types.ts";

interface SessionEntry {
	type: string;
	id?: string;
	summary?: string;
	firstKeptEntryId?: string;
	preserveData?: Record<string, unknown>;
	message?: unknown;
}

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point at the live agent tree");
const SESSION_FILE = process.argv[2];
if (!SESSION_FILE) {
	console.error("usage: OMP_PATCH_VERIFY_AGENT_ROOT=<root> verify-snapcompact-frame-reprice.ts <session.jsonl>");
	process.exit(2);
}

// ---------------------------------------------------------------------------
// GATE 1: the patch is present in the LIVE source the runtime executes.
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
// GATE 2: replay the real failing boundary; the decision flips under repricing.
// ---------------------------------------------------------------------------
const entries: SessionEntry[] = [];
for (const line of readFileSync(SESSION_FILE, "utf8").split("\n").filter(Boolean)) {
	try {
		entries.push(JSON.parse(line) as SessionEntry);
	} catch {
		/* skip malformed */
	}
}

// Boundary selection. The documented failure is bound to ONE compaction entry
// (its `preserveData` supplies the previous archive, and the messages after it
// supply the text that must shrink). A live session file is append-only, so
// "the latest compaction" drifts as the session grows and eventually stops
// reproducing the boundary.
//
// The replay window therefore ENDS at the next compaction entry: everything the
// boundary's pass could have seen before it was superseded. That makes the
// numbers a stable function of the fixture instead of the session's current
// length — on the recorded fixture the window closes at `6bc7f78b` and
// reproduces the incident figures exactly (frames=18, A=63729, R=21665,
// S_ceiling=98757). A boundary with no successor keeps EOF as its end.
//
// `OMP_PATCH_VERIFY_REPRICE_BOUNDARY=<compaction-id>` pins the entry; the
// recorded fixture is `6375bca4` in
// `-orca-projects-人山/2026-09-04T15-45-20-731Z_01a06d18-8d5b-...jsonl`.
const boundaryIndices: number[] = [];
for (let i = entries.length - 1; i >= 0; i--) {
	if (entries[i].type === "compaction") boundaryIndices.push(i);
}
const withArchive = boundaryIndices.filter((i) => snapcompact.getPreservedArchive(entries[i].preserveData));
assert.ok(withArchive.length > 0, "no compaction entry carrying a snapcompact archive; wrong fixture");

// The recorded incident boundary. The session file is append-only, so a
// "newest compaction" or "first ceiling rejection" selector drifts as the
// session grows and eventually lands on a boundary that no longer reproduces
// the decision. The recorded fixture already pins the right one, so default to
// it and let a caller override via OMP_PATCH_VERIFY_REPRICE_BOUNDARY.
const RECORDED_BOUNDARY = "6375bca4";
const pinned = process.env.OMP_PATCH_VERIFY_REPRICE_BOUNDARY ?? RECORDED_BOUNDARY;
const pinnedAt = withArchive.filter((i) => entries[i].id === pinned);
assert.ok(
	pinnedAt.length === 1,
	`boundary ${pinned} not found in this fixture (have: ${withArchive.map((i) => entries[i].id).join(", ")}); ` +
		`pass OMP_PATCH_VERIFY_REPRICE_BOUNDARY=<compaction-id> to select another.`,
);
const candidates = pinnedAt;

// Only boundaries whose window has CLOSED are replayable: without a successor
// the session is still appending into the same window, so A/R keep growing and
// the recorded decision cannot be reproduced.
/** Index of the next compaction after `compIdx`, or `entries.length`. */
function nextCompactionAfter(compIdx: number): number {
	let next = entries.length;
	for (const i of boundaryIndices) {
		if (i > compIdx && i < next) next = i;
	}
	return next;
}

// The failing session ran gpt-6-astra on a hand-written openai-responses
// gateway (wanzhao). The shape family is resolved from the wire api, so any
// openai-responses provider reproduces the same pricing.
const model = {
	provider: "wanzhao",
	api: "openai-responses",
	id: "gpt-6-astra",
	contextWindow: 278528,
	input: ["text", "image"],
} as unknown as Model;
const tk = new Tokenizer(model);
const opts = { excludeEncryptedReasoning: true } as const;

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
	const msgs: never[] = [];
	for (let i = startIdx; i < endIdx; i++) {
		const e = entries[i];
		if (e.type === "message" && e.message !== undefined) msgs.push(e.message as never);
	}

	// Mirror prepareCompaction's keepRecentTokens=20000 tail split.
	let cut = msgs.length, recent = 0;
	for (let i = msgs.length - 1; i >= 0; i--) {
		recent += tk.countMessage(msgs[i], opts);
		if (recent > 20000) { cut = i; break; }
		cut = i;
	}
	const archived = msgs.slice(0, cut), kept = msgs.slice(cut);
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
		{ convertToLlm: (m: readonly never[]) => m, model, maxFrames: 40, includeThinking: true },
	);

	const archive = snapcompact.getPreservedArchive(result.preserveData);
	assert.ok(archive && archive.frames.length > 0, "replay produced no frames; nothing to price");
	const blocks = snapcompact.historyBlocks(archive, { maxFrameDataBytes: snapcompact.FRAME_DATA_BYTES_BUDGET });
	const N = blocks.filter((b) => b.type !== "text").length;
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
// remains a genuine assertion (a boundary can be rejected at the ceiling and
// still fail to flip — the live 6bc7f78b boundary does exactly that).
const tried: string[] = [];
let boundary: Boundary | undefined;
for (const compIdx of candidates) {
	const candidate = await evaluateBoundary(compIdx);
	tried.push(`${candidate.id ?? compIdx}: S+R=${candidate.S_ceiling + candidate.R} vs A+R=${candidate.A + candidate.R}`);
	if (candidate.S_ceiling + candidate.R >= candidate.A + candidate.R) {
		boundary = candidate;
		break;
	}
}
assert.ok(
	boundary !== undefined,
	`no compaction boundary reproduces the live rejection at the 5024 ceiling. Tried (oldest window ` +
		`first): ${tried.join(" | ")}. Pass the recorded fixture or pin OMP_PATCH_VERIFY_REPRICE_BOUNDARY.`,
);

const { frames: N, A, R, S_ceiling, S_real } = boundary;
const shape = snapcompact.resolveShape(model, "auto");
console.log(`boundary=${boundary.id} frames=${N} shape=${shape.font}/${shape.variant}@${shape.frameSize} per-frame: ceiling=${snapcompact.FRAME_TOKEN_ESTIMATE} real=${shape.frameTokenEstimate}`);
console.log(`A=${A} R=${R} S_ceiling=${S_ceiling} S_real=${S_real}`);

assert.ok(
	shape.frameTokenEstimate < snapcompact.FRAME_TOKEN_ESTIMATE,
	`overcharge premise broken: shape price ${shape.frameTokenEstimate} not below ceiling ${snapcompact.FRAME_TOKEN_ESTIMATE}`,
);
assert.ok(
	S_real + R < A + R,
	`repriced projection does not reduce (S_real+R=${S_real + R} >= A+R=${A + R}) — fix ineffective on the real session`,
);
console.log("PASS: live source carries the reprice; 5024 ceiling rejects the real reduction, shape repricing admits it");
