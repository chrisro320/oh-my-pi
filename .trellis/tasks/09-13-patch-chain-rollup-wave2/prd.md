# 補丁鏈清場、安全修復與第二輪 rollup

## Goal

分批交付。**Phase A（已完成）**：清除過時版本計畫與死補丁，只留 18.1.14＋18.1.18，修復控制器、verify-rollups 與文件口徑。**Phase A2（本次擬執行，待本版計畫確認）**：修復已重現的狀態退出碼、0043 中斷工具結果對稱性及現役驗證閘的沙盒隔離，刪除無效驗證噪音，不合併補丁。**Phase B（維持另議）**：原三組合併方案保留為候選，須在 A2 完成後重新核定家族邊界。

## Background / Confirmed Facts

- **Phase A 前基線**：工作樹 base 28 − omit:0019/0042/0051 + 鏈尾 6 = **31 補丁**；當時 HEAD 為 30 層（含 0059）。Phase A 後 canonical=26，18.1.14 計畫=27，18.1.18 計畫=31。
- **用戶已決**：18.0.9 過時；只留 18.1.14＋18.1.18；先清場再談合併。
- **真實可套矩陣**（官方 tarball pristine 實測，非 bun cache）：18.0.9 上 0045/0046 套不上（既有斷點，其 a 側是 18.1.x 形態）；18.1.10/18.1.14/18.1.18 全鏈皆綠。
- **bun cache 已被污染不可當 pristine**：`pi-ai@18.1.14` 的 ollama.ts sha256 是 18.1.18 官方值；`pi-coding-agent@18.1.14` 的 session-selector.ts 已含 0050 內容。沙盒一律用官方 tarball＋SHA-256。
- 0059 曾進 active chain（cc6596c），按契約須退役留檔而非純刪。
- **Phase A 已同步**：apply.sh 尾部套件與 PATCHES.md §6.1 現為 **14 道**閘門；先前漏列 devin-thinking-signature／devin-idle-cascade-pin 的問題不再當成現存缺陷。新審計另確認 §2 缺 0060 明細，列入 RS5。
- **Phase A 前缺陷，已修**：verify-rollups 靜態閘 `entries == 18` 與 28 條陣列脫節；OLDCHAIN 缺 0043 以降全部新補丁。不得把這條歷史記錄當作現在仍失敗。
- Phase A 前分析全文：`research/patch-chain-analysis.md`；當時 reviewer 的 fix-then-execute（6 P1＋2 P2）已由 Phase A 執行記錄覆蓋。A2 只採用該檔最新審計節的已複核結論。
- **A2 審計證據**：2026-09-13 live 32 行 APPLIED、ledger 零漂移；現役 14 道離線閘＋4 道補充閘通過。18.1.18 官方五包經 registry integrity 驗證，31 層零 fuzz 正反套成功，2,354 個 src 檔與 live 一致、4,106 個套件檔反套回 pristine。負對照及被撤回的 reviewer 推測記於 `research/patch-chain-analysis.md` 最新審計節；這些是修改前基線，不能沿用為修改後驗收。

## Requirements — Phase A（清場）

- **RA1 備份**：已完成 repo/runtime `patches/` cp -a、六包 live tarball、bin/omp symlink、live sha256 清單（`~/omp-merge-backup-20260913-071204/`）。未提交 9 檔先 commit 成已知良好點——0059 改為 `git mv` 進 `.retired/`（不純刪）。
- **RA2 apply.sh**：① PATCHES 陣列移除 0019、0042（所有存活計畫均已 omit，上游 18.1.10 已拆該機制）；② 版本分支只留 `18.1.14`、`18.1.18`，刪 18.0.9/18.0.11/18.1.2/18.1.5/18.1.10 五支與其 omit 殘句；③ `OMP_PATCH_VERSION` 未設 → **auto-route**（讀 installed `pi-coding-agent` 版本精確匹配存活計畫，非就近 fallback；安裝版不符或顯式跨版本值 exit 2）——比原案 unset→exit 2 更好：保留「`bun add -g` 後裸跑一鍵重套」文件化路徑，且讓 verify-rollups 沙盒子控制器自動選對計畫；④ 尾部 14 道閘門不動；⑤ 新增 `--print-plan`（read-only 計畫查詢，輸出 `file:ROOT` 行，是 verifier 的唯一 resolver）。
- **RA3 退役歸檔**：0019、0042、0059 三個 `.patch`＋死候選目錄（.18.0.11/.18.1.2/.18.1.5/.18.1.10）＋死 verify 腳本（verify-model-switch-tool-description.ts、verify-date-cwd-reminder.ts）→ `.retired/09-13-dead-plans/`，逐檔記 SHA-256。
- **RA4 verify-rollups 修復**：`entries` 期望值改為新陣列數（26）；absence 斷言加 0019-/0042-/0059-/0061- 且改對 resolved plan 判定；retired manifest 補 `.retired/09-13-dead-plans/` 16 檔 SHA-256；**雙基線**——族檢查留 18.0.9 pinned tarball（退役族成員只在那裡成鏈），全鏈 oracle／peel／gate #11/#12 移 18.1.14 pinned tarball；`OLDCHAIN`＝釘死的前一表示鏈（等價 oracle before 側），`EXPECTED_PLAN`/`EXPECTED_PLAN_18` 獨立釘住兩計畫解析結果（計畫漂移閘），`NEWCHAIN` 由 `apply.sh --print-plan` 解析；新增 gate #12 fail-closed 矩陣（6 壞輸入精確 exit 2＋樹零變動）。
- **RA5 PATCHES.md 重寫口徑**：§0 狀態表、§1 改為「canonical 清單＋18.1.14/18.1.18 兩計畫」、§2 退役條目標注（含 0012/0016「不進 apply.sh」）、§3 補新退役、§5 `PATCHES+=` 清單、§6.1 補齊 14 道閘門。
- **RA6 ledger**：全部 repo 修改完成後單次 `rsync -a patches/ ~/.omp/patches/`＋`diff -rq` 零漂移（最後同步，禁止中途同步）。
- **RA7 驗收**：18.1.14 與 18.1.18 官方 tarball 沙盒各跑 apply→idempotent→revert→pristine 零差異；live `--check` 全 APPLIED 且 live 樹 sha256 不變。

## Requirements — Phase A2（安全修復，不是 rollup）

- **RS1 狀態退出碼**：`apply.sh --check` 遇任一 CONFLICT 或 MISSING 必須 exit 1；全 APPLIED、全 PENDING 或 APPLIED/PENDING 混合仍是有效狀態查詢、exit 0。版本錯誤維持 exit 2；不把 pristine 或未連結的 bin 當成衝突。證據：`apply.sh:452-458,499-510`；隔離鏡像 2 CONFLICT 仍 exit 0。
- **RS2 中斷對稱**：0043 的 live `convertToLlm` 與 resume `buildSessionContext` 必須同時移除 aborted/error assistant 及其配對 toolResult。保留正常 toolUse、其他工具結果、使用者訊息及顯示 transcript；不修改 session JSONL。證據：`verify-interrupt-prune-symmetry.ts:41-56,87-104` 只覆蓋文字／thinking；新負對照在 tool-call 中斷時 live=`user/toolResult/user`、rebuild=`user/user`。
- **RS3 驗證樹隔離**：`apply.sh` 目前註冊的 14 道閘逐項分類，凡讀取或執行套件行為者，runtime import、文字讀取及依賴解析都必須指向指定沙盒；禁止一半讀沙盒、一半執行 live。完整 23 個頂層 TS 腳本的根解析分類列在 research，但此次只遷移現役 suite，不宣稱已修全部 23 個。保留零參數的本機入口；不修改未註冊的獨立 extension／診斷腳本。已選計畫缺少應有補丁效果時必須失敗，不能靠待驗證的產出標記決定 SKIP；meta／repo extension 閘另依其實際職責驗收。
- **RS4 刪除假證據**：移除 `verify-spec-contracts.sh:79-92` 僅 grep 測試訊息、boundary 變數名的斷言，不整支移除 spec gate；以真正執行的隔離／行為負對照承接聲稱的保護。當 OLDCHAIN 與 resolved plan 相同時，不重複建樹、套同鏈、比較自身；保留真實家族等價、反套還原、計畫漂移及 retired SHA-256 檢查。
- **RS5 表示與文件同步**：0043 canonical 與現役 18.1.18 candidate 都從官方 pristine 派生，舊版本 bytes 按既有退役契約留存；不新增編號、不改兩個 resolved plan 的順序或層數。腳本、`apply.sh` 呼叫點、spec gate 及 `PATCHES.md` §6.1 同步；補 §2 遺漏的現役 0060 說明，消除本批相關的過期 AC／註解。更新具體行為契約，不把結構字串存在當成執行證據。
- **RS6 部署邊界**：先完成 repo 修改、兩版沙盒驗收及聚焦獨立覆核。展示最終 diff、唯一預期的 live 行為差異與回退方式後才請求部署確認；確認前不寫 live、不同步 runtime ledger、不呼叫付費 provider。部署時只接受與審查前像一致的 live，未知漂移即停。

## Requirements — Phase B（合併，清場驗收後另議）

- RB1：0044+0052+0057 併入 0036 族（族鏈 {0015s,0015a,0020s,0020a,0022,0044,0052,0057}，18.0.9 官方 tarball 族沙盒生成——生成基線是構建工件非部署目標）；舊 0036 位元組一併退役。
- RB2：0041 併入 0037 族（{0005,0007,0029,0041}）；舊 0037 位元組退役。
- RB3：0045+0046 併為 `0063-omp-session-maintenance-guard-rollup.patch`，反向剝離法在 **18.1.14** 全鏈沙盒生成（canonical=最舊存活版）；18.1.18 若上下文不過則產 `.18.1.18-candidates/0063`。
- RB4：verify-rollups 族定義與 manifest 同步（retired +8：0041/0044/0045/0046/0052/0057＋舊 0036＋舊 0037）；absence 斷言補全。
- RB5：18.1.14/18.1.18 沙盒重演＋live 等價＋PATCHES.md 收尾，同 Phase A 口徑。

## Acceptance Criteria — Phase A

- [ ] AC1：canonical 陣列為 **26**；`OMP_PATCH_VERSION` 未設時按 installed 18.1.14/18.1.18 精確 auto-route；空值、不支援版本及顯式跨版本值 exit 2。這是 RA2／design D1 的已實作契約，不再保留舊的 unset→exit 2 斷言。
- [ ] AC2：`ls patches/.18.0.11-candidates patches/.18.1.2-candidates patches/.18.1.5-candidates patches/.18.1.10-candidates 2>&1` 全部不存在；`.retired/09-13-dead-plans/` 含 0019/0042/0059 三 patch＋4 個候選目錄＋2 個死腳本，SHA-256 與來源一致。
- [ ] AC3：`bash patches/verify-patch-family-rollups.sh` 與 `--selftest` 全綠。
- [ ] AC4：18.1.14 與 18.1.18 官方 tarball 沙盒：apply 全 APPLIED → 再 apply 全 SKIP → revert 後 `diff -r` 對 pristine 零差異、無 `.orig`/`.rej`。
- [ ] AC5：`OMP_PATCH_VERSION=18.1.18 bash ~/.omp/patches/apply.sh --check` 全 APPLIED / 0 CONFLICT；live 六包 src sha256 對備份基線逐檔一致。
- [ ] AC6：`diff -rq patches/ ~/.omp/patches/` 零輸出；PATCHES.md 不再出現 18.0.9/18.0.11/18.1.2/18.1.5/18.1.10 作為存活計畫的表述。


## Acceptance Criteria — Phase A2

- [ ] ACS1／RS1：實際控制器在隔離樹上通過 APPLIED→0、PENDING→0、CONFLICT→1、MISSING→1、錯版本→2 矩陣；所有 `--check` 場景來源樹與 bin 零寫入，gate #11 的 pristine 27 PENDING 仍通過。
- [ ] ACS2／RS2：aborted、error 含 toolCall＋配對 toolResult 的 live/rebuild 輸出逐值一致，舊版負對照失敗；正常 toolUse、無 toolCall 中斷、非配對結果及 transcript 對照保留原行為。覆蓋 18.1.14、18.1.18。
- [ ] ACS3／RS3：兩版官方隔離樹各自執行所屬現役閘。套件效果閘必須在未套所屬補丁、錯根或破壞行為時失敗，且不是因缺少無關依賴；meta／repo extension 閘不要求因 pristine 本身失敗，須針對自身契約造負對照。加入套件根一致性的機檢，覆蓋 AGENT／CORE／AI／SNAPCOMPACT／CATALOG／共同 NM，不只識別 SNAPCOMPACT_ROOT；type-only import 不得誤算。根覆蓋及負對照狀態按 research 的現役清單逐項回填。
- [ ] ACS4／RS4：測試錯誤訊息換字不再觸發 spec gate；相關實際行為被破壞仍被執行閘抓到。五族等價、retired hashes、兩計畫解析、全鏈逆剝及 `--selftest` 保持通過；同鏈不再重複物化比較。
- [ ] ACS5／RS5：兩版零 fuzz 完整重演、再套冪等、revert→pristine；無 `.orig`／`.rej`。新舊最終樹差異只能是 RS2 指定的 `pi-coding-agent/src/session/messages.ts`，不能聲稱本批是源碼零差異的純 rollup。
- [ ] ACS6／RS5-RS6：聚焦覆核完成後回寫 spec；確認部署後 ledger 零漂移、live 32 行 APPLIED，live 源碼與已驗收的 18.1.18 目標一致；未取得部署確認時只交 repo diff 與沙盒證據，不宣稱已部署。

## Acceptance Criteria — Phase B（另議時生效）

- [ ] ACB1：18.1.18 計畫 `--check` = 26 補丁＋bin = 27 行全 APPLIED；18.1.14 計畫 = 22＋bin = 23 行。
- [ ] ACB2：verify-rollups 全綠（含新族定義、+8 retired SHA-256、absence 斷言）。
- [ ] ACB3：兩版沙盒 apply→idempotent→revert→pristine 零差異；live sha256 不變。

## Out of Scope

- 18.1.19 遷移評估（cache 已有 tarball，另行）。
- 0055+0058、0014+0054、0026+0030、0019+0042 合併（緩議/已死）。
- bun cache 污染修復（記錄在案；沙盒一律官方 tarball）。
- 0012/0016 機制改動（僅文檔標注）。
- A2 不處理：`providerOnly` 機制／舊尾巴測試的成組移除、大幀估價 7874>5024 的修正、0026 遠端 override 白名單、任何 Phase B 合併、未註冊診斷腳本的全面整理。
- 不當成新缺陷：0037 的事件式節流／不強制重繪、0036 已記錄的 rescue 保守策略。0062「雙倍 baseline」推測已撤回，現有 `preparedContextTokens` 生產者同時傳 `triggerContextTokens`，本批不動其算式。

## Planning Status

- 2026-09-13 使用者確認 A2，並要求「scope 不要一味擴大，只清掃關鍵位置」；以 RS1–RS6 為上限，不增加周邊整理。Phase B 保持延後；live 部署另取最終 diff 確認。
- 最終範圍覆寫：使用者要求完成原任務、極致最小修改、後續測試與審查均 0 次。保留 RS1/RS2 與現役根解析的必要修復、刪除假證據；取消新增 meta 檢查器、新增回歸用例與擴張驗收，不把 ACS3/ACS5/ACS6 的原大套件要求當作繼續擴 scope 的理由。既有驗證結果只記錄實際範圍；部署仍未授權。
