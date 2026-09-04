# 0019 / 0042 退役 — 18.1.10 移除 inspect_image

退役日期：2026-09-04（升級 18.1.5 → 18.1.10 時）

## 這兩個補丁修的是什麼

`read` 工具的描述含一個模型相關分支：

```handlebars
Images → {{#if INSPECT_IMAGE_ENABLED}}metadata; call `inspect_image`{{else}}decoded inline{{/if}}
```

`INSPECT_IMAGE_ENABLED` 由 `isInspectImageToolActive()` 決定，取決於 `model.input`
是否含 `image`。兩個版本差 16 字（2388 vs 2372）。

- **0019**：把 `read.ts` 的重渲染抽成 `refreshDescription()`，並在 model switch 時呼叫
- **0042**：resume 路徑（`agent-session.ts` 與 `sdk.ts` 兩處）也呼叫它

不修的後果：熱切模型的進程與 resume 後的新進程對同一 session 算出不同的 read
描述，工具區段的 bytes 不一致 → prompt cache 前綴斷裂。

## 為什麼退役

18.1.10 上游把 `inspect_image` 整個移除：

- `src/tools/inspect-image.ts`、`src/utils/inspect-image-mode.ts` 刪除
- `read.md` 的 `{{#if INSPECT_IMAGE_ENABLED}}` 分支刪除，只剩 `IS_HL_MODE`
- `system-prompt.md` 的 `{{#has tools "inspect_image"}}` 行刪除
- `src/config/settings.ts` 只留遷移代碼，把 `inspect_image.timeoutMs` 搬到
  `images.questionTimeoutMs`
- 功能併進 `read` 的 `?q=<question>`：`img.png?q=<question>` 送 vision model 回文字

連帶，**整套 refresh 機制被上游刪除**：18.1.10 全樹 `grep refreshDescription`
零結果，`read` 的 description 只在 constructor 渲染一次（`read.ts:700`）。

於是：

- **0019** 的 hunk #2 目標代碼（`#refreshInspectImageAvailability` 內的
  `this.description = this.#renderDescription()`）不存在 → 套用失敗
- **0042** 呼叫的是 `readTool?.refreshDescription?.()`，optional chaining 在
  18.1.10 上靜默變成 no-op → 套得上去，但是死代碼

病沒了，補丁跟著退役。這不是「放棄修」，是上游把觸發源移除了。

## 什麼情況要復活

盯以下任一條，出現就把這兩個 patch 拿回去反導：

1. `src/tools/read.ts` 重新出現 `refreshDescription` 或任何 constructor 之外的
   `this.description = ` 賦值
2. `src/prompts/tools/read.md` 重新出現除 `IS_HL_MODE` / `IS_LINE_NUMBER_MODE`
   之外的條件（特別是任何依賴 `model.input` 的）
3. `src/tools/inspect-image.ts` 回歸

檢查指令：

```bash
NM=~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent
grep -n "refreshDescription" "$NM/src/tools/read.ts"
grep -oE "\{\{#[^}]*\}\}" "$NM/src/prompts/tools/read.md" | sort -u
ls "$NM/src/tools/inspect-image.ts" 2>/dev/null
```

第一條有輸出、第二條出現新條件、第三條檔案存在 —— 任一成立就回頭看這裡。

## 遺留：新的漂移源

`inspect_image` 走了，但 18.1.10 引進了範圍更大的一個：`delegationBias`
（per-model，`pi-catalog/src/compat/delegation.ts`），同時驅動 `system-prompt.md`
的三分支與 `grep` / `glob` / `eval` / `ast-grep` 四個工具描述，且 `grep.ts:927`、
`glob.ts:122` 的 `description` 是 getter，每次組 payload 都重算。

處理它的補丁另行編號，不復用 0019 / 0042。

## SHA-256

```
fa402b2b1927fe5564acd7c9e3ee535901666ce33960e75d1f4b20b9311a5969  0019-omp-model-switch-read-description-refresh.patch
a6fa465bbf77ef69d627f7397decb84ff0a23b45bf552381b307713640ce72cc  0042-omp-resume-read-description-refresh.patch
```
