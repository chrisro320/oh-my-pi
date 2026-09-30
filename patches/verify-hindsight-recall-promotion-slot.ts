// The `<memories>` block the memory backend promotes onto the system prompt must
// keep ONE slot for the life of the promotion.
//
// Measured 2026-09-19 (session 01a0a51c): the previous process carried the block
// joined into the developer message (3 system parts, `system[2]` = mental models
// + memories). After a restart the same bytes rode a separate trailing system
// message (4 parts, `system[3]` = memories). `buildDeveloperInstructions` joins
// `lastRecallSnippet` whenever it is set, and a wholesale base rebuild replaces
// the prompt array — so the block migrated between carriers depending on whether
// the snippet was already published. The bytes never changed; the message
// boundaries did. `cache-prefix-audit.log` recorded the resulting miss as
// `MISS CAUSED BY SYSTEM_DRIFT`, input=102105 cacheRead=23424 (strict 18.7%).
//
// Zero provider calls. The source gates pin the single-carrier contract and the
// two rebuild sites; the behavioural gate drives the real `SessionMemory`
// promotion lifecycle (capture / restore / new transcript) with a stub host.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Dynamic roots are load-bearing: `OMP_PATCH_VERIFY_AGENT_ROOT` selects the tree
// under test, so the import specifier only exists at runtime. Every other
// patches/verify-*.ts gate reads the tree the same way.
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");

// Plan membership, not symbol existence: 0075 was deployed on the live 18.2.3
// tree before it was registered, and it is part of the 18.2.10 plan. Plans that
// never carried it must fail closed rather than measure a pristine tree.
const agentVersion: string = JSON.parse(readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
assert.ok(
	["18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4"].includes(agentVersion),
	`verify-hindsight-recall-promotion-slot: 0075 is not part of the ${agentVersion} plan`,
);

const source = (rel: string): string => readFileSync(`${AGENT_ROOT}/${rel}`, "utf8");

const backend = source("src/hindsight/backend.ts");
const tools = source("src/session/session-tools.ts");
const memory = source("src/session/session-memory.ts");
const session = source("src/session/agent-session.ts");

// 1. The developer message must never carry the recall block, or the rebuild
//    that clears the promoted tail re-creates it one level up.
assert.ok(
	!/parts\.push\(recallSnippet\)/.test(backend),
	"hindsight/backend.ts still joins the recall block into the developer message",
);
assert.ok(
	!/lastRecallSnippet/.test(backend),
	"hindsight/backend.ts still reads lastRecallSnippet while composing developer instructions",
);

// 2. Both wholesale rebuilds re-attach the promoted tail, and the promoting turn
//    stages it as a single message (an un-stripped previous tail would double it).
const reattached = tools.match(/const promotionTail = this\.#host\.memoryPromotionTail\(\);/g) ?? [];
assert.equal(reattached.length, 2, "expected the two base-prompt rebuilds to re-attach the promoted tail");
assert.ok(
	/captureMemoryPromotionSnapshot\(currentBase, injected\)/.test(tools),
	"the promoting turn must publish the promoted block as the tail",
);
assert.ok(
	/promoted !== undefined && base\[base\.length - 1\] === promoted/.test(tools),
	"the promoting turn must strip a previously attached block from the base it stages",
);
assert.ok(
	/promoted !== undefined && currentBase\[currentBase\.length - 1\] === promoted/.test(tools),
	"the committing turn must strip a previously attached block before publishing the new one",
);
assert.ok(
	/memoryPromotionTail\(\): string \| undefined;/.test(tools),
	"SessionToolsHost must expose the promoted tail",
);

// 3. The tail shares the promotion snapshot's lifecycle, so it cannot outlive the
//    transcript that produced it.
assert.ok(/get promotionTail\(\)/.test(memory), "SessionMemory must expose the promoted tail");
assert.ok(
	/capturePromotionSnapshot\(prompt: string\[\], tail\?: string\)/.test(memory),
	"capturePromotionSnapshot must take the promoted block",
);
assert.ok(
	/restorePromotionSnapshot\(prompt: string\[\] \| undefined, tail\?: string\)/.test(memory),
	"restorePromotionSnapshot must restore the promoted block",
);
assert.ok(
	/this\.#baseSystemPromptPromotionTail = undefined;/.test(memory),
	"a new transcript must clear the promoted block",
);
assert.ok(
	/this\.#baseSystemPromptPromotionTail = tail;/.test(memory),
	"rollback must restore the promoted block",
);

// 4. Host wiring: the getter is published, and a failed session switch snapshots
//    and restores the tail alongside the promotion snapshot.
assert.ok(
	/memoryPromotionTail: \(\) => this\.#memory\.promotionTail,/.test(session),
	"agent-session must wire memoryPromotionTail to SessionMemory",
);
assert.ok(
	/const previousMemoryPromotionTail = this\.#memory\.promotionTail;/.test(session),
	"the session-switch rollback must snapshot the promoted tail",
);
assert.ok(
	/restorePromotionSnapshot\(previousBaseSystemPromptBeforeMemoryPromotion, previousMemoryPromotionTail\);/.test(
		session,
	),
	"the session-switch rollback must restore the promoted tail",
);

// 5. Behaviour: drive the real promotion lifecycle with a stub host.
const { SessionMemory } = await import(`${AGENT_ROOT}/src/session/session-memory.ts`);

let base: string[] = ["base"];
let refreshes = 0;
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const host = {
	agent: {},
	settings: Settings.isolated({ "memory.backend": "off" }),
	modelRegistry: {},
	isDisposed: () => false,
	memoryBackendSession: () => ({}),
	getHindsightSessionState: () => undefined,
	setHindsightSessionState: () => undefined,
	getMnemopiSessionState: () => undefined,
	takeMnemopiSessionState: () => undefined,
	setBaseSystemPrompt: (prompt: string[]) => {
		base = prompt;
	},
	refreshBaseSystemPrompt: async () => {
		refreshes += 1;
	},
	replaceMemoryTools: async () => undefined,
};
const store = new SessionMemory(host as never, {});
assert.equal(store.promotionTail, undefined, "a fresh session has no promoted block");

const TAIL = "<memories>\npromoted\n</memories>";
store.capturePromotionSnapshot(["base"], TAIL);
assert.equal(store.promotionTail, TAIL, "capture must publish the promoted block");
assert.deepEqual(store.promotionSnapshot, ["base"], "capture must keep the pre-promotion base");

// A canonical rebuild clears the base snapshot but must keep the tail attached.
store.clearPromotionSnapshot();
assert.equal(store.promotionTail, TAIL, "a base rebuild must not drop the promoted block");

// A new transcript drops the block and rebuilds the prompt without it.
await store.resetContextForNewTranscript();
assert.equal(store.promotionTail, undefined, "a new transcript must drop the promoted block");
assert.ok(refreshes > 0, "dropping the block must refresh the base prompt");

// Rollback restores whatever the failed switch started from.
store.capturePromotionSnapshot(["base2"], TAIL);
store.restorePromotionSnapshot(undefined, undefined);
assert.equal(store.promotionTail, undefined, "rollback must restore the promoted block");
assert.equal(store.promotionSnapshot, undefined, "rollback must restore the base snapshot");

// 6. Behaviour at the host layer: the promoted block must occupy exactly one
//    system part on the promoting turn, after a wholesale rebuild (the drift
//    measured above was 3 parts -> 4), and none after a transcript reset. A
//    duck-typed hindsight session drives the real `buildSystemPromptForAgentStart`
//    path, including the staging commit.
const { SessionTools } = await import(`${AGENT_ROOT}/src/session/session-tools.ts`);

const TAIL_ONE = "<memories>\none\n</memories>";
const TAIL_TWO = "<memories>\ntwo\n</memories>";
const countTails = (parts: readonly string[]): number => parts.filter(part => part.startsWith("<memories>")).length;

let promotionTail: string | undefined;
let backendContext: string | undefined = TAIL_ONE;
let agentPrompt: readonly string[] = [];
// The backend re-checks session identity at commit (`getHindsightSessionState()
// === state`), so the stub must hand back one stable object.
const hindsightState = {
	beforeAgentStartPrompt: async () => ({ context: backendContext, commit: () => true }),
};
const memorySessionStub = { getHindsightSessionState: () => hindsightState };
const sessionToolsHost = new Proxy(
	{
		agent: {
			state: { tools: [] },
			setSystemPrompt: (parts: string[]) => {
				agentPrompt = parts;
			},
		},
		// SessionTools reads the branch at construction and publishes the advertised
		// model-agent list on rebuild (18.4.1 0083); an empty branch and an empty
		// tagged-agent list keep this fixture's surface empty, other journal calls
		// stay no-ops like the host stub.
		sessionAgents: () => [],
		sessionManager: new Proxy(
			{ getBranch: () => [] },
			{ get: (target, key) => (key in target ? Reflect.get(target, key) : () => undefined) },
		),
		settings: Settings.isolated({ "memory.backend": "hindsight" }),
		memoryBackendSession: () => memorySessionStub,
		isDisposed: () => false,
		clearInheritedProviderPromptCacheKey: () => undefined,
		clearMemoryPromotionSnapshot: () => undefined,
		captureMemoryPromotionSnapshot: (_prompt: string[], tail?: string) => {
			if (tail !== undefined) promotionTail = tail;
		},
		memoryPromotionTail: () => promotionTail,
		localProtocolOptions: () => ({}),
	},
	{ get: (target, key) => (key in target ? Reflect.get(target, key) : () => undefined) },
) as never;
const sessionTools = new SessionTools(sessionToolsHost, {
	baseSystemPrompt: ["STATIC"],
	toolRegistry: new Map(),
	rebuildSystemPrompt: async () => ({ systemPrompt: ["STATIC"] }),
} as never);

const promotingTurn = await sessionTools.buildSystemPromptForAgentStart("first", () => true);
assert.ok(promotingTurn.commit, "the promoting turn must stage a commit");
assert.equal(countTails(promotingTurn.systemPrompt), 1, "the promoting turn must carry one block");
assert.equal(promotingTurn.systemPrompt.at(-1), TAIL_ONE, "the block must ride the last system part");
agentPrompt = promotingTurn.systemPrompt;
assert.ok(await promotingTurn.commit(), "the promoting turn must commit");
assert.equal(countTails(agentPrompt), 1, "the committed prompt must carry one block");

// A wholesale rebuild re-attaches the block instead of dropping it: without the
// fix the block reappears inside the developer message, which is the 3 -> 4
// system-part drift this gate exists for.
await sessionTools.refreshBaseSystemPrompt();
assert.deepEqual(sessionTools.baseSystemPrompt, ["STATIC", TAIL_ONE], "a rebuild must re-attach the promoted block");
assert.equal(countTails(agentPrompt), 1, "the rebuilt prompt must carry one block");

// A second promotion with the previous block still attached must replace it, not
// stack a second copy.
backendContext = TAIL_TWO;
const secondTurn = await sessionTools.buildSystemPromptForAgentStart("second", () => true);
assert.equal(countTails(secondTurn.systemPrompt), 1, "the next promotion must not stack a second block");
assert.equal(secondTurn.systemPrompt.at(-1), TAIL_TWO, "the next promotion must replace the block");
assert.ok(await secondTurn.commit(), "the second promotion must commit");
assert.deepEqual(sessionTools.baseSystemPrompt, ["STATIC", TAIL_TWO], "the base must carry exactly the newest block");

// A new transcript drops the block (SessionMemory clears the tail before it
// refreshes), and the rebuilt prompt must not resurrect it.
promotionTail = undefined;
await sessionTools.refreshBaseSystemPrompt();
assert.deepEqual(sessionTools.baseSystemPrompt, ["STATIC"], "a new transcript must drop the promoted block");
assert.equal(countTails(agentPrompt), 0, "the new transcript prompt must carry no block");

console.log("verify-hindsight-recall-promotion-slot: ok");
