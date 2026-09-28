# 執行計畫與記錄 — P2（暫定 0084）媒體工具背景化

> 規劃基線：omp **18.3.3**。本檔目前只是計畫；開工時先做步驟 0。設計依據：`design.md`（決策 D1–D14）、研究證據 `research/background-media-jobs-feasibility.md`；**衝突時以 `design.md` 的 X3 為準**（研究對同步 HTTP 建議 `queued: false`，X3 裁定一律 `queued: true`）。
> 補丁編號 `0084`、計畫計數 50 都是暫定；開工當下依 `patches/apply.sh` 重新分配並全文替換。

## 重驗紀錄
（開工時填：日期、`omp --version`、`revalidate.sh` 輸出摘要、每個 DRIFT 的判定與對 design 的修訂、PREREQ `p1-model-kinds` 是否已 `applied`；使用者核准修訂後才 `task.py start`）

## 規劃驗證（2026-09-28）

**腳本**：`.trellis/tasks/09-27-media-tools-background/revalidate.sh`（唯讀；DRIFT 影響退出碼，INFO／PREREQ 不影響）。55 道檢查＝50 道基線事實 + check 51／52（`asyncSettles` 宿主契約）+ check 53／54／55（D14 錯誤分類現況；由主代理 2026-09-28 加入、本方重跑確認）。

1. 正常執行（`OMP_ROOT` 未設，指向 live 18.3.3）：

```
omp pi-coding-agent version: 18.3.3
root: /home/chris/.bun/install/global/node_modules/@oh-my-pi
PASS 1 … PASS 55          （55/55 PASS，無 DRIFT；含 51 print/ACP 不 settle、52 print 回合後即 dispose、53/54/55 D14 錯誤分類現況）
INFO 1  tests shipped in install: 0 dir(s)
INFO 2  Object.keys(ctx)/JSON.stringify(ctx) observers in extensibility: 0 hit(s)
INFO 3  18.3.3 tail candidates in repo: 24 entr(ies), last: _omp_tail_candidate "18.3.3" "0082-omp-user-display-text" "${NM}"
INFO 4  18.3.3 plan contract line: 48-entry capability contract
INFO 5  external jimeng proxy 5100 http: 200
INFO 6  external media gateway 5200 http: 000
INFO 7  bun fetch connection-failure error code (D14 allowlist): ConnectionRefused
PREREQ p1-model-kinds: missing
PREREQ p2-media-job-type: missing
PREREQ p2-media-output-module: missing
PREREQ p3-generate-video: missing
PREREQ p4-music-kind: missing
drift=0
exit 0
```

2. 敏感度（`OMP_ROOT=/tmp/nonexistent-omp`）：

```
exit 1
DRIFT 1 … DRIFT 53（version/所有上游事實檢查皆 DRIFT，因檔案不存在）
drift=53
PASS 計數 = 2（僅「期望 0 命中」的 absence 檢查在空樹上假性成立）
```

結論：腳本在本機對未套本補丁的 18.3.3 全綠，且對不存在的 root 會 DRIFT 退出 1（不是恆真）。INFO 1/2 兩列即研究風險 9／10 的查證：install 不含測試、`extensibility/` 沒有 ctx 鍵集合觀察者。check 51／52 是 D13 的錨點：print／ACP 不會 `settleAsyncWork()`，print 跑完回合就 `session.dispose()`（背景化的媒體工作會被取消）。check 53／54／55 與 INFO 7 是 D14 的錨點：兩個工具的候選迴圈目前只認 `MissingApiKeyError`／`ProviderHttpError`、speech transport 自帶 60 s 逾時，且本機 Bun 1.3.14 的連線失敗 `code` 實測為 `ConnectionRefused`（決定 `MEDIA_FALLBACK_ERROR_CODES` 白名單）。

## Boundary

- 補丁改兩個套件，root 註冊用 `${NM}`（單一 root，hunk 路徑 `a/pi-coding-agent/...`／`a/pi-tui/...`）：`pi-coding-agent`（`async/job-manager.ts`、`extensibility/custom-tools/types.ts`、`extensibility/extensions/{types,runner}.ts`、`sdk.ts`（`CreateAgentSessionOptions` + 三個注入點）、`session/agent-session-types.ts`（`AgentSessionConfig`）、`session/agent-session.ts`、`session/session-tools.ts`、`session/async-job-delivery.ts`、`tools/media-output.ts`（新；含 D14 錯誤分類匯出）、`tools/image-gen.ts`、`tools/tts.ts`、`main.ts`（`sessionOptions.asyncSettles`）、`task/executor.ts`（`buildSubagentSessionOptions`）、`modes/controllers/tan-command-controller.ts`）與 `pi-tui`（`tools/wait.ts`、`chat/media-thumbnail.ts`（新）、`chat/transcript-render-helpers.ts`、`chat/chat-transcript-builder.ts`），加上對應 `dist/types/**`（design D11）。
- 使用者設定：`~/.omp/agent/config.yml` 開啟 `generate_image.enabled` / `speechgen.enabled`（後端就緒時）；`models.yml` 的 `kind: image|tts` 由 P1（0083）提供，本切片不動。改前做時間戳備份。
- 不改：omp install 的 `.installed` 同層目錄、`~/.omp/patches/` 以外的 `~/.omp/**`、`models.yml`（除 P1 已寫入者）、`patches/` 其他計畫、ComfyUI、即夢反代、其他 task 目錄、git 歷史。
- 輸出／patch／log／commit 一律不得出現憑證內容（`revalidate.sh`、閘門 fixture 只用假 baseUrl 與 `apiKey: "!printf fixture"`）。

## Sequence

0. [ ] **開工前重驗**：`bash .trellis/tasks/09-27-media-tools-background/revalidate.sh` → 必須 `exit 0`（55/55 PASS）。逐列判定 DRIFT（若有），並確認 `PREREQ p1-model-kinds: applied`（未 applied = P1/0083 尚未落地，**停止**，先完成 P1）；`PREREQ p2-*` 應為 `missing`（本切片尚未實作）。特別確認 **check 51／52**（print／ACP 不 settle、print 回合後即 dispose）：這兩列若 DRIFT（上游讓 print／ACP 也 settle），就依 D13 刪掉 `asyncSettles` 旗標與判斷式中的該項；**check 53／54／55 與 INFO 7** 是 D14 錨點：若上游已放寬降級分類（53／54 DRIFT）就刪掉對應分支改用上游，若 INFO 7 的 `code` 不再是 `ConnectionRefused` 就更新 `MEDIA_FALLBACK_ERROR_CODES` 白名單。結果寫入上方「重驗紀錄」，依當下 `patches/apply.sh` 重新分配補丁編號（暫定 0084 → 實際 tail+1）與計畫計數（P1 落地後 49 → 本層 +1），並**全文替換**本檔與 `design.md` 的暫定編號。
1. [ ] **Pristine base**：從官方 `@oh-my-pi/pi-coding-agent` / `pi-tui@<當下版本>` tarball 取被改檔案，先套用撞到同檔案的既有層（`0010`、`0082` → `extensibility/extensions/{types,runner}.ts`；`0032`/`0038`/`0047` → `sdk.ts`；`0075` → `session/session-tools.ts`；`0079`/`0080` → `pi-tui/src/chat/{tool-execution,image-loading}.ts`）。用 `patches/apply.sh --print-plan` 找出確切清單，並以 `cmp` 證明 a 側 == live 樹（含 `dist/types`）。`async/job-manager.ts`、`pi-tui/src/tools/wait.ts`、`chat/transcript-render-helpers.ts`、`tools/{image-gen,tts}.ts`、`session/async-job-delivery.ts` 目前無既有層 → a 側 = pristine。
2. [ ] **紅燈閘門**：寫 `patches/verify-media-background-jobs.ts`（root-selected imports：`OMP_PATCH_VERIFY_NM` → 各 `OMP_PATCH_VERIFY_<PKG>_ROOT`，載入失敗必須 abort 而非 pass）。fixture：
   - 隔離 `PI_CODING_AGENT_DIR` 放 `models.yml`：provider `gatetest`（`baseUrl` = gate 內 `Bun.serve` 隨機埠、`apiKey: "!printf fixture"`），模型 `gate-image`（`kind: image`、`api: openai-images`）、`gate-speech`（`kind: tts`、`api: openai-speech`）；**依賴 P1 的 `kind` 支援**（P1 未落地時 fail-closed 並指名缺前置）。
   - 真 `Settings.isolated` + 真 `ModelRegistry`；`modelRoles.image`/`modelRoles.speech` 指 fixture 模型；`cfgAsyncEnabled` 保持預設 true。
   - `Bun.serve` 假後端：`POST /images/generations` 回 `{data:[{b64_json:<固定 PNG>}]}`、`POST /audio/speech` 回固定位元組（`Content-Type: audio/mpeg`），並記錄收到的 `Authorization`/`model`/請求次數。**可切換的模式**（供 D14 案例）：正常／延遲 N ms／**不回應**（hold 住連線以觸發本次逾時）／**HTTP 200 但缺 `data`**（觸發 `ProviderResponseError`）。另備「已關閉的埠」：先 `Bun.serve` 取得埠再 `stop()`，把該 URL 當作第一候選的 `baseUrl`（連線被拒）。
   - 真 `AsyncJobManager`（`maxRunningJobs: 2`）＋ `registerDeliverySink("GateOwner", sink)`；ctx 以字面量組出 `CustomToolContext` 的 7 個既有欄位 ＋ `asyncJobManager`、`agentId: "GateOwner"`、`asyncSettles: true`（`createCustomToolContext` 未匯出，無法直接呼叫）。另備兩個變體 ctx：**print-like**（同樣的 manager/agentId，`asyncSettles: false`）與 **no-agent**（manager/`asyncSettles: true`，`agentId: undefined`）。
   - 斷言（每條都要有一個「行為被移除即紅」的變體）：
     a. **立即回傳**：`imageGenTool.execute(...)` 在假後端延遲期間即 resolve，`details.async = { state: "running", jobId, type: "media" }`，耗時 < 假後端延遲（unpatched 樹會等到生圖完成才回 → 紅）。
     b. **ownerId delivery**：sink 收到 `GateOwner` 的完成回報，文字含 `generated/image/` 絕對路徑與 `provider/model`；以 `ownerId: undefined` 的對照註冊斷言「不會送達任何 sink」（dead-letter 面）。
     c. **queued 名額語意**：先註冊一個長跑的非 queued job 佔 1 格（cap=2）；媒體 job 以 `queued: true` 必須註冊成功；在假後端回應到達前 `manager.atCapacity === false`，回應到達後（`markRunning()`）`atCapacity === true`（證明 D4 的時機；把 `queued: true` 改成 false 會讓第一步 throw → 紅）。
     d. **abort 傳遞**：`manager.cancel(jobId, { ownerId })` 後 job 狀態 `cancelled`，假後端觀察到連線中止，且 `generated/image/` 沒有新檔。
     e. **輸出路徑**：檔案落在 `<cwd>/generated/image/<YYYYMMDD-HHmmss>-<provider>-<model>.<ext>`；同秒第二張得到 `-2` 後綴（純函式斷言 `generatedMediaPath`）。
     f. **`output_path` 只是額外複製**：`tts.execute` 帶 `output_path` 時，`generated/audio/…` 與指定路徑**兩份都存在且位元組相同**；不帶時只留 `generated/audio/…`（schema 已放寬為選填）。
     g. **無 manager → 前景 fallback**：ctx 去掉 `asyncJobManager` 後 `execute` 仍回完整結果、`details.async.state === "completed"`、檔案存在（且不 throw）。
     h. **縮圖不進 provider content（背景）**：`buildAsyncResultBatchMessage` 對媒體 job 產出的訊息 `typeof content === "string"`，`details.jobs[0].images` 有縮圖（D8 第 1 條）。
     i. **縮圖不進 provider content（前景，F13）**：前景 `execute` 結果的 `details.images` 有縮圖（顯示面），且 `details.async.state === "completed"`；把縮圖改放 `content` → 這條紅。
     j. **provider payload dump（兩條路徑 + 對照組）**：把 (a) 前景 tool result（帶 `details.images`）、(b) `async-result` 訊息（帶 `details.jobs[].images`）、(c) **對照組** bash job delivery（帶 `latestDetails.images`，本來就該進 content）三者送進 `${AI_ROOT}` 的 provider message 編碼函式，斷言 (a)(b) 序列化結果不含任何 image part／base64 片段、(c) 含 image part（證明 dump 非恆真）。研究把「details 不進 provider」標為 `[推論]`，這條把它變成實測。
     k. **print-like ctx（`asyncSettles: false`／缺省）→ 前景**：manager 在手也要走前景（`details.async.state === "completed"`、**沒有** job 註冊進 manager、sink 不收到任何 delivery）；把判斷式中的 `asyncSettles` 拿掉 → 這條紅（D13）。
     l. **缺 `agentId` → 前景**：`asyncSettles: true` 但 `agentId: undefined` 時同樣前景（且**不得**出現 `ownerId: undefined` 的註冊；用 `manager.getRunningJobs()` 斷言沒有新 job）；把 `ctx.agentId !== undefined` 拿掉 → 這條紅（D3 的 dead-letter 面）。
     m. **runner 注入**：`new ExtensionRunner(...).createContext(undefined, { toolName, context: { asyncJobManager: mgr, agentId: "GateOwner", asyncSettles: true } })` 的三個欄位等於傳入值（unpatched → `undefined` → 紅）；另加文字級結構斷言（`createCustomToolContext` 的投影含這三個鍵、`SessionToolsHost` 有欄位、`main.ts`/`task/executor.ts`/`tan-command-controller.ts` 有 `asyncSettles` 賦值）**並標明它只是結構補強，不是行為證明**。
     n. **D14 錯誤分類（`generate_image` 與 `tts` 各跑同一組案例）**：
        - 第一候選指向**已關閉的埠**（`code === "ConnectionRefused"`，實測形狀見 D14 表）→ **降級**、第二候選成功（unpatched：連線錯誤直接中斷整條鏈 → 紅）。
        - 第一候選的假服務**不回應**且本次請求逾時（`name === "TimeoutError"`）→ 降級、第二候選成功。
        - **使用者／會話 abort**（`signal.aborted`）→ **不**嘗試第二候選（斷言假後端只收到一次請求）。
        - **後處理**（寫檔、`copyMediaToOutputPath`）丟 `TypeError` → **不**降級、直接失敗（證明 `try/catch` 只包住 transport 呼叫；把 `try` 擴大到後處理 → 這條紅）。
        - 假服務回 **HTTP 200 但缺 `data`** → `ProviderResponseError`（`pi-ai/src/images/shared.ts` `decodeImageResponse`，即夢 HTTP 200 + `{code}` 的同形狀）→ 降級、第二候選成功。
        - 帶 `mediaFallbackEligible` 標記的錯誤（模擬 P3 gateway `failed`／`expired`）→ 降級。
        - 反向對照：transport 直接丟 `TypeError`（假服務改成回非 JSON、讓解碼前的程式錯誤浮出）與其他未知錯誤 → 照舊拋出，**不得**降級。
        - 案例要能區分：每個案例都要在「拿掉對應分類分支」時紅（關埠／逾時／ProviderResponseError／marker 各一條），abort 與後處理兩條則在「把 try 擴大」時紅。
   對 live（未補）樹執行必須紅，且紅在 (a)/(c)/(j)/(k)/(l)/(m)/(n) 這類斷言，不是 fixture 缺失。
3. [ ] **實作**：依 design D1–D14 改 25 個檔案（含新檔 `tools/media-output.ts`、`chat/media-thumbnail.ts`）；缺省值不得新增鍵；三個 ctx 欄位一起注入（`CustomToolContext`/`ExtensionContext`/`runner`/`getSessionContext`/`createCustomToolContext`/`SessionToolsHost`/`main.ts`/`task/executor.ts`/`tan-command-controller.ts`）；背景化判斷式一律 `manager && ctx.asyncSettles === true && ctx.agentId !== undefined && cfgAsyncEnabled.get(...)`；`queued: true` 一律；`markRunning()` 成功與失敗路徑都呼叫（`finally`）；前景結果保留 display-only `details.images`。**D14**：`tools/media-output.ts` 匯出 `MEDIA_FALLBACK_ERROR_CODES`（`ReadonlySet<string>`，Bun 實測 `ConnectionRefused` 為首）、`MEDIA_FALLBACK_MARKER = "mediaFallbackEligible"`、`isMediaFallbackEligible(error, userSignal)`（優先序：`userSignal?.aborted` → false；`MissingApiKeyError`/`ProviderHttpError`/`ProviderResponseError`、`error.code ∈ 白名單`、`name === "TimeoutError"`、marker === true → true；其餘 false）；`image-gen`/`tts` 的候選迴圈改用它，且 `try/catch` **只包住 transport 呼叫**（`generateImage(...)`／`synthesizeSpeech(...)`／本地合成），解碼、寫檔、`copyMediaToOutputPath` 等後處理留在 `try` 之外照舊拋出。
4. [ ] **產生 candidate**：從 pristine+前置產生 `patches/.18.3.3-candidates/<編號>-omp-media-tools-background-v18.3.3-candidate.patch`（root `${NM}`，含 `dist/types`）：`patch -p1 --fuzz=0` 正向 dry-run、反向 dry-run、套用後 `cmp`、二次 `--forward` 必失敗。
5. [ ] **註冊**：`apply.sh` 18.3.3 分支在現行 tail 後加 `_omp_tail_candidate "18.3.3" "<編號>-omp-media-tools-background" "${NM}"`；回歸區塊加 `if _omp_plan_has <編號>; then bun "${HERE}/verify-media-background-jobs.ts"; fi`；`verify-patch-family-rollups.sh` 的 `EXPECTED_PLAN_1833` 追加該 candidate 並把 `-eq N` 與註解同步（P1 後 49 → 本層 50）；`PATCHES.md` 計畫表計數與新增 `### <編號> — 媒體工具背景化` 條目（含行為閘門指令、部署紀錄欄）。
6. [ ] **隔離驗證**：`bash patches/verify-patch-family-rollups.sh`（18.3.3 完整 pristine 重放／反剝）；隔離補後樹跑 `OMP_PATCH_VERIFY_NM=<isolated-root> bun patches/verify-media-background-jobs.ts` 綠；對 pristine 樹跑同一閘門紅（貼兩次輸出）。
7. [ ] **獨立審查**：`trellis-check` 審 diff、閘門敏感性（每個宣稱都有 fault 變體）、`.d.ts` 同步、`queued/markRunning` 兩路徑、無 base64 不變式、`dist/types` 與 src 契約一致；發現即修正後重審。審查者只報告、不改碼。
8. [ ] **部署**：備份 live 改動檔（含 `dist/types`）到 `~/.omp/patches/backups/<date>-<編號>/manifest.json`；`bash patches/apply.sh`（只新增本層）；repo → `~/.omp/patches/` 逐檔同步 candidate、`verify-media-background-jobs.ts`、`apply.sh`、`verify-patch-family-rollups.sh`、`PATCHES.md`，每檔 `cmp`。
9. [ ] **使用者設定**：備份 `~/.omp/agent/config.yml`；後端就緒時開啟 `generate_image.enabled`、`speechgen.enabled`（omp 內建預設關閉）。不動 `models.yml`（P1 已寫入 `kind: image|tts`）。
10. [ ] **冒煙（新 omp 程序）**：
    - `generate_image`（P1/即夢直連或 gateway）→ 呼叫**立即**回 `Started image job …`；`/jobs` 顯示 `[media] image: … running`；完成後 delivery 訊息含路徑＋模型（無 base64）；`generated/image/…` 存在；TUI 可見縮圖（文字或截圖證據）。
    - `tts` 帶 `output_path` → 原檔在 `generated/audio/…` 且指定路徑有相同副本；不帶 `output_path` 仍成功。
    - **子代理**（`task`）內呼叫 `generate_image` → 仍走背景（子代理執行器會 `settleAsyncWork()`），delivery 回到子代理會話；主會話的 `/jobs` 不列該 job（owner 不同）。
    - **print（`omp -p`）**：`generate_image` 在**同一次呼叫**就回完成結果（`details.async.state === "completed"`，無 job id），不依賴 delivery（check 52：回合結束即 dispose）；`generated/image/…` 存在。
    - `proc://<jobId>/kill` 取消進行中的工作 → 狀態 `cancelled`、無殘檔。
    - `async.enabled=false`（或無 manager 情境）→ 前景完成、`details.async.state === "completed"`、**且前台顯示縮圖**（前景 `details.images` 路徑；用互動模式 + `async.enabled=false` 取截圖或文字證據，或 `terminal.showImages=false` 時確認 fallback 文字）。
    - **D14 降級**：把第一候選（本機 gateway／即夢直連）停掉或指向錯的埠後呼叫 `generate_image`／`tts` → 工具回報的是**第二候選**（雲端）成功，而不是整體失敗；把使用者取消（Ctrl-C）與後處理失敗各試一次，確認兩者都**不**降級。
11. [ ] **收尾**：`trellis-update-spec`（把 `"media"` job type、ctx 注入契約、`ownerId` 必要、`queued`/`markRunning` 時機、display-only 縮圖、`generated/<category>/` 路徑規則、**D14 候選降級錯誤分類契約**寫入 backend spec 的 patch-chain／extension-runtime 契約）；machine checks 重跑；commit。

## Validation commands
- `bash .trellis/tasks/09-27-media-tools-background/revalidate.sh`
- `OMP_PATCH_VERIFY_NM=<root> bun patches/verify-media-background-jobs.ts`（另跑 pristine root 取紅）
- `bash patches/verify-patch-family-rollups.sh`
- `bash patches/apply.sh --check`
- `OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh`
- 公開 API 型別封閉（暫時 consumer 檔，用完刪除）：`bunx tsc --noEmit --strict /tmp/media-dts-consumer.ts`，內容自 `@oh-my-pi/pi-coding-agent` 與 `@oh-my-pi/pi-tui` 的 declaration 進入點 import `CustomToolContext`、`ExtensionContext`、`AsyncJobType`、`JobSnapshot`、`AsyncResultJobDetails`，斷言新欄位可賦值、舊欄位仍相容。

## Machine checks（交付前與覆核各跑一次）
- `grep -nE '<編號>-omp-media-tools-background|verify-media-background-jobs' patches/apply.sh patches/verify-patch-family-rollups.sh`
- `grep -nE '"media"|media-output|mediaPreview|mediaCategory|asyncSettles|ownerId: ctx\.agentId|queued: true' patches/.18.3.3-candidates/<編號>-omp-media-tools-background-v18.3.3-candidate.patch`
- `.d.ts` 同步（每個檔都要有命中）：`for f in pi-coding-agent/dist/types/async/job-manager.d.ts pi-coding-agent/dist/types/extensibility/custom-tools/types.d.ts pi-coding-agent/dist/types/extensibility/extensions/types.d.ts pi-coding-agent/dist/types/extensibility/extensions/runner.d.ts pi-coding-agent/dist/types/sdk.d.ts pi-coding-agent/dist/types/session/agent-session-types.d.ts pi-coding-agent/dist/types/session/session-tools.d.ts pi-coding-agent/dist/types/session/async-job-delivery.d.ts pi-coding-agent/dist/types/tools/image-gen.d.ts pi-coding-agent/dist/types/tools/tts.d.ts pi-coding-agent/dist/types/tools/media-output.d.ts pi-tui/dist/types/tools/wait.d.ts pi-tui/dist/types/chat/media-thumbnail.d.ts pi-tui/dist/types/chat/transcript-render-helpers.d.ts; do echo -n "$f "; grep -c 'media\|asyncJobManager\|asyncSettles\|agentId\|output_path\|images\|MEDIA_FALLBACK' $A/$f; done`（每檔 ≥1；`tools/media-output.d.ts` 必須含 `MEDIA_FALLBACK_ERROR_CODES`／`MEDIA_FALLBACK_MARKER`／`isMediaFallbackEligible` 三個宣告）
- D14 錯誤分類（每個檔 ≥1 命中）：`grep -c 'isMediaFallbackEligible' $AG/tools/image-gen.ts $AG/tools/tts.ts`；`grep -c 'MEDIA_FALLBACK' $AG/tools/media-output.ts` → `≥3`
- D14 負向（不得以 `TypeError` 當連線失敗判斷）：`grep -nE 'instanceof TypeError|name === "TypeError"' $AG/tools/image-gen.ts $AG/tools/tts.ts $AG/tools/media-output.ts` → 無命中
- 注入三欄位都在（每個檔 ≥1 命中）：`grep -rn 'asyncSettles' $AG/sdk.ts $AG/main.ts $AG/task/executor.ts $AG/modes/controllers/tan-command-controller.ts $AG/session/agent-session-types.ts $AG/session/session-tools.ts $AG/extensibility/custom-tools/types.ts $AG/extensibility/extensions/types.ts $AG/extensibility/extensions/runner.ts`
- 顯示／模型邊界（F13 + D8）：
  - `grep -c 'latestDetails\.images' $AG/tools/image-gen.ts $AG/tools/tts.ts $AG/tools/media-output.ts` → 每個檔 `0`（媒體 job 絕不設 provider-visible images）
  - `grep -c 'os\.tmpdir()' $AG/tools/image-gen.ts` → `0`（不再寫系統暫存）
  - `grep -c 'images:' $AG/tools/image-gen.ts` → `≥1`（前景 display-only 保留）
  - 前景結果的 `content` 不得含 image part：`grep -nE 'content: \[\{ type: "image"' $AG/tools/image-gen.ts` → 無命中
- 憑證外洩：`git diff --cached | grep -nE '[0-9a-f]{32}'` 應無 token 樣式命中（fixture 用非十六進位字串）。

## Review gate
- 閘門在未補樹（紅）與補後樹（綠）的兩次輸出都要貼進執行記錄；每個宣稱都有 fault 變體（缺 patch／行為被改／時機顛倒／縮圖誤入 content／拿掉 `asyncSettles`／拿掉 `agentId` 收窄／拿掉 `queued: true`）。
- 審查者只報告、不改碼；修正由實作 owner 做完再送審。裁決涵蓋的內容若在裁決後改動，必須重新取得裁決。
- 收尾前 `revalidate.sh` 再跑一次：預期 `p2-media-job-type` / `p2-media-output-module` 轉為 `applied`（其餘上游事實仍 PASS）。

## Rollback
- 源碼：`bash patches/apply.sh --revert`（反向本層）或以 `<date>-<編號>` 備份覆蓋被改檔案（含 `dist/types`）。
- 設定：以時間戳備份還原 `config.yml`；軟回滾 = 設 `async.enabled=false`（媒體工具退回前景同步）或關閉工具 enable gate。
- 生效/回退都需重啟 omp；`/resume` 不會熱載入新源碼。

## Execution log
（實作時追加：日期、步驟、指令、觀察、裁決）
