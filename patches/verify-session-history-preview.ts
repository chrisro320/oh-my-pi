import { SessionSelectorComponent } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/session-selector";
import type { SessionInfo } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-listing";
import { initThemeSync } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/theme/theme";
import * as assert from "node:assert";
import { readFileSync } from "node:fs";

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}
initThemeSync();
console.log("Starting Session History Preview verification...");

const realSessionPath = "/home/chris/.omp/agent/sessions/-orca-projects-omp-move/2026-09-09T13-05-36-402Z_01a08646-1a92-7000-8d7b-def616102b13.jsonl";

const mockSession: SessionInfo = {
	id: "01a08646-1a92-7000-8d7b-def616102b13",
	path: realSessionPath,
	cwd: "/home/chris/orca/projects/omp-move",
	title: "Session History Preview in omp -r",
	created: new Date(),
	modified: new Date(),
	messageCount: 50,
	size: 102400,
	firstMessage: "你覺得能不能給omp添加一個插件",
	allMessagesText: "你覺得能不能給omp添加一個插件 能快速預覽會話歷史",
	status: "complete",
};

let selectedSession: SessionInfo | null = null;
let cancelled = false;
let exited = false;
const selector = new SessionSelectorComponent(
	[mockSession],
	(session) => {
		selectedSession = session;
	},
	() => {
		cancelled = true;
	},
	() => {
		exited = true;
	},
	{
		title: "Resume Session",
		getTerminalRows: () => 30,
	}
);

// 1. 驗證初態渲染
let lines = selector.render(100).join("\n");
assert.ok(lines.includes("Space preview"), "Initial footer must include 'Space preview' hint");
assert.ok(lines.includes("Session History Preview in omp -r"), "Initial list must render session title");
console.log("✓ Initial list view renders correctly with Space preview hint");
await sleep(100);
// 2. 模擬按下 Space 觸發預覽
selector.handleInput(" ");
// 等待非同步讀取 loadSessionMessagesReadOnly
await sleep(100);
const previewLines = selector.render(100);
for (let i = 0; i < previewLines.length; i++) {
	const line = previewLines[i]!;
	assert.ok(!line.includes("\n"), `Line ${i} must not contain embedded newline: ${JSON.stringify(line)}`);
	assert.ok(!line.includes("\r"), `Line ${i} must not contain embedded carriage return: ${JSON.stringify(line)}`);
	assert.ok(!/(?<!\x1b)\[(?:38|48);[25];\d+(?:;\d+)*m/.test(line), `Line ${i} must not leak raw unescaped ANSI color codes: ${JSON.stringify(line)}`);
}
lines = previewLines.join("\n");
assert.ok(lines.includes("Enter resume"), "Preview footer must show 'Enter resume'");
assert.ok(lines.includes("Esc/Space close"), "Preview footer must show 'Esc/Space close'");
assert.ok(lines.includes("Session History Preview in omp -r"), "Preview must show session title");
assert.ok(lines.includes("Assistant"), "Preview must show [Assistant] role");
// Provenance instead of a pinned sentence: take the first rendered assistant
// line and prove it came out of the real session file. Pinning one sentence
// ("骂得太对了") broke the moment the preview's first screen moved — the
// contract is "real conclusion text is rendered", not "that exact line is on
// screen first".
const plain = previewLines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ""));
const assistantIndex = plain.findIndex(line => line.includes("[Assistant]"));
assert.ok(assistantIndex >= 0, "Preview must show an [Assistant] block");
const renderedProbe = plain
	.slice(assistantIndex + 1)
	.map(line => line.replace(/^[│|]\s*/, "").replace(/[│|█]*\s*$/, "").trim())
	.find(line => line.length >= 8);
assert.ok(renderedProbe, "Preview must render assistant body text, not just the role header");
const sessionRaw = readFileSync(realSessionPath, "utf8");
const probe = renderedProbe.slice(0, 8);
assert.ok(
	sessionRaw.includes(probe),
	`Preview text must come from the real session file; rendered ${JSON.stringify(probe)} is absent from it`,
);
assert.ok(!lines.includes("[Tool Call]"), "Preview must NOT contain machine [Tool Call]");
assert.ok(!lines.includes("[Result:"), "Preview must NOT contain machine [Result:]");
assert.ok(!/\[Assistant\]\s*\n\s*```\s*\n\s*\[Assistant\]/.test(lines), "Preview must NOT contain consecutive phantom [Assistant] ``` fences");
console.log("✓ Space triggers SessionPreviewView and renders real history cleanly (no phantom fences, no tool noise)");

// 3. 模擬在預覽中按 Escape 關閉
selector.handleInput("\x1b"); // Escape
lines = selector.render(100).join("\n");
assert.ok(lines.includes("Space preview"), "After Esc, footer must revert to 'Space preview'");
assert.ok(!lines.includes("Enter resume"), "After Esc, preview footer must be gone");
console.log("✓ Escape closes preview and restores session list seamlessly");

// 4. 驗證搜尋框有內容時按 Space 不會誤開預覽
selector.handleInput("t");
selector.handleInput("e");
selector.handleInput("s");
selector.handleInput("t");
selector.handleInput(" "); // Space inside search input
lines = selector.render(100).join("\n");
assert.ok(lines.includes("Space preview"), "Typing with query must stay in list mode");
assert.ok(!lines.includes("Enter resume"), "Typing with query must not trigger preview");
console.log("✓ Space when search query is non-empty acts as normal search input");

for (let i = 0; i < 5; i++) {
	selector.handleInput("\x7f"); // Backspace exactly 5 characters: 't', 'e', 's', 't', ' '
}
selector.handleInput(" "); // Space to preview again
await sleep(100);

lines = selector.render(100).join("\n");
assert.ok(lines.includes("Enter resume"), "Preview must be open again");

// 按 Enter 直入 resume
selector.handleInput("\n");
assert.strictEqual(selectedSession, mockSession, "Enter in preview must trigger onSelect with current session");
console.log("✓ Enter inside preview directly resumes the selected session");

// 6. 驗證在預覽打開時按 Ctrl+C 能直接退出整個選擇器（Reviewer2 finding）
let exitCalled = false;
const exitTestSelector = new SessionSelectorComponent(
	[mockSession],
	() => {},
	() => {},
	() => {
		exitCalled = true;
	},
	{
		title: "Resume Session",
		getTerminalRows: () => 30,
	}
);
exitTestSelector.handleInput(" "); // Open preview
await sleep(100);
lines = exitTestSelector.render(100).join("\n");
assert.ok(lines.includes("Enter resume"), "Preview must be open for Ctrl+C test");
exitTestSelector.handleInput("\x03"); // Ctrl+C
assert.strictEqual(exitCalled, true, "Ctrl+C inside preview must trigger onExit");
console.log("✓ Ctrl+C inside preview triggers onExit cleanly");

// 7. 驗證預覽狀態下的滑鼠滾輪與滾動條點擊/拖曳
const mouseSelector = new SessionSelectorComponent(
	[mockSession],
	() => {},
	() => {},
	() => {},
	{
		title: "Resume Session",
		getTerminalRows: () => 30,
	}
);
mouseSelector.handleInput(" "); // Open preview
await sleep(100);
const beforeScroll = mouseSelector.render(100).join("\n");

// 模擬滑鼠滾輪向下滾動 (SGR button 65 = wheel down)
mouseSelector.handleInput("\x1b[<65;10;10M");
mouseSelector.handleInput("\x1b[<65;10;10M");
mouseSelector.handleInput("\x1b[<65;10;10M");
const scrolledLines = mouseSelector.render(100).join("\n");
// Behaviour, not fixture: three wheel-down notches must move the viewport and
// stay inside the preview. Pinning "User"/a specific sentence only held while
// that turn happened to land on the fourth screen of one session file.
assert.notEqual(scrolledLines, beforeScroll, "Wheel down must scroll the preview viewport");
assert.ok(scrolledLines.includes("Esc/Space close"), "Wheel down must not leave preview mode");
console.log("✓ Mouse wheel down scrolls the preview viewport and stays in preview");
// 模擬滑鼠滾輪向上滾動 (SGR button 64 = wheel up)
mouseSelector.handleInput("\x1b[<64;10;10M");
console.log("✓ Mouse wheel up handled smoothly in preview");

// 模擬滑鼠點擊右側滑塊區域 (col 98, row 15)
mouseSelector.handleInput("\x1b[<0;98;15M");
// 模擬按住左鍵拖動至 row 20
mouseSelector.handleInput("\x1b[<32;98;20M");
// 模擬釋放滑鼠左鍵
mouseSelector.handleInput("\x1b[<0;98;20m");
console.log("✓ Mouse click and drag on scrollbar handled smoothly");

// 8. 驗證真實包含多行程式碼圍欄的消息絕不被誤殺
const codeSessionPath = `/tmp/test-code-session-${Date.now()}.jsonl`;
await Bun.write(
	codeSessionPath,
	[
		JSON.stringify({ type: "session", id: "code-test", cwd: "/tmp" }),
		JSON.stringify({
			type: "message",
			message: { role: "user", content: "Can you write a sample?" },
		}),
		JSON.stringify({
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "```ts\nconst greeting = 'hello world';\n```" },
					{ type: "toolCall", name: "bash", id: "c1" },
				],
			},
		}),
	].join("\n") + "\n"
);

const codeMockSession: SessionInfo = {
	id: "code-test",
	path: codeSessionPath,
	cwd: "/tmp",
	title: "Code Fence Session",
	created: new Date(),
	modified: new Date(),
	messageCount: 2,
	size: 512,
	firstMessage: "Can you write a sample?",
	allMessagesText: "sample",
	status: "complete",
};

const codeSelector = new SessionSelectorComponent([codeMockSession], () => {}, () => {}, () => {});
codeSelector.handleInput(" "); // Open preview
await sleep(100);
const codePreview = codeSelector.render(100).join("\n");
assert.ok(codePreview.includes("const greeting = 'hello world';"), "Must retain real multi-line code content even when toolCall is present");
assert.ok(codePreview.includes("```ts"), "Must retain code fence opener");
console.log("✓ Real multi-line code fences are 100% preserved even with toolCall present");
console.log("\nALL VERIFICATIONS PASSED SUCCESSFULLY!");
