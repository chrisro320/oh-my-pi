import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.OMP_MODEL_LAB!;
assert.ok(root?.startsWith("/tmp/omp-1833-preflight-"), "private experiment root required");
const agentRoot = join(root, "node_modules/@oh-my-pi/pi-coding-agent");
const aiRoot = join(root, "node_modules/@oh-my-pi/pi-ai");
let fetchAttempts = 0;
globalThis.fetch = (() => { fetchAttempts++; throw new Error("Network forbidden in lifecycle probe"); }) as typeof fetch;
// Imports select the isolated package roots at runtime, never the live install.
const { createAgentSession, discoverAuthStorage } = await import(`${agentRoot}/src/sdk.ts`);
const { ModelRegistry } = await import(`${agentRoot}/src/config/model-registry.ts`);
const { Settings } = await import(`${agentRoot}/src/config/settings.ts`);
const { SessionManager } = await import(`${agentRoot}/src/session/session-manager.ts`);
const { createMockModel } = await import(`${aiRoot}/src/providers/mock.ts`);
const { resolveEditMode } = await import(`${agentRoot}/src/utils/edit-mode.ts`);
const [scenario, output, resumeFile] = process.argv.slice(2);
const cwd = join(root, "work");
const caseId = process.env.OMP_MODEL_CASE!;
assert.match(caseId, /^[a-z-]+$/);
const agentDir = join(root, "cases", caseId);
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
  "edit.mode": "hashline", "memory.backend": "off", "computer.enabled": false,
  "secrets.enabled": false, "compaction.enabled": false,
}});
if (scenario !== "resume") settings.setModelRole("default", scenario === "fresh-b" ? "drift-fixture/deepseek-v4.1-flash" : "drift-fixture/gpt-4.1");
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("drift-fixture", "offline-fixture");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
type ModelView = { provider: string; id: string; api: string; input: string[]; compat?: unknown; thinking?: unknown };
type ToolView = {
  name: string; description: string; parameters: unknown; strict?: boolean;
  deferLoading?: boolean; customFormat?: unknown; customWireName?: string;
  native?: unknown; examples?: readonly unknown[];
};
type ContextView = { systemPrompt?: unknown; tools?: ToolView[] };
type Snapshot = { model: ModelView; system?: unknown; tools?: ToolView[]; raw: { system: string; tools: string } };
const calls: Snapshot[] = [];
registry.registerProvider("drift-fixture", {
  api: "lifecycle-probe", baseUrl: "http://127.0.0.1:1/never", apiKey: "offline-fixture",
  models: [
    { id: "gpt-4.1", name: "A", reasoning: false, input: ["text", "image"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { id: "deepseek-v4.1-flash", name: "B", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  ],
  streamSimple(model: ModelView, context: ContextView, options: unknown) {
    // pi-ai Tool contract (types.ts:1438-1474), excluding execution-only
    // tool/runner/session objects and their mutable settings caches.
    const tools = context.tools?.map(tool => ({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      strict: tool.strict, deferLoading: tool.deferLoading, customFormat: tool.customFormat,
      customWireName: tool.customWireName, native: tool.native, examples: tool.examples,
    }));
    const raw = {
      system: JSON.stringify(context.systemPrompt),
      tools: JSON.stringify(tools),
    };
    calls.push(JSON.parse(JSON.stringify({
      model: { provider: model.provider, id: model.id, api: model.api, input: model.input, compat: model.compat, thinking: model.thinking },
      raw,
      system: context.systemPrompt,
      tools,
    })));
    return createMockModel({ id: model.id, provider: model.provider, handler: { content: "offline acknowledgement" } }).stream(model, context, options);
  },
}, "lifecycle-probe");
const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(root, "sessions"));
const { session } = await createAgentSession({
  cwd, agentDir, authStorage, modelRegistry: registry, settings, sessionManager: manager,
  skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
  disableExtensionDiscovery: true, enableMCP: false, preloadedCustomToolPaths: [],
  enableLsp: false, skipPythonPreflight: true, toolNames: ["read", "edit"], restrictToolNames: true,
});
const snapshots: (Snapshot & { label: string; effectiveEditMode: string; defaultRole: string })[] = [];
async function capture(label: string) {
  const before = calls.length;
  await session.prompt("Reply with a short acknowledgement; do not call tools.");
  assert.equal(calls.length, before + 1, "each capture must reach exactly one provider adapter request");
  const call = calls.at(-1);
  assert.ok(call);
  snapshots.push({ label, ...call, effectiveEditMode: resolveEditMode({ settings, getActiveModelString: () => `${session.model.provider}/${session.model.id}` }), defaultRole: settings.getModelRole("default") });
}
const a = registry.find("drift-fixture", "gpt-4.1")!;
const b = registry.find("drift-fixture", "deepseek-v4.1-flash")!;
assert.ok(a && b);
if (scenario === "resume") {
  await capture("resumed");
} else {
  await capture(scenario === "fresh-b" ? "initial-B" : "initial-A");
  if (scenario === "temporary" || scenario === "roundtrip" || scenario === "ephemeral") {
    await session.setModelTemporary(b, undefined, scenario === "ephemeral" ? { ephemeral: true } : undefined);
    assert.equal(settings.getModelRole("default"), "drift-fixture/gpt-4.1", "temporary selection must not change default role");
    await capture("temporary-B");
    if (scenario === "roundtrip") {
      await session.setModel(a, "default");
      await capture("returned-A");
    }
  } else if (scenario === "default") {
    await session.setModel(b, "default", { persist: true });
    assert.equal(settings.getModelRole("default"), "drift-fixture/deepseek-v4.1-flash");
    await capture("default-B");
  }
}
await manager.flush();
await settings.flush();
const sessionFile = manager.getSessionFile();
const result = { scenario, pid: process.pid, sessionFile, snapshots, fetchAttempts, selectedRoots: { agentRoot, aiRoot }, modelChanges: manager.getEntries().filter((entry: { type: string }) => entry.type === "model_change") };
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ scenario, output, snapshots: snapshots.length, fetchAttempts }));
process.exit(0);
