# billion-context-omp 深讀報告（已棄坑，0.3.3）

日期：2026-09-03｜對象：`ranxianglei/billion-context-omp` HEAD｜版本：0.3.3，`acp-kernel` 0.0.44，devDeps 全部 17.3.8

## 第二代架構：手術只在線路上

- `context` 降成純觀察者（`src/index.ts:188-206`），碰訊息陣列即回灌，當年 #22、#47、#52 即此迴路。
- 唯一手術點：`before_provider_request` 的線路 payload（`src/index.ts:229-303`），三層放行：非線路體透傳、未知格式透傳、內容不可重建透傳，例外也透傳。
- 流程：payload → kernel codec 轉核心（內容雜湊 id）→ `foldStreamCore` 增量加壓縮重播 → `processTurn` → 重建回線路 → 替換返回。

## 送不送得到（`src/transform-mode.ts`）

- `MIN_HOST_VERSION=[17,3,8]`（`src/transform-mode.ts:9`）：更舊宿主丟改寫，壓縮等於沒送（#79、#83）。
- 有 codec 且真送達只有四種：`anthropic-messages`、`ollama-chat`、`openai-responses`、`openai-completions`。
- 舊結論寫 `bedrock`、`cursor` 連改寫都丟，`google`、`devin` 無 codec 只能放行。此為 17.3.8 視角，現行版是否仍成立見 03 號報告。

## 保不保真（`src/wire-fold.ts`）

- Anthropic 只認 `text`、`tool_use`、`tool_result`、`thinking`、`image`；`document`、`redacted_thinking`、`server_tool_use` 等會被重建丟掉，先擋下不壓。
- OpenAI 只認五種 role；`function_call`、`audio`、`refusal` 等欄位會掉，先擋下不壓。
- OpenAI 兩道手工接回：
  - `restoreOpenaiWireFidelity`：補工具呼叫的空字串與 `reasoning_details`（#105）。
  - `restoreOpenaiSystemPrefix`：把開頭系統提示掛回去，未接回在 glm-5.3 實測系統長度 45151 掉到 0。
- `responses` 走 projection 原位 patch，不透明欄位才留得住。
- 線路標籤合約（#66）：只標工具結果片段，剝掉助理文字標籤，工具呼叫參數保持乾淨。

## 狀態與重啟（`src/runtime.ts`、`src/fold-persist.ts`）

- `FoldSlot` 加檢查點，id 空間為內容雜湊，同線路重算即同 id。
- `preview` 不持久化，只存真線路摺疊（`src/fold-persist.ts:45-47`）。目錄預設 `~/.omp/acp-omp-folds/`，`ACP_OMP_FOLD_DIR` 可覆蓋。
- `isViewFlip` 判視圖切換，`preserveCompressedSlot` 保住區塊；`restoreFold` 三道閘，擋過重啟 block-id 碰撞致壓縮落地即滅活的 #141（PR #140 已於真實會話驗證）。
- 當年鏡像重建猜錯宿主投影，1988 對 1692，一個錨點都對不上，才改成只信真線路檢查點（#64、#130）。

## 工具層（`src/compress-tool.ts`）

- `loadMode essential`：避開掛到 `xd://compress` 後的雙重轉義（#21、#36）。
- 參數缺欄位直接拒絕並計入連續拒絕；指紋 `[fp=]` 與位置 `[pos=]` 寫進結果文字，隨串流持久，供重播時比對（#91）。
- 熔斷：第三次連續拒絕加 STOP，第四次起壓掉細節。

## 糾正：`instance-guard` 沒有擋住雙載入

- `src/instance-guard.ts` 經 `~/.omp/.billion-context-omp-instance.json` 加 60 秒窗比對，`?mtime` 先剝掉（#88）。
- `stampAndDetect` 只讀 marker、記警告、再蓋掉，兩份仍各自註冊 handler。驗證不能只看 marker，要斷言實際 payload 被換掉，且每次請求只有一條改寫記錄。

## 更新檢查（外掛行為）

- 呼叫點：`src/index.ts:146-148`（`session_start`）加 `src/index.ts:462-465`（每次改寫之後）。
- 3 分鐘檔案戳節流加互斥，有新版真的 `npm install --no-save` 再驗證，失敗回滾。驗證一律 `ACP_AUTO_UPDATE=0`。

## Open issues 一句摘要

- #141：跨世代 block-id 碰撞，落地即滅活，PR #140 已修。
- #121：弱模型參數零容錯，約五成失敗，收斂至核心 #129。
- #120：要求自動關原生壓縮，`disableHostCompaction` 已在（`index.ts:32-42`）但 issue 仍開著。
- #112：壓縮過度注入，單行 issue，無更多正文。
- #92：全項目 review 匯總，行號已漂移。
- #67：`primeFold` 指紋殘留，顯示層自癒，無資料風險。

## 未讀到

- `acp-kernel` 本體、`src/config.ts`、`tests/` 全目錄、`src/messages.ts`、`src/system-prompt.ts`、`src/dump.ts`、`src/tool-guardrails.ts`。
