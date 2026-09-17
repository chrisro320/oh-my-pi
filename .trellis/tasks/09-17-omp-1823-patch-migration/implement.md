# 執行記錄 — 18.2.3 補丁鏈遷移

> **RESUME: S1-0030 完成 → 繼續 Re-anchor 0010 的 h9/h18(用 diff 重生成法),然後 0034/0038/0047/0060/0065/0037+0041/0068/0069/0070**
> 第一個動作:把 `/tmp/h9-diff.txt`(diff 原生生成的 h9)轉成 candidate 段落格式(行號平移 +3977、路徑改 `a/src/session/agent-session.ts`),替換 0010 候選中的手寫 h9;同法處理 h18(todo/modelMentions 區域);再以 `patch -d pkg/pi-coding-agent --dry-run` 全鏈驗證 0010。

## 狀態總覽(2026-09-17 01:35 暫停)

- 沙盒衝突矩陣已完成並交叉驗證:**25 CLEAN / 13 CONFLICT / 0 上游逐字採納**(獨立審計腳本 `/tmp/omp1823/replay-audit.sh`,log 與先前矩陣逐字一致)。
- Re-anchor 進度:**0030 ✓、0033 ✓**;0010 進行中(h9/h18 手寫重錨卡在 GNU patch 2.7.6 計數陷阱,已解出正解);0034/0038/0047/0060/0065 未開始。
- Rewrite 未開始:0037+0041(statusline usage 族)、0068/0069/0070(codex compaction 族)。
- Plan/Verify/Deploy 未開始。
- **工作樹未提交**:prd.md、research.md(在 .trellis/tasks/09-17-omp-1823-patch-migration/)。候選補丁目前在 `/tmp/omp1823/patches-ro/.18.2.3-candidates/`(0030/0033/0010 三件)——**這是 tmp,重啟即失**,恢復時先把它們拷回 repo `patches/.18.2.3-candidates/` 再繼續。

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