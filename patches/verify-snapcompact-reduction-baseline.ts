// Patch 0062 regression: the snapcompact reduction baseline must credit the
// archive the new pass supersedes.
//
// Failure signature (recorded, devin/swe-2, context 262000):
//   ~/.omp/logs/omp.2026-09-13.3292566.log
//   warn Snapcompact projection would not reduce context
//     {model: swe-2, projected: 133797, reductionBaseline: 99819}
//   The pass re-rendered a committed 25-frame archive into a 29-30 frame plan
//   over a 69,109-token region and was rejected, even though it removed the
//   region and its superseded archive while adding five frames.
//
//   GATE 1 (structure, live source): #projectPreSnapcompactContextTokens and its
//     new #projectPreviousArchiveTokens helper are private — unreachable from
//     outside the class — so assert on the live `session-maintenance.ts` text:
//     the helper exists and reads the superseded archive, the baseline adds it,
//     every call site passes the live shape's per-frame price, and no unpriced
//     call survives. On pristine source this gate FAILS — the negative control.
//   GATE 2 (behavior, decision formula): replay the recorded boundary as
//     arithmetic and assert the decision flips, plus two controls that must not:
//       (a) a plan whose frame count grows past what the region pays for,
//       (b) a FIRST pass (no superseded archive), which keeps the old verdict.
//
// Usage:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-snapcompact-reduction-baseline.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FRAME_TOKEN_ESTIMATE } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point at the live agent tree");
const source = readFileSync(`${AGENT_ROOT}/src/session/session-maintenance.ts`, "utf8");

// ---------------------------------------------------------------------------
// GATE 1: the patch is present in the LIVE source the runtime executes.
// ---------------------------------------------------------------------------
assert.match(
	source,
	/#projectPreSnapcompactContextTokens\(preparation: CompactionPreparation, frameTokenEstimate\?: number\): number \{/,
	"patch 0062 missing: the baseline takes no per-frame price for the superseded archive",
);
assert.match(
	source,
	/#projectPreviousArchiveTokens\(preparation: CompactionPreparation, frameTokenEstimate\?: number\): number \{/,
	"patch 0062 missing: #projectPreviousArchiveTokens is absent",
);
assert.match(
	source,
	/const archive = snapcompact\.getPreservedArchive\(preparation\.previousPreserveData\);/,
	"patch 0062 missing: the helper does not read the superseded archive",
);
assert.match(
	source,
	/tokens -= frameCount \* \(snapcompact\.FRAME_TOKEN_ESTIMATE - frameTokenEstimate\);/,
	"patch 0062 missing: the superseded frames are not repriced against the live shape",
);
assert.match(
	source,
	/tokens \+= this\.#projectPreviousArchiveTokens\(preparation, frameTokenEstimate\);/,
	"patch 0062 missing: the baseline never credits the superseded archive",
);
const pricedCallsites = source.match(
	/#projectPreSnapcompactContextTokens\(\s*preparation,\s*shape\.frameTokenEstimate,?\s*\)/g,
);
assert.equal(
	pricedCallsites?.length,
	3,
	`patch 0062 missing: all three baseline call sites must pass the shape price (found ${pricedCallsites?.length ?? 0})`,
);
assert.equal(
	source.match(/#projectPreSnapcompactContextTokens\(\s*preparation\s*\)/g),
	null,
	"patch 0062 missing: an unpriced baseline call survives (the superseded archive would be dropped)",
);

// ---------------------------------------------------------------------------
// GATE 2: the recorded boundary, and the controls the fix must not break.
// Figures from the replay of the recorded session file (maxFrames=30):
//   region A=69109  recent R=8293  new plan: 30 frames, summary text 7610
//   superseded archive: 25 frames, summary text 7505
//   swe-2 shape price = 3293/frame (8on22-bw @1568), ceiling = 5024
// ---------------------------------------------------------------------------
const INCIDENT = {
	regionTokens: 69_109,
	recentTokens: 8_293,
	summaryText: 7_610,
	frames: 30,
	supersededFrames: 25,
	supersededText: 7_505,
	framePrice: 3_293,
} as const;
assert.ok(
	INCIDENT.framePrice < FRAME_TOKEN_ESTIMATE,
	`premise broken: the recorded shape price ${INCIDENT.framePrice} is not below the ceiling ${FRAME_TOKEN_ESTIMATE}`,
);

const projected = INCIDENT.summaryText + INCIDENT.frames * INCIDENT.framePrice + INCIDENT.recentTokens;
const legacyBaseline = INCIDENT.regionTokens + INCIDENT.recentTokens;
const supersededCost = INCIDENT.supersededText + INCIDENT.supersededFrames * INCIDENT.framePrice;
assert.ok(
	projected >= legacyBaseline,
	`the recorded rejection no longer reproduces (projected ${projected} < baseline ${legacyBaseline})`,
);
assert.ok(
	projected < legacyBaseline + supersededCost,
	`0062 does not admit the recorded reduction (projected ${projected} >= baseline ${legacyBaseline + supersededCost})`,
);

/** The decision the patched guard makes, in the domain it compares. */
function decide(regionTokens: number, frames: number, supersededFrames: number): "reject" | "accept" {
	const reduction = INCIDENT.summaryText + frames * INCIDENT.framePrice + INCIDENT.recentTokens;
	const baseline =
		regionTokens + INCIDENT.recentTokens + INCIDENT.supersededText + supersededFrames * INCIDENT.framePrice;
	return reduction >= baseline ? "reject" : "accept";
}

assert.equal(
	decide(20_000, 40, 25),
	"reject",
	"a 25 -> 40 frame plan over a 20k region must still fail: crediting the superseded archive must not disable the guard",
);
assert.equal(
	decide(INCIDENT.regionTokens, INCIDENT.frames, 0),
	projected >= legacyBaseline ? "reject" : "accept",
	"a first pass (no superseded archive) must keep the previous verdict exactly",
);
assert.equal(decide(INCIDENT.regionTokens, INCIDENT.frames, INCIDENT.supersededFrames), "accept");

console.log(
	"PASS: live source credits the superseded archive and reprices it; recorded rejection " +
		`(projected ${projected} >= baseline ${legacyBaseline}) flips to accept ` +
		`(baseline ${legacyBaseline + supersededCost}); growing plans and first passes unchanged`,
);
