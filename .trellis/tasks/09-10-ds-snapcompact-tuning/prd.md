# omp snapcompact: DeepSeek/CJK 幀參數與計費修正

## Goal

修正 omp snapcompact 在 **Command Code / DeepSeek** 路徑上的兩類偏差，使中文（CJK）archive 既**讀得回來**又**不被計費高估誤拒**：

1. **幾何**：`resolveShapeForText` 對 CJK-heavy 文字自動選 `silver16@1568`，而該組合實測可讀性失效（0/5）；最佳點是 **1280**。
2. **計費**：`commandcode-custom` 落 `billingFamily=unknown`，DS 每幀估 3293，實測固定 **995**（高估 3.31×），會讓 `projectedForReduction >= reductionBaseline` 誤判、錯誤拒絕本可縮減的 snapcompact。

## Requirements

### R1 — 計費必須 per-model，不可全域映射 api

`commandcode-custom` 這**一個 api 同時註冊 22 個 claude 模型**（`vendor/pi-commandcode-provider/src/commandcode-catalog.ts`），只在 `streamProvider` 內才按 `apiForModelId` 還原成 wire api（`vendor/pi-commandcode-provider/src/models.ts:125`）。

- 禁止把 `billingFamily("commandcode-custom")` 全局映射成 DS 的 995。Claude 目前估 5000 是**正確**的（`unknown` 與 `anthropic` 家族在 `familyBilling` 走同一 default 分支），全局映射會把它砸到 995 → 5× 低估 → 投影以為幀近乎免費 → 超配幀 → 爆窗。
- 實作須以 **per-model billing override**（或顯式 wireApi）表達。
- 995 僅在 `frameSize >= 1280` 成立；以下為斜坡 198 / 198 / 363 / 653（256/512/768/1024）。禁止把整條曲線硬寫成定值。
- 未量測模型（glm-5.3-flash 等）**不得發明數字**，保持現值。

### R2 — CJK 走 silver 時 frameSize 降至 1280

- `resolveShapeForText` 的 CJK 分支目前選 `silver16@1568`；實測該組合 0/5，`@1280` 4/5 且 `@1408` 1/5（懸崖落在 1280–1568 之間，單調）。
- 1280 同時是**計費飽和點**（每圖 995 token 自 1280 起跳），故 1280 在可讀性與計費兩軸同時最優。
- 改動若採「覆寫 frameSize」，**必須同步更新 `FRAME_DATA_BYTES_PER_SHAPE`**：`maxFramesForDataBudget` 按 font+cell+variant+frameSize+stopwordDim+lineRepeat+columns **全等**匹配（`snapcompact.ts:520-540`），尺寸一變就 miss → 掉回 `FRAME_DATA_BYTES_ESTIMATE=170_000` → 規劃 17 幀 → 由 `shedFramesOverBudget` 事後靜默砍幀。

### R3 — `providerImageBudget` 補自訂 api 兜底

`providerImageBudget("commandcode", "commandcode-custom")` = 200（provider id 命中）；但 `providerImageBudget(undefined, "commandcode-custom")` = **5**（api 家族無此鍵）。別名帳號註冊為 `commandcode-<slug>`（`vendor/pi-commandcode-provider/src/accounts.ts:47-52`），與 `commandcode-custom` **兩次查表全 miss → floor 5** → frame budget 80 塌成 5 → 觸發補丁 0044 註釋所述的「單張新圖擠掉最舊 archive 幀 → 改寫 `contents[0]` → 整段 prompt 快取前綴失效」。

補丁 0044 只補了內建 api 家族鍵，未覆蓋自訂 api。修法二選一：加 `commandcode-custom` 鍵，或讓查表支援 `commandcode-*` 前綴。

### R4 — 落地前先建可重複的真 bench

現有結論來自**初步探針**（n=5、單一 prompt、單一 key、單一合成內容生成器），升級為定案前需 OCR-style F1 bench。

- 通道已打通：**Eval kernel 是唯一可出網的路徑**；外部進程（`curl`/`bun`/`python`）全部被 fake-ip TUN（`api.commandcode.ai` → `198.18.0.100`，走 `Meta` 網卡）在 TLS 握手階段切斷。
- bench 須覆蓋：多 shape × 多 frameSize × 多內容類型（ASCII/CJK/JSON）× 多次重複，並回報 raw PNG 與 base64 兩種長度。

### R5 — 位元組單位必須一致，且上界必須真的安全

`frameDataBytes()` 累加的是 `Frame.data.length`，即 **base64 字串長度**（`snapcompact.ts:562-563`），故 `FRAME_DATA_BYTES_BUDGET = 3_000_000` 是 **base64 單位**。一切與預算比較的數字必須用 base64，不可混用解碼後 PNG bytes（差約 1.33×）。

上界本身有缺陷：`FRAME_DATA_BYTES_PER_SHAPE["silver16-bw"] = 870_000` **不能覆蓋目前觀測到的最壞樣本（948 KB）**。實作必須在 Evidence 的 (a)/(b) 之間明確選一，不得含糊：

- 選 **(a)** 者：把估計值提高到實際覆蓋最壞觀測（含餘量），並在 PRD 記錄選定值與依據。
- 選 **(b)** 者：必須在 PRD 明確聲明「規劃值可能低於實際、依賴 `shedFramesOverBudget` 事後砍幀」，並承認其靜默丟資料的後果。

不得在未選定時把 870 KB 描述為保守上界。

## Acceptance Criteria

- [ ] AC1：`resolveShape({api:"commandcode-custom", id:"claude-opus-5"})` 的 `frameTokenEstimate` **仍為 5000**（未被 DS 的 995 污染）。
- [ ] AC2：`resolveShape({api:"commandcode-custom", id:"deepseek/deepseek-v4-flash-vision-exp"})` 在 `frameSize >= 1280` 時 `frameTokenEstimate === 995`；`frameSize < 1280` 時不套用 995。
- [ ] AC3：CJK-heavy 文字經 `resolveShapeForText` 解析後的 frameSize 為 **1280**（非 1568）。
- [ ] AC4：改動 frameSize 後，`maxFramesForDataBudget(3_000_000, shape)` **不得** miss 到 `FRAME_DATA_BYTES_ESTIMATE=170_000` 通用值（尺寸一變即 miss，見 R2）。且該值作為**安全上界**驗證：對已觀測最壞樣本（純 CJK 散文 @1568 = 948 KB base64），規劃幀數 × 估計值須 ≥ 可容幀數 × 實際位元組，或已按 R5 明確選定 (b) 並記錄其靜默砍幀後果。**不得**聲稱對任意內容「與實測一致」。
- [ ] AC5：`providerImageBudget(<任意 commandcode 別名>, "commandcode-custom") === 200`，`providerFrameBudget(...)` 為 80（非 5）。
- [ ] AC6：既有回歸閘門 `patches/verify-provider-image-budget.ts` 全綠。
- [ ] AC7：bench 可重複執行並輸出 raw PKG / base64 雙單位與逐尺寸命中率。

## Evidence（實測，2026-09-10）

### 計費曲線（真幀 + 同段文字 baseline 減除，嚴格可加）

| frameSize | 256 | 512 | 768 | 1024 | **1280** | 1568 | 2048 | 2576 | 3584 |
|---|---|---|---|---|---|---|---|---|---|
| tokens/圖 | 198 | 198 | 363 | 653 | **995** | 995 | 995 | 995 | 987 |

- 可加性：2×1568 = 1990；2×2576 = 1990（尺寸差 0）。
- omp 假設 3293 → **高估 3.31×**。

### 可讀性（同 key / 固定 prompt / 加 3 行邊距避免裁切）

| 形狀 / 內容 | 1280 | 1408 | 1568 | 1792 | 2048 |
|---|---|---|---|---|---|
| 8on22 + ASCII | 3/3 | — | 2/3 | 0/3 | 0/3 |
| silver + ASCII | — | — | 3/3 | — | — |
| silver + **CJK** | **4/5** | 1/5 | **0/5** | — | — |

失敗輸出為狂野幻覺（`4952813`、`26221`、`2`），非「差一點」。

### 位元組（base64 單位）

| 內容 | frameSize | raw PNG | base64 | frames@3MB |
|---|---|---|---|---|
| **真實 archive 幀**（session blob `34723125…`） | 1568 | 461 KB | **630 KB** | **4** |
| 合成純 CJK 散文（最壞情況） | 1568 | 711 KB | **948 KB** | **3** |
| 合成純 CJK 散文 | 1280 | 499 KB | **666 KB** | **4** |
| silver + ASCII | 1568 | 209 KB | 278 KB | 10 |

觀測區間：**混合真實幀約 630 KB；目前觀測最壞（純 CJK 散文 @1568）948 KB**。

源碼估計值 `FRAME_DATA_BYTES_PER_SHAPE["silver16-bw"] = 870_000`（base64 單位）**對最壞樣本不足**——它落在兩個實測值之間：對 630 KB 的真實幀有約 38% 餘量，但對 948 KB 的最壞樣本低估約 8%。故此值**不能**被描述為「保守上界」。

必須二選一並在實作中明確（見 R5）：

- **(a) 提高 bound 留餘量**：把 `silver16-bw` 的估計值提到覆蓋最壞（例如 ~1.0–1.1 MB），使 `maxFramesForDataBudget` 規劃階段就不超發。代價：真幀（630 KB）情境下少規劃 1 幀。
- **(b) 只依賴渲染後 `shedFramesOverBudget`**：保留 870 KB 作為規劃值，接受規劃可能超發、由渲染後的實際位元組檢查砍幀。代價：砍幀是**靜默丟資料**（最舊優先），且規劃與實際不一致。

## Notes

- 源碼路徑：`~/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts`（版本 18.1.14）。
- 供應商插件：`vendor/pi-commandcode-provider/`。
- 憑證狀態（2026-09-10 複測）：`commandcode` = HTTP 200 可用；`commandcode-alt` = HTTP 400 insufficient credits（已耗盡，勿再作為默認）。
- **Phase 3.3 `trellis-update-spec` 不可跳過**：本批結論需回寫 spec 供下批繼承。

## Resume

> RESUME: S3 — 先修 `research/snapcompact-ds-bench.ts` 的 key 選擇（目前硬編碼已耗盡的 `commandcode-alt`，任何量測都回 `undefined`），再跑 bench 產出 R4 要求的可重複數據。

本任務目前為 **PRD-only**（無 `design.md` / `implement.md`），故 RESUME 指針落在本節。

### 已完成

- **S0 現狀勘查** `verified` — 定位 snapcompact 源碼、供應商插件、`billingFamily` / `PROVIDER_IMAGE_BUDGETS` / `FRAME_DATA_BYTES_*` 三條路徑。
- **S1 計費量測** `verified` — DS 每圖固定 **995**（1280px 飽和、嚴格可加）；omp 假設 3293 → 高估 3.31×。
- **S2 可讀性量測** `verified`（初步，n=5）— silver+CJK：@1280 4/5、@1408 1/5、@1568 **0/5**；8on22+ASCII：@1280 3/3、@1568 2/3、@1792 與 @2048 0/3。
- **S2b 位元組量測** `verified` — raw 與 base64 雙單位；真實 archive 幀 630 KB、最壞 948 KB（base64）。
- **S2c 預算路徑審查** `verified` — `maxFramesForDataBudget` 按 font+cell+variant+frameSize+… **全等**匹配，改尺寸即 miss。
- **S2d `providerImageBudget` 兜底缺陷** `verified` — `commandcode-custom` 與 `commandcode-<slug>` 雙 miss → floor 5。
- **S4 PRD 撰寫** `verified` — R1–R5、AC1–AC7、Evidence 全部實測值；R5/AC4 的矛盾（870 KB 不覆蓋最壞 948 KB）已於暫停前修正。

### 待辦（下次接續）

- **S3 bench 可重現化** `blocked: 腳本中間態` — `research/snapcompact-ds-bench.ts` 已修掉 TDZ（default 參數捕獲外層 const 的 transform 產物），但 key 選擇仍硬編碼 `commandcode-alt`（HTTP 400 已耗盡）→ `baseline prompt_tokens` 為 `undefined`。修法已定：改為**候選 key 探活後快取**（先試 `commandcode-alt` 再 `commandcode`，以 HTTP 200 為準）。修完須跑通 `benchBilling` / `benchLegibility` / `benchRealArchiveFrames` 三者。
- **S5 R5 上界決策** `pending` — 在 (a) 提高 `FRAME_DATA_BYTES_PER_SHAPE["silver16-bw"]` 至覆蓋最壞，與 (b) 依賴 `shedFramesOverBudget` 之間選一並記錄依據。
- **S6 計費修正實作** `pending` — **per-model** 覆寫（禁全域映射 `commandcode-custom`，否則 claude 由 5000 砸成 995）；995 僅適用 `frameSize >= 1280`；glm 未量測不得發明數字。
- **S7 CJK frameSize 降 1280** `pending` — 同時更新 `FRAME_DATA_BYTES_PER_SHAPE` 匹配，否則規劃 miss → 靜默 shed。
- **S8 `providerImageBudget` 補自訂 api 兜底** `pending` — 加 `commandcode-custom` 鍵或支援 `commandcode-*` 前綴。
- **S9 回歸閘門** `pending` — `patches/verify-provider-image-budget.ts`（AC6）；新增 AC1–AC5、AC7 的斷言。
- **S10 Phase 3.3 `trellis-update-spec`** `pending` — 回寫 spec。

### 未落地 / 已知中間態（勿誤認為完成）

- `research/snapcompact-ds-bench.ts` — **不可用**（見 S3），已入 git 追蹤範圍外的未提交狀態。
- 本任務全部檔案**未提交**（工作區在 `master`，依 `/trellis-paused-work` 規範不在默認分支做 WIP commit）。
- 所有量測結論來自 **Eval kernel 記憶體**中的探針；探針腳本未全部落盤，唯 `research/snapcompact-ds-bench.ts` 為持久化產物。
