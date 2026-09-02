# Resume 後 read tool description 漂移 → 首輪 prompt cache miss

**日期**: 2026-09-02
**狀態**: 已修補，待新進程行為驗收
**影響**: 每次 resume 首輪 cache miss 一次（若該 tools 前綴冷）；temporary model 切換後 resume 必觸發

---

## 一句話結論

在 provider、帳號、model namespace、TTL 與會話內容均未變的前提下，恢復 target model 的兩條路徑都沒有刷新 cached `read.description`——行程內是 `AgentSession.switchSession()`；新進程則是 `createAgentSession()` 在 tools 建立後才 reclaim extension-backed temporary model（`src/sdk.ts` 晚期 session-model reclaim）——讓 resume 進程沿用建構期 hashline 長版；與舊進程的 sloppy 短版相比造成 tools 序列化 hash 改變，進而引發一次不必要的冷前綴 miss。

## 證據鏈

### 1. 現象

- 老進程（新建 session, pid 1929658）：read tool description = **2237 字**（sloppy 短版），全程 cache hit
- resume 進程（pid 1937119 / 1946082）：read tool description = **2372 字**（hashline 長版），首輪 `TOOLS_DRIFT 74234e98afe7 -> 642844711386`，cacheRead 從 118528 驟降 2432（miss）
- 第二次 resume（1946082）：642 前綴已暖 → 首輪直接 hit（cacheRead=118528, 99.3%）

### 2. 實際 diff（payload 直接證據）

read description 第 15 行：

```
BEFORE (老進程, 2237字):  "-"
AFTER  (resume進程, 2372字): "- File + selector → `[foo.ts#1A2B]` snapshot header + numbered lines. Copy `[FILENAME#TAG]` for anchored edits; NEVER fabricate the tag."
```

模板（`src/prompts/tools/read.md`）：

```
- {{#if IS_HL_MODE}}File + selector → ...{{/if}}
```

`IS_HL_MODE = (resolveEditMode(session) === "hashline")`。其餘 13 個工具、參數 schema、名稱全部一字不差。

### 3. 根因鏈

```
read.ts constructor → #renderDescription()
  → resolveFileDisplayMode(session).hashLines
    → resolveEditMode(session)
      → getActiveModelString() = formatModelString(agent.state.model)
      → modelSupportsHashlineEdits(modelId):
          classifyModel → deepseek/flash → false（不支持 hashline → sloppy）
          classifyModel → qwen → true（支持 hashline）
```

**老進程（新建）**：
1. 構造時 model = `hyper/qwen3.8-flash`（default role）→ qwen → hashline → 長版 (2372)
2. 13:07:07 切到 `commandcode/deepseek/deepseek-v4-flash-vision-exp`（role=temporary）→ `syncAfterModelChange` 偵測 editMode 從 hashline 變 sloppy → `refreshDescription()` → 短版 (2237)

**resume 進程（兩條路徑）**：
1. `getRestorableSessionModels(models, lastModelChangeRole)` 會從 session 的 `models.temporary` 取出 temporary model；實測結果為 `[temporary, default]`，因此 temporary model 持久化與恢復順序不是根因。
2. 行程內 `switchSession()` 恢復 target model 時直接走 `agent.setModel()` 或 provider reset 路徑，不經使用者 `/model` 對應的 `SessionTools.syncAfterModelChange()`。
3. 新進程 `createAgentSession()` 則是在 tools 建立之後才 reclaim extension-backed temporary model（`src/sdk.ts` 晚期 session-model reclaim，`model = restoredModel`），同樣不經該同步路徑。
4. resume 後 active model 已是 deepseek/sloppy，但既有 cached `read.description` 因此仍是建構期 hashline 長版 (2372)；這個 tools bytes 漂移使首輪對原本 74234e98afe7 前綴 miss，並建立 642844711386 新前綴。

### 4. 關鍵源碼位置

| 檔案 | 行 | 內容 |
|---|---|---|
| `src/session/session-context.ts` | 91-108 | `getRestorableSessionModels`：temporary model 會優先列為恢復候選，不是本次根因 |
| `src/session/agent-session.ts` | 8598 | `switchSession` 用 `getRestorableSessionModels` 恢復 model |
| `src/session/session-tools.ts` | 651-660 | `syncAfterModelChange`：僅 `editModeChanged` 時 refresh read description |
| `src/tools/read.ts` | 646, 654-666 | constructor 立即渲染 description；`refreshDescription` 需外部觸發 |
| `src/utils/edit-mode.ts` | 33-60 | `modelSupportsHashlineEdits`：deepseek/flash → false |
| `src/sdk.ts` | 2230-2266 | extension provider 註冊後晚期 reclaim session model；原本只更新 `model`，未重繪已建立的 read description |

## 修復方案

### 已選：兩條恢復路徑成功後各刷新既有 read description 一次

1. 行程內：`AgentSession.switchSession()` 成功恢復 target model、完成 session state 重建後，透過既有 `SessionTools.getToolByName("read")` 取得 `ReadTool`，呼叫 0019 已提供的 `refreshDescription()` 一次。
2. 新進程：`src/sdk.ts` 晚期 session-model reclaim 成功時，在 `model = restoredModel` 之後從既有 `toolRegistry.get("read")` 取得工具，選擇性呼叫 `refreshDescription()`；此時 `toolSession.getActiveModel()` 已讀到更新後的 `model`。

- **不改動**：`getRestorableSessionModels()`、temporary/default/ephemeral 語義、`syncAfterModelChange()` 的既有切模路徑、恢復順序與生命週期，以及其他 model-dependent reconcile。
- **原因**：不呼叫完整 `syncAfterModelChange()`，避免重跑整套同步；只修復本次實際漂移的 cached read description。

## 驗證方法

1. 零 provider 回歸（行程內）：hashline model 建構 session → `switchSession()` 恢復 temporary sloppy model。
2. 新進程原始重現：resume 前 `read.description`=2237、resume 後=2372；14 個 tools 中僅 read description 不同，parameters 相同。修補後驗收目標是新進程恢復為 2237，與 resume 前的 fresh sloppy `ReadTool` 一致。
3. 敏感性驗證：已有 0019、未套新補丁的 0019-only 樹必須失敗；套用新補丁後，行程內 resume 的 `read.description` 必須逐字等於 fresh sloppy `ReadTool`；新進程路徑另以重新啟動後的實際 payload 驗收。
4. 在 namespace、TTL、provider、帳號與 model 均不變時，首輪 resume 不得再因 `read.description` 自行建立新 tools 前綴；其他設計上必然失效的 cache 情況不納入本修復判定。

