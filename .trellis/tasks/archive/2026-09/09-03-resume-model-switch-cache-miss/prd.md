# PRD：修復 switch model 後首次 resume 的 prompt cache miss

## 目標（唯一成功標準）

**已有請求的會話，熱切（hot-switch）模型之後，首次 resume 不得 miss。**

判定的物理條件：resume 後送出的首批 bytes，必須與熱切時已寫入快取的 bytes **完全一致**。
prompt cache 是 byte-exact 前綴匹配，前綴任何一處變動都導致整段作廢。

### 明確不是目標

- 不是「讓某個欄位的值變正確」。欄位正確只是手段，不是結果。
- 不是「熱切當下不 miss」。換模型本來就該換工具組，本來就該重建快取——這是預期行為。
- 不是逐欄位打補丁。只補 `read` 描述而 system prompt 宣告仍不同，前綴照樣從 index 0 斷，miss 依舊。

## 問題描述

已在跑的會話中熱切模型，工具組與 system prompt 會按新模型重組（正確）。
但下一次 resume（新進程）重建出的前綴與熱切時不同 → 前綴不匹配 → 全量重算。

## 已證實的證據（payload 級，勿推翻重猜）

實測 session `01a06638-353f-7000-a274-8ea51d704146`，
`~/.omp/agent/payloads/01a06638-353f-7000-a274-8ea51d704146/`：

| 檔案 | 時機 | tools sha | read 描述 | system[0] |
|---|---|---|---|---|
| `1788421395741-2351128-0005-main-meta_muse-spark-1.3-contributor.json` | 熱切後 | `f3df759c02c8` | 2388 | **含** `inspect_image` 宣告 |
| `1788421445229-2352150-0001-main-meta_muse-spark-1.3-contributor.json` | resume 後 | `9bb34103b75c` | 2372 | **不含** |

全欄位 diff 結論：`model` / `max_tokens` / `stream` / `stream_options` 全部相同，
`messages` 7→15 是正常成長。**唯一內容差異**是 `inspect_image` 開關的兩面：

```diff
# tools 內 read 描述
- Images → metadata; call `inspect_image`.      # 熱切後 2388
+ Images → decoded inline.                      # resume 後 2372

# system[0]
- xd://inspect_image — Describe or analyze an image file
-
- Image tasks: prefer `inspect_image` to `read` (spares context).
```

兩處同由 `isInspectImageToolActive()`（`utils/inspect-image-mode.ts:33-39`）決定，
修一處即兩處同時對齊。

### 已證偽（先前假說，全部推翻）

| 假說 | 推翻證據 |
|---|---|
| model metadata 未就緒 | 兩進程 `input` 皆為 `["text"]`，一致 |
| `inspect_image` 註冊狀態漂移 | 全程 `hasInspectImage: false` |
| `freezeImplicitPromptRefresh` 守衛 | `prefixBinding` 全程 undefined，守衛第四條件不成立 |
| 熱切時沒重組 | 熱切後即變 2388，重組有發生 |
| 「resume 後 2372 是錯的、2388 才對」 | 反了。muse-spark 原生多模態，2372 才對；2388 是錯的 |
| 「muse-spark 不在 model_cache 快取」 | 錯。kilo / nanogpt / zenmux 都有，且 `input` 皆 `["text","image"]`；先前只是沒納入篩選 |
| 「只有 `read` 會漂」 | 就現有 66 組 (model,tool) 樣本是，但那是因為樣本沒切到 hashline / code-mode 邊界，不代表不存在 |

## 真根因（已定案，勿退回舊結論）

**不是 omp 的 bug，是 commandcode provider fork 的 model catalog 漏登記。**

fork 的 `models.ts:34-36` 查不到就退回純文字：

```js
export function inputModalitiesForModel(modelId: string): readonly CommandCodeInputType[] {
  return MODEL_INPUT_MODALITIES[modelId] ?? TEXT_INPUT_ONLY   // TEXT_INPUT_ONLY = ["text"]
}
```

commandcode 實際提供 5 個 muse-spark，catalog 只登記 3 個：

| commandcode 有 | catalog 有登記 |
|---|---|
| muse-spark-1.1 | ✅ `["text","image"]` |
| muse-spark-1.2 | ✅ `["text","image"]` |
| muse-spark-1.2-contributor | ✅ `["text","image"]` |
| **muse-spark-1.3** | ❌ 漏 → 落 `["text"]` |
| **muse-spark-1.3-contributor** | ❌ 漏 → 落 `["text"]` |

漏登記的兩個被誤判成「不能看圖」→ `isInspectImageToolActive()` 回 true →
熱切時給 2388（帶 `inspect_image`）、開機時給 2372 → 前綴不一致 → miss。

旁證：同一 model 在 kilo / nanogpt / zenmux 的 `input` 都是 `["text","image"]`，
只有 commandcode fork 是 `["text"]`。詳見「已證偽」最後一列。

### 已廢棄的舊根因（保留僅為避免重蹈）

先前歸因於 `sdk.ts:2254-2257` 的 `refreshDescription()`、以及「0042 漏第三條路徑」。
這些是**現象描述而非根因**：該處確實只重渲染描述字串、且位於 `sessionRetryLimit > 0`
守衛內（restore 一次成功時整段跳過），但即使補它，也只是讓兩個進程都維持同一個錯的值。
真正的錯在 metadata 源頭。

## 修法

改 canonical repo `vendor/pi-commandcode-provider`（submodule），三張表各補 2 行：

| 檔案 | 表 |
|---|---|
| `src/commandcode-catalog.ts` | `MODEL_INPUT_MODALITIES` |
| `src/commandcode-catalog.ts` | `MODEL_REASONING` |
| `src/commandcode-catalog-overrides.ts` | `MODEL_EFFORT_OVERRIDES` |

未改 `~/.omp/plugins/node_modules/pi-commandcode-provider`（它是指向 repo 的 symlink，
改 repo 即生效，但須走 repo 以保留 git 可審計性）。
未動 `patches/` 與 `apply.sh`。

## 驗證實錄

### 三張表全驗（非只驗多模態）

載入改後原始碼，直接讀 fork 的三張表：

```
id                                 reasoning efforts
meta/muse-spark-1.2-contributor    true      minimal,low,medium,high,xhigh
meta/muse-spark-1.3                true      minimal,low,medium,high,xhigh   ← 原缺
meta/muse-spark-1.3-contributor    true      minimal,low,medium,high,xhigh   ← 原缺
deepseek/deepseek-v4-flash         true      (none)                          ← 對照組未誤傷
```

```
meta/muse-spark-1.2-contributor    input=["text","image"]  supportsImage=true
meta/muse-spark-1.3                input=["text","image"]  supportsImage=true   ← 原 false
meta/muse-spark-1.3-contributor    input=["text","image"]  supportsImage=true   ← 原 false
deepseek/deepseek-v4-flash         input=["text"]          supportsImage=false  ← 對照組未誤傷
```

`bun build` 兩個檔案均通過。

### 端到端

chris 實測確認修復（2026-09-03）。

## 驗收條件

以實測判定，不看程式碼推論：

1. 重做「qwen 打一輪 → 熱切 muse-spark 打一輪 → resume」。
2. resume 後首筆主模型請求在 `~/.omp/agent/cache-prefix-audit.log` 中：
   - verdict 為 hit（非 `MISS CAUSED BY TOOLS_DRIFT`）
   - `usage.cacheRead` 顯著大於 0
3. 對照 payload：resume 後的 tools sha 與熱切時**相同**。
4. 不得破壞 prefix-bound thinking 歷史（本次 muse-spark 無 `prefixBinding`，
   但 Anthropic 系模型有；修法不可假設此條件永遠缺席）——
   `session-tools.ts:1045-1050` 的 freeze 守衛與其保護對象必須保留，
   不得以刪除守衛的方式繞過。

## 約束

- **最小修改原則**：優先修正既有補丁（0042），不新建補丁層，不引入 supersede 鏈。
- 動補丁前必須先解釋用途並提供 diff 供 chris 審核；未經確認不得修改 `apply.sh`。
- 所有 dist 補丁需重開 omp 才生效。
- 嚴禁觸碰 live `agent.db` 與 Anthropic 憑證。
- 禁止為「修」而修：任何修法若無法通過上述驗收條件第 2 項，即為無效，不得交付。

## 參考

- 實測探針：`~/.omp/agent/extensions/model-switch-probe.ts`（臨時，非補丁鏈，刪檔即停用）
- 探針日誌：`~/.omp/agent/model-switch-probe.log`
- 既有審計：`~/.omp/agent/extensions/cache-prefix-audit.ts`、日誌 `cache-prefix-audit.log`
- 既有補丁：`patches/0042-omp-resume-read-description-refresh.patch`（已 APPLIED）、
  `patches/0019-omp-model-switch-read-description-refresh.patch`
- 相關報告：`RESUME_TOOLS_DRIFT_REPORT.md`
