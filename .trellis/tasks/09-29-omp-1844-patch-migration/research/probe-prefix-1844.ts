// Cross-process request-prefix probe for the patched 18.4.4 chain (offline).
// Usage (via run-prefix-1844.py): bun <copy inside pi-coding-agent> <scenario> <out.json> [sessionFile]
// scenario: live-plain | live-soft | live-snapcompact | resume
// Every provider request is captured as the exact provider-facing context
// (system, tools, messages) serialized with JSON.stringify. No network.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lab = process.env.OMP_PREFIX_LAB!;
assert.ok(lab?.startsWith("/home/chris/.cache/omp-1844-upgrade/"), "private lab root required");
const agentRoot = join(lab, "node_modules/@oh-my-pi/pi-coding-agent");
const aiRoot = join(lab, "node_modules/@oh-my-pi/pi-ai");
type ModelView = { provider: string; id: string };
type ToolView = { name: string; description: string; parameters: unknown; strict?: boolean; customWireName?: string };
type ContextView = { systemPrompt?: unknown; tools?: ToolView[]; messages?: unknown[] };
type UserInputEvent = { text?: unknown };
type ExtensionApi = {
	on(event: string, handler: (event: UserInputEvent) => unknown): void;
	registerProvider(name: string, config: unknown): void;
};
type CompactionView = { firstKeptEntryId?: string; tokensBefore?: number };
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
const { convertAnthropicMessages } = await import(`${aiRoot}/src/providers/anthropic.ts`);
const { buildTransformedCodexRequestBody } = await import(`${aiRoot}/src/providers/openai-codex-responses.ts`);
const { getBundledModel } = await import(`${join(lab, "node_modules/@oh-my-pi/pi-catalog")}/src/models.ts`);
const anthropicModel = getBundledModel("anthropic", "claude-opus-5");
const codexModel = getBundledModel("openai-codex", "gpt-6-astra");
assert.ok(anthropicModel && codexModel, "wire fixture models must exist in the selected catalog");

const [scenario, output, resumeFile] = process.argv.slice(2);
const root = join(lab, "..", "..", "..", "prefix-lab");
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

type Wire = { anthropic: string[]; codexInput: string[]; codexHead: string };
type Call = { raw: { system: string; tools: string; messages: string[] }; wire?: Wire; summarize: boolean };
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
	],
	streamSimple(model: ModelView, context: ContextView, options: unknown) {
		const system = JSON.stringify(context.systemPrompt);
		const summarize = compacting;
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
				messages: (context.messages ?? []).map((m: unknown) => JSON.stringify(m)),
			},
		};
		calls.push(call);
		// Real provider serializers: what the prompt cache is keyed on.
		pendingWire.push(
			(async () => {
				const anthropic = convertAnthropicMessages(context.messages ?? [], anthropicModel, true).map(
					(m: unknown) => JSON.stringify(m),
				);
				const body = await buildTransformedCodexRequestBody(codexModel, context, { sessionId: "prefix-probe" });
				const { input, ...head } = body as { input?: unknown[] } & Record<string, unknown>;
				call.wire = {
					anthropic,
					codexInput: (input ?? []).map(item => JSON.stringify(item)),
					codexHead: JSON.stringify(head),
				};
			})(),
		);
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
	toolNames: ["read", "edit"],
	extensions: [translator],
});

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
	turns.push({ label, index: calls.indexOf(main[0]) });
}
const filler = (n: number) => `${"context line for prefix probe. ".repeat(n)}`;

let compaction: unknown = null;
if (scenario === "resume") {
	await turn("resumed", "After resume: reply briefly. 中文 marker four.");
} else {
	const size = scenario === "live-snapcompact" ? 4000 : 400;
	await turn("t1", `First turn. 中文 marker one. ${filler(size)}`);
	await turn("t2", `Second turn. ${filler(size)}`);
	await turn("t3", `Third turn. 中文 marker three. ${filler(size)}`);
	if (scenario === "live-soft" || scenario === "live-snapcompact") {
		const mode = scenario === "live-soft" ? "soft" : "snapcompact";
		compacting = true;
		const result: CompactionView = await session.compact(undefined, { mode });
		compacting = false;
		compaction = { mode, firstKeptEntryId: result.firstKeptEntryId, tokensBefore: result.tokensBefore };
		await turn("after-compaction", "Post-compaction turn. 中文 marker five.");
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
	turns: turns.map(t => ({ label: t.label, ...calls[t.index].raw, wire: calls[t.index].wire })),
	summarizeCalls: calls.filter(c => c.summarize).length,
	fetchAttempts,
};
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ scenario, turns: turns.length, summarizeCalls: result.summarizeCalls, fetchAttempts }));
process.exit(0);
