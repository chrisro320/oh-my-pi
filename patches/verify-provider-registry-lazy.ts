/**
 * verify-provider-registry-lazy.ts — patched providers must be reachable through
 * the lazy registration table (U9, 18.16.0 only)
 *
 * `pi-ai` no longer imports every provider eagerly. Each API is served by a
 * `createLazyProviderStream(() => import("<literal>"), mod => mod.streamX)`
 * entry in `src/providers/register-builtins.ts`, and the public `stream()`
 * dispatcher in `src/stream.ts` routes `model.api` to one of those wrappers.
 * The failure this gate exists for is silent: a provider that only exists as a
 * re-export (`src/index.ts`) or whose patched module is not what the table
 * loads keeps compiling, keeps type-checking, and only fails when a user
 * dispatches a turn — or, worse, dispatches the *unpatched* module while every
 * other gate, which imports the provider file directly, stays green.
 *
 * Claims, each with a fault control that turns exactly it red:
 *   route-<p>   the table entry for the provider's API loads
 *               `<AI_ROOT>/src/providers/<file>.ts` on first use — observed
 *               through Bun's module cache, never by reading the table source;
 *   symbols-<p> the loaded namespace owns the stream export the wrapper picks,
 *               and it is the same class of value `stream()` calls;
 *   lazy-table  importing the table loads no provider stream module at all —
 *               every wrapper really is a first-use loader;
 *   live-<p>    the dispatch reaches the provider's own code (its transport is
 *               attempted, or it raises a provider-authored error), not
 *               `... is not a function` from a missing pick;
 *   patch-<p>   the module the table loaded is the *patched* variant of that
 *               provider, pinned by a patch-only surface: codex's compaction
 *               exports, anthropic's request-audit module in the load set,
 *               devin's memoized GetUserJwt, gemini-cli's session key.
 *   dispatch    `stream()` itself routes each patched API to those modules and
 *               rejects an unknown API instead of falling through.
 *
 * Roots: `OMP_PATCH_VERIFY_AI_ROOT`, then `OMP_PATCH_VERIFY_NM`, then the live
 * install. Zero provider traffic: `fetch` is replaced and every URL it is asked
 * for is recorded, never opened.
 *
 * Fault controls (self-driven, candidate runs only) copy the selected pi-ai
 * into a throwaway runtime shell, make one mutation and re-run the whole gate
 * as a child; the child must exit non-zero and name the mutated claim.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const aiVersion = JSON.parse(readFileSync(join(AI_ROOT, "package.json"), "utf8")).version;
// The lazy table, the patched provider set and every marker below were read on
// 18.16.0. An unknown tree fails closed instead of silently asserting another
// release's provider wiring.
assert.equal(aiVersion, "18.16.0", `verify-provider-registry-lazy is an 18.16.0 gate, got ${aiVersion}`);

const PROVIDERS_DIR = join(AI_ROOT, "src", "providers");
const TABLE_FILE = join(PROVIDERS_DIR, "register-builtins.ts");

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (id: string, ok: boolean, detail: string): void => {
	checks.push({ id, ok, detail });
	console.log(`  ${ok ? "ok  " : "FAIL"} ${id}${detail ? `: ${detail}` : ""}`);
};

/** Loaded module paths, keyed by their path under `src/providers/`. */
function loadedProviderModules(): Map<string, string> {
	const loaded = new Map<string, string>();
	for (const key of Object.keys(require.cache ?? {})) {
		if (!key.startsWith(`${PROVIDERS_DIR}/`)) continue;
		loaded.set(key.slice(PROVIDERS_DIR.length + 1), key);
	}
	return loaded;
}

function providerExports(path: string): Record<string, unknown> {
	return (require.cache[path]?.exports ?? {}) as Record<string, unknown>;
}

interface Target {
	/** Provider module file name inside `src/providers/`. */
	file: string;
	/** The stream export the table wrapper picks. */
	stream: string;
	/** The public `model.api` value the dispatcher must route to it. */
	api: string;
	model: Record<string, unknown>;
	options: Record<string, unknown>;
	/**
	 * Provider-authored outcome of an offline dispatch: either our stubbed
	 * transport was reached (`network disabled`) or the provider refused before
	 * the transport with its own diagnostic. A wrapper-level failure ("… is not
	 * a function") matches neither.
	 */
	expect: RegExp;
}

const baseModel = {
	name: "registry-probe",
	input: ["text"],
	supportsTools: true,
	identity: { class: "gemini" },
	reasoning: false,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
	compat: {},
};

const TARGETS: Target[] = [
	{
		file: "devin.ts",
		stream: "streamDevin",
		api: "devin-agent",
		model: { ...baseModel, id: "swe-2", api: "devin-agent", provider: "devin", baseUrl: "http://127.0.0.1:9", compat: { modelRouter: false } },
		options: { apiKey: "devin-session-token$registry-probe" },
		expect: /verify-provider-registry-lazy: network disabled/,
	},
	{
		file: "google-gemini-cli.ts",
		stream: "streamGoogleGeminiCli",
		api: "google-gemini-cli",
		model: { ...baseModel, id: "gemini-3.7-flash", api: "google-gemini-cli", provider: "google-antigravity", baseUrl: "http://127.0.0.1:9" },
		options: { apiKey: "registry-probe" },
		expect: /Cloud Code Assist credentials/,
	},
	{
		file: "openai-codex-responses.ts",
		stream: "streamOpenAICodexResponses",
		api: "openai-codex-responses",
		model: { ...baseModel, id: "gpt-6-astra", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "http://127.0.0.1:9" },
		options: { apiKey: "registry-probe" },
		expect: /verify-provider-registry-lazy: network disabled/,
	},
	{
		file: "anthropic.ts",
		stream: "streamAnthropic",
		api: "anthropic-messages",
		model: { ...baseModel, id: "claude-probe", api: "anthropic-messages", provider: "anthropic", baseUrl: "http://127.0.0.1:9" },
		options: { apiKey: "registry-probe" },
		expect: /network disabled|Connection error/,
	},
];

const PROBE_CONTEXT = {
	systemPrompt: "registry probe",
	messages: [{ role: "user", content: [{ type: "text", text: "ping" }], timestamp: 1 }],
};

// --- The dispatch under test: pi-ai's public stream(), no direct provider import ---
const requestedUrls: string[] = [];
const offlineFetch = (async (input: unknown): Promise<Response> => {
	const url =
		typeof input === "string" ? input : input instanceof URL ? input.href : String((input as { url?: string }).url ?? "");
	requestedUrls.push(url);
	throw new Error("verify-provider-registry-lazy: network disabled");
}) as unknown as typeof fetch;
globalThis.fetch = offlineFetch;

// The table alone must not pull a provider stream module in: that is the whole
// point of the literal-specifier loaders.
const table = (await import(TABLE_FILE)) as Record<string, unknown>;
const afterTable = loadedProviderModules();
const eagerFromTable = TARGETS.map(target => target.file).filter(file => afterTable.has(file));
record(
	"lazy-table",
	eagerFromTable.length === 0,
	eagerFromTable.length === 0 ? "importing the table loads no provider module" : `eagerly loaded by the table: ${eagerFromTable.join(", ")}`,
);
record(
	"table-entries",
	TARGETS.every(target => typeof table[target.stream] === "function"),
	TARGETS.map(target => `${target.stream}=${typeof table[target.stream]}`).join(" "),
);

// The public dispatcher may keep static imports of its own (it names the lazy
// wrappers, and some shared helpers live inside provider modules). Record what
// it loads so the route leg can tell "the dispatcher already had it" from "the
// entry this dispatch chose loaded it".
const { stream } = (await import(join(AI_ROOT, "src", "stream.ts"))) as {
	stream: (model: unknown, context: unknown, options?: unknown) => { result?: () => Promise<unknown> };
};
const dispatcherStatic = new Set(loadedProviderModules().keys());

/** Drain one dispatched stream; the provider either answers or fails on its own path. */
async function dispatch(target: Target): Promise<{ urls: string[]; outcome: string }> {
	requestedUrls.length = 0;
	const source = stream(target.model, PROBE_CONTEXT, { ...target.options, fetch: offlineFetch });
	let outcome = "resolved";
	try {
		const result = (await source.result?.()) as { stopReason?: string; errorMessage?: string } | undefined;
		outcome = `stop=${result?.stopReason ?? "none"} ${result?.errorMessage ?? ""}`.trim();
	} catch (error) {
		outcome = `threw ${error instanceof Error ? error.message : String(error)}`;
	}
	return { urls: [...requestedUrls], outcome };
}

// --- 2. Route + symbols + live, one dispatch per provider ---
for (const target of TARGETS) {
	const before = new Set(loadedProviderModules().keys());
	const observation = await dispatch(target);
	const after = loadedProviderModules();
	const added = [...after.keys()].filter(file => !before.has(file));
	// A provider the dispatcher already imported statically still has to be the
	// module this dispatch reached: its transport (or its own refusal) proves it.
	const routedProvider = added.includes(target.file) || (dispatcherStatic.has(target.file) && observation.urls.length > 0);
	record(
		`route-${target.file}`,
		routedProvider,
		routedProvider
			? `${target.api} -> ${target.file}${added.includes(target.file) ? " (first use)" : " (dispatcher static)"}`
			: `${target.api} loaded ${added.join(", ") || "nothing"} instead of ${target.file}`,
	);
	const namespace = after.has(target.file) ? providerExports(after.get(target.file)!) : {};
	record(`symbols-${target.file}`, typeof namespace[target.stream] === "function", `${target.stream}=${typeof namespace[target.stream]}`);
	const missingSymbol = /not a function/.test(observation.outcome);
	record(
		`live-${target.file}`,
		!missingSymbol && target.expect.test(observation.outcome),
		missingSymbol
			? `a missing stream export reached the wire: ${observation.outcome}`
			: `${observation.urls[0] ?? "no transport"} :: ${observation.outcome.slice(0, 120)}`,
	);
}

// --- 3. The modules the table loaded are the patched variants ---
const codexNamespace = providerExports(join(PROVIDERS_DIR, "openai-codex-responses.ts"));
record(
	"patch-openai-codex-responses.ts",
	typeof codexNamespace.buildCodexChainedRequestBody === "function" &&
		typeof codexNamespace.CodexCompactionChainLostError === "function",
	"the compaction chain exports exist only in the patched module",
);

const anthropicLoadSet = loadedProviderModules();
record(
	"patch-anthropic.ts",
	anthropicLoadSet.has("anthropic-request-audit.ts"),
	anthropicLoadSet.has("anthropic-request-audit.ts")
		? "the patched anthropic imports its request-audit module"
		: "the loaded anthropic never pulled anthropic-request-audit.ts (unpatched module)",
);

// Devin: the patched provider memoizes GetUserJwt per (apiKey, baseUrl), so two
// turns of one process share one auth exchange. The fixture answers the real
// Connect protocol of the auth and chat endpoints.
{
	const { gzipSync } = await import("node:zlib");
	const catalog = join(dirname(AI_ROOT), "pi-catalog", "src", "discovery");
	const proto = (await import(join(catalog, "devin-proto.ts"))) as Record<string, unknown>;
	const protobuf = (await import(join(catalog, "protobuf.ts"))) as Record<string, unknown>;
	const create = protobuf.create as (schema: unknown, value: object) => object;
	const toBinary = protobuf.toBinary as (schema: unknown, value: object) => Uint8Array;
	const GetUserJwtResponseSchema = proto.GetUserJwtResponseSchema;
	const GetChatMessageResponseSchema = proto.GetChatMessageResponseSchema;
	const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
	const jwt = `${base64url({ alg: "none" })}.${base64url({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
	const calls = { auth: 0, chat: 0 };
	const devinFetch = (async (input: unknown): Promise<Response> => {
		const url = String(input);
		if (url.endsWith("/exa.auth_pb.AuthService/GetUserJwt")) {
			calls.auth++;
			return new Response(toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: jwt })) as never);
		}
		calls.chat++;
		const frames = [
			{ messageId: "registry-probe", requestId: "r1", latency: 0.05 },
			{ deltaText: "OK", deltaTokens: 1, latency: 0.1 },
		];
		const parts: Buffer[] = [];
		for (const frame of frames) {
			const payload = gzipSync(
				Buffer.from(toBinary(GetChatMessageResponseSchema, create(GetChatMessageResponseSchema, frame)) as Uint8Array),
			);
			const head = Buffer.alloc(5);
			head[0] = 0x01;
			head.writeUInt32BE(payload.length, 1);
			parts.push(head, payload);
		}
		const trailer = Buffer.from("{}");
		const tail = Buffer.alloc(5);
		tail[0] = 0x02;
		tail.writeUInt32BE(trailer.length, 1);
		parts.push(tail, trailer);
		return new Response(Buffer.concat(parts) as never);
	}) as unknown as typeof fetch;
	const devin = TARGETS[0]!;
	for (let turn = 0; turn < 2; turn++) {
		const source = stream(devin.model, PROBE_CONTEXT, { apiKey: devin.options.apiKey, fetch: devinFetch });
		await source.result?.().catch(() => undefined);
	}
	record(
		"patch-devin.ts",
		calls.auth === 1 && calls.chat === 2,
		`two dispatched turns -> ${calls.auth} GetUserJwt, ${calls.chat} GetChatMessage (the patched provider memoizes the JWT)`,
	);
}

// Gemini-cli: the patched module derives the Antigravity session identity from
// `options.sessionId`, not from the first user text, so distinct transcripts
// pinned to one session keep one signed session id.
{
	const gemini = providerExports(join(PROVIDERS_DIR, "google-gemini-cli.ts"));
	type BuildRequest = (
		model: unknown,
		context: unknown,
		project: string,
		options: object,
		antigravity: boolean,
	) => { request: Record<string, unknown> };
	const buildRequest = gemini.buildRequest as BuildRequest | undefined;
	const geminiModel = {
		id: "gemini-3.7-flash",
		identity: { class: "gemini" },
		compat: {},
		provider: "google-antigravity",
		api: "google-gemini-cli",
		input: ["text"],
	};
	const contextOf = (text: string) => ({
		systemPrompt: "registry probe",
		messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }],
	});
	const first = buildRequest?.(geminiModel, contextOf("alpha"), "registry-probe", { sessionId: "sess-registry" }, true);
	const second = buildRequest?.(geminiModel, contextOf("beta"), "registry-probe", { sessionId: "sess-registry" }, true);
	const other = buildRequest?.(geminiModel, contextOf("alpha"), "registry-probe", { sessionId: "sess-other" }, true);
	const keyed = first?.request.sessionId === second?.request.sessionId && first?.request.sessionId !== other?.request.sessionId;
	record(
		"patch-google-gemini-cli.ts",
		typeof buildRequest === "function" && keyed,
		typeof buildRequest === "function"
			? `sessionId keyed on options.sessionId=${keyed}`
			: "the loaded module does not export buildRequest",
	);
}

// --- 4. The dispatcher rejects an unroutable API instead of falling through ---
{
	let rejected = false;
	let detail = "no error";
	try {
		stream({ ...TARGETS[1]!.model, api: "no-such-api" }, PROBE_CONTEXT, { apiKey: "x" });
	} catch (error) {
		rejected = true;
		detail = error instanceof Error ? error.message : String(error);
	}
	record("dispatch-unknown-api", rejected, detail.slice(0, 120));
}

// --- 5. Fault controls: each mutation must turn exactly one claim red ---
interface FaultControl {
	name: string;
	/** Assertion id the child run must report as FAIL. */
	expect: string;
	apply(copy: string): void;
}

const FAULTS: FaultControl[] = [
	{
		name: "table entry points at another provider module",
		expect: "route-devin.ts",
		apply(copy) {
			const tablePath = join(copy, "src", "providers", "register-builtins.ts");
			const source = readFileSync(tablePath, "utf8");
			const loader = '() => import("./devin"),';
			assert.ok(source.includes(loader), "fault fixture: the devin loader must exist in the selected table");
			writeFileSync(tablePath, source.replace(loader, '() => import("./openai-completions"),'));
		},
	},
	{
		name: "patched stream symbol renamed (missing pick)",
		expect: "live-devin.ts",
		apply(copy) {
			const providerPath = join(copy, "src", "providers", "devin.ts");
			const source = readFileSync(providerPath, "utf8");
			const declaration = 'export const streamDevin: StreamFunction<"devin-agent"> = (';
			assert.ok(source.includes(declaration), "fault fixture: the devin stream export must exist in the selected tree");
			writeFileSync(providerPath, source.replace(declaration, 'export const streamDevinMoved: StreamFunction<"devin-agent"> = ('));
		},
	},
	{
		name: "provider module loaded eagerly instead of on first use",
		expect: "lazy-table",
		apply(copy) {
			const tablePath = join(copy, "src", "providers", "register-builtins.ts");
			const source = readFileSync(tablePath, "utf8");
			const loader = '() => import("./devin"),';
			assert.ok(source.includes(loader), "fault fixture: the devin loader must exist in the selected table");
			writeFileSync(
				tablePath,
				`import * as eagerDevinProbe from "./devin";\n${source.replace(loader, "() => Promise.resolve(eagerDevinProbe),")}`,
			);
		},
	},
];

/** Throwaway runtime whose pi-ai is a private copy; sibling packages shared by symlink. */
function copyRuntime(dir: string): string {
	const scope = join(dir, "node_modules", "@oh-my-pi");
	mkdirSync(scope, { recursive: true });
	for (const entry of readdirSync(dirname(NM))) {
		if (entry !== "@oh-my-pi") symlinkSync(join(dirname(NM), entry), join(dir, "node_modules", entry));
	}
	for (const entry of readdirSync(dirname(AI_ROOT))) {
		if (entry !== "pi-ai") symlinkSync(join(dirname(AI_ROOT), entry), join(scope, entry));
	}
	const copied = Bun.spawnSync(["cp", "-a", "--reflink=auto", AI_ROOT, join(scope, "pi-ai")]);
	assert.equal(copied.exitCode, 0, `cannot copy pi-ai for a fault control: ${copied.stderr.toString()}`);
	return join(scope, "pi-ai");
}

if (process.env.OMP_REGISTRY_FAULT_CHILD !== "1") {
	for (const fault of FAULTS) {
		const dir = mkdtempSync(join(tmpdir(), "omp-registry-fault-"));
		try {
			const copy = copyRuntime(dir);
			fault.apply(copy);
			const child = Bun.spawnSync([process.execPath, import.meta.path], {
				env: {
					...process.env,
					OMP_REGISTRY_FAULT_CHILD: "1",
					OMP_PATCH_VERIFY_AI_ROOT: copy,
					OMP_PATCH_VERIFY_NM: join(dir, "node_modules", "@oh-my-pi"),
				},
			});
			const output = `${child.stdout.toString()}${child.stderr.toString()}`;
			const rejected = child.exitCode !== 0 && output.includes(`FAIL ${fault.expect}`);
			record(
				`fault:${fault.expect}`,
				rejected,
				rejected
					? `rejected the mutated copy (exit ${child.exitCode})`
					: `the mutated copy survived: exit ${child.exitCode} ${output.slice(-400)}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

const failures = checks.filter(check => !check.ok);
console.log(
	`${failures.length === 0 ? "PASS" : "FAIL"} verify-provider-registry-lazy: ` +
		`${checks.length - failures.length}/${checks.length} claims hold` +
		(failures.length === 0 ? "" : ` (${failures.map(check => check.id).join(", ")})`),
);
process.exit(failures.length === 0 ? 0 : 1);
