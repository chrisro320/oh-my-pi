# OMP 宿主事件契約報告（現行 18.1.5 實測）

日期：2026-09-03｜實測：`omp/18.1.5`，`/home/chris/.bun/install/global/node_modules/@oh-my-pi/` 全套同版

## 管線順序（鐵證）

`pi-agent-core/src/agent-loop.ts:1594-1623`：`context` 事件先改 `AgentMessage` → `convertToLlm` 做投影 → 宿主內建 `transformProviderContext` → 最後 `onPayload`。前者會被再加工，後者改什麼發什麼。

- `context` 走 `ExtensionRunner.emitContext`（`runner.ts:1621-1663`），序列鏈式，最後一個贏。30 秒逾時，錯了記錯後繼續。
- `HookRunner` 全源碼無任何 `new HookRunner`，是沒接線的舊碼。現行 hook 檔一律經 `extensions/loader.ts:613-693` 綁成 extension。
- `onPayload` 契約在 `pi-ai/src/types.ts:529`：回非 `undefined` 即整體替換。

## `onPayload` 生效矩陣（18.1.5 逐檔驗證）

- 生效：`anthropic`（`anthropic.ts:2204-2208`，最終話語權）、`openai-responses`（`:514-518`）、`openai-completions`（`:768-771`）、`openai-codex-responses`、`azure-openai-responses`、`google` 全家、`ollama`、`amazon-bedrock`（`:395-397`）、`cursor`（`:5421-5432`）、`kimi` 墊片、`gitlab-duo`。
- 不發：`devin` 無 `onPayload`（文件級缺口，#8717 明言不修）；`gitlab-duo-workflow` 沒讀到發射點。

## 與舊結論不一致處（明確列出）

1. `bedrock`、`cursor`、`completions` 丟改寫在 17.3.8 成立，上游 PR #8717（2026-08-19 合併）已修，18.1.5 三處皆等候加替換。舊結論作廢。
2. `cursor` 的 `customSystemPrompt` 順序同批修成 hook 之前，註釋明言 replacement 是最終話語權。
3. `HookRunner` 路徑已死，現行只有 extension runner。
4. 版本以 18.1.5 為準，不沿用 17.3.8。
5. `ACP_AUTO_UPDATE` 在 18.1.5 全部宿主源碼零匹配，那是外掛自己的開關。宿主唯一更新是 marketplace 外掛排程（`main.ts:1813-1817`，預設通知）。

## `convertToLlm` 投影（`context` 改寫會經過）

- 自訂訊息轉 `developer`；分支與壓縮摘要轉 `user` 加改寫標記；助理中斷 thinking 降級；空訊息丟棄。
- `pi-ai` 再做：畸形呼叫清理、簽章信任、跨 API thinking 轉文字、孤兒工具結果改寫為 `<stale-tool-result>` 用戶訊息、截斷 thinking 丟棄（`transform-messages.ts`）。

## 生命週期順序（`agent-session.ts:8559-8703`）

resume：先掛 transcript → 發 `session_switch reason:resume`（此時記憶體仍是舊的）→ `replaceMessages` → model 還原在最後。所以 switch、branch 都要重做一次（舊 #103 的根因）。

- `session_start` 在 `runtime-init.ts:147-148`；`session_shutdown` 走平行、2 秒上限、無結果回收。

## 壓縮與設定語義

- `compaction.enabled` 是自動壓縮總閘（預設開），另有多個同級欄位；`/compact` 的模式覆蓋優先於設定。
- `Settings.override()` 是不持久化的最高優先級運行層，只影響當進行程。

## 未讀到

- `resolveMethodSettings` 定義本體、`bedrock-mantle` 最終串流連接點逐行、`gitlab-duo-workflow` 僅 grep 確認、`dist/cli.js` 全文（以源碼為準）。
