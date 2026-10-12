// Verify context-persist-audit: a context message that exists only in memory
// is reported on the request that first carries it, while the not-yet-persisted
// input tail (newest user prompt / tool result) is not.
//
// Sessions are real in-memory SessionManagers rebuilt with the same
// `buildSessionContext` the extension uses. The retry reminder leg uses the
// exact message shape turn-recovery appends before `scheduleAgentContinue`
// (18.2.10 `turn-recovery.ts` empty-stop / unexpected-stop paths): role
// `developer`, `attribution: "agent"`, never persisted. No provider traffic.
import type { AgentSession, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const EXTENSION = process.env.OMP_CONTEXT_AUDIT_EXTENSION ?? join(import.meta.dir, "context-persist-audit-extension.ts");

// HOME must be private before process startup; Bun caches os.homedir().
if (process.env.OMP_CONTEXT_AUDIT_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "cpa-home-"));
	try {
		const result = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH, HOME: home, TMPDIR: home,
				XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
				XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"),
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_CONTEXT_AUDIT_EXTENSION: EXTENSION, OMP_CONTEXT_AUDIT_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated context audit gate failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}
globalThis.fetch = (() => { throw new Error("Network forbidden in context audit gate"); }) as typeof fetch;

const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
// Bind the extension's package imports to AGENT_ROOT: resolved from this repo,
// the bare specifiers would pick up whatever version the repo's own install has.
const bound = join(mkdtempSync(join(tmpdir(), "cpa-ext-")), "extension.ts");
writeFileSync(
	bound,
	readFileSync(EXTENSION, "utf8").replace(
		/"@oh-my-pi\/pi-coding-agent\/(session\/[a-z-]+)"/g,
		(_match, sub: string) => JSON.stringify(`${AGENT_ROOT}/src/${sub}.ts`),
	),
);
const { default: contextPersistAudit, auditContext, loadTrellisAnchors } = await import(bound);

type Msg = Record<string, unknown> & { role: string };
let clock = 1_000;
const user = (text: string): Msg => ({ role: "user", content: [{ type: "text", text }], timestamp: clock++ });
const assistant = (text: string): Msg => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "verify",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: clock++,
});
const retryReminder = (): Msg => ({
	role: "developer",
	content: [{ type: "text", text: "<system-reminder>Your previous turn stopped unexpectedly. Continue.</system-reminder>" }],
	attribution: "agent",
	timestamp: clock++,
});

function persisted(messages: Msg[]) {
	const manager = SessionManager.inMemory("/tmp");
	for (const message of messages) manager.appendMessage(message);
	return { manager, file: buildSessionContext(manager.getEntries(), manager.getLeafId()).messages as Msg[] };
}

// 1. Brand-new session, first request: the prompt is not in the entries yet.
{
	const prompt = user("hello");
	const { file } = persisted([]);
	const result = auditContext([prompt], file);
	assert.equal(result.status, "ok");
	assert.equal(result.pendingTail, 1);
}

// 2. Tool continuation: the newest tool result is the only unpersisted tail.
{
	const prompt = user("run it");
	const call = { ...assistant("calling"), content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] };
	const toolResult: Msg = {
		role: "toolResult",
		toolCallId: "t1",
		toolName: "bash",
		content: [{ type: "text", text: "done" }],
		isError: false,
		timestamp: clock++,
	};
	const { file } = persisted([prompt, call]);
	const result = auditContext([...file, toolResult], file);
	assert.equal(result.status, "ok");
	assert.equal(result.pendingTail, 1);
}

// 3. Retry reminder: reported on the very request that carries it.
const prompt = user("do the thing");
const reminder = retryReminder();
{
	const { file } = persisted([prompt]);
	const result = auditContext([...file, reminder], file);
	assert.equal(result.status, "live-extra", "a memory-only developer reminder at the tail must be reported");
	assert.equal(result.index, 1);
	assert.equal(result.live?.role, "developer");
	assert.equal(JSON.stringify(result).includes("unexpectedly"), false, "results must not carry message content");
}

// 4. Same reminder once the retry's reply is persisted behind it.
{
	const reply = assistant("continued");
	const { file } = persisted([prompt, reply]);
	const result = auditContext([...file.slice(0, 1), reminder, file[1]], file);
	assert.equal(result.status, "diverged");
	assert.equal(result.index, 1);
}

// 5. Unknown text appended to a persisted user message is drift, not an injection.
{
	const { file } = persisted([user("question"), assistant("answer"), user("follow-up")]);
	const live = file.map(message => ({ ...message }));
	live[2] = { ...live[2], content: [...(live[2].content as unknown[]), { type: "text", text: "memory-only" }] };
	const result = auditContext(live, file);
	assert.equal(result.status, "diverged");
	assert.equal(result.index, 2);
}

// 6. Trellis: only the exact anchored text is exempt; a corrupt anchor file throws for the caller.
{
	const root = mkdtempSync(join(tmpdir(), "cpa-verify-"));
	try {
		const { manager, file } = persisted([user("question"), assistant("answer"), user("follow-up")]);
		const target = file[2];
		const { createHash } = await import("node:crypto");
		const signature = createHash("sha256").update(JSON.stringify(target.content)).digest("hex").slice(0, 16);
		const key = `user:${target.timestamp}:${signature}`;
		const anchorsDir = join(root, ".trellis", ".runtime", "omp-anchors");
		mkdirSync(anchorsDir, { recursive: true });
		const anchorFile = join(anchorsDir, `omp_${manager.getSessionId()}.json`);
		writeFileSync(anchorFile, JSON.stringify({ [key]: "<trellis-state>x</trellis-state>" }));
		const anchors = loadTrellisAnchors(root, manager.getSessionId());
		const injected = file.map(message => ({ ...message }));
		injected[2] = {
			...injected[2],
			content: [...(injected[2].content as unknown[]), { type: "text", text: "<trellis-state>x</trellis-state>" }],
		};
		const exact = auditContext(injected, file, anchors);
		assert.equal(exact.status, "ok");
		assert.equal(exact.trellisInjected, 1);
		assert.equal(auditContext(file, file, anchors).status, "ok", "expansion must not depend on extension order");
		const wrong = file.map(message => ({ ...message }));
		wrong[2] = { ...wrong[2], content: [...(wrong[2].content as unknown[]), { type: "text", text: "<trellis-state>y</trellis-state>" }] };
		assert.equal(auditContext(wrong, file, anchors).status, "diverged");
		writeFileSync(anchorFile, "{broken");
		assert.throws(() => loadTrellisAnchors(root, manager.getSessionId()));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// 7. async-result aside: in flight before its message_end commit.
{
	const asyncResult: Msg = {
		role: "custom",
		customType: "async-result",
		content: "<system-notice>Background job bg_3 has completed.</system-notice>",
		display: true,
		attribution: "agent",
		timestamp: clock++,
	};
	const { file } = persisted([prompt, assistant("done")]);
	const result = auditContext([...file, asyncResult], file);
	assert.equal(result.status, "pending-commit");
	assert.equal(result.index, 2);
	assert.equal(result.customType, "async-result");
	assert.equal(result.pendingTail, 1);
	// Once the entry lands the live side and the rebuild agree again.
	const committed = persisted([prompt, assistant("done")]);
	committed.manager.appendCustomMessageEntry("async-result", asyncResult.content, true, undefined, "agent", asyncResult.timestamp);
	assert.equal(auditContext([...committed.file], committed.file).status, "ok");
}

// 7b. The reported shape: the new user prompt is also still unpersisted, so the
//     tail is `… persisted, user, async-result` (audit pendingTail 2).
{
	const asyncResult: Msg = {
		role: "custom",
		customType: "async-result",
		content: "<system-notice>Background job bg_3 has completed.</system-notice>",
		display: true,
		attribution: "agent",
		timestamp: clock++,
	};
	const { file } = persisted([prompt, assistant("done")]);
	const followUp = user("意思就是這個東西具有自癒能力是吧");
	const result = auditContext([...file, followUp, asyncResult], file);
	assert.equal(result.status, "pending-commit");
	assert.equal(result.pendingTail, 2);
	assert.equal(result.customType, "async-result");
	// A non-aside custom behind the user prompt is not exempt: the walk bails
	// at that message and the old live-extra verdict stands.
	const ttsr: Msg = {
		role: "custom",
		customType: "ttsr-injection",
		content: "injected rule body",
		display: false,
		attribution: "agent",
		timestamp: clock++,
	};
	assert.equal(auditContext([...file, followUp, ttsr], file).status, "live-extra");
	// Same shape with a tool result instead of a user prompt.
	const call = assistant("calling");
	const toolResult: Msg = {
		role: "toolResult",
		toolCallId: "t1",
		toolName: "bash",
		content: [{ type: "text", text: "done" }],
		isError: false,
		timestamp: clock++,
	};
	const withCall = persisted([prompt, { ...call, content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] }]);
	const tail = auditContext([...withCall.file, toolResult, asyncResult], withCall.file);
	assert.equal(tail.status, "pending-commit");
	assert.equal(tail.pendingTail, 2);
}

// 8. Image-bearing custom aside splits into developer text + user image: the
//    whole projection must match the live wire suffix as one unit.
{
	const imageAside: Msg = {
		role: "custom",
		customType: "image-attachment",
		content: [
			{ type: "text", text: "A terminal warning about context persistence." },
			{ type: "image", data: "blob:sha256:abc", mimeType: "image/webp" },
		],
		display: false,
		attribution: "user",
		timestamp: clock++,
	};
	const { file } = persisted([prompt, assistant("done")]);
	const live = [...file, imageAside];
	const wire = auditContext(live, file);
	assert.equal(wire.status, "pending-commit", "an image-bearing custom aside must classify as pending-commit");
	assert.equal(wire.liveCount, file.length + 2, "the aside projects to two wire messages");
	// A shape mismatch on the projected pair falls back to the old live-extra.
	const tampered: Msg = { ...imageAside, customType: "ttsr-injection" };
	assert.equal(auditContext([...file, tampered], file).status, "live-extra");
	// The real first-request shape: `image-attachment` notice, then the user
	// prompt, then the aside describing it — user in front of the aside.
	const withUser = auditContext([...file, imageAside, user("這老報這個錯")], file);
	assert.equal(withUser.status, "pending-commit");
	assert.equal(withUser.pendingTail, 3, "two wire messages from the aside plus the user prompt");
}

// 9. A non-aside custom type at the tail is still live-extra.
{
	const otherCustom: Msg = {
		role: "custom",
		customType: "ttsr-injection",
		content: "some injected rule",
		display: false,
		attribution: "agent",
		timestamp: clock++,
	};
	const { file } = persisted([prompt, assistant("done")]);
	const result = auditContext([...file, otherCustom], file);
	assert.equal(result.status, "live-extra");
	assert.equal(result.index, file.length);
}

// A real SDK side request may summarize a strict prefix; only a truncated main
// turn is a persistence violation. Exercise both through their actual pipelines.
{
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => { throw new Error("Network forbidden in the context audit gate"); }) as typeof fetch;
	let session: AgentSession | undefined;
	try {
		// Runtime-selected imports keep all SDK dependencies in the selected tree.
		const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
		const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
		const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
		const { createMockModel } = await import(`${AI_ROOT}/src/providers/mock.ts`);
		const cwd = join(dirname(bound), "work");
		const agentDir = join(dirname(bound), "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const settings = await Settings.loadIsolated({
			cwd, agentDir,
			overrides: {
				"memory.backend": "off", "computer.enabled": false,
				"secrets.enabled": false, "compaction.enabled": false,
			},
		});
		settings.setModelRole("default", "audit-fixture/audit-model");
		const authStorage = await discoverAuthStorage(agentDir);
		authStorage.keys.setRuntime("audit-fixture", "offline-fixture");
		const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
		const extension = (pi: ExtensionAPI) => {
			pi.registerProvider("audit-fixture", {
				api: "audit-fixture", baseUrl: "http://127.0.0.1:1/never", apiKey: "offline-fixture",
				models: [{
					id: "audit-model", name: "Audit fixture", reasoning: false, input: ["text"],
					contextWindow: 200000, maxTokens: 1024,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				}],
				streamSimple(model, context, options) {
					return createMockModel({
						id: model.id, provider: model.provider,
						handler: { content: [{ type: "text", text: "ack" }] },
					}).stream(model, context, options);
				},
			});
			contextPersistAudit(pi);
		};
		const manager = SessionManager.create(cwd, join(dirname(bound), "sessions"));
		({ session } = await createAgentSession({
			cwd, agentDir, settings, authStorage, modelRegistry, sessionManager: manager,
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
			skipPythonPreflight: true, preloadedCustomToolPaths: [], toolNames: [],
			extensions: [extension],
		}));
		assert.ok(session);
		await session.prompt("Persist this complete turn.");
		await manager.flush();
		const logPath = join(homedir(), ".omp", "agent", "context-persist-audit.log");
		const readAudit = () => readFileSync(logPath, "utf8");
		const beforeLog = readAudit();
		const originalMessages = session.agent.state.messages.slice();
		await session.convertMessagesToLlm(originalMessages.slice(0, 1));
		assert.equal(readAudit(), beforeLog, "compaction-prefix conversion must not emit a false persistence warning");
		assert.deepEqual(session.agent.state.messages, originalMessages, "side conversion must not truncate live history");
		session.agent.replaceMessages(originalMessages.slice(0, 1));
		await session.agent.continue();
		const records = readAudit().trim().split("\n").map(line => JSON.parse(line) as { status: string });
		assert.equal(records.at(-1)?.status, "file-extra", "a genuinely truncated main turn must still be detected");
		await settings.flush();

		if (["18.10.0", "18.10.1"].includes(JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version)) {
			const { FileSessionStorage } = await import(`${AGENT_ROOT}/src/session/session-storage.ts`);
			const { appendTransferNotice } = await import(`${AGENT_ROOT}/src/session/session-transfer-marker.ts`);
			const { HindsightSessionState } = await import(`${AGENT_ROOT}/src/hindsight/state.ts`);
			const { cfgMemoryBackend } = await import(`${AGENT_ROOT}/src/memory-backend/settings.ts`);
			const { cfgHindsightApiUrl, cfgHindsightMentalModelsEnabled } = await import(`${AGENT_ROOT}/src/hindsight/settings.ts`);
			// The initial runtime-off override outranks persisted writes. Activate
			// and drain the real lifecycle before replacing only its client state.
			cfgHindsightApiUrl.override(settings, "http://127.0.0.1:1");
			cfgHindsightMentalModelsEnabled.override(settings, false);
			cfgMemoryBackend.override(settings, "hindsight");
			await session.applyMemoryBackend();
			await session.settleMemoryBackend();
			assert.equal(cfgMemoryBackend.get(settings), "hindsight");
			assert.ok(session.getHindsightSessionState(), "replica fixture requires an active Hindsight backend");
			let mentalModelLoads = 0;
			const memory = new HindsightSessionState({
				sessionId: session.sessionId, session, bankId: "replica-fixture",
				config: { mentalModelsEnabled: true, mentalModelMaxRenderChars: 16_000 },
				client: { listMentalModels: async () => {
					mentalModelLoads++;
					throw new Error("read-only replica must not fetch local mental models");
				} },
				banksSet: new Set(["replica-fixture"]),
			});
			session.setHindsightSessionState(memory)?.dispose();
			const hostCwd = join(dirname(bound), "remote-host");
			mkdirSync(hostCwd);
			const host = SessionManager.inMemory(hostCwd);
			// A guest must inspect even a departed snapshot, not turn it into a
			// writable fork. The completed eval and interrupted tool turn expose
			// the two transcript producers formerly reached during hydration.
			await appendTransferNotice(host, { kind: "departed", to: "another host" });
			host.appendMessage(user("host eval"));
			host.appendMessage({ ...assistant("eval"), stopReason: "toolUse",
				content: [{ type: "toolCall", id: "host-eval", name: "eval", arguments: { code: "x = 1" } }] });
			host.appendMessage({ role: "toolResult", toolCallId: "host-eval", toolName: "eval",
				content: [{ type: "text", text: "ok" }], isError: false, timestamp: clock++ });
			host.appendMessage(user("host pending tool"));
			host.appendMessage({ ...assistant("pending"), stopReason: "toolUse",
				content: [{ type: "toolCall", id: "host-pending", name: "bash", arguments: { command: "held" } }] });
			const replicaFile = join(dirname(bound), "replica.jsonl");
			const replicaId = host.getSessionId();
			const releaseReplica = new FileSessionStorage().claimSession(replicaId, replicaFile, { exclusive: true });
			assert.ok(releaseReplica, "guest fixture must own its replica while the SDK only inspects it");
			session.setSessionBeforeSwitchReconciler(null);
			session.setSessionSwitchReconciler(null);
			try {
				for (const phase of ["welcome", "resync"]) {
					const frozenModels = phase === "welcome" ? "<mental_models>\nexact host snapshot\n</mental_models>" : "";
					host.appendCustomEntry("hindsight_mental_models_snippet", { snippet: frozenModels });
					const snapshot = [host.getHeader(), ...host.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n";
					writeFileSync(replicaFile, snapshot);
					assert.equal(await session.switchSession(replicaFile, { preserveLocalCwd: true, keepModel: true }), true);
					assert.equal(session.getHindsightSessionState(), memory, `${phase}: replica hydration keeps the settled memory binding`);
					await memory.mentalModelsLoadPromise;
					assert.equal(memory.mentalModelsSnippet ?? "", frozenModels, `${phase}: replica reads the exact host's frozen answer`);
					assert.equal(mentalModelLoads, 0, `${phase}: read-only hydration cannot load local mental models`);
					await session.sessionManager.flush();
					assert.equal(session.sessionManager.getSessionId(), replicaId, `${phase}: replica inspection cannot adopt/fork`);
					assert.equal(session.sessionManager.getSessionFile(), replicaFile);
					assert.equal(session.sessionManager.getCwd(), cwd, `${phase}: the guest keeps its own cwd`);
					assert.deepEqual(session.sessionManager.getEntries(), host.getEntries(),
						`${phase}: guest cannot synthesize eval/repair/model receipts or migrate scoped memory metadata`);
					assert.equal(readFileSync(replicaFile, "utf8"), snapshot, `${phase}: host snapshot bytes remain authoritative`);
				}
			} finally {
				releaseReplica();
				await host.close();
			}
		}
		authStorage.close();
	} finally {
		await session?.dispose();
		globalThis.fetch = originalFetch;
	}
}

rmSync(dirname(bound), { recursive: true, force: true });
console.log("context-persist-audit: ALL PASS");
