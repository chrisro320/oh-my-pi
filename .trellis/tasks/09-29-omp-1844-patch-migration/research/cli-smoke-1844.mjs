import assert from "node:assert/strict";

export default async function (pi) {
  const nm = process.env.OMP_PATCH_VERIFY_NM;
  const fixture = process.env.OMP_SMOKE_FIXTURE;
  assert.ok(nm && fixture, "explicit selected roots and private read fixture required");
  // Selected install root is only known at runtime.
  const { createMockModel } = await import(`${nm}/pi-ai/src/providers/mock.ts`);
  const model = createMockModel({
    id: "verification", provider: "upgrade-smoke",
    responses: [
      { content: [{ type: "toolCall", name: "read", arguments: { path: fixture } }] },
      context => {
        const result = context.messages.find(message => message.role === "toolResult" && message.toolName === "read");
        assert.ok(result, "CLI must execute the real read tool before completing");
        assert.ok(JSON.stringify(result.content).includes("offline-read-proof"), "real file content must reach the provider boundary");
        return { content: "OMP_1844_SMOKE_OK" };
      },
    ],
  });
  pi.registerProvider("upgrade-smoke", {
    api: "upgrade-smoke-api", apiKey: "offline-fixture", baseUrl: "http://127.0.0.1:1/never",
    models: [{ id: "verification", name: "Offline upgrade verification", reasoning: false,
      input: ["text"], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (selectedModel, context, options) => model.stream(selectedModel, context, options),
  });
}
