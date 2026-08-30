/**
 * verify-goal-tool-resident.ts — 0032 靜態回歸鎖
 *
 * 鎖定「goal 工具常駐」的三個不變量(0032 之前是 inject-on-interview /
 * recycle-on-exit 週期,每個 goal 生命週期邊界都翻轉工具簽名,強制 system
 * rebuild → 全量重算;實測案例 01a051c8 176k token):
 *
 *   1. sdk.ts 初始 active 組裝在 goalResident 條件下不剔除/不隱藏 goal。
 *   2. tools/index.ts isToolAllowed 的 goal 分支常駐放行(不吃 goalState)。
 *   3. interactive-mode.ts 三處 previous-tools 快照一律攜帶 goal——
 *      舊的 `.filter(name => name !== "goal")` 必須滅絕,否則 #exitGoalMode
 *      恢復快照時會把常駐工具剝掉(2026-08-30 review 補洞:手動停用過
 *      goal 或 goal.enabled 剛開啟時,enabledTools 本身不含 goal,快照
 *      必須統一補上)。
 *
 * 靜態形狀鎖定與 0021 的 verify 模式一致;零 provider 調用。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const AGENT = process.env.OMP_AGENT_SRC ?? `${process.env.HOME}/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`;
const read = (rel: string) => readFileSync(`${AGENT}/src/${rel}`, "utf8");

// --- 1. sdk.ts:初始 active 組裝尊重 goalResident ---
const sdk = read("sdk.ts");
assert.match(sdk, /const goalResident = !restrictToolNames && settings\.get\("goal\.enabled"\) === true;/,
	"sdk.ts must define goalResident from goal.enabled");
assert.match(sdk, /if \(name === "goal" && goalResident\) return false;/,
	"sdk.ts must not collect goal into defaultInactiveToolNames while resident");
assert.match(sdk, /name !== "goal" \|\| goalResident/,
	"sdk.ts must keep goal in requestedActiveToolNames while resident");
// 舊的無條件剔除不得復活
assert.doesNotMatch(sdk, /filter\(name => name !== "goal"\);/,
	"sdk.ts unconditional goal exclusion must stay removed");

// --- 2. tools/index.ts:isToolAllowed 常駐放行 ---
const tools = read("tools/index.ts");
assert.match(tools, /if \(name === "goal"\) \{\s*\n\s*return goalEnabled && !restrictToolNames;\s*\n\s*\}/,
	"isToolAllowed goal branch must be the unconditional resident form");
assert.doesNotMatch(tools, /const goalState = session\.getGoalModeState\?\(\);\s*\n\s*return goalState === undefined/,
	"isToolAllowed must not gate goal on goalState (paused/dropped must stay visible)");

// --- 3. interactive-mode.ts:三處快照一律攜帶 goal ---
const im = read("modes/interactive-mode.ts");
// 舊 filter 語義必須滅絕(0032 之前的三處:.filter(name => name !== "goal"))
assert.equal((im.match(/\.filter\(name => name !== "goal"\)/g) ?? []).length, 0,
	"previous-tools snapshots must never strip goal again (0032)");
// 每一處 #goalModePreviousTools 賦值都必須是「含 goal 的統一快照」形狀
const snapshots = (im.match(/#goalModePreviousTools = (?!undefined)[^;]+;/g) ?? []);
assert.equal(snapshots.length, 3, `expected 3 snapshot assignments, got ${snapshots.length}`);
for (const [i, a] of snapshots.entries()) {
	assert.match(a, /includes\("goal"\)/, `snapshot #${i + 1} must normalize goal into the snapshot: ${a}`);
}
// thread-resume 路徑必須保留「補回 goal」的 active-set 動作(否則 resume 後 agent 失去 goal 工具)
assert.match(im, /setActiveToolsByName\(\[\.\.\.new Set\(\[\.\.\.previousTools, "goal"\]\)\]/,
	"thread-resume must re-add goal to the active set");

console.log("verify-goal-tool-resident: all 0032 invariants hold");
