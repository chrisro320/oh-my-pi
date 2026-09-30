// Cross-process request-prefix probe for MID-SESSION MODEL TAGGING (`^selector`).
// Runs against the fully patched 18.4.4 chain (TagProbe sandbox) and against the patched
// 18.3.3 install (Rehearsal sandbox) so the two behaviors can be compared.
//
// Usage (via run-tag-prefix-1844.py): bun <copy inside pi-coding-agent> <scenario> <out.json> [sessionFile]
// live scenarios:    tag-live | tag-control-live | tag-live-rebuild | tag-live-soft
// resume scenarios:  resume-chain
// Every provider request is captured as the exact provider-facing context (system, tools,
// messages) serialized with JSON.stringify, plus the real Anthropic/Codex serializer output
// when this install ships those builders. No network.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lab = process.env.OMP_PREFIX_LAB!;
assert.ok(lab?.startsWith("/home/chris/.cache/omp-1844-upgrade/"), "private lab root required");
const agentRoot = join(lab, "node_modules/@oh-my-pi/pi-coding-agent");
const aiRoot = join(lab, "node_modules/@oh-my-pi/pi-ai");
const catalogRoot = join(lab, "node_modules/@oh-my-pi/pi-catalog");
type ModelView = { provider: string; id: string };
type ToolView = { name: string; description: string; parameters: unknown; strict?: boolean; customWireName?: string };
type ContextView = { systemPrompt?: unknown; tools?: ToolView[]; messages?: unknown[] };
type UserInputEvent = { text?: unknown };
type ExtensionApi = {
	on(event: string, handler: (event: UserInputEvent) => unknown): void;
	registerProvider(name: string, config: unknown): void;
};
type MentionView = { agent: string; selector: string; name: string };
type AgentView = { name: string };
type CompactionView = { firstKeptEntryId?: string; tokensBefore?: number };
/** Surface the SDK exposes in some versions only; the probe records which ones exist. */
type SessionLike = {
	findMentionableModel?: (selector: string) => unknown;
	modelMentions?: readonly MentionView[];
	getSessionAgents?: () => readonly AgentView[];
	getAdvertisedSessionAgents?: () => readonly AgentView[];
	refreshBaseSystemPrompt?: (commitIf?: () => boolean) => Promise<void>;
};
let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("Network forbidden in prefix probe");
}) as typeof fetch;
// Package roots are selected at runtime (isolated lab tree), so static imports cannot work.
const { createAgentSession, discoverAuthStorage } = await import(`${agentRoot}/src/sdk.ts`);
const { ModelRegistry } = await import(`${agentRoot}/src/config/model-registry.ts`);
const { Settings } = await import(`${agentRoot}/src/config/settings.ts`);
const { SessionManager } = await import(`${agentRoot}/src/session/session-manager.ts`);
const { createMockModel } = await import(`${aiRoot}/src/providers/mock.ts`);
const catalog = (await import(`${catalogRoot}/src/models.ts`)) as {
	getBundledModel: (provider: string, id: string) => unknown;
	getBundledModels: (provider: string) => unknown[];
};
// Wire fixtures: prefer the ids the 18.4.4 catalog ships, else the first bundled model of the
// provider (the patched 18.3.3 catalog names them differently).
const wireModel = (provider: "anthropic" | "openai-codex", preferred: string): unknown =>
	catalog.getBundledModel(provider, preferred) ?? catalog.getBundledModels(provider)[0];
const anthropicModel = wireModel("anthropic", "claude-opus-5");
const codexModel = wireModel("openai-codex", "gpt-6-astra");
// Serializers are optional across versions: absence only costs the wire fields.
let convertAnthropicMessages: ((m: unknown[], model: unknown, strict: boolean) => unknown[]) | undefined;
let buildTransformedCodexRequestBody:
	| ((model: unknown, context: unknown, options: { sessionId: string }) => Promise<Record<string, unknown>>)
	| undefined;
let wireError: string | undefined;
if (anthropicModel && codexModel) {
	try {
		const anthropic = (await import(`${aiRoot}/src/providers/anthropic.ts`)) as {
			convertAnthropicMessages?: typeof convertAnthropicMessages;
		};
		const codex = (await import(`${aiRoot}/src/providers/openai-codex-responses.ts`)) as {
			buildTransformedCodexRequestBody?: typeof buildTransformedCodexRequestBody;
		};
		convertAnthropicMessages = anthropic.convertAnthropicMessages;
		buildTransformedCodexRequestBody = codex.buildTransformedCodexRequestBody;
	} catch (error) {
		wireError = error instanceof Error ? error.message : String(error);
	}
} else {
	wireError = "no anthropic/openai-codex bundled model available for the wire fixtures";
}

const [scenario, output, resumeFile] = process.argv.slice(2);
const root = join(lab, "..", "..", "..", "tag-prefix-lab");
const cwd = join(root, "work");
const agentDir = join(root, "agent");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
const settings = await Settings.loadIsolated({
	cwd,
	agentDir,
	overrides: {
		"edit.mode": "hashline",
		"memory.backend": "off",
		"computer.enabled": false,
		"secrets.enabled": false,
		"compaction.enabled": false,
		"compaction.keepRecentTokens": 2000,
	},
});
settings.setModelRole("default", "drift-fixture/vision-model");
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("drift-fixture", "offline-fixture");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

type Wire = { anthropic: string[]; codexInput: string[]; codexHead: string } | null;
type TurnState = {
	mentions: MentionView[] | null;
	sessionAgents: string[] | null;
	advertisedSessionAgents: string[] | null;
	noticeIndexes: number[];
	noticesInMessages: number;
	taggedTokens: number;
	rawTagTokens: number;
};
type Call = {
	raw: { system: string; tools: string; messages: string[] };
	wire?: Wire;
	summarize: boolean;
	state?: TurnState;
};
const pendingWire: Promise<void>[] = [];
const calls: Call[] = [];
let compacting = false;
// Registered from the inline extension below: with extensions enabled the SDK
// drops runtime provider registrations whose source is not an active extension.
const probeProvider = {
	api: "prefix-probe",
	baseUrl: "http://127.0.0.1:1/never",
	apiKey: "offline-fixture",
	models: [
		{
			id: "vision-model",
			name: "V",
			reasoning: false,
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
		// Second model, reachable only through a user tag: `^drift-fixture/tag-model`.
		{
			id: "tag-model",
			name: "T",
			reasoning: false,
			input: ["text"],
			contextWindow: 200000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	],
	streamSimple(model: ModelView, context: ContextView, options: unknown) {
		const system = JSON.stringify(context.systemPrompt);
		const summarize = compacting;
		const messages = (context.messages ?? []).map((m: unknown) => JSON.stringify(m));
		const call: Call = {
			summarize,
			raw: {
				system,
				tools: JSON.stringify(
					context.tools?.map(t => ({
						name: t.name,
						description: t.description,
						parameters: t.parameters,
						strict: t.strict,
						customWireName: t.customWireName,
					})),
				),
				messages,
			},
		};
		calls.push(call);
		// Real provider serializers: what the prompt cache is keyed on.
		if (!convertAnthropicMessages && !buildTransformedCodexRequestBody) {
			call.wire = null;
		} else {
			pendingWire.push(
				(async () => {
					const anthropic = convertAnthropicMessages
						? convertAnthropicMessages(context.messages ?? [], anthropicModel, true).map((m: unknown) =>
								JSON.stringify(m),
							)
						: [];
					let codexInput: string[] = [];
					let codexHead = "";
					if (buildTransformedCodexRequestBody) {
						const body = await buildTransformedCodexRequestBody(codexModel, context, { sessionId: "prefix-probe" });
						const { input, ...head } = body as { input?: unknown[] } & Record<string, unknown>;
						codexInput = (input ?? []).map(item => JSON.stringify(item));
						codexHead = JSON.stringify(head);
					}
					call.wire = { anthropic, codexInput, codexHead };
				})(),
			);
		}
		const content = summarize
			? "## Goal\nOffline probe summary.\n## Progress\nTurns one to three recorded."
			: `ack ${calls.length}`;
		return createMockModel({ id: model.id, provider: model.provider, handler: { content } }).stream(
			model,
			context,
			options,
		);
	},
};

// Inline stand-in for the deployed input translator (0082 contract).
const translator = (pi: ExtensionApi) => {
	pi.registerProvider("drift-fixture", probeProvider);
	pi.on("prepare_user_input", event =>
		typeof event.text === "string" && event.text.includes("中文")
			? { action: "submit", modelText: event.text.replaceAll("中文", "CHINESE") }
			: undefined,
	);
};

const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(root, "sessions"));
const { session } = await createAgentSession({
	cwd,
	agentDir,
	authStorage,
	modelRegistry: registry,
	settings,
	sessionManager: manager,
	skills: [],
	rules: [],
	contextFiles: [],
	promptTemplates: [],
	slashCommands: [],
	disableExtensionDiscovery: true,
	enableMCP: false,
	preloadedCustomToolPaths: [],
	enableLsp: false,
	skipPythonPreflight: true,
	// `task` must stay enabled: its description is what advertises `m<N>` tags.
	toolNames: ["read", "edit", "task"],
	extensions: [translator],
});
const view = session as unknown as SessionLike;
const capabilities = {
	findMentionableModel: typeof view.findMentionableModel === "function",
	modelMentions: view.modelMentions !== undefined,
	getSessionAgents: typeof view.getSessionAgents === "function",
	advertisedSessionAgents: typeof view.getAdvertisedSessionAgents === "function",
	refreshBaseSystemPrompt: typeof view.refreshBaseSystemPrompt === "function",
	anthropicWire: convertAnthropicMessages !== undefined,
	codexWire: buildTransformedCodexRequestBody !== undefined,
};
// The tag target must be mentionable through the same scope the session picker uses.
if (capabilities.findMentionableModel) {
	assert.ok(view.findMentionableModel!("drift-fixture/tag-model"), "second provider model must resolve as a mention");
}

const turns: { label: string; index: number }[] = [];
async function turn(label: string, text: string) {
	const before = calls.length;
	// Mirror the interactive submit path (input-controller #prepareOrdinaryInput):
	// the 0082 preparation boundary runs before admission, never inside prompt().
	const runner = session.extensionRunner;
	let modelText = text;
	if (runner?.hasHandlers?.("prepare_user_input")) {
		const result = await runner.emitPrepareUserInput({
			type: "prepare_user_input",
			inputId: crypto.randomUUID(),
			sessionId: manager.getSessionId(),
			target: "main",
			source: "interactive",
			submission: "submit",
			text,
			images: undefined,
			signal: new AbortController().signal,
		});
		assert.equal(result.action, "submit", `${label}: preparation must admit the input`);
		if (typeof result.modelText === "string") modelText = result.modelText;
	}
	if (modelText === text) await session.prompt(text);
	else await session.prompt(modelText, { displayText: text, expandPromptTemplates: false });
	const main = calls.slice(before).filter(c => !c.summarize);
	if (main.length !== 1) {
		type Entry = { type: string; message?: { role?: string; stopReason?: string; errorMessage?: string; content?: unknown } };
		const tail = (manager.getEntries() as Entry[]).slice(-4).map(entry => ({
			type: entry.type,
			role: entry.message?.role,
			stopReason: entry.message?.stopReason,
			error: entry.message?.errorMessage,
			content: entry.message?.role === "assistant" ? JSON.stringify(entry.message.content).slice(0, 300) : undefined,
		}));
		console.error(JSON.stringify({ label, model: `${session.model?.provider}/${session.model?.id}`, calls: calls.length, fetchAttempts, tail }, null, 1));
	}
	assert.equal(main.length, 1, `${label}: exactly one main provider request expected, got ${main.length}`);
	const captured = main[0]!;
	await Promise.all(pendingWire);
	const operatorMessage = captured.raw.messages.at(-1) ?? "";
	captured.state = {
		mentions: view.modelMentions ? view.modelMentions.map(m => ({ agent: m.agent, selector: m.selector, name: m.name })) : null,
		sessionAgents: view.getSessionAgents ? view.getSessionAgents().map(a => a.name) : null,
		advertisedSessionAgents: view.getAdvertisedSessionAgents
			? view.getAdvertisedSessionAgents().map(a => a.name)
			: null,
		// Hidden `session-agent-notice` custom messages reach the provider as `developer`-role
		// messages; the marker below is their rendered `<system-notice id="session-agents">` id.
		noticeIndexes: captured.raw.messages.flatMap((m, index) => (m.includes("session-agents") ? [index] : [])),
		noticesInMessages: 0,
		// `^` token replaced by the persisted `<model agent="m<N>" .../>` tag vs left verbatim.
		taggedTokens: operatorMessage.includes("<model agent=") ? 1 : 0,
		rawTagTokens: operatorMessage.includes("^drift-fixture") ? 1 : 0,
	};
	captured.state.noticesInMessages = captured.state.noticeIndexes.length;
	turns.push({ label, index: calls.indexOf(captured) });
}
const filler = (n: number) => `${"context line for prefix probe. ".repeat(n)}`;
const TAG_TURN = `Second turn. Tag ^drift-fixture/tag-model now. ${filler(400)}`;
const REBUILD_TURN = `Fourth turn after base-prompt rebuild. 中文 marker six. ${filler(400)}`;

async function assertTagRegistered(tagging: boolean, label: string) {
	if (!tagging || !capabilities.modelMentions) return;
	assert.equal(view.modelMentions!.length, 1, `${label}: mid-session tag must register one mention`);
	assert.equal(view.modelMentions![0]!.agent, "m1", `${label}: first tag must take the m1 pseudonym`);
	assert.equal(view.modelMentions![0]!.selector, "drift-fixture/tag-model");
	assert.equal(
		manager.getEntries().filter(entry => entry.type === "custom" && entry.customType === "model_mention").length,
		1,
		`${label}: the mention must be persisted as a model_mention entry`,
	);
}

let compaction: unknown = null;
if (scenario === "resume-chain") {
	// Chain: two plain resumed turns (drift persistence), then a forced base-prompt rebuild,
	// then one more turn (does the description snap back to the live shape?).
	await turn("resumed-1", "After resume: reply briefly. 中文 marker four.");
	await turn("resumed-2", "After resume, second request. 中文 marker seven.");
	if (capabilities.refreshBaseSystemPrompt) {
		await view.refreshBaseSystemPrompt!();
	}
	await turn("resumed-rebuilt", "After resume and base-prompt rebuild. 中文 marker eight.");
} else {
	const tagging = scenario === "tag-live" || scenario === "tag-live-rebuild" || scenario === "tag-live-soft";
	await turn("t1", `First turn. 中文 marker one. ${filler(400)}`);
	// The tag token must stay whitespace-delimited (MODEL_MENTION_RE lookahead) and the turn
	// carries no 中文 so the input-translator boundary leaves the sent text untouched and
	// `expandMentions` runs on the operator text itself.
	await turn("t2", tagging ? TAG_TURN : `Second turn. No tag here. ${filler(400)}`);
	await turn("t3", `Third turn. 中文 marker three. ${filler(400)}`);
	await assertTagRegistered(tagging, scenario);
	if (!tagging && capabilities.modelMentions) {
		assert.equal(view.modelMentions!.length, 0, "control scenario must register no mention");
	}
	if (scenario === "tag-live-rebuild") {
		// The base-prompt rebuild the reviewer's mechanism names (session-tools.ts
		// #prepareBaseSystemPrompt publishes the derived surface on commit).
		if (capabilities.refreshBaseSystemPrompt) await view.refreshBaseSystemPrompt!();
		await turn("t4-rebuilt", REBUILD_TURN);
	} else if (scenario === "tag-live-soft") {
		// Natural trigger under the user's real compaction configuration.
		compacting = true;
		const result: CompactionView = await session.compact(undefined, { mode: "soft" });
		compacting = false;
		compaction = { mode: "soft", firstKeptEntryId: result.firstKeptEntryId, tokensBefore: result.tokensBefore };
		await turn("t5-compacted", "Post-compaction turn. 中文 marker five.");
	} else if (scenario !== "tag-live" && scenario !== "tag-control-live") {
		throw new Error(`unknown scenario ${scenario}`);
	}
}
await Promise.all(pendingWire);
await manager.flush();
await settings.flush();
const result = {
	scenario,
	pid: process.pid,
	sessionFile: manager.getSessionFile(),
	compaction,
	capabilities,
	wireError,
	tagModel: { provider: "drift-fixture", id: "tag-model" },
	mentions: view.modelMentions ? view.modelMentions.map(m => ({ agent: m.agent, selector: m.selector, name: m.name })) : null,
	turns: turns.map(t => {
		const call = calls[t.index]!;
		return { label: t.label, ...call.raw, wire: call.wire ?? null, state: call.state };
	}),
	summarizeCalls: calls.filter(c => c.summarize).length,
	fetchAttempts,
};
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ scenario, turns: turns.length, summarizeCalls: result.summarizeCalls, fetchAttempts }));
process.exit(0);
