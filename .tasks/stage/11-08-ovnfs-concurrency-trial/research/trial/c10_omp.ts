/**
 * C10: omp 18.18.0 isolated parallel subagents on ovnfs checkouts.
 *
 * One throwaway SDK session with a scripted offline model and in-memory settings
 * (task.isolation.enabled, isolation.backend=auto, ovnfs.path = a wrapper pinned
 * to the private daemon). run_all.py starts it with HOME inside the scratch dir,
 * so omp's isolation dirs and config lookups never touch the user's.
 *
 * The parent calls `task` once with N isolated workers, then `wait`s. Each worker
 * writes c10/w<i>.txt and edits one more file:
 *   mode "shared":   line 5+8i of shared.txt (same file, lines far apart)
 *   mode "disjoint": own/o<i>.txt (a file of its own)
 * then blocks until all N wrote, when the test process inspects every open
 * checkout and the source repo, and finally yields.
 *
 * env: C10_RUNTIME (…/node_modules/@oh-my-pi), C10_REPO (git repo, the session cwd),
 * C10_OVNFS (wrapper), C10_N, C10_MODE, C10_OUT (result json), C10_MOUNT (private mount).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const RT = process.env.C10_RUNTIME!;
const REPO = process.env.C10_REPO!;
const OVNFS = process.env.C10_OVNFS!;
const N = Number(process.env.C10_N ?? "4");
const MODE = process.env.C10_MODE === "disjoint" ? "disjoint" : "shared";
const OUT = process.env.C10_OUT!;
const MOUNT = process.env.C10_MOUNT!;
const AGENT = `${RT}/pi-coding-agent`;
const AI = `${RT}/pi-ai`;

// The omp release root is chosen at run time (C10_RUNTIME); the installed release is not a dependency of this repo.
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT}/src/config/model-registry.ts`);
const { SessionManager } = await import(`${AGENT}/src/session/session-manager.ts`);
const { createMockModel } = await import(`${AI}/src/providers/mock.ts`);

type Msg = { role: string; content: unknown };
type Ctx = { messages: Msg[]; tools?: Array<{ name: string }> };
type Checkout = { name: string; path: string; source: string };

const log: string[] = [];

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map(c => (typeof c === "string" ? c : typeof c?.text === "string" ? c.text : JSON.stringify(c)))
			.join("\n");
	return JSON.stringify(content ?? "");
}

function ovnfsLs(): Checkout[] {
	const r = Bun.spawnSync([OVNFS, "--json", "ls"]);
	return (JSON.parse(r.stdout.toString()).checkouts ?? []) as Checkout[];
}

const sharedLines = fs.readFileSync(path.join(REPO, "shared.txt"), "utf8").split("\n");
// 0-based line worker i rewrites in shared mode: 8 apart, beyond git apply's 3 context lines.
const workerLine = (i: number) => 5 + i * 8;
const marker = (i: number) => `edited by worker ${i}`;

function secondWrite(i: number): { path: string; content: string } {
	if (MODE === "disjoint") return { path: `own/o${i}.txt`, content: `${marker(i)}\n` };
	const lines = [...sharedLines];
	lines[workerLine(i)] = marker(i);
	return { path: "shared.txt", content: lines.join("\n") };
}

// Barrier: every worker has written before the isolation check runs.
let written = 0;
const allWritten = Promise.withResolvers<void>();
let during: Record<string, unknown> | undefined;

function inspectDuring(): Record<string, unknown> {
	const per: Record<string, unknown> = {};
	for (const co of ovnfsLs()) {
		const c10 = path.join(co.path, "c10");
		const editedFiles = MODE === "disjoint" ? fs.readdirSync(path.join(co.path, "own")).map(f => `own/${f}`) : ["shared.txt"];
		const edits = editedFiles.flatMap(f =>
			fs
				.readFileSync(path.join(co.path, f), "utf8")
				.split("\n")
				.filter(l => l.startsWith("edited by worker")),
		);
		per[co.name] = {
			path: co.path,
			underPrivateMount: co.path.startsWith(`${MOUNT}/`),
			source: co.source,
			c10: fs.existsSync(c10) ? fs.readdirSync(c10).sort() : [],
			edits,
			diff: Bun.spawnSync([OVNFS, "diff", co.name, "-p"]).stdout.toString(),
		};
	}
	return {
		openCheckouts: Object.keys(per).length,
		checkouts: per,
		sourceHasC10: fs.existsSync(path.join(REPO, "c10")),
		sourceEdited: Bun.spawnSync(["git", "-C", REPO, "status", "--porcelain"]).stdout.toString(),
	};
}

async function worker(i: number, ctx: Ctx) {
	const turns = ctx.messages.filter(m => m.role === "assistant").length;
	if (turns === 0) {
		return {
			content: [
				{ type: "toolCall", name: "write", arguments: { path: `c10/w${i}.txt`, content: `worker ${i}\n` } },
				{ type: "toolCall", name: "write", arguments: secondWrite(i) },
			],
		};
	}
	if (turns === 1) {
		written++;
		if (written === N) allWritten.resolve();
		// Bounded: if omp ran fewer than N at once, the check sees only those open.
		await Promise.race([allWritten.promise, Bun.sleep(30_000)]);
		during ??= inspectDuring();
		return { content: [{ type: "toolCall", name: "yield", arguments: { result: { data: `worker ${i} done` } } }] };
	}
	return { content: [`worker ${i} done`] };
}

const waitResults: string[] = [];
function parent(ctx: Ctx) {
	const turns = ctx.messages.filter(m => m.role === "assistant").length;
	if (turns === 0) {
		const tasks = Array.from({ length: N }, (_, i) => ({
			name: `C10Worker${i}`,
			agent: "task",
			task: `C10-WORKER-${i}: write c10/w${i}.txt and edit ${secondWrite(i).path}`,
			solutionSpace: "one fix: given",
			isolated: true,
		}));
		return {
			content: [{ type: "toolCall", name: "task", arguments: { i: "Spawning C10 workers", context: "C10 trial", tasks } }],
		};
	}
	// Workers run as background jobs: wait until `wait` reports nothing left.
	const lastResult = textOf(ctx.messages.at(-1)?.content);
	waitResults.push(lastResult);
	if (turns <= N + 2 && !/^Nothing to wait for/.test(lastResult)) {
		return { content: [{ type: "toolCall", name: "wait", arguments: { i: "Waiting for C10 workers" } }] };
	}
	return { content: ["parent done"] };
}

const mock = createMockModel({
	id: "scripted",
	provider: "c10",
	handler: async (ctx: Ctx) => {
		const texts = ctx.messages.map(m => textOf(m.content));
		if (texts.some(t => t.includes("C10-PARENT"))) return parent(ctx);
		const m = texts.map(t => /C10-WORKER-(\d+)/.exec(t)).find(Boolean);
		if (!m) {
			log.push(`unrouted call: ${texts.join(" | ").slice(0, 300)}`);
			return { content: ["unrouted"] };
		}
		return worker(Number(m[1]), ctx);
	},
});

const agentDir = path.join(path.dirname(OUT), "agent");
fs.mkdirSync(agentDir, { recursive: true });
const settings = await Settings.loadIsolated({
	cwd: REPO,
	agentDir,
	overrides: {
		"task.isolation.enabled": true,
		"isolation.backend": "auto",
		"ovnfs.path": OVNFS,
		"memory.backend": "off",
		// Subagents resolve their model by role; every role points at the scripted offline model.
		modelRoles: { default: "c10/scripted", task: "c10/scripted", smol: "c10/scripted", slow: "c10/scripted" },
	},
});
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("c10", "offline");
const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.yml"), { settings });
// No sourceId: a source-tagged provider is dropped by every createAgentSession (the parent's
// and each subagent's) as an inactive extension source.
modelRegistry.registerProvider("c10", {
	api: "c10-mock",
	baseUrl: "http://127.0.0.1:1/never",
	apiKey: "offline",
	streamSimple: (model, context, options) => mock.stream(model, context, options),
	models: [
		{
			id: "scripted",
			name: "scripted",
			input: ["text"],
			contextWindow: 200_000,
			maxTokens: 4_096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	],
});

const result: Record<string, unknown> = { n: N, mode: MODE };
const t0 = performance.now();
const { session } = await createAgentSession({
	cwd: REPO,
	agentDir,
	settings,
	authStorage,
	modelRegistry,
	model: modelRegistry.find("c10", "scripted"),
	sessionManager: SessionManager.inMemory(REPO),
	skills: [],
	rules: [],
	contextFiles: [],
	promptTemplates: [],
	slashCommands: [],
	disableExtensionDiscovery: true,
	enableMCP: false,
	enableLsp: false,
	preloadedCustomToolPaths: [],
	skipPythonPreflight: true,
});
try {
	await session.prompt("C10-PARENT: run the workers");
	result.seconds = (performance.now() - t0) / 1000;
} catch (err) {
	result.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
} finally {
	await session.dispose();
}
const finalText = waitResults.join("\n");
result.workersCompleted = (finalText.match(/status="completed"/g) ?? []).length;
result.appliedYes = (finalText.match(/Applied patches: yes/g) ?? []).length;
result.waitResults = waitResults.map(t => t.slice(0, 6000));
result.during = during ?? null;
const sourceText = (f: string) => (fs.existsSync(path.join(REPO, f)) ? fs.readFileSync(path.join(REPO, f), "utf8") : "");
const editedFiles = MODE === "disjoint" ? Array.from({ length: N }, (_, i) => `own/o${i}.txt`) : ["shared.txt"];
const finalEdits = editedFiles.flatMap(f => sourceText(f).split("\n").filter(l => l.startsWith("edited by worker")));
result.after = {
	checkoutsLeft: ovnfsLs().map(c => c.name),
	sourceC10: fs.existsSync(path.join(REPO, "c10")) ? fs.readdirSync(path.join(REPO, "c10")).sort() : [],
	editsInSource: finalEdits,
	missingEdits: Array.from({ length: N }, (_, i) => marker(i)).filter(mk => !finalEdits.includes(mk)),
	conflictMarkers: editedFiles.some(f => /^(<<<<<<<|>>>>>>>)/m.test(sourceText(f))),
	gitStatus: Bun.spawnSync(["git", "-C", REPO, "status", "--porcelain"]).stdout.toString(),
};
// Per worker: what omp reported (the `wait` block of that worker) against what the folder holds.
const after = result.after as { sourceC10: string[]; editsInSource: string[] };
result.perWorker = Array.from({ length: N }, (_, i) => {
	const block = finalText.split(/^### /m).find(b => b.startsWith(`C10Worker${i} `)) ?? "";
	const summary = /<merge-summary>([\s\S]*?)<\/merge-summary>/.exec(block)?.[1]?.trim() ?? "";
	return {
		worker: i,
		reportedApplied: summary.includes("Applied patches: yes"),
		summary: summary.slice(0, 600),
		fileInSource: after.sourceC10.includes(`w${i}.txt`),
		editInSource: after.editsInSource.includes(marker(i)),
	};
});
result.modelCalls = mock.calls.length;
result.log = log;
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
process.exit(0);
