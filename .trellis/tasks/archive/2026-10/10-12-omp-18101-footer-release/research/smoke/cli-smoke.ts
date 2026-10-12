/**
 * Synthetic offline model provider for the installed-path private smoke.
 *
 * Loaded by the installed CLI with `-e <this file>` and selected with
 * `--model release-smoke/verification`. It registers a provider whose
 * `streamSimple` is a scripted mock model:
 *
 *   1. first response: a real `read` tool call on the fixture file in the
 *      private HOME;
 *   2. second response: echoes the marker read from that file.
 *
 * The real read tool must therefore execute against the installed runtime and
 * the file content must cross the provider boundary before the marker is
 * echoed, so a passing run proves the CLI read path, not just process startup.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Marker the fixture file carries and the second response echoes. */
const MARKER = "OMP_18.10.1_SMOKE_OK";

interface SmokeMessage {
	role: string;
	toolName?: string;
	content: unknown;
}

interface SmokeContext {
	messages: SmokeMessage[];
}

interface SmokeExtensionApi {
	registerProvider(name: string, config: Record<string, unknown>): void;
}

export default async function (pi: SmokeExtensionApi): Promise<void> {
	const runtime = process.env.OMP_SMOKE_RUNTIME;
	const fixture = process.env.OMP_SMOKE_FIXTURE;
	assert.ok(runtime, "OMP_SMOKE_RUNTIME must point at the installed @oh-my-pi runtime");
	assert.ok(fixture, "OMP_SMOKE_FIXTURE must point at the private read fixture");

	// Dynamic import, not a static one: the selected install root is only known
	// at runtime, so the installed mock-provider module cannot be a bare
	// specifier resolved at author time.
	const { createMockModel } = await import(`${runtime}/pi-ai/src/providers/mock.ts`);

	const model = createMockModel({
		id: "verification",
		provider: "release-smoke",
		responses: [
			{ content: [{ type: "toolCall", name: "read", arguments: { path: fixture } }] },
			(context: SmokeContext) => {
				const result = context.messages.find(
					message => message.role === "toolResult" && message.toolName === "read",
				);
				assert.ok(result, "CLI must execute the real read tool before completing");
				assert.ok(
					JSON.stringify(result.content).includes(MARKER),
					"real fixture content must reach the provider boundary",
				);
				const marker = readFileSync(fixture, "utf8")
					.split("\n")
					.map(line => line.trim())
					.find(line => line.startsWith("OMP_"));
				assert.equal(marker, MARKER, "echoed marker must be read back from the fixture file");
				return { content: marker };
			},
		],
	});

	pi.registerProvider("release-smoke", {
		api: "release-smoke-api",
		apiKey: "offline-fixture",
		baseUrl: "http://127.0.0.1:1/never",
		models: [
			{
				id: "verification",
				name: "Offline release verification",
				reasoning: false,
				input: ["text"],
				contextWindow: 128_000,
				maxTokens: 4_096,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
		streamSimple: (selectedModel: unknown, context: unknown, options: unknown) =>
			model.stream(selectedModel, context, options),
	});
}
