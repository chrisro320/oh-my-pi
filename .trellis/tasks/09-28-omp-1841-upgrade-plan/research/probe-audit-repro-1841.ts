// Dynamic reproduction of the static-audit "eval-class" prefix-drift findings on
// the deployed omp 18.4.1 (offline, no network).
//
//   bun <copy inside pi-coding-agent> <scenario> <out.json> [sessionFile]
//
// Scenarios: live-r1|resume-r1 live-r2|resume-r2 live-r3|resume-r3
//            live-r3x|resume-r3x live-r4|resume-r4
//
// Each live scenario drives a real `AgentSession` (persisted `SessionManager.create`)
// over an offline provider registered from an inline extension; the matching resume
// scenario opens the same session file in a NEW process (`SessionManager.open`) and
// sends 2 turns. Every provider request is captured as
//   * the real provider-facing context (system / tools / messages),
//   * the real wire (`convertAnthropicMessages`, `buildTransformedCodexRequestBody`),
//   * the per-request persistence invariant at capture time: the `context` extension
//     hook's live messages vs `buildSessionContext(getEntries(), getLeafId())`,
//     both through `convertToLlm` (the same algorithm as
//     patches/context-persist-audit-extension.ts).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lab = process.env.OMP_PREFIX_LAB!;
assert.ok(lab && existsSync(join(lab, "node_modules/@oh-my-pi/pi-coding-agent/package.json")), "lab root required");
// Never probe the live install by accident.
assert.notEqual(lab, "/home/chris/.bun/install/global", "this probe must run against an isolated copy");
const agentRoot = join(lab, "node_modules/@oh-my-pi/pi-coding-agent");
const aiRoot = join(lab, "node_modules/@oh-my-pi/pi-ai");

type ModelView = { provider: string; id: string };
type ToolView = { name: string; description: string; parameters: unknown; strict?: boolean; customWireName?: string };
type ContextView = { systemPrompt?: unknown; tools?: ToolView[]; messages?: unknown[] };
type ExtensionApi = {
	on(event: string, handler: (event: unknown) => unknown): void;
	registerProvider(name: string, config: unknown): void;
};

let fetchAttempts = 0;
const fetchLog: string[] = [];
globalThis.fetch = ((input: unknown) => {
	fetchAttempts++;
	const url = typeof input === "string" ? input : String((input as { url?: unknown })?.url ?? input);
	fetchLog.push(url);
	console.error(`[fetch#${fetchAttempts}] ${url}`);
	throw new Error("Network forbidden in audit-repro probe");
}) as typeof fetch;

// Package roots are selected at runtime (isolated lab tree), so static imports cannot work.
const { createAgentSession, discoverAuthStorage } = await import(`${agentRoot}/src/sdk.ts`);
const { ModelRegistry } = await import(`${agentRoot}/src/config/model-registry.ts`);
const { Settings } = await import(`${agentRoot}/src/config/settings.ts`);
const { SessionManager } = await import(`${agentRoot}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${agentRoot}/src/session/session-context.ts`);
const { convertToLlm } = await import(`${agentRoot}/src/session/messages.ts`);
const { createMockModel } = await import(`${aiRoot}/src/providers/mock.ts`);
const { convertAnthropicMessages } = await import(`${aiRoot}/src/providers/anthropic.ts`);
const { buildTransformedCodexRequestBody } = await import(`${aiRoot}/src/providers/openai-codex-responses.ts`);
const { getBundledModel } = await import(`${join(lab, "node_modules/@oh-my-pi/pi-catalog")}/src/models.ts`);
const { VibeSessionRegistry } = await import(`${agentRoot}/src/vibe/runtime.ts`);
const { formatModelString } = await import(`${agentRoot}/src/config/model-resolver.ts`);
const anthropicModel = getBundledModel("anthropic", "claude-opus-5");
const codexModel = getBundledModel("openai-codex", "gpt-6-astra");
assert.ok(anthropicModel && codexModel, "wire fixture models must exist in the selected catalog");

const [scenario, output, resumeFile] = process.argv.slice(2);
assert.ok(scenario && output, "usage: bun probe-audit-repro-1841.ts <scenario> <out.json> [sessionFile]");
const isResume = scenario.startsWith("resume-");
const caseId = scenario.replace(/^(live|resume)-/, "");

const root = join(lab, "..", "..", "..", "audit-repro-lab");
const cwd = join(root, "work", caseId);
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
		// R1 needs the incomplete/length recovery path armed (Case 3) while the
		// window stays far below the compaction threshold.
		"compaction.enabled": caseId === "r1",
		"compaction.keepRecentTokens": 2000,
		// Real switch for the checkpoint/rewind tool pair (default off).
		"checkpoint.enabled": caseId === "r2",
	},
});
settings.setModelRole("default", "audit-fixture/vision-model");
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("audit-fixture", "offline-fixture");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

// ---------------------------------------------------------------------------
// Persistence invariant (mirror of patches/context-persist-audit-extension.ts)
// ---------------------------------------------------------------------------
type Verdict = Record<string, unknown> & { status: string };
const wireKey = (message: unknown): string => {
	if (!message || typeof message !== "object") return JSON.stringify(message);
	const role = "role" in message ? message.role : undefined;
	const content = "content" in message ? message.content : undefined;
	const toolCallId = "toolCallId" in message ? message.toolCallId : undefined;
	return JSON.stringify({ role, content, toolCallId });
};
function liveRole(message: unknown): string {
	const role = message && typeof message === "object" && "role" in message ? message.role : undefined;
	return typeof role === "string" ? role : String(role);
}
function auditMessages(liveRaw: unknown[], fileRaw: unknown[]): Verdict {
	const live = convertToLlm(liveRaw as never) as unknown[];
	const file = convertToLlm(fileRaw as never) as unknown[];
	const liveCount = live.length;
	const fileCount = file.length;
	const liveRoles = live.map(liveRole);
	const fileRoles = file.map(liveRole);
	const shared = Math.min(liveCount, fileCount);
	for (let i = 0; i < shared; i++) {
		if (wireKey(live[i]) === wireKey(file[i])) continue;
		return {
			status: "diverged",
			index: i,
			liveCount,
			fileCount,
			liveRoles,
			fileRoles,
			live: wireKey(live[i]).slice(0, 400),
			file: wireKey(file[i]).slice(0, 400),
		};
	}
	if (fileCount > shared) {
		return {
			status: "file-extra",
			index: shared,
			liveCount,
			fileCount,
			liveRoles,
			fileRoles,
			file: wireKey(file[shared]).slice(0, 400),
		};
	}
	for (let i = shared; i < liveCount; i++) {
		const candidate = live[i];
		const role = candidate && typeof candidate === "object" && "role" in candidate ? candidate.role : undefined;
		if (role === "user" || role === "toolResult") continue;
		return { status: "live-extra", index: i, liveCount, fileCount, liveRoles, fileRoles, live: wireKey(live[i]).slice(0, 400) };
	}
	return { status: "ok", liveCount, fileCount, liveRoles, fileRoles };
}

// ---------------------------------------------------------------------------
// Scenario script
// ---------------------------------------------------------------------------
type Scripted = {
	prompts: string[];
	responses: unknown[];
	tools: string[];
	vibe?: "enter" | "enter-exit";
	fresh?: boolean;
};
const text = (content: string) => ({ content: [content] });
function scriptFor(): Scripted {
	switch (caseId) {
		case "r1":
			return isResume
				? { prompts: ["resume prompt one", "resume prompt two"], responses: [text("Resume ack one."), text("Resume ack two.")], tools: ["read"] }
				: {
						// 1) output-cap `length` stop that delivered nothing (thinking only),
						//    usage.output > 0, window not exhausted -> the length-stop retry
						//    reminder + `incomplete-retry` continuation. 2) the retry reply.
						// 3-4) two more ordinary turns in the same process.
						prompts: ["first prompt", "second prompt", "third prompt"],
						responses: [
							{
								content: [{ type: "thinking", thinking: "Planning the whole task in reasoning before acting." }],
								stopReason: "length",
								usage: { output: 900, input: 40 },
							},
							text("Recovered after the length stop."),
							text("Second turn ack."),
							text("Third turn ack."),
						],
						tools: ["read"],
					};
		case "r2":
			return isResume
				? { prompts: ["resume one", "resume two"], responses: [text("Resume ack one."), text("Resume ack two."), text("Resume ack three.")], tools: ["read", "checkpoint", "rewind"] }
				: {
						prompts: ["start the checkpoint investigation", "second prompt"],
						responses: [
							{ content: [{ type: "toolCall", name: "checkpoint", arguments: { goal: "investigate the flaky test" } }] },
							text("I yield with my findings."),
							{ content: [{ type: "toolCall", name: "rewind", arguments: { report: "Findings: the flaky test is fine." } }] },
							text("Rewind complete."),
							text("Second turn ack."),
						],
						tools: ["read", "checkpoint", "rewind"],
					};
		case "r3":
			return isResume
				? { prompts: ["resume vibe one", "resume vibe two"], responses: [text("Resume vibe ack one."), text("Resume vibe ack two.")], tools: ["read", "edit"], vibe: "enter" }
				: { prompts: ["vibe one", "vibe two"], responses: [text("Vibe ack one."), text("Vibe ack two.")], tools: ["read", "edit"], vibe: "enter" };
		case "r3x":
			return isResume
				? { prompts: ["resume after exit one", "resume after exit two"], responses: [text("Resume exit ack one."), text("Resume exit ack two.")], tools: ["read", "edit"] }
				: { prompts: ["before exit", "after exit"], responses: [text("Before exit ack."), text("After exit ack.")], tools: ["read", "edit"], vibe: "enter-exit" };
		case "r3x-real":
			// Same shape as r3x, but the exit runs the REAL #exitVibeMode teardown,
			// including VibeSessionRegistry.killAll -> #persistModeExit (which writes
			// `mode_change: none`).
			return isResume
				? { prompts: ["resume after real exit one", "resume after real exit two"], responses: [text("Resume real-exit ack one."), text("Resume real-exit ack two.")], tools: ["read", "edit"] }
				: { prompts: ["before real exit", "after real exit"], responses: [text("Before real-exit ack."), text("After real-exit ack.")], tools: ["read", "edit"], vibe: "enter-exit" };
		case "r4":
			return isResume
				? { prompts: ["resume fresh one", "resume fresh two"], responses: [text("Resume fresh ack one."), text("Resume fresh ack two.")], tools: ["read"] }
				: { prompts: ["fresh one", "fresh two", "fresh three"], responses: [text("Fresh ack one."), text("Fresh ack two."), text("Fresh ack three.")], tools: ["read"], fresh: true };
		default:
			throw new Error(`unknown case ${caseId}`);
	}
}
const scripted = scriptFor();
const script = createMockModel({
	id: "vision-model",
	provider: "audit-fixture",
	responses: scripted.responses as never,
	handler: text("fallback ack") as never,
	contextWindow: 200000,
	maxTokens: 4096,
});

// ---------------------------------------------------------------------------
// Provider (+ per-request invariant capture)
// ---------------------------------------------------------------------------
type Call = {
	label: string;
	turn: string;
	system: string;
	tools: string;
	messages: string[];
	roles: string[];
	wire?: { anthropic: string[]; anthropicNoCache: string[]; codexInput: string[]; codexHead: string };
	audit?: Verdict;
	auditAlign: boolean;
	agentSessionId?: string;
	promptCacheKey?: string | null;
	managerSessionId: string;
};
const calls: Call[] = [];
const pendingWire: Promise<void>[] = [];
const liveRaw: unknown[][] = [];
let currentTurn = "(setup)";
let liveSession: { agent?: { sessionId?: string }; sessionId?: string } | undefined;
type ManagerView = {
	getEntries(): unknown[];
	getLeafId(): string | null;
	getSessionFile(): string | null;
	getSessionId(): string;
	buildSessionContext(): { mode?: string };
	appendModeChange?(mode: string, data?: Record<string, unknown>): string;
};
let manager: ManagerView | undefined;

function auditLiveAgainstDisk(live: unknown[]): Verdict {
	if (!manager) return { status: "no-manager" };
	try {
		const rebuilt = buildSessionContext(manager.getEntries() as never, manager.getLeafId() as never).messages as unknown[];
		return auditMessages(live, rebuilt);
	} catch (error) {
		return { status: "audit-error", error: String(error) };
	}
}

const probeProvider = {
	api: "audit-probe",
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
		const messages = context.messages ?? [];
		const agentSessionId = liveSession?.agent?.sessionId;
		const call: Call = {
			label: `${currentTurn}/${calls.length}`,
			turn: currentTurn,
			system: JSON.stringify(context.systemPrompt),
			tools: JSON.stringify(
				context.tools?.map(t => ({
					name: t.name,
					description: t.description,
					parameters: t.parameters,
					strict: t.strict,
					customWireName: t.customWireName,
				})),
			),
			messages: messages.map((m: unknown) => JSON.stringify(m)),
			roles: messages.map((m: unknown) => {
				const role = m && typeof m === "object" && "role" in m ? m.role : undefined;
				return typeof role === "string" ? role : String(role);
			}),
			audit: auditLiveAgainstDisk(liveRaw.length > 0 ? liveRaw[liveRaw.length - 1] : messages),
			auditAlign: liveRaw.length > 0,
			agentSessionId,
			managerSessionId: manager?.getSessionId() ?? "(none)",
		};
		calls.push(call);
		pendingWire.push(
			(async () => {
				const anthropic = convertAnthropicMessages(messages, anthropicModel, true).map((m: unknown) => JSON.stringify(m));
				const anthropicNoCache = convertAnthropicMessages(messages, anthropicModel, false).map((m: unknown) => JSON.stringify(m));
				const body = (await buildTransformedCodexRequestBody(codexModel, context as never, {
					sessionId: agentSessionId,
				})) as { input?: unknown[] } & Record<string, unknown>;
				const { input, ...head } = body;
				call.wire = {
					anthropic,
					anthropicNoCache,
					codexInput: (input ?? []).map(item => JSON.stringify(item)),
					codexHead: JSON.stringify(head),
				};
				const cacheKey = "prompt_cache_key" in head ? head.prompt_cache_key : null;
				call.promptCacheKey = typeof cacheKey === "string" ? cacheKey : null;
			})(),
		);
		return script.stream(model as never, context as never, options as never);
	},
};

// The `context` extension event carries the LIVE agent messages just before the
// provider conversion — exactly what the deployed context-persist-audit hooks.
const auditExtension = (pi: ExtensionApi) => {
	pi.registerProvider("audit-fixture", probeProvider);
	pi.on("context", event => {
		const messages = event && typeof event === "object" && "messages" in event ? event.messages : [];
		liveRaw.push(Array.isArray(messages) ? messages : []);
		return undefined;
	});
};

manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(root, "sessions"));

// ---------------------------------------------------------------------------
// Vibe-mode helpers: the real APIs the interactive path uses.
// `#enterVibeMode` (interactive-mode.ts:5278-5331) = activateVibeTools + setVibeModeState
//   + sessionManager.appendModeChange("vibe", { previousTools }).
// `#exitVibeMode` (interactive-mode.ts:5342-5367) = runModeExitTeardown { abort if streaming;
//   VibeSessionRegistry.killAll(parent, ownerScope); deactivateVibeTools(prev);
//   setVibeModeState(undefined) }. `killAll` -> `#killAllLocked` (vibe/runtime.ts:1106-1120)
//   -> `#persistModeExit` (vibe/runtime.ts:439-484), which atomically appends
//   `appendModeChange("none")` whenever the branch's last mode_change is not "none"
//   (even with zero worker records). The abbreviated `exitVibe()` below skips killAll,
//   so only the `r3x-real` case exercises the real sequence.
// `#reconcileModeFromSession` (interactive-mode.ts:4107-4188) re-enters vibe on resume
//   whenever the persisted `mode_change` says "vibe".
// ---------------------------------------------------------------------------
const vibe: {
	activated: boolean;
	error?: string;
	reconciled?: boolean;
	ownerScope?: unknown;
	killed?: number;
} = { activated: false };
async function enterVibe(session: { activateVibeTools(names: string[]): Promise<void>; setVibeModeState(state: { enabled: boolean } | undefined): void }, persist: boolean) {
	// `#enterVibeMode` 5297-5301: resolve the owner scope from the parent session and
	// re-open spawn admission before installing the mode.
	const registry = VibeSessionRegistry.global();
	const ownerScope = registry.ownerScope(vibeParentSession());
	registry.activateScope(ownerScope);
	vibe.ownerScope = ownerScope;
	try {
		await session.activateVibeTools(["read"]);
	} catch (error) {
		vibe.error = String(error);
	}
	session.setVibeModeState({ enabled: true });
	vibe.activated = true;
	if (persist) manager!.appendModeChange?.("vibe", { previousTools: ["read", "edit"] });
}
async function exitVibe(session: { deactivateVibeTools(names: string[]): Promise<void>; setVibeModeState(state: { enabled: boolean } | undefined): void }) {
	await session.deactivateVibeTools(["read", "edit"]);
	session.setVibeModeState(undefined);
	vibe.activated = false;
}

/** `#vibeParentSession()` (interactive-mode.ts:3815-3829), field for field. */
function vibeParentSession() {
	return {
		getAgentId: () => session.getAgentId() ?? null,
		getSessionId: () => manager!.getSessionId(),
		getSessionFile: () => manager!.getSessionFile() ?? null,
		sessionManager: manager,
		asyncJobManager: session.asyncJobManager,
		settings: session.settings,
		getActiveModelString: () => (session.model ? formatModelString(session.model) : undefined),
	};
}

/** The real `#exitVibeMode` body (interactive-mode.ts:5342-5367). */
async function exitVibeReal(ownerScope: unknown): Promise<void> {
	await session.runModeExitTeardown(async () => {
		if (session.isStreaming) await session.abort();
		vibe.killed = await VibeSessionRegistry.global().killAll(vibeParentSession(), ownerScope);
		await session.deactivateVibeTools(["read", "edit"]);
		session.setVibeModeState(undefined);
	});
	vibe.activated = false;
}

/** Persisted `mode_change` sequence on the branch (what a resume reconciles from). */
function modeHistory(): { mode: string; data?: unknown }[] {
	const entries = manager!.getEntries();
	const out: { mode: string; data?: unknown }[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "mode_change") continue;
		const mode = "mode" in entry ? entry.mode : undefined;
		out.push({ mode: String(mode), data: "data" in entry ? entry.data : undefined });
	}
	return out;
}

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
	// NOTE: `restrictToolNames: true` must NOT be set here — it makes the SDK kick
	// off provider-model catalog discovery (localhost ollama/lmstudio + remote
	// catalog fetches) and the no-network assertion then fails.
	toolNames: scripted.tools,
	extensions: [auditExtension],
}) as { session: Record<string, any> };
liveSession = session;

const turns: { label: string; requests: number; error?: string }[] = [];
const freshLog: Record<string, unknown>[] = [];
async function runTurn(label: string, promptText: string) {
	currentTurn = label;
	const before = calls.length;
	try {
		await session.prompt(promptText);
		await session.waitForIdle();
	} catch (error) {
		turns.push({ label, requests: calls.length - before, error: String(error) });
		return;
	}
	turns.push({ label, requests: calls.length - before });
}

// Persisted mode entry: only the live process writes it (mirrors `/vibe`).
if (caseId === "r3" || caseId === "r3x" || caseId === "r3x-real") {
	if (!isResume) await enterVibe(session as never, true);
	else {
		// Mirror #reconcileModeFromSession: re-enter when the branch says "vibe".
		const mode = manager.buildSessionContext().mode;
		vibe.reconciled = mode === "vibe";
		if (mode === "vibe") await enterVibe(session as never, false);
	}
}

for (let i = 0; i < scripted.prompts.length; i++) {
	await runTurn(`t${i + 1}`, scripted.prompts[i]);
	if (!isResume && i === 0 && (caseId === "r3x" || caseId === "r3x-real")) {
		if (caseId === "r3x-real") await exitVibeReal(vibe.ownerScope);
		else await exitVibe(session as never);
	}
	if (caseId === "r4" && !isResume) {
		if (i === 0) freshLog.push({ step: "freshSession", ...(session.freshSession?.() as object) });
		if (i === 1) {
			const reset = await session.resetSessionContext?.();
			freshLog.push({ step: "resetSessionContext", result: reset ?? null });
		}
	}
}

await Promise.all(pendingWire);
await manager.flush();
await settings.flush();

const result = {
	scenario,
	case: caseId,
	mode: isResume ? "resume" : "live",
	pid: process.pid,
	sessionFile: manager.getSessionFile(),
	managerSessionId: manager.getSessionId(),
	agentSessionId: session.agent?.sessionId,
	mode_from_entries: manager.buildSessionContext().mode,
	mode_history: modeHistory(),
	vibe,
	freshLog,
	turns,
	requests: calls.map((call, index) => ({
		index,
		label: call.label,
		turn: call.turn,
		system: call.system,
		tools: call.tools,
		messages: call.messages,
		roles: call.roles,
		wire: call.wire,
		audit: call.audit,
		auditAlign: call.auditAlign,
		agentSessionId: call.agentSessionId,
		promptCacheKey: call.promptCacheKey,
		managerSessionId: call.managerSessionId,
	})),
	fetchAttempts,
	fetchLog,
};
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(
	JSON.stringify({
		scenario,
		requests: result.requests.length,
		turns: turns.length,
		audits: result.requests.map(r => `${r.audit?.status ?? "?"}@${r.audit?.index ?? "-"}`),
		fetchAttempts,
	}),
);
process.exit(0);
