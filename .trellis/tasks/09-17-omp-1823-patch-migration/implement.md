# 執行記錄 — 18.2.3 補丁鏈遷移

> **RESUME(修訂 2026-09-17 暫停前):S1-0010 — 用 diff 重生成法重寫 h9/h18,不再手寫 hunk。**
> 第一個動作:① 以 `pkg/pi-coding-agent/src/session/agent-session.ts` pristine 為 base,取出 h9 區域(lines 3978–3986)與 h18 區域(navigateTree 尾部)為 old 檔;② 按 18.1.18 語義寫 new 檔(h9 = publish-before-await `ActiveAgentContinue` 包裝,h18 = 刪 `#branchSummaryAbortController = undefined;` 兩處);③ `diff -u` 生成後把路徑改 `a/src/session/agent-session.ts`、`@@` 行號平移 +3977;④ 替換候選中對應段落,`patch -d pkg/pi-coding-agent --dry-run -p1` 全鏈驗證。**禁止手寫 hunk 標頭與行索引位元組替換**(本輪已證明易錯)。
- 沙盒衝突矩陣已完成並交叉驗證:**25 CLEAN / 13 CONFLICT / 0 上游逐字採納**(獨立審計腳本 `/tmp/omp1823/replay-audit.sh`,log 與先前矩陣逐字一致)。
- [ ] S1-0010 候選:h33(`_transition` 行)已修;h9/h18 待以 diff 重生成法替換手寫版;h10(`#endInFlight(inFlight.epoch)`)之後 hunk 未逐一複核(pending — 當前 39 hunk 中 2 個 agent-session hunk 失敗)
	- ⚠ **18.2.3 新競態 #1 — admission 窗口(2026-09-17 審查發現,已核實 pristine 821/2361/2371/6313 行)**:上游新增 `#admitSubmission()` 包裹 `#prompt`——主 prompt 在圖片歸一化/vision await 期間先 `#admittedSubmissionCount++` 後才 `#beginInFlight()`。18.1.18 的 `runIdleEphemeralTurn` gate(live 8916 行)只查 `#promptInFlightCount`/`isStreaming`/`isCompacting`/`#branchSummaryAbortController`/`queuedMessageCount`/`#idleEphemeralReservation`,**不含 admission**——「已 admit 未 beginInFlight」窗口內 idle side-channel 可搶跑。遷移時把 `this.hasAdmittedSubmission`(或 `#admittedSubmissionCount > 0`)納入同步 gate,並補「admitted→idle 搶跑」交錯回歸斷言。
	- ⚠ **18.2.3 新競態 #2 — session transition(已核實 pristine 4491–4510 行,8 個 `#beginSessionTransition()` 調用點)**:上游新增 `#beginSessionTransition()` 同步置 `isSessionTransitioning`;live 的 idle gate 與 reservation 清理都不知道它。`newSession`/`switchSession` 先 await 後 reset,已保留的 idle 請求可能在舊快照上繼續發 provider 請求。遷移時:`runIdleEphemeralTurn` 同步拒絕 `isSessionTransitioning`;最外層 `#beginSessionTransition`(8308/8439/9486/9854/9962 入口)進入時 abort 現有 idle reservation;補「reservation→session transition」交錯測試。
 	- ⚠ 定稿驗收(用戶指示 2026-09-17):上游 18.2.3 的 `#scheduleAgentContinue` 仍是裸 `#beginInFlight()` + 直呼 `#runAgentContinue()`——**未吸收 0010**,候選必須完整保留 publish-before-await 的 `ActiveAgentContinue` 包裝與 `#endInFlight(inFlight.epoch)` epoch 配對。定稿後按 `grep -n "#beginInFlight\|#endInFlight"` 逐一核對 18.2.3 全部調用點:每個 `#beginInFlight()` 有返回值接住且 finally 有對應 `#endInFlight(epoch)`;上游若新增調用點(18.2.3 比舊版多出的路徑)漏配對即是缺陷。
- Plan/Verify/Deploy 未開始。
- 工作樹:WIP 已提交 `a9c0292`(含 prd/research/implement + 三件候選補丁 + 審計腳本與 log,均已入 repo `patches/.18.2.3-candidates/`);`patches/PATCHES.md` 的既有未提交改動與 `patches/turn-timer-extension.ts` 為遷移前的進行中工作,未納入本次 WIP。

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
- [ ] S1-0010 候選:h33(`_transition` 行)已修;h9/h18 待以 diff 重生成法替換手寫版;h10(`#endInFlight(inFlight.epoch)`)之後 hunk 未逐一複核(pending — 當前 39 hunk 中 2 個 agent-session hunk 失敗)
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