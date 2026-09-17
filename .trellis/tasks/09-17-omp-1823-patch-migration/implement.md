# 執行記錄 — 18.2.3 補丁鏈遷移

> **RESUME(修訂 2026-09-17 暫停前,已複核):S1-0010 只剩 1 個 hunk 失敗 —— `agent-session.ts` h9(`#scheduleAgentContinue` 的 publish-before-await 包裝);h18、h33、executor hunk 均已通過。**
> 第一個動作(不依賴 `/tmp`):以 `pkg/pi-coding-agent/src/session/agent-session.ts`(pristine 18.2.3)為 base,取出 3978–3986 行為 old 檔;按 18.1.18 語義寫 new 檔(`const inFlight = this.#beginInFlight();` + `ActiveAgentContinue` IIFE 包裝 + `#endInFlight(inFlight.epoch)` 配對;縮排一律與 pristine 逐字節一致);`diff -u old new` 生成後改路徑為 `a/src/session/agent-session.ts`、`@@` 起始行平移至 3978;替換候選對應段落 → `patch -d pkg/pi-coding-agent --dry-run -p1` 驗證。**禁止手寫 hunk 標頭與行索引位元組替換。**
> 已入庫現成參照(不依賴 `/tmp`):
>  - `patches/.18.2.3-candidates/0010-h18-usable-hunk.patch`(sha256 `5c2fcf32…a1117d`)**已可直接套用**:路徑與 `@@` 行號就位,`patch -d <agent-root> --dry-run` 已驗證 CLEAN(區域 B fuzz 1)。h18 由此片段直接替換候選內的舊兩段。
>  - `patches/.18.2.3-candidates/0010-h9-diff-regen.txt`(sha256 `588b993f…45af20`):h9 的 diff 原生輸出,**尚未**改路徑/平移行號,需按首動作處理。
>  - 若兩者與候選狀態不符(例如候選又被改動),以 pristine `pkg/pi-coding-agent/src/session/agent-session.ts` 重新生成即可复現。
- 沙盒衝突矩陣已完成並交叉驗證:**25 CLEAN / 13 CONFLICT / 0 上游逐字採納**(獨立審計腳本 `/tmp/omp1823/replay-audit.sh`,log 與先前矩陣逐字一致)。
- [ ] S1-0010 候選:僅 h9 未通過(其餘 8/9 agent-session hunk 已 CLEAN,含 h18/h33/executor);待以 diff 重生成法替換手寫版 h9(pending)
	- ⚠ **18.2.3 新競態 #1 — admission 窗口(2026-09-17 審查發現,已核實 pristine 821/2361/2371/6313 行)**:上游新增 `#admitSubmission()` 包裹 `#prompt`——主 prompt 在圖片歸一化/vision await 期間先 `#admittedSubmissionCount++` 後才 `#beginInFlight()`。18.1.18 的 `runIdleEphemeralTurn` gate(live 8916 行)只查 `#promptInFlightCount`/`isStreaming`/`isCompacting`/`#branchSummaryAbortController`/`queuedMessageCount`/`#idleEphemeralReservation`,**不含 admission**——「已 admit 未 beginInFlight」窗口內 idle side-channel 可搶跑。遷移時把 `this.hasAdmittedSubmission`(或 `#admittedSubmissionCount > 0`)納入同步 gate,並補「admitted→idle 搶跑」交錯回歸斷言。
	- ⚠ **18.2.3 新競態 #2 — session transition(已核實 pristine 4491–4510 行定義;7 個 `#beginSessionTransition()` 調用點:5084 `resetSessionContext`、8308 `newSession`、8439 `fork`、9486 `switchSession`、9854 `branch`、9962 `branchFromBtw`、10154 `navigateTree`)**:上游新增 `#beginSessionTransition()` 同步置 `isSessionTransitioning`;live 的 idle gate 與 reservation 清理都不知道它。`newSession`/`switchSession` 先 await 後 reset,已保留的 idle 請求可能在舊快照上繼續發 provider 請求。遷移時:`runIdleEphemeralTurn` 同步拒絕 `isSessionTransitioning`;7 個 transition 入口進入時 abort 現有 idle reservation(**不可漏 `resetSessionContext`**);補「reservation→session transition」交錯測試。
 	- ⚠ 定稿驗收(用戶指示 2026-09-17):上游 18.2.3 的 `#scheduleAgentContinue` 仍是裸 `#beginInFlight()` + 直呼 `#runAgentContinue()`——**未吸收 0010**,候選必須完整保留 publish-before-await 的 `ActiveAgentContinue` 包裝與 `#endInFlight(inFlight.epoch)` epoch 配對。定稿後按 `grep -n "#beginInFlight\|#endInFlight"` 逐一核對 18.2.3 全部調用點:每個 `#beginInFlight()` 有返回值接住且 finally 有對應 `#endInFlight(epoch)`;上游若新增調用點(18.2.3 比舊版多出的路徑)漏配對即是缺陷。
- Plan/Verify/Deploy 未開始。
- 工作樹(2026-09-17 01:43 獨立核實,HEAD `e091806b2aeba5189df993573e07722159d6e889`;`.git/refs/heads/trellis/ds-snapcompact-tuning` 與 `git rev-parse HEAD` 雙路一致):
  - 已提交:本任務 `prd.md`/`research.md`/`implement.md` + `patches/.18.2.3-candidates/`(4 件:0010/0030/0033 候選 + h9 diff + h18 usable hunk)+ 審計腳本與 log —— 提交鏈 `a9c0292` → `7626204` → `e091806`。
  - 未提交(非本次遷移操作):`prd.md`/`research.md` 被外部 Trellis 流程於 01:41:09 重組(矩陣移入 research、新增 Planning recovery evidence),並生成 `task.json`/`check.jsonl`/`implement.jsonl`;`patches/PATCHES.md` 與 `patches/turn-timer-extension.ts` 為遷移前的既有進行中工作。**恢復時不要回退這些外部改動。**

## 關鍵教訓(勿重蹈)

1. **GNU patch 2.7.6 空白上下文行計數陷阱**(本次卡最久的坑,已實證):
   - 手寫 `@@ -N,old +M,new @@` 標頭時,`' '`(單空格)與 `''`(空行)兩種空白上下文行的計數行為不直觀;經驗矩陣(`ctx+blank+add+ctx` 形態)實測 `old=2 new=3` 與 `old=3 new=4` 都能解析,但純 ctx hunk 帶空白的組合全部 malformed。
   - **正解:不要手寫 hunk。用 `diff -u` 對「pristine 區域檔」與「語義改寫區域檔」重新生成,再把 `--- a/+++ b` 路徑與 `@@` 行號平移到真實位置。** diff 原生輸出(`-\n`/`+\n` 表示空行增刪、ctx 空行為 `\n`)100% 被 patch 接受。h9 的 diff 原生輸出已存 `/tmp/h9-diff.txt`,驗證過形態正確。
2. **GNU patch 對 symlink 目錄 root 報 "can't find file to patch"**(openat O_NOFOLLOW):沙盒 root 必須真目錄(`cp -r`),不能用 symlink。
3. **`patch ... | head` 之後 `$?` 是 head 的**:判定必須 `out=$(patch --dry-run ...); rc=$?`。
4. **ADOPTED 判定必須在該補丁套用前**做 reverse dry-run,不能在鏈尾(前面 CLEAN 補丁已 real-apply 會誤報)。
5. 縮排必須與目標檔逐字節核對(`cat -A`):上游 18.2.3 在 `navigateTree` 重構後同檔案存在混合縮排深度(h9 區域 `return;` 5-tab、`#beginInFlight()` 4-tab)。

## 已完成步驟

- [x] S0 備份:18.1.18 已打補丁樹 tar 322MB,sha256 `c78f94549aaa4e9c65d641eedce44957b8409bec6e4c8da5e630cbf2f42a07f2`,位於 `~/.omp/backups/oh-my-pi-18.1.18-patched-20260917-010451.tar.gz`(verified)
- [x] S0 沙盒矩陣:38 項部署計畫在 pristine 18.2.3 重放,25 CLEAN / 13 CONFLICT,分類與根因全表在 prd.md(verified,audit log 交叉一致)
- [x] S1-0030 候選:charm-hyper import 行納入上下文,dry-run CLEAN + 實套 + 反向 round-trip OK(verified)
- [x] S1-0033 候選:settings-schema 陣列形態重錨,3 hunk 全 CLEAN + round-trip OK(verified)
- [ ] S1-0010 候選:僅 h9 未通過(其餘 8/9 agent-session hunk 已 CLEAN,含 h18/h33/executor);待以 diff 重生成法替換手寫版 h9(pending)
- [ ] S1-0034 候選(4/8 hunk 需適配 `beginMentalModelsTranscriptReload` 新結構)
- [ ] S1-0038+0047 候選(0038 頭部註釋重寫;0047 a 側必須取 0038 候選產出形態)
- [ ] S1-0060 候選(依賴 0010 的 `runIdleEphemeralTurn`;agent-session h1/h3 需重錨)
- [ ] S1-0065 候選(只補 strict-mode + multi-system-messages 兩鍵 + rules.json wire 區塊;上游已含 effort/strip-image/input-modalities)
- [ ] S2-0037+0041 重寫(上游 usage 管線新結構:5min TTL 硬編、`#runUsageRefresh`、fetch 後強制重繪——**以本機語義為準**:turn-gate 60s + 50s TTL + fetch 後不重繪)
- [ ] S3-0068/0069/0070 重寫(上游 codexMetadata 新結構;fail-closed 不變量保留)
- [ ] S4 apply.sh 18.2.3 版本計畫 + `.18.2.3-candidates/` 進 repo
- [ ] S5 沙盒全鏈重放 38/38 + verify 套件 + revert 逐字節回 pristine
- [ ] S6 部署切換 + 進程重啟提醒(49 個運行中 omp)+ 回滾演練

## 恢復所需路徑

- 沙盒:`/tmp/omp1823/{pkg,audit,patches-ro}`(audit 樹已套 0030/0033 + 部分 0010;pkg 為 pristine)
- 審計:`/tmp/omp1823/replay-audit.sh` + `replay-audit.log`
- h9 diff 原生輸出:`/tmp/h9-diff.txt`
- 候選補丁(tmp,易失):`/tmp/omp1823/patches-ro/.18.2.3-candidates/{0030,0033,0010}-…-v18.2.3-candidate.patch`
- 上游參照:pristine 18.2.3 五套件在 `/tmp/omp1823/pkg/`(若 tmp 被清,重拉:`npm pack @oh-my-pi/{pi-coding-agent,pi-ai,snapcompact,pi-catalog,pi-agent-core}@18.2.3` 後解包)