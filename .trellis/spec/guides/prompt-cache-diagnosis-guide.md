# Prompt Cache 診斷指南

> **目的**：prompt cache miss 的根因常在「資料源頭」，不在「重組邏輯」。
> 本指南記錄 2026-09-03 修復 switch model 後 resume miss 的過程與教訓。

---

## 核心原則：先問「值對不對」，再問「有沒有重組」

調查 miss 時最容易犯的錯，是**直接去查重組邏輯**（誰呼叫了 refresh / reconcile），
卻沒先確認**被重組的那個值本身對不對**。

錯誤順序（本次實際走過，浪費十幾輪）：

1. 發現熱切後 2388、resume 後 2372 → 認定「resume 沒重組」
2. 去找 resume 的 refresh 路徑 → 找到 `sdk.ts` 的 `refreshDescription()`
3. 發現它在守衛內沒執行 → 認定「漏了第三條路徑」
4. 準備出 patch → 實際上只是在讓兩個進程維持同一個**錯的**值

正確順序：

1. 兩個值不同 → **先確定哪個才對**
2. 確定對錯之後才問「錯的那個從哪來」
3. 最後才問「為什麼沒被修正」

本次正解：muse-spark 原生多模態 → 2372 才是對的，2388 是錯的。
一旦確認這點，方向立刻從「補重組」轉成「誰把 metadata 弄錯」。

---

## 判據：怎麼確定哪個值才對

不要靠「哪個出現次數多」或「哪個看起來比較新」。用**獨立資料源交叉驗證**：

```bash
# 同一個 model 在不同 provider 的 input 是否一致
sqlite3 -readonly ~/.omp/agent/models.db \
  "select provider_id, models from model_cache"
```

本次案例：muse-spark-1.3-contributor 在 kilo / nanogpt / zenmux 都是
`input=["text","image"]`，只有 commandcode fork 是 `["text"]`。
**多數 provider 一致 + 使用者領域知識（muse-spark 原生多模態）** → 判定 fork 錯。

若缺少獨立資料源，直接問使用者：「這個模型能不能看圖？」
一句話就能定案，比讀十輪程式碼快。

---

## 根因類別：catalog 漏登記（本次真因）

fork/provider 的 model catalog 常用「查表 + 預設值」：

```js
// vendor/pi-commandcode-provider/src/models.ts:34-36
export function inputModalitiesForModel(modelId: string) {
  return MODEL_INPUT_MODALITIES[modelId] ?? TEXT_INPUT_ONLY   // ["text"]
}
```

**查不到就退回「最保守的」純文字**。上游新增模型後若沒同步進 catalog，
該模型會被靜默降級——不報錯、不警告，只是能力標錯。

排查方式：比對「provider 實際提供的模型清單」與「catalog 登記的清單」。

```bash
# provider 實際提供（commandcode 自己的 cache）
python3 -c "import json;d=json.load(open('$HOME/.omp/agent/commandcode-models.json'));..."
# catalog 登記
grep -n 'muse' vendor/pi-commandcode-provider/src/commandcode-catalog.ts
```

本次：commandcode 提供 5 個 muse-spark，catalog 只登記 3 個，漏 1.3 兩個。

**補登記時要補齊所有相關表**，不要只補觸發問題的那張：

| 表 | 漏了會怎樣 |
|---|---|
| `MODEL_INPUT_MODALITIES` | 多模態誤判（本次觸發 cache miss） |
| `MODEL_REASONING` | thinking 能力標錯 |
| `MODEL_EFFORT_OVERRIDES` | effort 等級不可用 |
| `pricing.ts` | 計費退回預設（不影響功能，但數字不準） |

---

## 已知會隨模型漂移的 prompt 區段

改模型會改變送出的 bytes，以下是會翻的開關：

| 開關 | 影響位置 | 觸發條件 |
|---|---|---|
| `inspect_image` | read 描述 + system[0] 宣告 | `model.input` 不含 image |
| hashline 編輯模式 | edit 描述 | `modelSupportsHashlineEdits()` 為 false |
| code mode | 整組工具呈現 | 模型切到 code-mode 家族 |

**只有寫進 prompt 的才會造成 miss**。
`webpExclusionForModel` 之類只影響工具執行期行為，不進 prompt，不造成 miss。

判定函式：`isInspectImageToolActive()`（`utils/inspect-image-mode.ts:33-39`）

```js
if (mode === "on")  return true;
if (mode === "off") return false;
return !(model?.input?.includes("image") ?? false);
```

read 描述的兩個版本（差 16 字）：
- true → `Images → metadata; call inspect_image.`（2388）
- false → `Images → decoded inline.`（2372）

---

## 取證方法：payload 逐工具比對

不要只比 whole-array hash，要**逐工具**比對，才能定位是哪一個漂。

```bash
cd ~/.omp/agent/payloads/<session-id>/
# 同 model、跨 pid 的兩個 payload，逐工具比 description
```

全量掃描某工具是否曾漂：

```python
# 對每個 (model, tool) 收集所有出現過的 description hash
# >1 種變體 = 該工具會漂
```

本次：66 組 (model, tool)，只有 `read` 有 2 種變體。
**但樣本沒切到 hashline / code-mode 邊界，所以「只有 read 會漂」是樣本限制，非證明。**

---

## 臨時探針模式

純讀碼猜不出來時，加一個最小 extension 直接記錄當下的事實。

原則：
- 放 `~/.omp/agent/extensions/`，**不進 `patches/`、不改 `apply.sh`**
- 每個請求寫一行 JSONL 到獨立 log
- 全部包 try/catch，絕不干擾 provider 呼叫
- **刪檔即停用**，收尾時務必刪除

本次探針記錄的欄位（決定性）：

```
activeModel / input / prefixBinding / readDescLen / hasInspectImage
```

`input` 兩進程皆 `["text"]` 這一筆，直接推翻了「metadata 未就緒」假說。

`ctx.model` 是 live getter（`extensibility/extensions/runner.ts:1183`），
在 `before_provider_request` 可安全讀取。

---

## 不要做的事

- **不要為「修」而修**。讓兩個進程維持同一個錯的值 = 墊墊子，不是修凳子腿。
- **不要只補觸發症狀的那張表**。漏補 `MODEL_EFFORTS` 會留下同類型的洞。
- **不要改 live runtime**。
  `~/.omp/plugins/node_modules/pi-commandcode-provider` 是指向
  `vendor/pi-commandcode-provider` 的 symlink，必須改 repo 那一側以保留 git 可審計性。
- **不要用「樣本沒出現」當成「不存在」**。
- **不要分段拋結論**。讀完整條鏈再一次給答案，來回翻覆會讓協作者失去信任。

---

## 相關檔案

- fork catalog：`vendor/pi-commandcode-provider/src/commandcode-catalog.ts`
- fork overrides：`vendor/pi-commandcode-provider/src/commandcode-catalog-overrides.ts`
- 能力查詢：`vendor/pi-commandcode-provider/src/models.ts`
- 永久審計：`~/.omp/agent/extensions/cache-prefix-audit.ts`
- 歷史任務：`.trellis/tasks/archive/*/09-03-resume-model-switch-cache-miss/`
