// Patch 0052 regression: snapcompact must price Command Code's DeepSeek vision
// routes from measurement, not from the Anthropic pixel-area formula the wire
// api would otherwise imply.
//
// Behavior gates import the selected package and exercise measured pricing,
// model boundaries, every shipped shape, and provider/API precedence. The three
// measured DeepSeek ids retain their measured curve while other models retain
// their family formula. Source spelling is not part of this contract.
//
// verify-snapcompact-frame-reprice.ts exercises the actual session.compact()
// consumer, including a successor archive. This gate checks measured prices
// and routing boundaries without copying the reduction guard's arithmetic.
//
// Measured 2026-09-10 against the Command Code gateway (`commandcode-custom`
// wire api), real rendered frames, same-text baseline subtracted, two frames to
// confirm additivity. All three ids below measured IDENTICALLY on every size:
//   deepseek/deepseek-v4-flash-vision-exp  198/198/363/653/995/995/993/1011/989
//   deepseek/deepseek-v4.1-flash           (same nine points)
//   deepseek/deepseek-v4-flash             (same nine points)
//                                          ^ 256/512/768/1024/1280/1568/2048/2576/3584
//   deepseek/deepseek-v4-pro                 6/frame  <- NOT ~1000
//   deepseek/deepseek-v4-flash-fast          0/frame  <- NOT ~1000
// The last two are text-only in the vendor catalog so snapcompact never renders
// for them today, but their divergence is exactly why the override is keyed by
// exact model id instead of a `^deepseek/` prefix.
// The curve is NOT flat above 1280: 2576 bills 1011 (not 995) and 3584 bills
// 989, so the table carries a 2576 step. The table is exact at the two sizes
// shipped variants reach (1568, 2576) and conservative at the measured
// checkpoints inside the steps — 2048 would bill 995 against a measured 993,
// 3584 would bill 1011 against 989. Unmeasured sizes above 2576 are NOT bounded.
//
// Usage:
//   bun patches/verify-snapcompact-model-billing.ts
//   OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT=<root> bun ...   (negative controls)
//
// SNAPCOMPACT_ROOT must be a directory holding `src/snapcompact.ts` whose
// `@oh-my-pi/*` imports resolve — symlink `node_modules` next to it for an
// isolated variant (see the fault-tree helper in the patch notes).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`;

const COMMAND_CODE_API = "commandcode-custom";
const ALIAS_API = "commandcode-custom-b";
const DS = "deepseek/deepseek-v4-flash-vision-exp";
const CLAUDE = "claude-opus-5";
/** Ids measured at a price far from the ~1,000 band — a broad `^deepseek/`
 *  override would silently mis-price them. */
const OFF_CURVE = ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash-fast"];

// ---------------------------------------------------------------------------
// GATE 2: pricing. Imported from SNAPCOMPACT_ROOT so faulted variants are
// actually exercised (a live-absolute import would ignore the override).
// Fail closed: a tree that cannot even be imported must abort, never fall
// through to a passing run.
// ---------------------------------------------------------------------------
let snapcompact: {
	resolveShape(model: { api?: string; id?: string }, variant?: string): {
		frameTokenEstimate: number;
		frameSize: number;
	};
	SHAPE_VARIANT_NAMES: readonly string[];
	providerImageBudget(provider?: string, api?: string): number;
	providerFrameBudget(provider?: string, api?: string): number;
	frameBilling(model: { api?: string; id?: string }): unknown;
	frameBillingKey(billing: unknown): string;
	frameTokens(billing: unknown, size: { width: number; height: number }): number;
};
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

const price = (id: string | undefined, api = COMMAND_CODE_API, variant?: string) =>
	snapcompact.resolveShape({ api, id }, variant).frameTokenEstimate;

// The shipped variant set tops out at 1568/2576 (1932/2048 for the Claude and
// Gemini model lines), so every reachable frame size sits at or above the
// 1280px saturation edge. Assert each variant against the MEASURED curve rather
// than a flat 995 — 2576 is a real 1011, and a table that flattened it would
// under-charge high-frame-size archives by 1.6%.
const MEASURED_BY_EDGE: ReadonlyArray<readonly [number, number]> = [
	[256, 198], [512, 198], [768, 363], [1024, 653], [1280, 995], [2576, 1011],
];
const measuredPriceAt = (frameSize: number) => {
	let tokens = MEASURED_BY_EDGE[0][1];
	for (const [edge, price] of MEASURED_BY_EDGE) if (frameSize >= edge) tokens = price;
	return tokens;
};

assert.equal(price(DS), 995, "DeepSeek vision-exp @1568 must price at the measured 995");
assert.equal(price(DS, ALIAS_API), 995, "an account-suffixed alias api must price identically");
assert.equal(price(DS, "openai-completions"), 995, "the DeepSeek line is api-independent");
assert.equal(snapcompact.resolveShape({ api: COMMAND_CODE_API, id: DS }).frameSize, 1568);
if (JSON.parse(readFileSync(`${SNAP_ROOT}/package.json`, "utf8")).version === "18.7.0") {
	const measuredBilling = snapcompact.frameBilling({ api: COMMAND_CODE_API, id: DS });
	assert.equal(snapcompact.frameTokens(measuredBilling, { width: 1568, height: 1568 }), 995,
		"tokenizer and shape planning must both use the measured 1568px frame price");
	assert.equal(snapcompact.frameTokens(measuredBilling, { width: 2576, height: 2576 }), 1011,
		"the tokenizer frame path must preserve the measured large-frame step");
	assert.notEqual(snapcompact.frameBillingKey(measuredBilling),
		snapcompact.frameBillingKey(snapcompact.frameBilling({ api: COMMAND_CODE_API, id: OFF_CURVE[0] })),
		"switching between measured and unmeasured models must invalidate cached frame counts");
}
let variantsChecked = 0;
for (const variant of snapcompact.SHAPE_VARIANT_NAMES) {
	const shape = snapcompact.resolveShape({ api: COMMAND_CODE_API, id: DS }, variant);
	if (shape.frameSize < 1280) continue; // below the saturation edge; not shipped today
	const want = measuredPriceAt(shape.frameSize);
	assert.equal(
		shape.frameTokenEstimate,
		want,
		`DeepSeek @${variant} (frameSize ${shape.frameSize}) must price at the measured ${want}, not the family formula`,
	);
	variantsChecked++;
}
// The 2576 step is the one a naive flat-995 table gets wrong; pin it directly.
assert.equal(price(DS, undefined, "5x8-bw"), 1011, "a 2576px frame bills the measured 1011, not 995");

// The three measured-equal ids share the curve.
for (const id of ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4-flash"]) {
	assert.equal(price(id), 995, `${id} measured 995 and must price identically`);
}

// Regression guard: the two DeepSeek ids measured at a DIFFERENT price must not
// be swept in. A `^deepseek/` prefix override passed every other assertion here
// while mis-pricing `v4-pro` by ~166x (995 vs a measured 6) and charging
// `v4-flash-fast` 995 against a measured 0 — a ratio undefined at the
// denominator, so the magnitude is stated as an absolute overcharge instead.
for (const id of OFF_CURVE) {
	assert.notEqual(price(id), 995, `${id} must not inherit the measured DeepSeek vision override`);
}
// Nor may an unknown future id on the same prefix be swept in.
assert.notEqual(price("deepseek/deepseek-v5-future"), 995, "an unmeasured deepseek id must not inherit the measured override");

// Regression guard: the Anthropic routes sharing `commandcode-custom` must NOT
// be dragged down to the DeepSeek price. 22 claude models ride this same api,
// and a global api->DeepSeek mapping would price them at 995 (5x under), which
// makes frames look nearly free to the projection and over-allocates them.
assert.notEqual(price(CLAUDE), 995, "Claude on the Command Code api must not inherit the DeepSeek override");
assert.notEqual(price(CLAUDE, "anthropic-messages"), 995, "native Claude must not inherit the DeepSeek override");
assert.notEqual(price("claude-fable-latest"), 995, "the high-res Claude line must not inherit the DeepSeek override");


// ---------------------------------------------------------------------------
// GATE 2b: the Command Code namespace must not outrank a measured wire api.
// ---------------------------------------------------------------------------
// `commandcode-b` really shipped a turn on `anthropic-messages` (2026-09-03),
// so the pair is live: the explicit api entry (Anthropic's 90) must win over
// the gateway heuristic, otherwise the account name alone would widen an
// Anthropic request's image cap from 90 to 200.
assert.equal(
	snapcompact.providerImageBudget("commandcode-b", "anthropic-messages"),
	90,
	"an exact wire-api entry must outrank the Command Code namespace fallback",
);
// The primary id has its own explicit table entry (200), which outranks the api
// by the pre-existing provider-first rule — unchanged by 0052.
assert.equal(snapcompact.providerImageBudget("commandcode", "anthropic-messages"), 200);
assert.equal(snapcompact.providerImageBudget("commandcode-b", "bedrock-converse-stream"), 90);
// The alias provider id alone still names the gateway, so it is rescued even on
// an api string with no entry (the api is not the identifier that matters here).
assert.equal(snapcompact.providerImageBudget("commandcode-b", "cursor-agent"), 200);
// A non-gateway provider on the same api is NOT rescued — the namespace test
// keys off the name, not the api:
assert.equal(snapcompact.providerImageBudget("totally-unknown", "cursor-agent"), 5);
// `umans` is a provider id, not an api: its explicit 10 still wins as provider.
assert.equal(snapcompact.providerImageBudget("umans", "commandcode-custom"), 10);
// The namespace still rescues only names that would otherwise floor:
assert.equal(snapcompact.providerImageBudget("commandcode-b", "commandcode-custom-b"), 200);
assert.equal(snapcompact.providerImageBudget("commandcode_proxy", "commandcode-custom"), 200);
assert.equal(snapcompact.providerImageBudget(undefined, "commandcode-custom-b"), 200);
assert.equal(snapcompact.providerFrameBudget("commandcode-b", "commandcode-custom-b"), 80);
// ...and must not swallow an unrelated provider that merely starts the same way:
assert.equal(snapcompact.providerImageBudget("commandcodex", "cursor-agent"), 5, "an unbounded prefix would mis-rescue this id");
assert.equal(snapcompact.providerImageBudget(undefined, "commandcodex"), 5);
assert.equal(snapcompact.providerImageBudget("xcommandcode"), 5);

console.log(
	`source=${SNAP_ROOT}\n` +
		`measured ids: ${DS}=${price(DS)} claude=${price(CLAUDE)} off-curve: ` +
		OFF_CURVE.map((id) => `${id}=${price(id)}`).join(" "),
);
console.log(`PASS: ${variantsChecked} shipped shapes retain measured pricing and provider/API precedence`);
