#!/usr/bin/env bun
/**
 * verify-tokenizer-budget-parity.ts — U6 (18.16.0 arm only)
 *
 * The claim: every local token count behind compaction and budget math comes
 * from the native tokenizer of the reading model's family, and a model with no
 * first-party family is counted in `o200k_base` instead of a 4-bytes-per-token
 * guess. 18.16.0 removed that guess (`PI_TOKENIZER_ACCURATE`, and the legacy
 * model-less `estimateTokens`), which undercounted code-heavy non-Claude
 * sessions by 11-48% and let compaction fire several turns late after a switch
 * to such a model.
 *
 * Observed through the consumers, not re-derived here: the bundled catalog
 * record, pi-agent-core's `Tokenizer` (`tokenizerEncodingForModel`,
 * `countMessage`, `checkTokenBudget`), the legacy `estimateTokens` export
 * extensions still call, the native addon the counts come from, and the
 * production compaction decision (`resolveThresholdTokens`,
 * `compactionContextTokens`, `shouldCompact`) over a pinned code-heavy corpus
 * (`patches/fixtures/tokenizer-parity-corpus.txt`) split into session turns.
 *
 * Mutation hooks (either must make this gate FAIL):
 *   count a model-less (unknown-family) tokenizer with the removed bytes/4
 *   fallback: every turn drifts past ±2% and the compaction trigger moves off
 *   the native turn — or resolve an unknown family to a non-`o200k_base`
 *   encoding.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = realpathSync(process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`);
const CORE_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`);
const AGENT_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`);
const CATALOG_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`);
const NATIVES_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_NATIVES_ROOT ?? `${NM}/pi-natives`);
// The corpus ships next to this gate; the override exists for a copied tree, not
// for pointing the gate at a fixture measured elsewhere.
const CORPUS = process.env.OMP_TOKENIZER_PARITY_CORPUS ?? join(import.meta.dir, "fixtures", "tokenizer-parity-corpus.txt");

// One arm only: this gate is registered inside the 18.16.0 guard, so any other
// plan must fail closed rather than borrow an assertion it never had.
const version: string = JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version;
assert.equal(version, "18.16.0", `tokenizer parity gate has no arm for pi-coding-agent ${version}`);
if (process.env.OMP_PATCH_VERSION) {
	assert.equal(version, process.env.OMP_PATCH_VERSION, "tokenizer parity fixture must match the selected plan");
}
// `NODE_ENV=test` switches the tokenizer to its byte fallback outside `strict`,
// which would make this gate measure the very path it is meant to rule out.
assert.notEqual(process.env.NODE_ENV, "test", "tokenizer parity gate must not run under NODE_ENV=test");

// HOME must be private before process startup; Bun caches os.homedir().
if (process.env.OMP_TOKENIZER_PARITY_CHILD !== "1") {
	const privateHome = mkdtempSync(join(tmpdir(), "omp-tokenizer-parity-home-"));
	try {
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH, HOME: privateHome, TMPDIR: privateHome,
				XDG_CONFIG_HOME: join(privateHome, "config"), XDG_CACHE_HOME: join(privateHome, "cache"),
				XDG_DATA_HOME: join(privateHome, "data"), XDG_STATE_HOME: join(privateHome, "state"),
				OMP_PATCH_VERIFY_NM: NM, OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
				OMP_PATCH_VERIFY_NATIVES_ROOT: NATIVES_ROOT, OMP_TOKENIZER_PARITY_CORPUS: CORPUS,
				OMP_TOKENIZER_PARITY_CHILD: "1",
			},
			stdout: "inherit", stderr: "inherit",
		});
		process.exitCode = child.exitCode ?? 1;
	} finally {
		rmSync(privateHome, { recursive: true, force: true });
	}
	process.exit();
}
// The probe reads counts; it never sends a request.
globalThis.fetch = (() => { throw new Error("Network forbidden in tokenizer parity gate"); }) as typeof fetch;

const natives = await import(`${NATIVES_ROOT}/native/index.js`);
const catalog = await import(`${CATALOG_ROOT}/src/models.ts`);
const { Tokenizer, tokenizerEncodingForModel } = await import(`${CORE_ROOT}/src/tokenizer.ts`);
const { compactionContextTokens, resolveThresholdTokens, shouldCompact } = await import(
	`${CORE_ROOT}/src/compaction/compaction.ts`
);
const { estimateTokens } = await import(`${AGENT_ROOT}/src/extensibility/legacy-pi-coding-agent-shim.ts`);
assert.equal(typeof estimateTokens, "function", "legacy estimateTokens export must survive for extensions");

/** ±2% of the reference count: the band the sweep was measured on. */
const PARITY = 0.02;
const withinBand = (actual: number, reference: number): boolean => Math.abs(actual - reference) <= reference * PARITY;
const drift = (actual: number, reference: number): string => `${(100 * (actual - reference) / reference).toFixed(2)}%`;

// ---------------------------------------------------------------------------
// The corpus: code-heavy, split into turns of a simulated session.
// ---------------------------------------------------------------------------
const corpusText = readFileSync(CORPUS, "utf8");
const firstTurn = corpusText.search(/^----- turn 1 -----$/m);
assert.ok(firstTurn >= 0, `${CORPUS} must open its turn list with "----- turn 1 -----"`);
const turns = corpusText
	.slice(firstTurn)
	.split(/^----- turn \d+ -----$/m)
	.map(turn => turn.trim())
	.filter(turn => turn.length > 0);
assert.ok(turns.length >= 12, `the corpus must carry a session of at least 12 turns, got ${turns.length}`);
const corpus = turns.join("\n\n");
const corpusBytes = Buffer.byteLength(corpus, "utf8");
assert.ok(corpusBytes > 12_000, `the corpus must stay code-heavy and non-trivial, got ${corpusBytes} bytes`);

/**
 * A non-Claude chat model with no first-party local tokenizer: the shape whose
 * counts the removed bytes/4 guess undercounted. Resolved from the bundled
 * catalog, so the family lookup is the one the runtime performs.
 */
const MODELS: readonly { provider: string; id: string }[] = [
	{ provider: "google", id: "gemini-3.7-flash" },
	{ provider: "xai", id: "grok-4" },
];

// The configured compaction fill: 8% of this model's 40k per-model limit.
// Both models' windows exceed the limit, so `baseWindowTokens` decides and the
// trigger is the same 3,200 tokens for either.
const SETTINGS = {
	enabled: true,
	strategy: "context-full" as const,
	thresholdPercent: 8,
	thresholdTokens: -1,
	baseWindowTokens: 40_000,
	keepRecentTokens: 20_000,
};
const FILL_TOKENS = 3_200;

/** The pre-18.16 estimate: `(bytes + 3) >> 2` per counted fragment. */
const removedPathTokens = (text: string): number => (Buffer.byteLength(text, "utf8") + 3) >> 2;

function triggerTurn(series: readonly number[], window: number): number | undefined {
	let cumulative = 0;
	for (const [index, tokens] of series.entries()) {
		cumulative += tokens;
		// The production decision consumes the stored-conversation floor of the
		// provider-reported context, so the estimate reaches `shouldCompact`
		// through it — never straight from the count.
		if (shouldCompact(compactionContextTokens(0, cumulative), window, SETTINGS)) return index + 1;
	}
	return undefined;
}

for (const fixture of MODELS) {
	const model = catalog.getBundledModel(fixture.provider as never, fixture.id as never);
	assert.ok(model, `${fixture.provider}/${fixture.id} must be in the 18.16.0 catalog`);
	assert.equal(
		model.tokenizer,
		undefined,
		`${fixture.provider}/${fixture.id} must have no first-party tokenizer, the shape this gate measures`,
	);
	// One line of evidence per model, printed before any assertion so a red run
	// still shows what the tree measured.
	const tokenizer = new Tokenizer(model);
	const reference = natives.countTokens(corpus, natives.Encoding.O200kBase);
	const probe = tokenizer.checkTokenBudget([corpus], Buffer.byteLength(corpus, "utf8") - 1);

	// Per-turn series for both consumers that feed the budget math: the legacy
	// model-less `estimateTokens` extensions call, and the model's own Tokenizer.
	const nativeSeries: number[] = [];
	const estimateSeries: number[] = [];
	const tokenizerSeries: number[] = [];
	const removedSeries: number[] = [];
	let worstDrift = 0;
	for (const [index, turn] of turns.entries()) {
		const message = { role: "user", content: turn, timestamp: index + 1 };
		const turnReference = natives.countTokens(turn, natives.Encoding.O200kBase);
		const estimated = estimateTokens(message as never);
		const counted = tokenizer.countMessage(message as never);
		worstDrift = Math.max(worstDrift, Math.abs(estimated - turnReference) / turnReference);
		nativeSeries.push(turnReference);
		estimateSeries.push(estimated);
		tokenizerSeries.push(counted);
		removedSeries.push(removedPathTokens(turn));
	}
	const total = (series: readonly number[]): number => series.reduce((sum, tokens) => sum + tokens, 0);
	const nativeTotal = total(nativeSeries);
	const estimateTotal = total(estimateSeries);
	const tokenizerTotal = total(tokenizerSeries);
	const removedTotal = total(removedSeries);
	const fill = resolveThresholdTokens(model.contextWindow, SETTINGS);
	const nativeTrigger = triggerTurn(nativeSeries, model.contextWindow);
	const estimateTrigger = triggerTurn(estimateSeries, model.contextWindow);
	const tokenizerTrigger = triggerTurn(tokenizerSeries, model.contextWindow);
	const removedTrigger = triggerTurn(removedSeries, model.contextWindow);
	console.log(
		`tokenizer-budget-parity[${fixture.provider}/${fixture.id}]: turns=${turns.length} native=${nativeTotal} ` +
			`estimate=${estimateTotal} (${drift(estimateTotal, nativeTotal)}) tokenizer=${tokenizerTotal} ` +
			`(${drift(tokenizerTotal, nativeTotal)}) worst-turn-drift=${(100 * worstDrift).toFixed(2)}% exact=${probe.exact}`,
	);
	console.log(
		`tokenizer-budget-parity[compaction ${fixture.id}]: fill=${fill} native=turn ${nativeTrigger} ` +
			`estimate=turn ${estimateTrigger} tokenizer=turn ${tokenizerTrigger} ` +
			`removed-bytes4=turn ${removedTrigger} (${drift(removedTotal, nativeTotal)})`,
	);

	// Unknown family → the native o200k_base fallback, not the byte guess.
	assert.equal(tokenizerEncodingForModel(model), null, `${fixture.id} has no encoding of its own`);
	assert.equal(
		tokenizer.countTokens(corpus, "strict"),
		reference,
		`${fixture.id}: an unknown family must count in o200k_base natively`,
	);
	// The native addon answered; a byte fallback would report `exact: false`.
	assert.equal(probe.exact, true, `${fixture.id}: checkTokenBudget must reach the native tokenizer`);
	assert.equal(probe.tokens, reference, `${fixture.id}: the exact budget count must be the native count`);
	assert.ok(reference > FILL_TOKENS, `the corpus must exceed the compaction fill, got ${reference} o200k tokens`);
	assert.ok(
		withinBand(estimateTotal, nativeTotal),
		`${fixture.id}: estimateTokens drifts ${drift(estimateTotal, nativeTotal)} off the native count ` +
			`(worst turn ${(100 * worstDrift).toFixed(2)}%)`,
	);
	assert.ok(
		withinBand(tokenizerTotal, nativeTotal),
		`${fixture.id}: the model tokenizer drifts ${drift(tokenizerTotal, nativeTotal)} off the native count`,
	);

	// Compaction trigger parity at the configured fill.
	assert.equal(fill, FILL_TOKENS, `${fixture.id}: the configured fill must resolve to ${FILL_TOKENS} tokens`);
	assert.ok(
		nativeTrigger !== undefined && nativeTrigger > 1 && nativeTrigger < turns.length,
		`${fixture.id}: the corpus must cross the ${fill}-token fill inside its session, trigger=${nativeTrigger}`,
	);
	assert.equal(
		estimateTrigger,
		nativeTrigger,
		`${fixture.id}: the estimated fill must trigger on the native turn (${nativeTrigger}), got ${estimateTrigger}`,
	);
	assert.equal(
		tokenizerTrigger,
		nativeTrigger,
		`${fixture.id}: the model tokenizer must trigger on the native turn (${nativeTrigger}), got ${tokenizerTrigger}`,
	);

	// The fixture proves something only while the removed path is visibly worse:
	// bytes/4 must break the band and move the trigger.
	assert.ok(
		!withinBand(removedTotal, nativeTotal),
		`the corpus must discriminate the removed bytes/4 estimate (${removedTotal} vs native ${nativeTotal})`,
	);
	assert.notEqual(
		removedTrigger,
		nativeTrigger,
		`the corpus must move the trigger under the removed estimate (native ${nativeTrigger}, bytes/4 ${removedTrigger})`,
	);
}

console.log("tokenizer-budget-parity verification: ok");
