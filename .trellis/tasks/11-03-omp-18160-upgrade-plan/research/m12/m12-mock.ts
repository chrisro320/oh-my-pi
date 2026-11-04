/** M12 physical-acceptance mock provider. Synthetic model, offline only.
 *
 * Registers provider `m12-mock` (model `scripted`) through the 18.16.0 extension
 * API and scripts one scenario per process, selected by M12_SCENARIO:
 *
 *   image-build      print mode: read a PNG (real read tool => image in transcript)
 *   image            interactive: short replies for a resumed image-bearing session
 *   escape           call 1 streams ~90 s in 1 s deltas (Escape aborts it); later
 *                    calls answer immediately
 *   computer-confirm call 1 is a computer `control.acquire` call; the reply after
 *                    the tool result echoes that result (0102 verdict)
 *   computer-ax      control.acquire -> window{title}+observe (AT-SPI) ->
 *                    window{title}+holdKeys(Shift, 60 s, takeover) for Escape
 *
 * There is no provider endpoint: baseUrl is loopback port 1 and streamSimple is
 * served by pi-ai's own mock provider (createMockModel), except the escape
 * scenario, whose slow stream is emitted here (the mock provider cannot delay
 * per delta; delays belong in the extension, not in the runtime).
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const RUNTIME = process.env.M12_RUNTIME;
const SCENARIO = process.env.M12_SCENARIO;
const LOG = process.env.M12_LOG;
const TARGET = process.env.M12_TARGET_TITLE ?? "Kate";
const PNG = process.env.M12_PNG;
const ESCAPE_CHUNKS = Number(process.env.M12_ESCAPE_CHUNKS ?? 90);
const ESCAPE_INTERVAL_MS = Number(process.env.M12_ESCAPE_INTERVAL_MS ?? 1000);

if (!RUNTIME || !SCENARIO || !LOG) {
	throw new Error("m12-mock: M12_RUNTIME, M12_SCENARIO and M12_LOG are required");
}

function note(line: string, extra?: unknown): void {
	try {
		appendFileSync(LOG!, `${new Date().toISOString()} ${line}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}\n`);
	} catch {}
}

interface Message {
	role: string;
	toolName?: string;
	content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

function textOf(message: Message | undefined): string {
	if (!message?.content) return "";
	return message.content
		.map(part => (part.type === "text" ? (part.text ?? "") : `<${part.type}>`))
		.join("\n");
}

function lastToolResult(messages: Message[], name: string): Message | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role === "toolResult" && message.toolName === name) return message;
	}
	return undefined;
}

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export default async function (pi: {
	registerProvider(name: string, config: Record<string, unknown>): void;
	logger?: { info(message: string, meta?: unknown): void };
}): Promise<void> {
	// Runtime-selected specifiers: the staged release path arrives in M12_RUNTIME and
	// the release is read-only, so the module cannot be a static import of this repo.
	const { createMockModel } = await import(`${RUNTIME}/node_modules/@oh-my-pi/pi-ai/src/providers/mock.ts`);
	const { AssistantMessageEventStream } = await import(
		`${RUNTIME}/node_modules/@oh-my-pi/pi-ai/src/utils/event-stream.ts`
	);
	note("m12-mock: extension loaded", { scenario: SCENARIO, target: TARGET });

	const controlReason =
		SCENARIO === "computer-ax"
			? `M12 computer-ax: read the accessibility tree of the "${TARGET}" window`
			: "M12 computer-confirm: acquire foreground control for a scripted acceptance check";

	// The computer steps are `eval` cells: `computer` is an eval prelude in 18.16.0,
	// not a standalone tool, and every step is one cell whose last expression is the
	// value the TUI and the model see. Declarations are per-cell unique because the
	// JS cell keeps top-level state between calls.
	const cellAcquire = `await computer.control.acquire({ reason: ${JSON.stringify(controlReason)} })`;
	const cellObserve =
		`const observed = await computer.window({ title: ${JSON.stringify(TARGET)}, wait: 2000 });\n`
		+ "const tree = await observed.observe({});\n"
		+ "({ id: observed.id, pid: observed.pid, title: observed.title, nodes: tree.nodeCount, truncated: tree.truncated })";
	const cellTakeover =
		`const held = await computer.window({ title: ${JSON.stringify(TARGET)} });\n`
		+ 'await held.holdKeys(["Shift"], { duration: 60, takeover: true })';
	// Cells 2 and 3 only run after a human approves the dialog, so the real process
	// proves every cell parses as JS at load time; the headless run then never has to
	// claim untested syntax.
	const cells: Array<[string, string]> = [
		["acquire", cellAcquire],
		["observe", cellObserve],
		["takeover", cellTakeover],
	];
	const cellErrors: string[] = [];
	for (const [name, code] of cells) {
		try {
			new Bun.Transpiler({ loader: "js" }).transformSync(code);
		} catch (error) {
			cellErrors.push(`${name}: ${String(error)}`);
		}
	}
	note(cellErrors.length === 0 ? "m12-mock: cell selfcheck OK" : "m12-mock: cell selfcheck FAILED", {
		cells: cells.length,
		errors: cellErrors,
	});

	/** Scripted reply for one model call, by scenario and by what the transcript already holds. */
	function scripted(context: { messages: Message[] }): Record<string, unknown> {
		const results = context.messages.filter(message => message.role === "toolResult");
		if (SCENARIO === "image-build") {
			if (!lastToolResult(context.messages, "read")) {
				note("m12-mock: image-build -> read tool call", { png: PNG });
				return { content: [{ type: "toolCall", name: "read", arguments: { path: PNG } }] };
			}
			note("m12-mock: image-build -> final text");
			return { content: ["M12_IMAGE_BUILT: the transcript above holds the image the read tool returned."] };
		}
		if (SCENARIO === "image") {
			note("m12-mock: image -> short reply");
			return { content: ["M12 image scenario: the resumed transcript above holds the harness PNG."] };
		}
		if (SCENARIO === "escape") {
			note("m12-mock: escape -> short reply", { priorResults: results.length });
			return { content: ["M12 escape scenario: second prompt answered immediately; the session still works."] };
		}
		// `computer` is an eval prelude, not a standalone tool: every computer step is
		// one `eval` cell whose last expression is the value the TUI and the model see.
		const evalCall = (title: string, code: string) => {
			note(`m12-mock: ${title}`, { code });
			return { content: [{ type: "toolCall", name: "eval", arguments: { language: "js", code } }] };
		};
		if (SCENARIO === "computer-confirm") {
			const result = lastToolResult(context.messages, "eval");
			if (!result) return evalCall("computer-confirm -> control.acquire eval call", cellAcquire);
			note("m12-mock: computer-confirm -> echo tool result");
			return { content: [`M12 computer-confirm tool result:\n${textOf(result)}`] };
		}
		if (SCENARIO === "computer-ax") {
			const applied = context.messages.filter(
				message => message.role === "toolResult" && message.toolName === "eval",
			);
			if (applied.length === 0) return evalCall("computer-ax -> control.acquire eval call", cellAcquire);
			if (applied.length === 1) return evalCall("computer-ax -> window observe eval call", cellObserve);
			if (applied.length === 2) {
				return evalCall("computer-ax -> takeover hold eval call (Escape cancels this)", cellTakeover);
			}
			note("m12-mock: computer-ax -> echo tool result");
			return { content: [`M12 computer-ax tool result:\n${textOf(lastToolResult(context.messages, "eval"))}`] };
		}
		// Read-only (no control.acquire, no input): an ambiguous title filter must throw, then
		// the unique target's AT-SPI tree is read. M12_AMBIGUOUS_TITLE must match two windows.
		if (SCENARIO === "computer-read") {
			const applied = context.messages.filter(
				message => message.role === "toolResult" && message.toolName === "eval",
			);
			const ambiguous = JSON.stringify(process.env.M12_AMBIGUOUS_TITLE ?? "M12 AX");
			if (applied.length === 0) {
				return evalCall("computer-read -> ambiguous window eval call", `await computer.window({ title: ${ambiguous} })`);
			}
			if (applied.length === 1) return evalCall("computer-read -> window observe eval call", cellObserve);
			note("m12-mock: computer-read -> echo tool results");
			return { content: [`M12 computer-read tool results:\n${applied.map(textOf).join("\n---\n")}`] };
		}
		// Live double `/compact snapcompact`: every prompt reads one large work file, so the
		// session accumulates real tool results for snapcompact to fold.
		if (SCENARIO === "compact") {
			const last = context.messages[context.messages.length - 1];
			if (last?.role === "toolResult") {
				note("m12-mock: compact -> short reply");
				return { content: [`M12 compact scenario: read ${results.length} file(s).`] };
			}
			const path = `${process.cwd()}/big-${(results.length % 12) + 1}.txt`;
			note("m12-mock: compact -> read tool call", { path });
			return { content: [{ type: "toolCall", name: "read", arguments: { path } }] };
		}
		note("m12-mock: unknown scenario, plain reply");
		return { content: [`M12 unknown scenario ${SCENARIO}`] };
	}

	const model = createMockModel({
		id: "scripted",
		provider: "m12-mock",
		baseUrl: "http://127.0.0.1:1/never",
		handler: context => {
			const reply = scripted(context as { messages: Message[] });
			note("m12-mock: model call served", { calls: model.calls.length });
			return reply;
		},
	});

	function sleep(ms: number, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new Error("aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		return promise;
	}

	let escapeCalls = 0;

	/** ~90 s of text_delta events: Escape mid-stream must abort the turn, not the session. */
	function escapeStream(
		selected: { api: string; provider: string; id: string },
		options?: { signal?: AbortSignal },
	) {
		const stream = new AssistantMessageEventStream();
		const startedAt = Date.now();
		const blocks: Array<{ type: "text"; text: string }> = [{ type: "text", text: "" }];
		const partial = {
			role: "assistant",
			content: blocks,
			api: selected.api,
			provider: selected.provider,
			model: selected.id,
			usage: zeroUsage(),
			stopReason: "stop",
			timestamp: startedAt,
		} as Record<string, unknown>;
		// Distinct text per chunk: a repeated line trips the 18.16.0 loop guard ("Thinking loop detected").
		const words = "amber basalt cedar delta ember fjord granite harbor iris juniper kelp lagoon maple nectar onyx pine quartz river saffron tundra umber violet willow xenon yarrow zephyr acorn brook cliff dune estuary fern glacier heath inlet jade knoll ledge meadow nook orchard prairie quarry ridge summit thicket upland vale wharf yew".split(" ");
		let seed = 7;
		const chunkAt = (index: number): string => {
			if (index === 0) return "M12 escape scenario: streaming slowly; press Escape now to abort this turn. ";
			const picked: string[] = [];
			for (let n = 0; n < 6; n += 1) {
				seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
				picked.push(words[(seed >>> 16) % words.length]!);
			}
			return `(${index + 1}) ${picked.join(" ")}. `;
		};
		void (async () => {
			note("m12-mock: escape stream start", { chunks: ESCAPE_CHUNKS, intervalMs: ESCAPE_INTERVAL_MS });
			stream.push({ type: "start", partial } as never);
			stream.push({ type: "text_start", contentIndex: 0, partial } as never);
			for (let index = 0; index < ESCAPE_CHUNKS; index += 1) {
				try {
					await sleep(ESCAPE_INTERVAL_MS, options?.signal);
				} catch {
					note("m12-mock: escape stream aborted", {
						afterChunks: index,
						reason: String(options?.signal?.reason ?? "unknown"),
					});
					const aborted = { ...partial, stopReason: "aborted", errorMessage: "M12 escape stream aborted by Escape" };
					stream.push({ type: "error", reason: "aborted", error: aborted } as never);
					return;
				}
				const chunk = chunkAt(index);
				blocks[0]!.text += chunk;
				stream.push({ type: "text_delta", contentIndex: 0, delta: chunk, partial } as never);
			}
			stream.push({ type: "text_end", contentIndex: 0, content: blocks[0]!.text, partial } as never);
			stream.push({ type: "done", reason: "stop", message: partial } as never);
			note("m12-mock: escape stream finished", { chunks: ESCAPE_CHUNKS });
		})();
		return stream;
	}

	pi.registerProvider("m12-mock", {
		api: "m12-mock-api",
		apiKey: "synthetic-offline-m12",
		baseUrl: "http://127.0.0.1:1/never",
		models: [
			{
				id: "scripted",
				name: "M12 scripted (offline)",
				reasoning: false,
				input: ["text", "image"],
				contextWindow: 200_000,
				maxTokens: 8_192,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
		streamSimple: (selected: { api: string; provider: string; id: string }, context: unknown, options?: { signal?: AbortSignal }) => {
			const slow = SCENARIO === "escape" && escapeCalls === 0;
			escapeCalls += 1;
			note("m12-mock: streamSimple", { slow, served: escapeCalls, aborted: options?.signal?.aborted === true });
			if (slow) return escapeStream(selected, options);
			return model.stream(selected as never, context as never, options as never);
		},
	});
	note("m12-mock: provider registered", { provider: "m12-mock", model: "scripted", log: join(LOG) });
}
