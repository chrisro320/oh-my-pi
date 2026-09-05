import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// Attribute: the per-turn supersede pass must never rewrite a tool result that
// still sits inside a warm provider prefix.
//
// `pruneSupersededToolResults` weighs the rewrite against `suffixTokenLimit`,
// compared to the estimated tokens of the messages AFTER the candidate. That
// estimate is not the bill. A provider charges the distance from the mutated
// index back to its last cache checkpoint, and the checkpoint stride is not
// observable from the harness. Measured on session 01a07221 (deepseek-v4-pro
// via hyper, openai-completions): a candidate whose suffix estimated 1 122
// tokens passed the stock 8 000 gate, and blanking that 638-token stale read
// dropped cacheRead from 40 832 to 32 640 — 8 192 tokens re-billed as input at
// ~10x the cacheRead rate to save 638 tokens per later turn.
//
// So the gate is 0 for every model: only the last message (suffix 0, nothing
// cached after it) may be rewritten immediately. Everything else waits for the
// idle flush, where the cache is already cold and the rewrite is free — which
// is why this is a scheduling change, not a capability loss.

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;

// Dynamic import is required, not stylistic: the module tree under test is
// named by OMP_PATCH_VERIFY_CORE_ROOT so the rollup gate can point this script
// at a pristine sandbox instead of the installed tree. A static specifier
// cannot express that, and would additionally bake this script's own
// resolution root into a patch-verification harness.
const { pruneSupersededToolResults, readToolSupersedeKey, DEFAULT_PRUNE_CONFIG, SUPERSEDED_NOTICE } = await import(
	`${CORE_ROOT}/src/compaction/pruning.ts`
);
const { Tokenizer } = await import(`${CORE_ROOT}/src/tokenizer.ts`);

console.log("=== Testing supersede warm-prefix guard (0046) ===");

const tokenizer = new Tokenizer();
const PROTECTED = [...DEFAULT_PRUNE_CONFIG.protectedTools];
const NOW = 1_788_621_000_000;
const READ_PATH = "/home/chris/orca/projects/omp-move/patches/resume-cache-breakpoint-extension.ts";

/** Session-entry shape this fixture builds. `message` stays `unknown` because
 *  the agent message union lives behind the runtime-selected root above; the
 *  prune pass and the tokenizer are its only consumers here. */
interface FixtureEntry {
	type: "message";
	id: string;
	message: unknown;
}

/** Real text, not a repeated filler string: a high-repetition body tokenizes
 *  far below real source and would understate every suffix in this fixture. */
const BODY = readFileSync(fileURLToPath(import.meta.url), "utf8");

const readCall = (id: string, callId: string, path: string): FixtureEntry => ({
	type: "message",
	id,
	message: {
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "read", arguments: { path } }],
		timestamp: NOW,
	},
});

const readResult = (id: string, callId: string, body: string): FixtureEntry => ({
	type: "message",
	id,
	message: { role: "toolResult", toolName: "read", toolCallId: callId, content: body, timestamp: NOW },
});

const chatter = (id: string, text: string): FixtureEntry => ({
	type: "message",
	id,
	message: { role: "user", content: [{ type: "text", text }], timestamp: NOW },
});

/** Index of the superseded candidate (`r1`) inside every fixture below. */
const CANDIDATE_INDEX = 2;

/** Two reads of the same path, with `tail` messages of history after the second
 *  one. The first result is the supersede candidate; `tail` controls its
 *  suffix, i.e. which side of the gate it falls on. */
function fixture(tail: string[]): FixtureEntry[] {
	return [
		chatter("u0", "read this file"),
		readCall("a1", "c1", READ_PATH),
		readResult("r1", "c1", BODY.slice(0, 2000)),
		readCall("a2", "c2", READ_PATH),
		readResult("r2", "c2", BODY.slice(0, 2000)),
		...tail.map((text, i) => chatter(`t${i}`, text)),
	];
}

function suffixTokensAfterCandidate(entries: FixtureEntry[]): number {
	let total = 0;
	for (const entry of entries.slice(CANDIDATE_INDEX + 1)) total += tokenizer.countMessage(entry.message);
	return total;
}

function prune(entries: FixtureEntry[], suffixTokenLimit: number | undefined, now = NOW) {
	return pruneSupersededToolResults(structuredClone(entries), tokenizer, {
		supersedeKey: readToolSupersedeKey,
		pruneUseless: false,
		protectedTools: PROTECTED,
		idleFlushMs: 60 * 60_000,
		suffixTokenLimit,
		now,
	});
}

// The measured case: a mid-history candidate with a suffix well under the stock
// 8 000 gate. Stock prunes it (and pays the checkpoint rewind); the guard does not.
const midHistory = fixture([BODY.slice(0, 3000), "keep going"]);
const suffixTokens = suffixTokensAfterCandidate(midHistory);
assert.ok(
	suffixTokens > 0 && suffixTokens < 8000,
	`fixture must sit under the stock gate to reproduce the bug (suffix ${suffixTokens})`,
);
console.log(`  fixture suffix after the candidate: ${suffixTokens} tokens (stock gate 8000)`);

const stock = prune(midHistory, undefined);
assert.equal(stock.prunedCount, 1, "stock behaviour must reproduce: the mid-history candidate is rewritten");
assert.ok(stock.tokensSaved > 0, "stock behaviour saves context tokens — that is the trade being refused");
console.log(`  stock (limit 8000): pruned ${stock.prunedCount}, saved ${stock.tokensSaved} context tokens`);

const guarded = prune(midHistory, 0);
assert.equal(guarded.prunedCount, 0, "the guard must refuse a rewrite inside the warm prefix");
assert.equal(guarded.tokensSaved, 0, "a refused prune saves nothing");
console.log("  guarded (limit 0): pruned 0 — warm prefix untouched");

// The gate is not arbitrary: a supersede candidate is BY CONSTRUCTION followed
// by the newer result that superseded it, so its suffix can never be 0. Gating
// at 0 therefore defers every supersede rewrite to the idle flush — that is the
// intended reach of this patch, and this assertion pins it so a future "just
// raise it a little" cannot pass unnoticed.
const atTail = fixture([]);
assert.ok(
	suffixTokensAfterCandidate(atTail) > 0,
	"a superseded result always has its successor after it; suffix 0 is unreachable here",
);
assert.equal(prune(atTail, 0).prunedCount, 0, "with no tail chatter at all the rewrite is still deferred");
console.log("  candidate's own successor keeps its suffix > 0: every supersede rewrite defers");

// Nothing accumulates permanently: once the cache is cold the idle flush takes
// the same entry the warm-prefix guard refused.
const flushed = prune(midHistory, 0, NOW + 2 * 60 * 60_000);
assert.equal(flushed.prunedCount, 1, "the idle flush must still reclaim what the warm guard deferred");
console.log(`  idle flush: pruned ${flushed.prunedCount} — deferral, not a leak`);

// The placeholder is what makes this a mid-history REWRITE rather than a drop;
// if it ever stops being written the cost model above no longer applies.
assert.equal(
	SUPERSEDED_NOTICE,
	"[Superseded by a newer read of this file]",
	"the placeholder text is the wire signature this patch is priced against",
);

// Source gate: the call site must pass a literal 0 for every model. The stock
// line made the guard conditional on `thinking.prefixBinding`, which is exactly
// the narrowing this patch removes.
const source = readFileSync(`${AGENT_ROOT}/src/session/session-maintenance.ts`, "utf8");
const callSite = source.slice(source.indexOf("pruneSupersededToolResults("));
assert.ok(callSite.length > 0, "the supersede call site must exist");
const configBlock = callSite.slice(0, callSite.indexOf("}),"));
assert.match(configBlock, /suffixTokenLimit: 0,/, "the supersede pass must gate at 0 tokens of suffix");
assert.ok(
	!/prefixBinding/.test(configBlock),
	"the guard must not be conditional on prefixBinding: no model survives a warm-prefix rewrite",
);
console.log("  source gate holds: suffixTokenLimit: 0, unconditional");

console.log("=== supersede warm-prefix guard OK ===");
