/**
 * verify-trellis-command-tool.ts — 0040 回歸鎖
 *
 * 鎖定 trellis_command 工具的不變量:
 *
 *   1. 靜態: extension 內 registerTool({ name: "trellis_command" }) 在位,
 *      且展開原語 import 自 omp 本體(parseCommandArgs/substituteArgs/
 *      appendInlineArgsFallback/templateUsesInlineArgPlaceholders/
 *      parseFrontmatter/prompt.render)——不另起一套展開語義。
 *   2. 功能: import 真實 extension 並呼叫 tool.execute:
 *      - trellis-continue → 回傳全文, frontmatter 已剝除, 含 Step 1 腳本行
 *      - 不存在的命令 → 拋錯並附可用清單
 *      - 帶 args → 正常展開(inline fallback 附加參數)
 *
 * 零 provider 調用。跑法: `bun patches/verify-trellis-command-tool.ts`
 * (自 repo 根;與既有 verify 腳本同一調用慣例)。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
// 靜態相對 import:腳本與 extension 同倉庫,路徑在撰寫時已知。
import trellisExtension from "../.omp/extensions/trellis/index.ts";

interface ToolResultContent {
	type: string;
	text: string;
}
interface ToolResult {
	content: ToolResultContent[];
	details: { command: string };
}
interface ToolDefinition {
	name: string;
	execute(
		id: string,
		params: { command: string; args?: string },
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	): Promise<ToolResult>;
}
interface ExtensionAPILike {
	zod: typeof z;
	registerTool(tool: ToolDefinition): void;
	on(event: string, handler: () => void): void;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "../.omp/extensions/trellis/index.ts"), "utf8");

// --- 1. 靜態形狀 ---
assert.match(src, /pi\.registerTool\(\{\s*\n\s*name: "trellis_command",/,
	"extension must register trellis_command tool");
for (const sym of ["parseCommandArgs", "substituteArgs"]) {
	assert.ok(
		new RegExp(`import \\{[^}]*\\b${sym}\\b[^}]*\\} from "@oh-my-pi/pi-coding-agent/utils/command-args"`).test(src),
		`${sym} must come from omp's own command-args module`,
	);
}
assert.match(src, /import \{[^}]*parseFrontmatter[^}]*\} from "@oh-my-pi\/pi-utils"/,
	"parseFrontmatter must come from pi-utils");
assert.match(src, /import \{[\s\S]*?appendInlineArgsFallback,[\s\S]*?\} from "@oh-my-pi\/pi-coding-agent\/config\/prompt-templates"/,
	"inline-args fallback must come from omp prompt-templates module");

// --- 2. 功能 ---
let def: ToolDefinition | undefined;
trellisExtension({ zod: z, registerTool: (t: ToolDefinition) => { def = t; }, on: () => {} } as unknown as ExtensionAPILike);
assert.ok(def, "factory must register a tool");
assert.equal(def!.name, "trellis_command");

const ctx = { cwd: join(HERE, "..") };
const r = await def!.execute("t1", { command: "/trellis-continue" }, undefined, undefined, ctx);
const text = r.content[0]!.text;
assert.ok(!text.startsWith("---"), "frontmatter must be stripped");
assert.match(text, /python3 \.\/\.trellis\/scripts\/get_context\.py/, "expanded body must carry Step 1");
assert.equal(r.details.command, "trellis-continue", "leading slash must normalize away");

const r2 = await def!.execute("t2", { command: "trellis-init", args: "--force" }, undefined, undefined, ctx);
assert.ok(r2.content[0]!.text.length > 0, "args path must expand");

await assert.rejects(
	() => def!.execute("t3", { command: "no-such-cmd" }, undefined, undefined, ctx),
	/Available: \/trellis-/,
	"missing command must throw with available list",
);

for (const name of ["trellis-finish-work", "trellis-paused-work"]) {
	const rn = await def!.execute(`t-${name}`, { command: name }, undefined, undefined, ctx);
	assert.ok(rn.content[0]!.text.length > 100, `${name} expands`);
}

console.log("PASS: 0040 trellis_command static + functional locks");
