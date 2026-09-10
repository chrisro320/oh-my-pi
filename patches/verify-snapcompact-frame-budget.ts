// Patch 0053 regression: snapcompact must size its frame cap from the SAME
// shape it will render with, and the byte table must reflect real pages.
//
// Why: `#computeSnapcompactMaxFrames` derived its shape from `resolveShape`
// while the caller rendered with `resolveShapeForText`. Those two disagree
// whenever the text is CJK-heavy, because `resolveShapeForText` swaps in a
// Silver grid whose `FRAME_DATA_BYTES_PER_SHAPE` entry is ~8x larger — so the
// planner believed 150 frames fit where 3 did, and `shedFramesOverBudget`
// silently dropped most of the archive afterwards. The plan and the render
// must be computed from one shape.
//
// Two assertions:
//   GATE 1 (structure): the cap helpers accept a resolved shape and every call
//     site hands them one, and the byte table carries the measured pages.
//   GATE 2 (behaviour): feed the real byte table and the real resolver, and
//     check the planned frame count matches what the budget actually holds.
//
// Usage:
//   bun patches/verify-snapcompact-frame-budget.ts
//
// Zero provider calls; source-text and local-arithmetic assertions only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const AGENT_ROOT =
	process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent";
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact";

const maintenance = (() => {
	try {
		return readFileSync(`${AGENT_ROOT}/src/session/session-maintenance.ts`, "utf8");
	} catch (error) {
		throw new Error(`GATE 1 cannot load ${AGENT_ROOT}/src/session/session-maintenance.ts (${(error as Error).message})`);
	}
})();
const source = (() => {
	try {
		return readFileSync(`${SNAP_ROOT}/src/snapcompact.ts`, "utf8");
	} catch (error) {
		throw new Error(`GATE 1 cannot load ${SNAP_ROOT}/src/snapcompact.ts (${(error as Error).message})`);
	}
})();

// ---------------------------------------------------------------------------
// GATE 1: the cap helpers take a resolved shape, and callers supply one.
// ---------------------------------------------------------------------------
assert.match(
	maintenance,
	/#computeSnapcompactMaxFrames\(\s*\n\s*preparation: CompactionPreparation,\s*\n\s*settings: EngineCompactionSettings,\s*\n\s*resolvedShape\?: snapcompact\.Shape,/,
	"patch 0053 missing: #computeSnapcompactMaxFrames has no resolvedShape parameter",
);
assert.match(
	maintenance,
	/#computeSnapcompactRescueMaxFrames\(\s*\n\s*settings: EngineCompactionSettings,\s*\n\s*keptTailTokens: number,\s*\n\s*resolvedShape\?: snapcompact\.Shape,/,
	"patch 0053 missing: #computeSnapcompactRescueMaxFrames has no resolvedShape parameter",
);

// Both helpers must actually consume the passed shape, not re-derive one.
// Anchor on the declaration (multi-line signature), not the first call site.
const declAt = maintenance.search(/#computeSnapcompactMaxFrames\(\s*\n\s*preparation:/);
assert.ok(declAt > 0, "could not locate the #computeSnapcompactMaxFrames declaration");
const capBody = maintenance.slice(declAt, declAt + 4000);
assert.match(
	capBody,
	/resolvedShape \?\? snapcompact\.resolveShape\(/,
	"patch 0053 missing: the cap does not prefer the resolved shape",
);

// Every call site must pass a shape. A three-arg call is the fixed form; a
// two-arg call is the bug this patch exists to prevent.
const maxFramesCalls = maintenance.match(/#computeSnapcompactMaxFrames\(([^)]*)\)/g) ?? [];
const callArgCounts = maxFramesCalls
	.filter(call => !call.includes("preparation: CompactionPreparation")) // skip the declaration
	.map(call => call.slice(0, -1).split(",").length);
assert.ok(maxFramesCalls.length >= 3, "expected at least three #computeSnapcompactMaxFrames references");
for (const n of callArgCounts) {
	assert.equal(n, 3, `a #computeSnapcompactMaxFrames call passes ${n} args; every call must pass the resolved shape`);
}
const rescueCalls = maintenance.match(/#computeSnapcompactRescueMaxFrames\(([^)]*)\)/g) ?? [];
assert.ok(rescueCalls.length >= 1, "expected the rescue cap to have a call site");
for (const call of rescueCalls) {
	if (call.includes("settings: EngineCompactionSettings")) continue;
	assert.equal(call.slice(0, -1).split(",").length, 3, "the rescue cap call must pass the resolved shape");
}

// The INNER byte cap must also receive a shape. Passing a shape into the outer
// helper proves nothing about what the helper does with it: the rescue path
// previously called `maxFramesForDataBudget()` bare, so its byte ceiling came
// from the legacy generic estimate while the main path used the measured table
// — a 1.6x divergence between two routes over the same archive. Assert the
// inner argument directly.
const byteCapCalls = maintenance.match(/maxFramesForDataBudget\(([^)]*)\)/g) ?? [];
assert.ok(byteCapCalls.length >= 4, `expected at least four maxFramesForDataBudget references, found ${byteCapCalls.length}`);
for (const call of byteCapCalls) {
	if (call.includes("maxFrameDataBytes: number")) continue; // the declaration
	const args = call.slice(0, -1).split(",").length;
	assert.equal(
		args,
		2,
		`maxFramesForDataBudget called with ${args} arg(s); every call must pass (FRAME_DATA_BYTES_BUDGET, shape) ` +
			`so both the main and rescue paths size the byte ceiling from the measured table`,
	);
}

// The byte table must carry the measured pages, not the old 20k placeholder.
const table = source.slice(source.indexOf("FRAME_DATA_BYTES_PER_SHAPE"));
const entry = (name: string) => {
	const m = table.match(new RegExp(`"${name}": ([0-9_]+)`));
	assert.ok(m, `byte table is missing ${name}`);
	return Number(m[1].replaceAll("_", ""));
};
// Measured means over persisted frames, at each variant's CANONICAL frame edge
// (the table is area-scaled from there to whatever edge a model resolves to):
// 8on22-bw ~90.8 KB and 8on16-bw ~121.7 KB at 1568, 11on16-bw ~184.1 KB at
// 1932 -> ~122 KB at its canonical 1568. The old 20k values planned 3-6x the
// frames the budget holds.
assert.ok(entry("8on22-bw") >= 90_000, `8on22-bw entry ${entry("8on22-bw")} understates the measured page`);
assert.ok(entry("8on16-bw") >= 120_000, `8on16-bw entry ${entry("8on16-bw")} understates the measured page`);
assert.ok(entry("11on16-bw") >= 120_000, `11on16-bw entry ${entry("11on16-bw")} understates the canonical page`);
// silver must stay an upper bound: its worst observed page was 772,992 B.
assert.ok(entry("silver16-bw") >= 772_992, `silver16-bw entry ${entry("silver16-bw")} no longer covers the worst observed page`);
// 8x13-bw has no measured group (its canonical page is 196x120, which no
// persisted frame used), so it must keep its original value rather than an
// invented one.
assert.equal(entry("8x13-bw"), 25_000, "8x13-bw has no measurement; it must keep its original value, not an invented one");

// The lookup must scale with page area so a non-canonical frame edge keeps
// using the measurement instead of dropping to the generic estimate.
assert.match(
	source,
	/perFrame = Math\.round\(FRAME_DATA_BYTES_PER_SHAPE\[name as ShapeVariantName\] \* \(actual \/ canonical\)\)/,
	"patch 0053 missing: the byte lookup does not scale the measurement by page area",
);

// ---------------------------------------------------------------------------
// GATE 2: the plan must match what the budget actually holds.
// ---------------------------------------------------------------------------
let snapcompact: typeof import("snapcompact");
try {
	snapcompact = await import(`${SNAP_ROOT}/src/snapcompact.ts`);
} catch (error) {
	throw new Error(
		`GATE 2 cannot load ${SNAP_ROOT}/src/snapcompact.ts (${(error as Error).message}); ` +
			`a fault tree must be a full copy of the package (src/ incl. prompts/, plus node_modules).`,
	);
}
assert.equal(
	typeof snapcompact.resolveShape,
	"function",
	`GATE 2 loaded ${SNAP_ROOT}/src/snapcompact.ts but it exports no resolveShape`,
);
const model = { api: "commandcode-custom", id: "deepseek/deepseek-v4.1-flash" } as never;
const shape = snapcompact.resolveShape(model);
const planned = snapcompact.maxFramesForDataBudget(snapcompact.FRAME_DATA_BYTES_BUDGET, shape);

// The typical page for this shape, measured over persisted frames.
const MEASURED_TYPICAL: Record<string, number> = { "8on22-bw": 90_797, "8on16-bw": 121_708, "8x13-bw": 184_116 };
const variantName =
	Object.keys(snapcompact.SHAPE_VARIANTS).find(name => {
		const g = snapcompact.SHAPE_VARIANTS[name as keyof typeof snapcompact.SHAPE_VARIANTS];
		return (
			g.font === shape.font && g.cellWidth === shape.cellWidth && g.cellHeight === shape.cellHeight && g.frameSize === shape.frameSize
		);
	}) ?? "";
const typical = MEASURED_TYPICAL[variantName];
assert.ok(typical, `no measured page size recorded for resolved variant ${variantName || "(unknown)"}`);

const realFrames = Math.min(planned, Math.floor(snapcompact.FRAME_DATA_BYTES_BUDGET / typical));
const wasteRatio = planned / realFrames;
assert.ok(
	wasteRatio <= 1.5,
	`planned ${planned} frames but only ${realFrames} fit (${wasteRatio.toFixed(1)}x over-plan; shedFramesOverBudget would drop ${planned - realFrames})`,
);

console.log(`source=${SNAP_ROOT}`);
console.log(`shape: ${variantName} (${shape.cellWidth}x${shape.cellHeight})`);
console.log(`planned=${planned} frames, typical page ${typical.toLocaleString()} B -> ${realFrames} fit`);
console.log("PASS: the cap is sized from the rendered shape and the byte table reflects measured pages");
