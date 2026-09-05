// Patch 0045 regression: snapcompact reduction guard must price archive
// frames at the live shape's per-frame estimate, not the cross-shape
// FRAME_TOKEN_ESTIMATE ceiling.
//
// Standalone replay on the real failing session (same convention as
// verify-snapcompact-frame-budget.ts):
//   bun patches/verify-snapcompact-frame-reprice.ts <session.jsonl>
//
// The guard in session-maintenance.ts compares
//   projected = X + S + R   vs   baseline = X + A + R
// (X = non-message overhead, A = archived text, R = kept tail, S = new
// compaction-summary message including its re-attached frames). X and R
// cancel, so the decision is exactly `S >= A -> reject`. The tokenizer bills
// every frame block inside S at FRAME_TOKEN_ESTIMATE (5024); for a
// non-Anthropic model the real per-frame price is shape.frameTokenEstimate
// (openai 8on22-bw @1568px = 2882, google = 1120). This script replays the
// real boundary and asserts:
//   1. at the 5024 ceiling the guard REJECTS (the live failure),
//   2. repriced at the shape's own estimate the guard PASSES.
import * as snapcompact from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts";
import { Tokenizer } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/tokenizer.ts";
import { createCompactionSummaryMessage } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction/messages.ts";
import { readFileSync } from "node:fs";
import type { Model } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/types.ts";

interface SessionEntry {
	type: string;
	id?: string;
	timestamp?: string;
	summary?: string;
	firstKeptEntryId?: string;
	preserveData?: Record<string, unknown>;
	message?: unknown;
}

const path = process.argv[2];
if (!path) {
	console.error("usage: verify-snapcompact-frame-reprice.ts <session.jsonl>");
	process.exit(2);
}
const entries: SessionEntry[] = [];
for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
	try {
		entries.push(JSON.parse(line) as SessionEntry);
	} catch {
		/* skip malformed */
	}
}

// Latest compaction entry = the boundary the failing pass ran against; its
// preserveData carries the previous archive frames that get folded into the
// new render (this is what made the live archive 18 frames, not 7).
let lastCompIdx = -1;
for (let i = entries.length - 1; i >= 0; i--) if (entries[i].type === "compaction") { lastCompIdx = i; break; }
if (lastCompIdx < 0) { console.error("no compaction entry in session"); process.exit(1); }
const prev = entries[lastCompIdx];
if (!snapcompact.getPreservedArchive(prev.preserveData)) {
	console.error("latest compaction entry carries no snapcompact archive; wrong fixture");
	process.exit(1);
}
let startIdx = entries.findIndex((e) => e.id === prev.firstKeptEntryId);
if (startIdx < 0) startIdx = lastCompIdx + 1;
const msgs: never[] = [];
for (let i = startIdx; i < entries.length; i++) {
	const e = entries[i];
	if (e.type === "message" && e.message !== undefined) msgs.push(e.message as never);
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
if (!archive || archive.frames.length === 0) {
	console.error("replay produced no frames; nothing to price");
	process.exit(1);
}
const blocks = snapcompact.historyBlocks(archive, { maxFrameDataBytes: snapcompact.FRAME_DATA_BYTES_BUDGET });
const N = blocks.filter((b) => b.type !== "text").length;
const summaryMsg = createCompactionSummaryMessage(result.summary, 0, new Date().toISOString(), {
	shortSummary: result.shortSummary,
	blocks,
});
const S_ceiling = tk.countMessage(summaryMsg, opts);
const shape = snapcompact.resolveShape(model, "auto");
const S_real = S_ceiling - N * (snapcompact.FRAME_TOKEN_ESTIMATE - shape.frameTokenEstimate);

console.log(`frames=${N} shape=${shape.font}/${shape.variant}@${shape.frameSize} per-frame: ceiling=${snapcompact.FRAME_TOKEN_ESTIMATE} real=${shape.frameTokenEstimate}`);
console.log(`A=${A} R=${R} S_ceiling=${S_ceiling} S_real=${S_real}`);

let fail = 0;
if (!(S_ceiling + R >= A + R)) {
	console.error(`FAIL: fixture no longer reproduces the live rejection at the 5024 ceiling (S+R=${S_ceiling + R} < A+R=${A + R})`);
	fail = 1;
}
if (!(S_real + R < A + R)) {
	console.error(`FAIL: repriced projection does not reduce (S_real+R=${S_real + R} >= A+R=${A + R}) — fix ineffective on the real session`);
	fail = 1;
}
// The patched guard subtracts exactly this delta; keep the two expressions in sync.
if (shape.frameTokenEstimate >= snapcompact.FRAME_TOKEN_ESTIMATE) {
	console.error(`FAIL: shape price ${shape.frameTokenEstimate} not below ceiling ${snapcompact.FRAME_TOKEN_ESTIMATE} — overcharge premise broken`);
	fail = 1;
}
if (!fail) console.log("PASS: 5024 ceiling rejects the real reduction; shape repricing admits it");
process.exit(fail);
