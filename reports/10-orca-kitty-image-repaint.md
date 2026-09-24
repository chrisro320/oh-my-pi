# Orca／OMP kitty 圖片丟失與重繪調查報告

日期：2026-09-24｜對象：`@oh-my-pi/pi-tui` 18.2.10（omp 18.2.10）｜現場：Orca IDE 1.4.210 內建終端、`~/.config/orca/terminal-history/<hash>/output.log`、會話 `01a0d353-e6f1-7000-93bf-c2dfcd26bb46`

## 本輪修復：Orca 1.9.2＋OMP 0078／0079

會話 `01a0d45c-c800-7000-b2e0-08fbf5ce6c26` 的 40 張 PIL 批次暴露三個獨立缺口，下方「不需修改 omp」僅適用前輪 ED／快取問題，不適用本輪：

1. Orca `queueAgentIdleTerminalModeReset` 把 `ESC[0 q` 插進未結束的 Kitty PNG base64。捕獲原生 write stack 與解碼失敗；僅有 PNG header／IEND 不能證明內容完整。1.9.2 改為輸出排序 callback 直接執行既有模式 handler。
2. OMP 同一 PIL MIME bundle 同時輸出 PNG 和 JPEG。0078 改為 PNG 優先／JPEG fallback，不去重獨立 display 呼叫。
3. OMP 工具結果在 5 張 WebP→PNG 尚未完成時就退休。0079 以 pending conversion 計數阻止過早封存，成功／失敗都釋放；只遞增 blockVersion 的試驗仍只有 35 張，已捨棄。

冷啟動隔離 Orca＋真實 OMP PID 2093363，原 40 張混合尺寸（35×400×260、4×900×600、1×1280×720）全部傳輸、完整放置。初次、80 行文字後、切頁返回後各 80 次三點像素回訪，共 240 次通過。使用完整 20 行 placement 作 anchor，不把進度殘片當完整歷史。

Orca 1.9.2 已部署，與驗收 ASAR 同為 `52a511a2df9b40b65f93d310159258b9e13f33c3be59e1dd9701650016f107ec`。按使用者要求設 **64 MB**，不是圖片數量上限；placement／解碼快取各最多 64 MB，壓縮歷史另計。本批峰值 25.04704 MB，不冒充超預算測試；前輪 32 MB／64 張壓力測試獨立保留。

0078／0079 已註冊到 18.2.10 的 AGENT／TUI patch plan 與 verifier，完整 46 補丁 pristine replay 通過。兩個專項回歸均先在舊源碼失敗，再在修復版通過。未更改 `agent.db`、憑證或既有 session。
部署後再用正式 `~/.bun/bin/omp` 冷啟動 PID 2119789，原批 40 張全部傳輸／放置，另通過 80 次像素回訪。標準 `apply.sh` 本次僅套用 0078／0079，所有註冊回歸通過；源檔已獨立備份於 `~/.omp/patches/backups/20260924-kitty-0078-0079/`，與隔離验收源碼逐位元組相同。


未重啟正式程序；**完整退出 Orca，再開新終端啟動 OMP** 才能載入全部修復。原生首／中／末截圖與逐次量測見 `~/orca/projects/orca-update-patch/reference/kitty-bulk-40-*`。未建立 Trellis 任務。

## 前輪 1.9.1：歷史快取修復（含 64 張壓力驗收）

**修復位於 Orca addon；不需修改 omp。第一輪雙圖修補不完整，1.9.1 補上快取满載後的歷史保留。** 後文「同 placement ID 不重畫」「omp 重畫時機」「非同步解碼造成 anchor 漂移」均不是實測根因。原生 xterm APC parser 會等待 Promise；解碼前後游標未漂移。

實際失效鏈為：
`eraseInDisplay → _resetBufferLine → clearMarkers → marker.dispose → ImageStorage._delImg → KittyImageStorage._handleStorageImageDeleted → _images.delete(kittyImageId)`。
畫面擦除錯誤地連帶釋放 transmit-once 資料，下一次 `a=p` 無資料可畫。另有每次 placement 重解碼／重配置，以及小數 cell width 的 tile 欄數取整問題。

權威實作在 `~/orca/projects/orca-update-patch/bin/kitty-image-repair.mjs`，標準部署入口為同目錄 `orca-kitty-images-patch.py`，已安裝 **1.9.1** dpkg trigger：

- 分離 transmitted data 與 placement 生命週期；ED/EL 正常清 cell，後續 `a=p,C=1` 重用有界快取復原。
- raster 淘汰只釋放像素，不刪除有效 scrollback 的 cell ID、幾何與壓縮來源；回捲按需復原。解碼／placement 像素各受 32 MB 預算限制，歷史壓縮資料另隨 scrollback 增長，不宣稱總 RAM 只有 32 MB。
- 舊 1.9.0 在 64 張大圖下只剩 41 個 placement，前 23 張消失。新 renderer/web 各通過 134 次回訪，跨越 38.11 MB PNG 與 112.9 MB 投影 raster 壓力；快取峰值 30.6 MB，行淘汰／delete-all／RIS 後用量歸零。
- 冷啟動隔離 Orca＋真實 OMP `read` 讀取 64 個不同 2048×1536 PNG；OMP 正常縮圖為 1568×1176。相同 OMP PID 2020319 回報 kitty，實際終端收到 64 個不同 transmit ID、未見 OSC 1337。
- 原生逐張正反回捲共 128 次，64 種 fixture 底色全符合；峰值 31.47776 MB，最慢回訪 66.3 ms。再連續輸出 80 行，重新逐張檢查仍保留 64 張。離線 provider 未呼叫外部模型。
- 第一輪雙圖、設定面板、輸入和分割驗證仍有效，但不能替代本次幾十張圖的壓力驗收。
- ASAR patch/status/冪等/revert 雜湊還原通過，2938 個非目標 packed entry 不变。未知版本／簽名損壞 fail closed。

修復鎖定 Orca 1.4.210，正式 ASAR 與已驗收產物 SHA-256 同為 `579778520a8010db627df57b8a112a9617562ffd243db0b5ca90354f9933f236`。已知舊 suffix 可精確升級，未知 suffix 拒絕；整包回滾保護其他後續修改。Claude 兩條輪詢保護不變。

**完整重啟 Orca，再開新終端啟動 OMP** 才生效；未中斷目前的正式程序。現場 `.profile` 原本為 iterm2，已改回 Orca-only kitty，新建正式終端已驗證。既有 OMP 不會因工具子 shell export 改變協議，也無法復原先前已丟失的圖片。

詳細證據、首／中／末原生截圖與量測見 `~/orca/projects/orca-update-patch/INLINE-IMAGES.md` 及 `reference/kitty-history-64-metrics.json`。未建立 Trellis 任務。

以下保留各輪調查歷史，涉及根因與修法的舊推論以上述最終結論為準。

## 結論

在 Orca 的內建終端（`TERM_PROGRAM=Orca`）以 kitty 協議顯示內嵌圖片時：**讀一張圖正常顯示，讀兩張起兩張全部空白**（重現 3 次）。

omp 送出的位元組流**完全正確**（分片 `a=t`、獨立 `a=p`、順序、清行，皆已逐塊核對）。問題出在 **omp/pi-tui 重複 placement 的重畫時機**：

- Orca 的圖片 addon 把圖畫在**獨立 canvas 層**，靠 `onRender` 重畫；重複出現**同一個 `(image id, placement id)`** 的 `a=p` 不會觸發重畫。
- omp 每幀重繪都送同 id 的 `a=p`，一旦圖被擦掉（例如 TUI 清行），**它永遠回不來**。
- 結論：需要的是「**重畫**（新 placement id 或先 `d=i` 再放）」，不是「重放置」。

**未實作、也未 100% 定案**：此報告只交付已驗證的事實與建議切入點。Orca addon 的清除路徑未定位到具體分支，因此**不建議改 `app.asar`**。

## 環境

- Orca IDE 1.4.210（`/opt/Orca/resources/app.asar`）
- `~/.profile`：`if [ "$TERM_PROGRAM" = "Orca" ]; then export PI_FORCE_IMAGE_PROTOCOL=kitty; fi`
- omp：18.2.10；pi-tui：18.2.10（`exports.import` 指向 `src`，即直接載入 TS 源碼）
- 需要此變數的原因：pi-tui 的 `KNOWN_TERMINALS` 把 `orca` 的 `imageProtocol` 釘成 `null`

## 重現

```
1. 在 Orca 終端啟動：PI_FORCE_IMAGE_PROTOCOL=kitty omp --no-session
2. 讓 omp 讀一張圖（例如 read 一個 PNG）→ 正常顯示
3. 再讀第二張 → 兩張一起變空白
```

穩定重現 3 次（會話 `01a0d353…`、測試終端 DBGIMG、FIXTEST）。

## 現場證據

### 1. omp 端：兩張圖都有排入 transmit 佇列

在 `src/components/image.ts` 暫時插樁（已還原）後的輸出：

```
enqueueTransmit OK id=1158195 surface=screen len=65364
enqueueTransmit OK id=1158196 surface=screen len=110375
takeTransmits surface=screen pending=2 screen=2 alt=0
```

### 2. 終端實收：兩張圖的分片傳輸與放置都完整

`~/.config/orca/terminal-history/…@35066633/output.log`（65 萬 bytes）事件順序：

```
@321      a=d,d=A,q=2                                  ← omp 啟動時的清圖
@414954   a=t,f=100,q=2,i=1158195,m=1 …（16 塊，尾塊 m=0）
@480323   a=t,f=100,q=2,i=1158196,m=1 …（尾塊 m=0）
@592443   a=p,q=2,C=1,i=1158195,p=1,c=73,r=20
@592765   a=p,q=2,C=1,i=1158196,p=1,c=73,r=20
```

`a=p` 之後每幀重複；**整個日誌沒有任何 `d=I`/`d=A` 刪圖指令**。

### 3. omp 重繪時實際寫入的片段（`src/tui.ts:3466` 附近）

```
\x1b[2K                    ← 圖片行：整行清除
\x1b7\x1b[19A              ← 保存游標、上移 19 行
\x1b_Ga=p,…,c=73,r=20\x1b\\  ← 重新放置（同一個 placement id）
\x1b8
\r\r\n\x1b[0m\x1b[0m\x1b[K …
```

### 4. Orca addon 的結構（抽出 `/out/renderer/assets/addon-image-DAd04cB5.js`，77509 B）

註冊的 handler 全集：

```js
registerCsiHandler({prefix:'?',final:'h'}  → _decset
registerCsiHandler({prefix:'?',final:'l'}  → _decrst
registerCsiHandler({final:'c'}             → _da1
registerCsiHandler({prefix:'?',final:'S'}  → _xtermGraphicsAttributes
registerCsiHandler({intermediates:'!',final:'p'} → reset
registerEscHandler({final:'c'}             → reset
_core._inputHandler.onRequestReset        → reset
buffer.onBufferChange                     → _storage.wipeAlternate
onRender                                  → _storage.render
```

- **沒有任何 `ESC[2K`（EL2）的 handler**
- `render()` 只在 `this._images.size === 0` 時 `clearAll()`；圖繪於獨立 canvas 層（`insertLayerToDom`）
- addon 內 `10EEEE` 出現 **0 次** → 不支援 unicode placeholder

## 已排除的假設（全部實測）

| 假設 | 證據 | 結果 |
|---|---|---|
| Orca 不支援分片 `a=t` + 獨立 `a=p` | 用 python 送同構序列（分片首塊帶參數、續塊 `m=`、尾塊 `m=0`，其後單獨 `a=p`） | **顯示正常** → 假 |
| 第二張沒送出 transmit | 見上「現場證據 2」 | **假** |
| 多個 transmit 串在一次寫入被截斷 | 一次寫兩個 `a=T` | **兩張都顯示** → 假 |
| `ESC[2K` 抹掉圖片是主因 | 手動在圖上送 `ESC[2K` → 只剩殘片；但把 omp 圖片行改成 `ESC[K`（`ERASE_TO_END_OF_LINE`）後**依然不顯示** | 部分真、非主因 |
| `eraseInLine` 清掉 cell 的 `_extendedAttrs`，addon 因此畫不出圖 | EL0 與 EL2 走同一條清除路徑、清同樣的 cell；實測送 EL0 後**再強制觸發文字 render**，圖**仍在畫面上** | **假** |
| 是 webp 轉換問題 | 純 PNG（`p2.png`、`here.png`）同樣不顯示 | **假** |
| 用 unicode placeholder 繞開 | `PI_KITTY_PLACEHOLDERS=1` → Orca 把 `U+10EEEE` 畫成整片豆腐 | **不可行** |

## 指向 omp 側的推理

1. 手動送同構序列（同樣的分片 + placement）→ **顯示正常**：Orca 的接收與繪製沒問題。
2. 手動 `ESC[2K` 覆蓋 → 圖變殘片，但 addon 的 `_images` 未被清（日誌無刪圖指令）→ 擦的是 canvas 上的繪製結果。
3. omp 之後每幀重送**同 id、同 placement id** 的 `a=p` → 圖**不再出現**。
4. 因此失效點是「重放置 ≠ 重畫」：addon 判定該 placement 已存在，跳過重繪。

`src/components/image.ts` 已有 `resolvePlacementEmit` 的 **placement id epoch** 機制（用於寬度變化時換 epoch），本次情境顯然沒有涵蓋「行被外部擦除」或「圖片元件重建」這兩種失效。

## 尚未完成的關鍵驗證（會改變修點歸屬）

目前的手動對照測試有一個缺口，足以推翻本報告的歸屬判斷：

| 已測 | 未測 |
|---|---|
| 兩張 `a=T`（單包 transmit+display）→ 兩張都顯示 | **兩張 `a=t` 分片 + 分離 `a=p`（與 omp 同構：不同 id、`c=73,r=20`、各自游標位置）→ ？** |
| 一張 `a=t` + `a=p` → 顯示 | 上述雙圖再加「持續重繪」 |

- 若「兩張 direct placement」的**第二張才失敗** → 修點在 addon 的 `KittyImageStorage` / `ImageStorage.addImage`（tileCount / marker 狀態），與 `ESC[2K` 無關。
- 若兩張都正常 → 失效來自 omp 側的渲染時序/座標系，而非 addon 的多圖管理。

**這個實驗必須先做，任何 patch 才不是猜測。**

## 建議修法方向（omp 側，未實作）



1. **首選**：圖片元件在偵測到自身輸出被外部覆蓋後，走 `resolvePlacementEmit` 換一個新的 placement id（或先送 `d=i` 刪除該 placement，再重新放置）→ 迫使 addon 重畫。
2. 或者在 `ImageBudget` 這一層提供「強制重畫」信號（類似既有 `#resetPurgeIds` / `forgetTransmitted()` 的破壞性重繪路徑）。
3. 起點檔案：
   - `src/components/image.ts`：`ImageBudget.resolvePlacementEmit`、`observeCommitWatermark`、`#placementState`
   - `src/tui.ts:3466`：圖片行的 rewrite（EL2 + `#imageLineSequence`）
4. 驗證方式：在 Orca 終端以 kitty 協議連續讀兩張圖，確認第二張到來後第一張仍在；再讓畫面捲動後確認不回退。

## 對照：iTerm2 協議（現行 fallback）

| 協議 | 卡 | 圖消失 | 機制 |
|---|---|---|---|
| iTerm2（`ESC]1337;File=`） | 卡 | 否 | 協議無 transmit-once，omp 每幀重送整張 base64（可用 `tui.maxInlineImageColumns` 縮圖緩解） |
| kitty（`ESC_G`） | 不卡 | **是** | 本報告主題 |

## 相關檔案與工具

- 本報告的完整取證記錄（含假設排除過程）：`~/orca/projects/orca-update-patch/INLINE-IMAGES.md`
- Orca addon 抽出方式：解析 `app.asar` header（`8 + headerSize` 起為資料區）取得 `/out/renderer/assets/addon-image-DAd04cB5.js`；`/out/web/assets/` 另有一份（77588 B），本次未逐位元組比對
- 終端位元組流：`~/.config/orca/terminal-history/<worktree-hash>/output.log`

---

## 補充：根因已定位（2026-09-24 第二輪取證，實測確認）

**報告原假設「同 (i,p) 重複 placement 被 addon 去重跳過」是錯的。** 抽出 `addon-image-DAd04cB5.js` 逐函數讀 + Orca 終端活體探針，真實機制：

### Orca addon 的真實模型（xterm.js addon-image 架構）

1. `a=p` → `_handlePlacement` → `_displayImage` → **`async _decodeAndDisplay`**：`await createImageBitmap` 之後才讀 `buffer.x/buffer.y` —— **錨點 = 解碼完成那一刻的游標位置**，不是 `a=p` 被解析時的游標。
2. `addImage` 把 tile 引用寫進 **buffer cell 的 `_extendedAttrs`**（`_writeToCell`），並 `lineFeed` 逐行下移（`scrolling` 硬編碼 `true`，`C=1` 事後才還原游標）。
3. `onRender → render(start,end)`：每幀 `clearLines` 後**從 cell refs 重畫** —— 圖不靠 placement registry 活，靠 cell 裡的 refs 活。
4. **`p=`（placementId）有解析、零使用**：無去重、無 registry——每次 `a=p` 都重新 decode + `addImage`（舊 storage image 成孤兒，不刪）。
5. `a=d` 只實作兩條分支：`d=a/A` 全清；`d=i/I` → `deleteById(i=)` **整張圖連資料刪除，`p=` 無視**。`d=p/n/c` 等 → `default: break` 不支援。
6. **無 kitty 應答**：`a=p` 不帶 `q` 實測 1.5s 無任何回包（`_sendResponse` 走 `triggerDataEvent`，到不了 PTY）→ 用應答做串行化的方案不可行。

### 活體探針結論（Orca 終端實測）

| 實驗 | 結果 |
|---|---|
| `a=p` 在寫入流中段、後面還有文字 | 圖錨到**批次結尾游標**（非預期行），refs 被後續寫入抹掉 → 空白 |
| `a=p` 為**最後位元組**、游標留在圖頂、之後無輸出 | **正確錨定**（後續 prompt 覆寫只造成頂部殘片，與「殘片」觀察一致） |
| 首張圖能顯示 | 巧合：批次結尾游標 ≈ 圖頂；負載下即失效 |
| 修正版幀序列：圖行不擦 + 幀尾 `CUP 圖頂 + a=p` | **圖正確顯示** |
| 之後整屏重寫但圖行只送 `\x1b[0m` 不擦 | **圖存活**（cell refs 未被清） |

### 失效鏈總結

omp 每幀對圖片塊做 `EL2/EL + 同 id a=p`：EL 抹掉 cell refs → 圖消失；`a=p` 非同步解碼後錨到批次結尾游標（park 位）→ refs 寫到錯誤行 → 再被下一幀抹掉 → **永久空白**。單圖時因結尾游標恰好≈圖頂而倖存。

### 修法設計（機制層已驗證；**端到端未驗收，勿直接產 patch**）

**置信分級**：

- **已證明（source + 活體探針）**：上節機制全部——非同步錨定、cell refs、EL 抹除、`p=` 無效、`d=i` 刪整圖、無應答。
- **局部機制 probe（手寫 APC smoke，非 OMP 回歸）**：`a=p` 作最後位元組 + 游標留圖頂 → 正確錨定；圖行不擦的重寫 → 圖存活。局限：probe_f2 phase1/2 座標未對齊（TOP=4 vs 實際 row 3）、無 frame provider/diff/overlay/hardware cursor/雙圖——只證機制可行，不證 TUI 整合正確。
- **Hypothesis（未驗證）**：下列設計在真實 omp 的端到端行為——
  - quiet window 只是啟發式：omp 運行時獨佔終端寫入，延遲自身下一幀可保住游標，但 **decode 時間無上界、無完成信號**，不能保證「幀尾 CUP ⇒ 永遠正確錨定」；大圖/高負載下可能仍錯錨。
  - 多圖串行放置、anchored 台帳在捲動/overlay/resize/alt 下的正確性未驗收。
  - **驗收門檻**：真實 omp（非手寫 probe）連讀兩張圖 + 捲動 + overlay 開合，圖均存活；且 scrollback 中舊圖不回退。

**「錨定一次、永不擦除」**：


1. **行重寫**：kitty direct-placement 行 → 不輸出（無 EL2、無行內 `a=p`）；保留行 `\x1b[0m` → 只送 `\x1b[0m` 不擦。iTerm2/sixel/placeholder 行維持原路徑（`parseKittyDirectPlacementLine` 可區分）。
2. **幀尾放置**：幀 buffer 末尾（park 之後）對**一張**待放置圖送 `\x1b[<top>;1H` + 裁剪版 `a=p` APC（沿用 `encodeKittyPlacementLine` 的 r/y/h 裁剪），游標**停在圖頂**，補 `?25l` 藏游標。多圖每幀一張串行。
3. **anchored 台帳**（per surface）：放置後標記；purge/`d=I`、destructive reset、alt 進入（`wipeAlternate`）、**離開當前幀**（被 overlay 遮蓋→cell 被覆寫）時清除 → 回來時重新放置可自癒。
4. **quiet window**：放置幀後延遲下一幀 ~80ms（`scheduleRender` 已有延時機制），保證非同步 decode 完成時游標仍在圖頂；到期 `requestRender` 排幀補游標/放下一張。
5. `p=` 恆為 1：Orca 無視 `p=`；epoch 機制本就 dormant（`observeCommitWatermark`/`beginPlacementCoordinateEpoch` 全域無呼叫，`resolvePlacementEmit` 全傳 -1）。**不要**在 dormant epoch 上疊修補，也不要發 `d=i`（Orca 會連圖資料一起刪）。

### 切入點

- `src/tui.ts`：`#lineRewriteSequence`（~3465，圖行分支）、`#emitPlanFrame`（~2948 `paintEndSequence` 後、write 前插幀尾放置）、`#emitAltFrame`（~3604 同法）、`#doRender` 入口加 quiet-window 閘門、`#handleInput` 無需改（無應答可用）。
- `src/terminal-capabilities.ts`：`encodeKittyPlacementLine`（1021）抽出裸 APC builder 供幀尾用。
- `src/components/image.ts`：`PlacementEmitState`/`#placementState` 可放 anchored 旗標，或台帳直接放 tui.ts。
- 驗證方式：Orca 終端 `PI_FORCE_IMAGE_PROTOCOL=kitty` 連讀兩張圖，捲動後仍在；探針法見 `/tmp/k/probe_*.py`（transmit 分片 + `a=p` 位元組級模擬 + 截圖）。
- 補丁流程（專案規約 `.trellis/spec/backend/patch-rollup-contracts.md:33-43`）：禁止以 live/cache 當 pristine；用 SHA-256 驗證的 18.2.10 官方 tarball 建 TUI sandbox 產出 patch，登記 `apply.sh`/ledger 後才部署。
- **排除「換 fresh p=」方案**：addon 全檔 `placementId` 僅 3 處——解析存入 `t.placementId`、回包 echo 兩次；**零功能使用、無 (i,p) 去重**。每次 `a=p` 都重新 decode+addImage，換新 p 不改變任何行為；失效點是「非同步錨到批次結尾游標 + EL 抹 cell refs」，與 p 無關。同理「先 `d=i` 再放」不可行：Orca 的 `d=i` 走 `deleteById` 連圖資料一起刪。
- 若要縮小爆破半徑，整個「不擦 + 幀尾放置」路徑可用 `TERMINAL.id === "orca"` 做門（`PI_FORCE_IMAGE_PROTOCOL=kitty` 下 id 仍為 orca）；kitty/Ghostty 維持現行行內 `a=p` 重放置。但依 cell-anchored 語義，新模型在 kitty 上同樣成立（placement 依附 cell，不擦即存活），可不設門——取捨點在改動面積。
