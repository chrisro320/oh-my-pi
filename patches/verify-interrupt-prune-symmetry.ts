import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Attribute: an interrupted (aborted/error) assistant turn must produce the same
// wire history on both request paths.
//
// The two paths are genuinely different code:
//   * live      — `agent-loop.prepareProviderCall` sets `messages = context.messages`
//                 (accumulated agent state, remnant and in-memory marker included)
//                 and hands that straight to `convertToLlm`. `buildSessionContext`
//                 is NOT on this path.
//   * rebuild   — resume/branch rebuilds from the session JSONL through
//                 `buildSessionContext`, which prunes aborted/error turns.
// The `interrupted-thinking` marker is minted in memory on abort and never
// written to the JSONL, so any rule keyed off its presence makes the provider
// prefix a function of which process rendered it, and the implicit cache dies
// from that index on at every interrupt point.

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;

// Runtime-selected specifier: the module tree under test is an isolated sandbox
// named by OMP_PATCH_VERIFY_AGENT_ROOT, so a static import cannot name it.
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
const { convertToLlm, INTERRUPTED_THINKING_MESSAGE_TYPE } = await import(`${AGENT_ROOT}/src/session/messages.ts`);

console.log("=== Testing interrupted-turn render symmetry (0043) ===");

const TS = "2026-09-03T18:27:26.015Z";

type Entry = Record<string, unknown>;

const userEntry = (id: string, parentId: string | null, text: string): Entry => ({
	type: "message",
	id,
	parentId,
	timestamp: TS,
	message: { role: "user", content: [{ type: "text", text }], timestamp: TS },
});

const abortedEntry = (id: string, parentId: string, stopReason: "aborted" | "error"): Entry => ({
	type: "message",
	id,
	parentId,
	timestamp: TS,
	message: {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "half-formed plan that never shipped", thinkingSignature: "reasoning" },
			{ type: "text", text: "partial answer the user cut off" },
		],
		stopReason,
		errorMessage: stopReason === "aborted" ? "Interrupted by user" : "provider blew up",
		model: "deepseek/deepseek-v4-flash-vision-exp",
		timestamp: TS,
	},
});

const marker = {
	role: "custom",
	customType: INTERRUPTED_THINKING_MESSAGE_TYPE,
	content: "You were interrupted while reasoning. Prior reasoning: half-formed plan that never shipped",
	display: false,
	attribution: "agent",
	timestamp: TS,
};

/** Rebuild path: resume reads the JSONL and prunes through `buildSessionContext`. */
function rebuildWire(entries: Entry[], leafId: string): unknown[] {
	return convertToLlm(buildSessionContext(entries, leafId).messages) as unknown[];
}

/**
 * Live path: agent state, not a rebuild. `transcript: true` is used only to
 * obtain the unpruned message sequence the live agent actually accumulates
 * (`appendMessage` never prunes); the in-memory marker is then appended after
 * the remnant exactly as `AgentSession` does on abort. `convertToLlm` is called
 * on that array directly — the same single call `prepareProviderCall` makes.
 */
function liveWire(entries: Entry[], leafId: string, remnantIndex: number): unknown[] {
	const accumulated = buildSessionContext(entries, leafId, undefined, { transcript: true }).messages as unknown[];
	const state = [...accumulated];
	state.splice(remnantIndex + 1, 0, marker);
	return convertToLlm(state as never) as unknown[];
}

for (const stopReason of ["aborted", "error"] as const) {
	const entries = [
		userEntry("u1", null, "first ask"),
		abortedEntry("a1", "u1", stopReason),
		userEntry("u2", "a1", "second ask"),
	];
	const rebuilt = rebuildWire(entries, "u2");
	// The remnant sits at index 1 of the accumulated live sequence.
	const live = liveWire(entries, "u2", 1);
	assert.deepEqual(
		live,
		rebuilt,
		`live and rebuilt renders of a ${stopReason} turn must be byte-identical; a path-local prune breaks the prompt-cache prefix at every interrupt`,
	);
	assert.equal(rebuilt.length, 2, `${stopReason}: both user turns survive, the interrupted turn does not`);
	for (const message of rebuilt as { role: string }[]) {
		assert.equal(message.role, "user", `${stopReason}: no remnant and no marker note may reach the wire`);
	}
	console.log(`  ${stopReason}: live == rebuilt, ${rebuilt.length} wire messages, no remnant`);
}

const agentVersion = JSON.parse(readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
if (agentVersion === "18.3.3") {
	for (const stopReason of ["aborted", "error"] as const) {
		for (const pairedResult of [false, true]) {
			const interrupted = abortedEntry("a1", "u1", stopReason);
			const message = interrupted.message as Record<string, unknown>;
			const controls = { tools: { declared: ["read"], deferred: [], active: ["read"] }, messageIndex: 1 };
			message.requestControls = controls;
			(message.content as unknown[]).push({ type: "toolCall", id: "c1", name: "read", arguments: { path: "/fixture" } });
			const entries = [userEntry("u1", null, "first ask"), interrupted];
			if (pairedResult) entries.push({
				type: "message", id: "t1", parentId: "a1", timestamp: TS,
				message: { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "cancelled" }], isError: true, timestamp: TS },
			});
			entries.push(userEntry("u2", pairedResult ? "t1" : "a1", "second ask"));
			const rebuilt = rebuildWire(entries, "u2") as Record<string, unknown>[];
			assert.deepEqual(liveWire(entries, "u2", 1), rebuilt, "control carriers must replay identically");
			assert.deepEqual(rebuilt.map(message => message.role), ["user", "assistant", "user"]);
			assert.deepEqual(rebuilt[1].content, [], "interrupted payload must not survive with the controls");
			assert.deepEqual(rebuilt[1].requestControls, controls, "tool removal controls must survive resume");
		}
	}
}

// A remnant with no marker after it (marker is only minted for user interrupts
// with enough reasoning) must be pruned on the live path too.
const noMarkerEntries = [
	userEntry("u1", null, "first ask"),
	abortedEntry("a1", "u1", "aborted"),
	userEntry("u2", "a1", "second ask"),
];
const accumulated = buildSessionContext(noMarkerEntries, "u2", undefined, { transcript: true }).messages as unknown[];
assert.equal(accumulated.length, 3, "the live agent accumulates the remnant; only the provider view drops it");
assert.deepEqual(
	convertToLlm(accumulated as never),
	rebuildWire(noMarkerEntries, "u2"),
	"a markerless remnant must not survive the live path either",
);
console.log("  markerless remnant pruned on the live path");

// A bare marker left in memory (queued messages, advisors, compaction input)
// must not reach the wire either.
assert.deepEqual(convertToLlm([marker as never]), [], "a bare marker must convert to nothing");
console.log("  bare marker converts to nothing");

// A healthy turn is untouched: this patch must not eat real assistant history.
const healthy = {
	role: "assistant",
	content: [{ type: "text", text: "a real answer" }],
	stopReason: "stop",
	model: "deepseek/deepseek-v4-flash-vision-exp",
	timestamp: TS,
};
assert.equal((convertToLlm([healthy as never]) as unknown[]).length, 1, "a completed turn still reaches the wire");
console.log("  completed turn untouched");

// The display transcript must still show the interrupted turn.
const transcript = buildSessionContext(noMarkerEntries, "u2", undefined, { transcript: true });
assert.ok(
	(transcript.messages as { role: string }[]).some(message => message.role === "assistant"),
	"the display transcript must still show the interrupted turn; only the provider view prunes it",
);
console.log("  transcript still renders the interrupted turn");


console.log("=== interrupted-turn render symmetry OK ===");
