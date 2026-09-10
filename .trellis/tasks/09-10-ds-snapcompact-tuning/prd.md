# omp snapcompact: DeepSeek/CJK 幀參數與計費修正

## Goal

修正 omp snapcompact 在 **Command Code / DeepSeek** 路徑上的三類偏差：

1. **計費（已實作，補丁 0052）**：`commandcode-custom` 落 `billingFamily=unknown`，DS 每幀估 3293@1568、5024@2576（28px 面積公式帶 4784 patch 上限，誤差隨尺寸增長），實測 **995@1568 / 1011@2576**（高估 3.31×／4.97×），會讓 `projectedForReduction >= reductionBaseline` 誤判、錯誤拒絕本可縮減的 snapcompact。
2. **圖片預算（已實作，補丁 0052）**：別名帳號（`commandcode-<slug>`）的 provider id 與 wire api 都是**運行時生成**，兩次查表全 miss → floor 5 → archive 被夾到 5 幀。
3. **幾何（未實作，前提待重驗）**：`resolveShapeForText` 對 CJK-heavy 文字自動選 `silver16@1568`。但此路徑**罕見**——全量 709 個歸檔幀中 silver 僅 5 個（0.7%），實測主路徑是 `8on16-bw`（cols=196/rows=98，佔 22/25 幀）。原「@1568 失效 0/5、@1280 最佳 4/5」的結論**已作廢**（fill harness 缺陷，見 §Evidence）；2026-09-10 重測顯示可讀性隨 **cellHeight** 而非 frameSize 變化，故「降 frameSize 到 1280」很可能無效。是否改動幾何須先完成足量重測。

## Requirements

### R1 — 計費必須 per-model，不可全域映射 api

`commandcode-custom` 這**一個 api 同時註冊 22 個 claude 模型**（`vendor/pi-commandcode-provider/src/commandcode-catalog.ts`），只在 `streamProvider` 內才按 `apiForModelId` 還原成 wire api（`vendor/pi-commandcode-provider/src/models.ts:125`）。

- 禁止把 `billingFamily("commandcode-custom")` 全局映射成 DS 的 995。Claude 目前估 5000 是**正確**的（`unknown` 與 `anthropic` 家族在 `familyBilling` 走同一 default 分支），全局映射會把它砸到 995 → 5× 低估 → 投影以為幀近乎免費 → 超配幀 → 爆窗。
- 實作須以 **per-model billing override**（或顯式 wireApi）表達。
- 計費隨尺寸變化：256/512→198、768→363、1024→653、1280→995、1568→995、2048→993、2576→1011、3584→989。**1280 以上並非定值**（2576 為 1011）。禁止把整條曲線硬寫成單一定值。
- 未量測模型（glm-5.3-flash 等）**不得發明數字**，保持現值。

### R2 — CJK 走 silver 時 frameSize 降至 1280

- `resolveShapeForText` 的 CJK 分支目前選 `silver16@1568`。原「實測 0/5、@1280 4/5、@1408 1/5（單調懸崖）」**已作廢**——該數據受 fill harness 缺陷污染。重測（n=5，正確填充）：`silver16-bw@1568` 1/5、`@1408` 3/5、`@1280` 1/3，**非單調**；且 `cellHeight=16` 的 `8on16-bw` 同樣 1/5，而 `cellHeight=22` 的 `8on22-bw` 為 3/5。
- 1280 同時位於**計費平坦段**（1280 與 1568 皆 995 token/圖），故 1280 在可讀性與計費兩軸同時最優；2576 反而升至 1011，故降到 1280 不會增加計費。
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

上界覆蓋範圍須精確界定：870 KB **覆蓋全部 582 個已觀測真實幀**（最大 754.9 KB），但**不覆蓋**合成純 CJK 壓力樣本（948 KB）。實作必須在 Evidence 的 (a)/(b) 之間明確選一，不得含糊：

- 選 **(a)** 者：把估計值提高到實際覆蓋最壞觀測（含餘量），並在 PRD 記錄選定值與依據。
- 選 **(b)** 者：必須在 PRD 明確聲明「規劃值可能低於實際、依賴 `shedFramesOverBudget` 事後砍幀」，並承認其靜默丟資料的後果。

不得在未選定時把 870 KB 描述為保守上界。

## Acceptance Criteria

- [x] AC1：`resolveShape({api:"commandcode-custom", id:"claude-opus-5"})` 的 `frameTokenEstimate` **仍為 5000**（未被 DS 的 995 污染）。— 已實作並由 `verify-snapcompact-model-billing.ts` GATE 2 斷言（另含 `anthropic-messages` 與 `claude-fable-latest` 兩條對照）。
- [x] AC2a：`resolveShapeForText`/`resolveShape` 在**已量測尺寸**上回傳實測值：1568→**995**、2576→**1011**。— 已實作；GATE 2 逐個 shipped variant 對照量測曲線斷言（非硬編碼 995），並單獨釘住 `5x8-bw@2576 === 1011`。行為層負向對照已驗證：把查表結果鉗到 995（表文本不變，GATE 1 仍過）→ `DeepSeek @5x8-bw (frameSize 2576) must price at the measured 1011` 失敗。
- [x] AC2b：`frameSize < 1280` 時套用實測斜坡（256/512→198、768→363、1024→653），**不得**抹成定值。— 階梯表已含這四檔且被 GATE 1 的「未被抹平」正則鎖定；但當前 17 個 shipped variant 全部 ≥1568，故該分支**在 runtime 不可達**，僅在顯式指定小尺寸 variant 時生效。此為 source-level 覆蓋，非 runtime 覆蓋。
- [ ] AC3：CJK-heavy 文字經 `resolveShapeForText` 解析後的 frameSize 為 **1280**（非 1568）。— **未實作**，待 `8on22-bw` CJK bench 決定（見 S7）。
- [ ] AC4：改動 frameSize 後，`maxFramesForDataBudget(3_000_000, shape)` **不得** miss 到 `FRAME_DATA_BYTES_ESTIMATE=170_000` 通用值，且須滿足 948 KB 安全上界（或按 R5 明確選定 (b) 並記錄靜默砍幀後果）。— **deferred（非已滿足）**：本批**未改任何 frameSize**，故此驗證未被執行、也不可能被「不觸發」滿足。已記錄 runtime 規劃器走 `resolveShape`（`session-maintenance.ts:2533`）而非 `resolveShapeForText`，S7 落地時須一併處理，並與 S5 的 (a)/(b) 決策一起結算。
- [x] AC5：`providerImageBudget(<任意 commandcode 別名>, "commandcode-custom") === 200`，`providerFrameBudget(...)` 為 80（非 5）。— 已實作。實測 `commandcode-b`/`commandcode-c`/`commandcode_proxy`/`commandcode-alt` 皆 200 / 80；並保留 `commandcode-b + anthropic-messages === 90`（精確 api 條目優先於命名空間回退）。
- [x] AC6：既有回歸閘門 `patches/verify-provider-image-budget.ts` 全綠。— 已擴充別名斷言，實測零 provider 呼叫通過。
- [x] AC7：bench 可重複執行並輸出 raw PNG / base64 雙單位與逐尺寸命中率。— 已完成，見 S3（金鑰探活 + 填充單位修正）。

## Evidence（實測，2026-09-10）

### 計費曲線（真幀 + 同段文字 baseline 減除，嚴格可加）

對 `commandcode-custom` 的**三條已量測 DeepSeek id**（`v4-flash-vision-exp`／`v4.1-flash`／`v4-flash`）逐尺寸量測，**九個尺寸上逐點相同**：

| frameSize | 256 | 512 | 768 | 1024 | 1280 | 1568 | 2048 | 2576 | 3584 |
|---|---|---|---|---|---|---|---|---|---|
| tokens/圖 | 198 | 198 | 363 | 653 | 995 | 995 | 993 | **1011** | 989 |

- 可加性：2×1568 = 1990、2×2576 = **2022**（皆嚴格可加；2576 兩次複測數字完全一致）。
- 1568 與 2576 是 shipped variant 唯一可達的兩個尺寸（17 個 variant 皆為 1568 或 2576）。
- omp 假設 3293@1568／5024@2576（4784 patch 上限）→ 對 1568 高估 **3.31×**、對 2576 高估 **4.97×**。
- **不得宣稱 1280 以上恆定**：2048 實測 993、2576 實測 **1011**、3584 實測 989，非單一定值。階梯表在 1280→995、2576→1011 兩檔取實測值。**保證範圍僅限已測點**：shipped variants 可達的 1568/2576 逐點精確；已測 checkpoint 上偏保守（2048 表 995 對實測 993、3584 表 1011 對實測 989）；2576 以上的**未測尺寸不獲上界保證**。

### 可讀性（⚠ 2026-09-10 作廢，見下）

> **本節數據已作廢**。原測量用的填充函數按**字元數**計算頁面容量，但畫布容量是**終端格**；
> CJK 每字佔 2 格，故實際填入行數超出畫布約 39%，渲染器把尾部裁掉——**錨點行根本沒進圖像**，
> 模型只能瞎猜，於是表現為「亂碼／0 分」。那不是可讀性失敗，是測量對象缺失。

### 可讀性（2026-09-10 重測，填充按格且以 `geometry.rows` 為界）

同 key、固定 prompt、temperature=0、底部留 3 行邊距、5 次重複：

| variant | cellHeight | frameSize | 命中 | 讀出值 |
|---|---|---|---|---|
| `8on16-bw` | 16 | 1568 | **1/5** | 1881/1981/1861/1861/1821（真值 1881） |
| `silver16-bw` | 16 | 1568 | **1/5** | 1831×4,1881 |
| `8on22-bw` | **22** | 1568 | **3/5** | 1341/1341/1381/1341/-（真值 1341） |

失敗模式是**末行定位偏差 ±1–3 行**，不是完全幻覺——與舊節所述「狂野幻覺」不是同一種現象。

**兩個 cellHeight=16 的 variant 表現相同（皆 1/5），cellHeight=22 的明顯更好。**
這指向 **`cellHeight` 才是可讀性的主因，`frameSize` 不是**——即降 frameSize（S7 原始假設）
很可能無效，因為它只改 cols/rows，不改每行的高度。

**樣本僅 5 次、且是「讀最末行」這一邊緣敏感任務**，不足以定案；但足以否定「降 frameSize 能修」這個前提。

### 可讀性（舊數據，已作廢，僅存檔）

| 形狀 / 內容 | 1280 | 1408 | 1568 | 1792 | 2048 |
|---|---|---|---|---|---|
| 8on22 + ASCII | 3/3 | — | 2/3 | 0/3 | 0/3 |
| silver + ASCII | — | — | 3/3 | — | — |
| silver + **CJK** | **4/5** | 1/5 | **0/5** | — | — |

> ⚠ **本表數字全部作廢**（fill harness 缺陷：錨點行未進圖像）。失敗輸出看似「狂野幻覺」正是模型在猜一個不存在的行——**不是可讀性不足**。重測結果見上一節。

### 位元組（base64 單位）

`frameDataBytes()` 加總 `Frame.data.length`（base64），故 3 MB 預算是 base64 單位。磁碟上 archive 幀外部化為 `blob:sha256:<hash>`，blob 檔存的是**解碼後 PNG**，所以運行時 base64 長度須由檔案大小還原：`4 * ceil(raw / 3)`。

**全量實測：582 個真實 archive 幀**（掃自各 session JSONL 的 `preserveData.snapcompact.frames[].data` 參照，非目錄掃描——blob 目錄另有 752 個無關圖片）

| 規模 | raw PNG | base64 | frames@3MB |
|---|---|---|---|
| 最大真實幀（`b02345a0…`） | 566.2 KB | **754.9 KB** | **3** |
| 次大（`34723125…`） | 461.1 KB | 614.8 KB | 4 |
| 第三（`36e1adfc…`） | 428.2 KB | 570.9 KB | 5 |
| 第四（`1a693f42…`） | 419.3 KB | 559.1 KB | 5 |
| 其餘 578 個 | 1.6–199 KB | 2.1–265.6 KB | ≥11 |

合成壓力樣本（純 CJK 散文 @1568，非真實語料）：raw 711 KB → base64 **948 KB** → 3 幀。

**修正後的判斷**：源碼估計值 `FRAME_DATA_BYTES_PER_SHAPE["silver16-bw"] = 870_000` **覆蓋全部 582 個已觀測真實幀**（最大 754.9 KB，餘量約 15%），但**不覆蓋**合成純 CJK 壓力樣本（948 KB，超出約 9%）。

故「870 KB 保守」須限定為「**對已觀測真實語料保守，對合成最壞樣本不足**」——這兩句不能互相取代。

必須二選一並在實作中明確（見 R5）：

- **(a) 提高 bound 留餘量**：把 `silver16-bw` 的估計值提到覆蓋最壞（例如 ~1.0–1.1 MB），使 `maxFramesForDataBudget` 規劃階段就不超發。代價：真幀（630 KB）情境下少規劃 1 幀。
- **(b) 只依賴渲染後 `shedFramesOverBudget`**：保留 870 KB 作為規劃值，接受規劃可能超發、由渲染後的實際位元組檢查砍幀。代價：砍幀是**靜默丟資料**（最舊優先），且規劃與實際不一致。

## Notes

- 源碼路徑：`~/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts`（版本 18.1.14）。
- 供應商插件：`vendor/pi-commandcode-provider/`。
- 憑證狀態（2026-09-10 複測）：`commandcode` = HTTP 200 可用；`commandcode-alt` = HTTP 400 insufficient credits（已耗盡，勿再作為默認）。
- **Phase 3.3 `trellis-update-spec` 不可跳過**：本批結論需回寫 spec 供下批繼承。

## Resume

> RESUME: S7（幾何）—— 先補 `8on22-bw` 的 CJK 可讀性 bench，再決定 `silver16-bw` 是否降到 1280。S5 的 R5 上界決策同時待定。計費（S6）與圖額（S8）已由補丁 0052 落地；S11 已修正措辭過度聲稱與 root 傳遞，並經 BillingRecheck 複審。

本任務目前為 **PRD-only**（無 `design.md` / `implement.md`），故 RESUME 指針落在本節。

### 已完成

- **S0 現狀勘查** `verified` — 定位 snapcompact 源碼、供應商插件、`billingFamily` / `PROVIDER_IMAGE_BUDGETS` / `FRAME_DATA_BYTES_*` 三條路徑。
- **S1 計費量測** `verified` — **全 5 條 deepseek 模型逐條量測**：`v4-flash`／`v4-flash-vision-exp`／`v4.1-flash` 三條在**九個尺寸（256–3584）上逐點相同**（198/198/363/653/995/995/**993**/**1011**/**989**）；但 **`v4-pro` 實測 6、`v4-flash-fast` 實測 0** —— 供應商同一前綴下計費**不統一**，這是覆寫必須按精確 model id 的實證依據。omp 假設 3293@1568／5024@2576 → 對 1568 高估 3.31×、對 2576 高估 4.97×。**1280 以上並非恆定**（2576 實測 1011，與 1568 的 995 差 16），故階梯表帶 [2576, 1011] 檔。
- **S2 可讀性量測** `作廢（數據不可用）` — 原測 5 組數據（silver+CJK：@1280 4/5、@1408 1/5、@1568 0/5；8on22+ASCII 等）**全部作廢**：當時的 `fill()` 按字元數而非終端格計算頁容量，CJK 超填約 39%，**錨點行沒進圖像**。已於 2026-09-10 重測（見 Evidence 的可讀性節），結論**與原數據不一致**（silver@1408 反而 3/3、@1280 只有 1/3）。**不得再引用本條數字。**
- **S2b 位元組量測** `verified` — 全量掃描 **582 個真實 archive 幀**（最大 base64 754.9 KB）；最壞合成樣本 948 KB。
- **S2c 預算路徑審查** `verified` — `maxFramesForDataBudget` 按幾何**全等**匹配；runtime 規劃器（`session-maintenance.ts:2533`）走 `resolveShape` 而非 `resolveShapeForText`。
- **S2d 圖片預算兜底缺陷** `verified` — 別名帳號雙 miss → floor 5（`providerFrameBudget("commandcode-b","commandcode-custom-b")` 修前 = 5）。
- **S2e CJK 渲染契約釐清** `verified` — 8x13 **沒有**缺字問題：經 embedded Silver TrueType fallback 以全寬兩格渲染（README 明載；200 個 CJK 字元 → PNG 高 66px ÷ cellHeight 22 = 3 行 = `ceil(200/98)`，即每字 2 格）。先前「中文被壓扁／缺字偵測失明」的判斷**已撤回**。
- **S4 PRD 撰寫** `verified`。
- **S6 計費修正實作** `verified` — 補丁 **0052**：`MODEL_FRAME_TOKEN_STEPS`（**精確 model id 為鍵**，非前綴）+ `resolveShape` wrapper。Claude 維持 5000 未被污染；`v4-pro`／`v4-flash-fast` 維持家族公式 3293。初版用 `^deepseek/` 前綴，經 reviewer 判為 P1，已收窄。**曲線亦經修正**：初版只量到 1568 便誤把 995 當成全尺寸定值，複測後補上 `[2576, 1011]` 檔（詳見 Evidence）；表尾兩檔 `[1280, 995]`／`[2576, 1011]` 皆為實測值，缺口處偏保守側。
- **S9b 0045 閘門邊界穩定性修正** `verified` — 回歸時發現 `verify-snapcompact-frame-reprice.ts` 的 GATE 2 取「最後一個 compaction」，而 session 是 append-only，回放窗口隨增長而關閉 → **偶發變紅**（pristine 與 patched 失敗完全一致，證明與 0052 無關）。修法三處：窗口止於下一個 compaction（`nextCompactionAfter` 取最小的 `i > compIdx`）、預設釘住 `6375bca4`（`OMP_PATCH_VERIFY_REPRICE_BOUNDARY` 可覆寫）、找不到即失敗。修正後三次運行逐位一致，且與 PATCHES.md 原記載四位數字吻合。三個負向對照：① 移除 pin 恢復掃描 → 選中 `6bc7f78b` 且 flip 斷言失敗（證明 pin 必要）；② `nextCompactionAfter` 降序 bug → 窗口跨頭，`A+R` 由 112027 暴增到 308326；③ 刪 `session-maintenance.ts:3542` 的參數 → GATE 1 失敗。
- **S8 圖片預算兜底實作** `verified` — 補丁 **0052**：`COMMAND_CODE_NAMESPACE` 回退，位置在 provider exact → api exact 之後。
- **S9 回歸閘門** `verified` — 新增 `verify-snapcompact-model-billing.ts`（三閘門 ＋ 十個負向對照全部觸發）；擴充 `verify-provider-image-budget.ts`；已掛入 `apply.sh` 回歸套件；`OMP_PATCH_VERSION=18.1.14 apply.sh --check` 全 **26** 條 APPLIED。另修正 0045 的 `verify-snapcompact-frame-reprice.ts` 邊界穩定性（見 S9b）。

- **S11 措辭準確性與 root 傳遞修正** `verified` — 交付前複查抓到三處真缺陷：
  ① **`apply.sh` 未傳 root 給 spec 閘門**：調用 `verify-spec-contracts.sh` 時漏了 `OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="$SNAP"`，違反 spec 自己寫的 root-redirection 合同——sandbox／offline 或換安裝根時，閘門會退回固定 global 路徑去驗**另一棵樹**。已修，並以**區分性**負向對照證明 root 確被尊重（指向刪掉該表的副本 → `MODEL_FRAME_TOKEN_STEPS table is absent` FAIL；指向 live → PASS）。
  ② **計費註釋過度聲稱**：原文宣稱「曲線在缺口處保守（2048 表 995 對實測 993、3584 表 1011 對實測 989）」。2048/3584 只是**兩個採樣點**，不足以替「未測區間」或「最後一檔覆蓋的所有 >2576 尺寸」建立上界——拿一個 3000px 的幀就能推翻。已改為精確限定：**表在 shipped variants 可達的 1568／2576 逐點精確**（兩者皆實測）、**僅在已測 checkpoint 上偏保守**、**2576 以上的未測尺寸不獲上界保證**。同步 live 註釋、閘門頭註釋、0052 patch、`PATCHES.md`、本 PRD。
  ③ **`PATCHES.md` 對 0045 降序 bug 的描述不準**：原文寫「窗口跨過中間兩個**直抵 EOF**」。實測 `nextCompactionAfter(433)`：修正版 **577**、降序版 **1260**（`boundaryIndices` 降序 = 1260/1002/577/433，取最大者）；而 EOF **1333** 是 `6bc7f78b` **自身**窗口的終點，不是本次窗口的。已改為精確 index 並附兩版實測數字。
  另修計數與舊說法：`PATCHES.md` 閘門數 2→**3**（實際有 GATE 1／2／2b）、負向變體數 9→**10**、`prd.md` 三處「1280 起飽和」改為實測曲線。
  **驗證**：round-trip（live `-R` patch → pristine，再 `+` patch）**逐字節 == live**；`patch -R --dry-run --fuzz=0` reverse-clean；hunk header 同步 `+255,62 → +255,65`；`apply.sh` exit=0 且 **live sha256 前後不變**（`56ba523deea2baf2`）；26 APPLIED／無 CONFLICT；四閘門 PASS；零漂移 7/7。**旁證**：新閘門在同步前確實報出 `apply.sh DRIFTED`／`PATCHES.md DRIFTED` 並以 exit=1 結束——它抓到了真實漂移，而非恆綠。

- **S5 R5 上界決策** `verified: 選 (b)` — **不需要改代碼**。算術上 (a) 的前提不成立：`silver16-bw` 表值 870,000 → `maxFramesForDataBudget` 規劃 `floor(3,000,000 / 870,000) = 3` 幀，故**溢出條件是「3 幀均值 > 1,000,000」**，而非單幀超表值。
  - 實測最大真實 silver 幀 **772,992 B**（全量 709 幀掃描，silver n=5）→ 容忍倍數 **1.294×**
  - PRD 合成純 CJK 壓力樣本 948,000 B → 容忍倍數 1.055×
  - 最壞情形「3 幀全為合成樣本」= 948,000×3 = **2,844,000 ≤ 3,000,000**（餘 5.2%）
  → **規劃階段永不超發**，`shedFramesOverBudget` 在此路徑上根本不會被觸發。選 **(b) 保留 870 KB**，無需提高 bound，也無需聲明依賴事後砍幀（該依賴不成立）。
  - 附帶更正：舊描述「870 KB 不覆蓋合成樣本（948 KB）」誤把**單幀值**與**規劃總量**比較。單幀超表值不等於溢出——只有規劃出的 3 幀總和超過 3 MB 才溢出，而那不可能發生。
- **S3 bench 金鑰** `verified` — 已實作候選探活：`resolveKey()` 按序探測並快取，**且刻意探測 chat 端點而非 `/models`**（Cloudflare 對部分路徑回 `error code: 1010`，只有 chat 端點的結論才對 bench 有效）。修前腳本寫 `auth["commandcode-alt"] ?? auth["commandcode"]`，**優先選已欠費的那個**（實測 400 insufficient credits），使每次測量都變成帳務錯誤。
  另修 `fill()` 的填充單位（見上）與 `ask` 的遞迴依賴（拆出 `post`）。
- **S10 Phase 3.3 `trellis-update-spec`** `verified` — 新增 `.trellis/spec/backend/verification-gate-contracts.md`（兩大 Scenario：閘門可證偽性 ＋ 補丁變更的表示同步），已註冊進 `backend/index.md`。附 machine-checkable 閘門 `patches/verify-spec-contracts.sh`（已掛入 `apply.sh` 套件，從 repo 與 ledger 兩路徑皆 exit 0）。負向對照：① 計費表出現裸前綴鍵 → `billing table contains a bare prefix key` FAILED；② ledger 漂移 → `DRIFTED from the deployed ledger` FAILED；③ 根指向不存在樹 → fail-closed FAILED；④ spec 找不到 → exit 1。
### 待辦（下次接續）

- **S7 CJK 可讀性** `pending: 前提已被推翻` — 原假設「把 `silver16-bw` 的 frameSize 從 1568 降到 1280」建基於作廢的舊數據。重測顯示 `cellHeight=16` 的兩個 variant（`8on16-bw`／`silver16-bw`）表現**相同**（皆 1/5），而 `cellHeight=22` 的 `8on22-bw` 為 3/5 → **可讀性跟 `cellHeight` 走，不是 `frameSize`**。降 frameSize 只改 cols/rows，不動行高，**很可能無效**。
  下一步應改為：加大每次重複數（≥15）並改測**畫面中段行**（排除末行邊緣效應），確認 `cellHeight` 假說；若成立，S7 的正解是換 variant（如 CJK 時走 `8on22-bw`）而非改尺寸。另須注意 runtime 規劃器走 `resolveShape`，且 `8on22-bw` 的 `FRAME_DATA_BYTES_PER_SHAPE` 為 20,000（比 silver 的 870,000 小 43×），換 variant 反而**大幅**降低位元組壓力。

### 未落地 / 已知中間態（勿誤認為完成）

- **補丁 0052 已提交 `b059edc`**；**S11 措辭修正與 root 傳遞已提交 `8377e67`**。本任務產物已全部落地，工作區在 `trellis/ds-snapcompact-tuning` 分支（剩下的未提交項皆非本任務）。
- **silver 幾何未改**：`silver16-bw.frameSize` 仍是 1568。
- **PRD 的 AC3 未實作**（CJK frameSize == 1280），因為 S7 未動。
- **S4 的「DS 被誤拒」是推論非觀測**：全量日誌僅 2 次 `Snapcompact projection would not reduce context`，**兩次都是 gemini-3.8-flash**（google 家族，1120），且 0045 早於兩者部署。DS 路徑的收益是**防止未來誤拒 ＋ 投影準確性**，不可宣稱修好了一個已觀測故障。
