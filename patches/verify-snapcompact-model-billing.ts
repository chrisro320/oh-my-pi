// Patch 0052 regression: snapcompact must price Command Code's DeepSeek vision
// routes from measurement, not from the Anthropic pixel-area formula the wire
// api would otherwise imply.
//
// Two gates, plus the routing boundary this patch feeds:
//   GATE 1 (structure, live source): the per-model step table, the `resolveShape`
//     wrapper, and the gateway namespace fallback are present in the source
//     under SNAPCOMPACT_ROOT. On pristine source this FAILS — first negative
//     control.
//   GATE 2 (behavior, pricing): the three measured DeepSeek ids price at the
//     MEASURED curve (995 @1568, 1011 @2576 — the two sizes shipped variants
//     reach) while Claude keeps 5,000 and every unmeasured id keeps its family
//     formula.
//
// The *routing* of `shape.frameTokenEstimate` into the reduction guard lives in
// `pi-coding-agent/src/session/session-maintenance.ts` and is gated by
// `verify-snapcompact-frame-reprice.ts` (patch 0045). This gate deliberately
// does NOT restate that arithmetic: a local copy of the formula would stay
// green even if the consumer stopped passing the price, which is the failure it
// would claim to catch. Composition is the coverage — 0045 proves the price
// reaches the guard, this file proves the price is the measured curve.
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
// 989, so the table carries a 2576 step. In the gaps it stays conservative —
// 2048 bills 995 against a measured 993, and 3584 bills 1011 against 989.
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

const SNAP_ROOT =
	process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ??
	"/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact";

const COMMAND_CODE_API = "commandcode-custom";
const ALIAS_API = "commandcode-custom-b";
const DS = "deepseek/deepseek-v4-flash-vision-exp";
const CLAUDE = "claude-opus-5";
/** Ids measured at a price far from the ~1,000 band — a broad `^deepseek/`
 *  override would silently mis-price them. */
const OFF_CURVE = ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash-fast"];

// ---------------------------------------------------------------------------
// GATE 1: the patch is present in the source under SNAPCOMPACT_ROOT.
// ---------------------------------------------------------------------------
const source = readFileSync(`${SNAP_ROOT}/src/snapcompact.ts`, "utf8");
assert.match(
	source,
	/const MODEL_FRAME_TOKEN_STEPS: Readonly<Record<string, ReadonlyArray<readonly \[number, number\]>>>/,
	"patch 0052 missing: MODEL_FRAME_TOKEN_STEPS table is absent",
);
assert.match(
	source,
	/const DEEPSEEK_VISION_FRAME_TOKENS: ReadonlyArray<readonly \[number, number\]> = \[\s*\n\s*\[256, 198\],\s*\n\s*\[512, 198\],\s*\n\s*\[768, 363\],\s*\n\s*\[1024, 653\],\s*\n\s*\[1280, 995\],\s*\n\s*\[2576, 1011\],/,
	"patch 0052 missing: the measured DeepSeek step curve is absent or flattened to a constant",
);
assert.match(
	source,
	/export function resolveShape\([\s\S]*?const measured = modelFrameTokenEstimate\(model\?\.id, shape\.frameSize\);[\s\S]*?return measured === undefined \? shape : \{ \.\.\.shape, frameTokenEstimate: measured \};/,
	"patch 0052 missing: resolveShape does not apply the per-model billing override",
);
assert.match(
	source,
	/const COMMAND_CODE_NAMESPACE = \/\^commandcode\(\?:\[-_\]\|\$\)\/;/,
	"patch 0052 missing: the Command Code namespace matcher is absent or unbounded",
);
assert.match(
	source,
	/if \(provider !== undefined && COMMAND_CODE_NAMESPACE\.test\(provider\)\) return COMMAND_CODE_IMAGE_BUDGET;\s*\n\s*if \(api !== undefined && COMMAND_CODE_NAMESPACE\.test\(api\)\) return COMMAND_CODE_IMAGE_BUDGET;/,
	"patch 0052 missing: providerImageBudget has no Command Code namespace fallback",
);
// The namespace fallback must sit AFTER both exact lookups, or an explicitly
// measured wire api loses to the gateway heuristic (`commandcode-b` on
// `anthropic-messages` would widen from 90 to 200). Compare positions rather
// than adjacency so any reordering is caught.
const providerExactAt = source.indexOf("const byProvider = PROVIDER_IMAGE_BUDGETS[provider];");
const apiExactAt = source.indexOf("const byApi = PROVIDER_IMAGE_BUDGETS[api];");
const namespaceAt = source.indexOf("COMMAND_CODE_NAMESPACE.test(provider)");
assert.ok(
	providerExactAt > 0 && apiExactAt > providerExactAt && namespaceAt > apiExactAt,
	`patch 0052 ordering broken: exact lookups must precede the Command Code namespace fallback ` +
		`(provider@${providerExactAt}, api@${apiExactAt}, namespace@${namespaceAt})`,
);

// ---------------------------------------------------------------------------
// GATE 2: pricing. Imported from SNAPCOMPACT_ROOT so faulted variants are
// actually exercised (a live-absolute import would ignore the override).
// Fail closed: a tree that cannot even be imported must abort, never fall
// through to a passing run.
// ---------------------------------------------------------------------------
let snapcompact: typeof import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts");
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
	snapcompact.resolveShape({ api, id }, variant as never).frameTokenEstimate;

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
assert.ok(variantsChecked >= 15, `expected most variants to be price-checked, only ${variantsChecked} were`);
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
	assert.equal(
		price(id),
		3293,
		`${id} was measured at a different price; it must keep the family formula, not 995`,
	);
}
// Nor may an unknown future id on the same prefix be swept in.
assert.equal(price("deepseek/deepseek-v5-future"), 3293, "an unmeasured deepseek id must keep the family formula");

// Regression guard: the Anthropic routes sharing `commandcode-custom` must NOT
// be dragged down to the DeepSeek price. 22 claude models ride this same api,
// and a global api->DeepSeek mapping would price them at 995 (5x under), which
// makes frames look nearly free to the projection and over-allocates them.
assert.equal(price(CLAUDE), 5000, "Claude on the Command Code api must keep 5,000");
assert.equal(price(CLAUDE, "anthropic-messages"), 5000, "Claude on its native api must keep 5,000");
assert.equal(price("claude-fable-latest"), 5000, "the high-res Claude line must keep 5,000");

// Unmeasured lines keep their family formula — no invented numbers.
assert.equal(price("glm-5.3-flash"), 3293, "unmeasured glm keeps the unknown-family formula");
assert.equal(price("gemini-3.8-flash", "google-gemini-cli"), 1120, "Gemini keeps its fixed media budget");
assert.equal(price("gpt-5.6-sol", "openai-codex-responses"), 2882, "OpenAI keeps the 32px patch formula");
assert.equal(price(undefined), 3293, "an unknown model keeps the unknown-family formula");

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
console.log("PASS: the source carries the per-model pricing; measured DeepSeek ids price at the measured curve, everything else keeps its formula");
