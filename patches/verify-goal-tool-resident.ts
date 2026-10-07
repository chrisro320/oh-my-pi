import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const version = JSON.parse(readFileSync(`${AGENT}/package.json`, "utf8")).version;
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT}/src/config/settings.ts`);
const { SessionManager } = await import(`${AGENT}/src/session/session-manager.ts`);
const { createMockModel } = await import(`${AI}/src/providers/mock.ts`);
const root = mkdtempSync(join(tmpdir(), "omp-goal-resident-"));
try {
  for (const restrictToolNames of [false, true]) {
    const agentDir = join(root, String(restrictToolNames));
    const authStorage = await discoverAuthStorage(agentDir);
    if (["18.3.3", "18.4.1", "18.4.4", "18.7.0"].includes(version)) authStorage.keys.setRuntime("mock", "offline");
    else authStorage.setRuntimeApiKey("mock", "offline");
    const { session } = await createAgentSession({
      cwd: root, agentDir, authStorage,
      settings: Settings.isolated({ "goal.enabled": true, "memory.backend": "off", "computer.enabled": false }),
      model: createMockModel({ handler: { content: "offline" } }),
      sessionManager: SessionManager.inMemory(root),
      skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
      disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
      preloadedCustomToolPaths: [], skipPythonPreflight: true,
      toolNames: ["read", "goal"], restrictToolNames,
    });
    try {
      const activeNames = () => session.agent.state.tools.map((tool: { name: string }) => tool.name).sort();
      const initial = activeNames();
      assert.equal(initial.includes("goal"), !restrictToolNames, "goal residency must respect restricted sessions");
      for (const status of ["active", "paused", "dropped", undefined]) {
        session.setGoalModeState(status ? {
          enabled: status === "active", mode: "active",
          goal: { id: "fixture", objective: "offline", status, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 },
        } : undefined);
        await session.setActiveToolsByName(initial);
        assert.deepEqual(activeNames(), initial, `${status ?? "absent"}: goal lifecycle must not reshape the toolset`);
      }
    } finally {
      await session.dispose();
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("PASS goal tool residency: active, paused, dropped, absent, restricted session");
