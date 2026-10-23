/** Synthetic model ONLY; real selected CLI, read tool and tool-result boundary.
 * This is not provider/network proof. Success requires actual fixture bytes in
 * the read result, not an echoed marker from a mock tool implementation.
 */
import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
const runtime = process.env.OMP_SMOKE_RUNTIME;
const fixture = process.env.OMP_SMOKE_FIXTURE;
const marker = process.env.OMP_SMOKE_READ_MARKER;
assert.ok(runtime && isAbsolute(runtime));
assert.ok(fixture && isAbsolute(fixture));
assert.ok(marker);
assert.ok(realpathSync(import.meta.filename).startsWith(`${runtime}/`), "probe must live inside selected tree");
interface Message { role: string; toolName?: string; content: unknown }
interface Context { messages: Message[] }
interface Api { registerProvider(name: string, config: Record<string, unknown>): void }
export default async function (pi: Api): Promise<void> {
	const modulePath = `${runtime}/node_modules/@oh-my-pi/pi-ai/src/providers/mock.ts`;
	console.error(`OMP_SMOKE_IMPORT ${import.meta.resolve(modulePath)}`);
	const { createMockModel } = await import(modulePath);
	const model = createMockModel({
		id: "verification", provider: "release-smoke",
		responses: [
			{ content: [{ type: "toolCall", name: "read", arguments: { path: fixture } }] },
			(context: Context) => {
				const result = context.messages.find(message => message.role === "toolResult" && message.toolName === "read");
				assert.ok(result, "selected CLI must invoke its real read tool");
				assert.ok(JSON.stringify(result.content).includes(marker), "fixture nonce must cross real tool-result boundary");
				console.error("OMP_REAL_READ_OBSERVED");
				return { content: [marker] };
			},
		],
	});
	pi.registerProvider("release-smoke", {
		api: "release-smoke-api", apiKey: "synthetic-offline-fixture", baseUrl: "http://127.0.0.1:1/never",
		models: [{ id: "verification", name: "Offline sandbox verification", reasoning: false,
			input: ["text"], contextWindow: 128_000, maxTokens: 4_096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		streamSimple: (selected: unknown, context: unknown, options: unknown) => model.stream(selected, context, options),
	});
}
