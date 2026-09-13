# 補丁鏈清場＋第二輪 rollup：死版本計畫移除、0036/0037 族擴編、0045+0046 併為新層

## Goal

兩階段。**Phase A（本批交付）**：清除過時版本計畫與死補丁——只留 18.1.14＋18.1.18 兩個存活計畫，base 陣列降為純 canonical 清單（不再是可部署的 18.0.9 計畫），死補丁與死候選目錄按契約退役，verify-rollups 與 PATCHES.md 回到真實口徑。**Phase B（清場後另議）**：A=0044+0052+0057 併入 0036 族、B=0041 併入 0037 族、C=0045+0046 併為新補丁 0063。

## Background / Confirmed Facts

- 當前鏈（工作樹口徑）：base 28 − omit:0019/0042/0051 + 鏈尾 6 = **31 補丁**，18.1.18 `--check` 全 APPLIED。HEAD 口徑 30 層（含 0059）。
- **用戶已決**：18.0.9 過時；只留 18.1.14＋18.1.18；先清場再談合併。
- **真實可套矩陣**（官方 tarball pristine 實測，非 bun cache）：18.0.9 上 0045/0046 套不上（既有斷點，其 a 側是 18.1.x 形態）；18.1.10/18.1.14/18.1.18 全鏈皆綠。
- **bun cache 已被污染不可當 pristine**：`pi-ai@18.1.14` 的 ollama.ts sha256 是 18.1.18 官方值；`pi-coding-agent@18.1.14` 的 session-selector.ts 已含 0050 內容。沙盒一律用官方 tarball＋SHA-256。
- 0059 曾進 active chain（cc6596c），按契約須退役留檔而非純刪。
- apply.sh 尾部套件實掛 **14 道**閘門（PATCHES.md §6.1 只列 12，漏 devin-thinking-signature 與 devin-idle-cascade-pin）。
- verify-rollups 靜態閘 `entries == 18` 早已與 28 條陣列脫節；OLDCHAIN 缺 0043 以降全部新補丁——該腳本目前跑不過，屬既有腐壞。
- 分析全文：`research/patch-chain-analysis.md`；reviewer 審查結論 fix-then-execute（6 P1＋2 P2，已全部納入本版計畫）。

## Requirements — Phase A（清場）

- **RA1 備份**：已完成 repo/runtime `patches/` cp -a、六包 live tarball、bin/omp symlink、live sha256 清單（`~/omp-merge-backup-20260913-071204/`）。未提交 9 檔先 commit 成已知良好點——0059 改為 `git mv` 進 `.retired/`（不純刪）。
- **RA2 apply.sh**：① PATCHES 陣列移除 0019、0042（所有存活計畫均已 omit，上游 18.1.10 已拆該機制）；② 版本分支只留 `18.1.14`、`18.1.18`，刪 18.0.9/18.0.11/18.1.2/18.1.5/18.1.10 五支與其 omit 殘句；③ `OMP_PATCH_VERSION` 未設 → **auto-route**（讀 installed `pi-coding-agent` 版本精確匹配存活計畫，非就近 fallback；安裝版不符或顯式跨版本值 exit 2）——比原案 unset→exit 2 更好：保留「`bun add -g` 後裸跑一鍵重套」文件化路徑，且讓 verify-rollups 沙盒子控制器自動選對計畫；④ 尾部 14 道閘門不動；⑤ 新增 `--print-plan`（read-only 計畫查詢，輸出 `file:ROOT` 行，是 verifier 的唯一 resolver）。
- **RA3 退役歸檔**：0019、0042、0059 三個 `.patch`＋死候選目錄（.18.0.11/.18.1.2/.18.1.5/.18.1.10）＋死 verify 腳本（verify-model-switch-tool-description.ts、verify-date-cwd-reminder.ts）→ `.retired/09-13-dead-plans/`，逐檔記 SHA-256。
- **RA4 verify-rollups 修復**：`entries` 期望值改為新陣列數（26）；absence 斷言加 0019-/0042-/0059-/0061- 且改對 resolved plan 判定；retired manifest 補 `.retired/09-13-dead-plans/` 16 檔 SHA-256；**雙基線**——族檢查留 18.0.9 pinned tarball（退役族成員只在那裡成鏈），全鏈 oracle／peel／gate #11/#12 移 18.1.14 pinned tarball；`OLDCHAIN`＝釘死的前一表示鏈（等價 oracle before 側），`EXPECTED_PLAN`/`EXPECTED_PLAN_18` 獨立釘住兩計畫解析結果（計畫漂移閘），`NEWCHAIN` 由 `apply.sh --print-plan` 解析；新增 gate #12 fail-closed 矩陣（6 壞輸入精確 exit 2＋樹零變動）。
- **RA5 PATCHES.md 重寫口徑**：§0 狀態表、§1 改為「canonical 清單＋18.1.14/18.1.18 兩計畫」、§2 退役條目標注（含 0012/0016「不進 apply.sh」）、§3 補新退役、§5 `PATCHES+=` 清單、§6.1 補齊 14 道閘門。
- **RA6 ledger**：全部 repo 修改完成後單次 `rsync -a patches/ ~/.omp/patches/`＋`diff -rq` 零漂移（最後同步，禁止中途同步）。
- **RA7 驗收**：18.1.14 與 18.1.18 官方 tarball 沙盒各跑 apply→idempotent→revert→pristine 零差異；live `--check` 全 APPLIED 且 live 樹 sha256 不變。

## Requirements — Phase B（合併，清場驗收後另議）

- RB1：0044+0052+0057 併入 0036 族（族鏈 {0015s,0015a,0020s,0020a,0022,0044,0052,0057}，18.0.9 官方 tarball 族沙盒生成——生成基線是構建工件非部署目標）；舊 0036 位元組一併退役。
- RB2：0041 併入 0037 族（{0005,0007,0029,0041}）；舊 0037 位元組退役。
- RB3：0045+0046 併為 `0063-omp-session-maintenance-guard-rollup.patch`，反向剝離法在 **18.1.14** 全鏈沙盒生成（canonical=最舊存活版）；18.1.18 若上下文不過則產 `.18.1.18-candidates/0063`。
- RB4：verify-rollups 族定義與 manifest 同步（retired +8：0041/0044/0045/0046/0052/0057＋舊 0036＋舊 0037）；absence 斷言補全。
- RB5：18.1.14/18.1.18 沙盒重演＋live 等價＋PATCHES.md 收尾，同 Phase A 口徑。

## Acceptance Criteria — Phase A

- [ ] AC1：`sed -n '/^PATCHES=(/,/^)/p' patches/apply.sh | grep -c 'patch:'` = **26**；`OMP_PATCH_VERSION` 未設時 `apply.sh` exit 2；`18.1.14`/`18.1.18` 之外的所有版本字串 exit 2。
- [ ] AC2：`ls patches/.18.0.11-candidates patches/.18.1.2-candidates patches/.18.1.5-candidates patches/.18.1.10-candidates 2>&1` 全部不存在；`.retired/09-13-dead-plans/` 含 0019/0042/0059 三 patch＋4 個候選目錄＋2 個死腳本，SHA-256 與來源一致。
- [ ] AC3：`bash patches/verify-patch-family-rollups.sh` 與 `--selftest` 全綠。
- [ ] AC4：18.1.14 與 18.1.18 官方 tarball 沙盒：apply 全 APPLIED → 再 apply 全 SKIP → revert 後 `diff -r` 對 pristine 零差異、無 `.orig`/`.rej`。
- [ ] AC5：`OMP_PATCH_VERSION=18.1.18 bash ~/.omp/patches/apply.sh --check` 全 APPLIED / 0 CONFLICT；live 六包 src sha256 對備份基線逐檔一致。
- [ ] AC6：`diff -rq patches/ ~/.omp/patches/` 零輸出；PATCHES.md 不再出現 18.0.9/18.0.11/18.1.2/18.1.5/18.1.10 作為存活計畫的表述。

## Acceptance Criteria — Phase B（另議時生效）

- [ ] ACB1：18.1.18 計畫 `--check` = 26 補丁＋bin = 27 行全 APPLIED；18.1.14 計畫 = 22＋bin = 23 行。
- [ ] ACB2：verify-rollups 全綠（含新族定義、+8 retired SHA-256、absence 斷言）。
- [ ] ACB3：兩版沙盒 apply→idempotent→revert→pristine 零差異；live sha256 不變。

## Out of Scope

- 18.1.19 遷移評估（cache 已有 tarball，另行）。
- 0055+0058、0014+0054、0026+0030、0019+0042 合併（緩議/已死）。
- bun cache 污染修復（記錄在案；沙盒一律官方 tarball）。
- 0012/0016 機制改動（僅文檔標注）。

## Open Questions

- 無阻塞項。Phase B 的 0063 是否需要 18.1.18 候選，由生成後 dry-run 實測決定。
