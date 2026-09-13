# Design — 補丁鏈清場＋rollup wave 2

## 術語

- **canonical 清單**：`PATCHES` 陣列的新定位——所有存活計畫共用的補丁母集，本身不是可部署計畫。
- **族（family）**：同一功能的初版＋補漏歷史，rollup 時從官方 pristine 單獨套該族舊鏈生成單一補丁。
- **反向剝離法**：全鏈樹按逆序 `patch -R` 剝掉待併補丁得 t_a，`diff(t_a, t_full)` 即合併補丁。
- **存活計畫**：18.1.14（回退）、18.1.18（當前部署）。其餘版本分支全部死亡。

## 決策樹

### D1：unset `OMP_PATCH_VERSION` → auto-route（review 修正）

- **選擇**：未設版本時讀 installed `pi-coding-agent` 版本精確路由到存活計畫（18.1.14/18.1.18）；安裝版不符或顯式值跨版本一律 exit 2。
- **為什麼**：比原設計的 unset→exit 2 更好——保留「`bun add -g` 後裸跑 `apply.sh` 一鍵重套」的文件化路徑，且讓 verify-rollups 的 gate #11 子控制器在 18.1.14 沙盒內自動選對計畫。精確匹配＋非就近 fallback，不違 fail-closed。
- **否決項**：unset→exit 2（原案）——會破壞一鍵重套路徑，且強迫沙盒子控制器顯式傳版本。

### D2：死物一律退役留檔，不純刪

- **選擇**：0019/0042/0059 patch、4 個死候選目錄、2 個死 verify 腳本全部進 `.retired/09-13-dead-plans/`＋SHA-256。
- **為什麼**：`patch-rollup-contracts.md`——進過 active chain 的補丁必須留 bytes＋pinned hash。候選檔是計畫成員同適用。verify 腳本雖非補丁，留檔成本為零且保留復活可能。
- **0059 特例**：已 staged 刪除，改為 `git mv` 進 .retired（它進過 18.1.18 計畫）。

### D3：verify-rollups 修復而非退役（review 後定稿架構）

- **選擇**：雙基線——族檢查留 18.0.9 pinned tarball（退役族成員只在那裡成鏈）；全鏈 oracle／peel／gate #11/#12 移 18.1.14 pinned tarball（最舊存活版）。
- **單一 resolver**：`apply.sh --print-plan` 是唯一的計畫解析器（read-only、跳過 installed 閘、仍查候選檔存在性）。verifier 禁止自行解析 `_omp_version_candidates`——第二份手維清單不是 oracle（review HIGH-2）。
- **EXPECTED_PLAN 與 OLDCHAIN 分離**（review HIGH-1）：`EXPECTED_PLAN`/`EXPECTED_PLAN_18` 釘住兩個存活計畫的解析結果（計畫漂移閘）；`OLDCHAIN` 是等價 oracle 的 before 側（前一表示鏈）。今天兩者相同；Phase B 合併落地時 EXPECTED_PLAN 更新為合併後計畫、OLDCHAIN 保持合併前，樹 diff 證明合併只改表示。
- **gate #12 fail-closed 矩陣**：6 種壞輸入（空值/不支援/跨版本/installed 不可讀×2/候選檔缺失）全部 exit 2＋套件樹零變動。
- **absence 閘**：退役編號檢查改為對兩個 resolved plan 判定（含候選置換與鏈尾追加），不再掃原始文本。

### D4：沙盒只用官方 tarball＋SHA-256

- **選擇**：`npm pack`/registry 直下，sha256 驗證後解壓；bun cache 一律不用。
- **為什麼**：實測 cache 已污染（`pi-ai@18.1.14` 內容是 18.1.18 的檔、session-selector.ts 含 0050 產出）——hard-link/就地寫入風險成真。已抓取的 tarball SHA-256 記入沙盒腳本當 pin。
- **沙盒佈局**：假 HOME `<dest>/.bun/{install/global/node_modules/@oh-my-pi/<pkg>,bin/omp}`；`bin/omp` symlink 預建（否則 `--check` 尾行假失敗）；`OMP_PATCH_OFFLINE_VERIFY=1`。

### D5：Phase B 合併方法（清場後執行）

- **A/B 族重生成**：0036 族 {0015s,0015a,0020s,0020a,0022,0044,0052,0057}、0037 族 {0005,0007,0029,0041}，18.0.9 官方 tarball 族沙盒生成（全部成員實測可在 18.0.9 套）。舊 0036/0037 位元組進 .retired。
- **C 反向剝離**：在 **18.1.14** 全鏈沙盒反套 0046→0045 得 t_a，`diff(t_a, t_full)` 限 session-maintenance.ts 生成 0063 canonical（最舊存活版形態）；對 18.1.18 post-chain-minus-0045/46 樹 dry-run，不過則產 `.18.1.18-candidates/0063`。
- **為什麼 C 不用族生成法**：`session-maintenance.ts` 五方共享（0035/0036/0045/0046/0062），pristine 基線產出的 a 側在真實鏈位對不上（spec Bad case）；且 0045/0046 在 18.0.9 根本套不上。
- **否決項**：併入 0035 族（不同族語義＋0035 有候選需連帶重生成）；canonical 用 18.1.18（違 canonical=最舊存活慣例）。

### D6：順序

```
commit 未提交檔(0059→.retired) → RA2 apply.sh → RA3 退役歸檔 → RA4 verify-rollups
  → RA5 PATCHES.md → RA6 ledger rsync+cmp → RA7 兩版沙盒＋live 等價 → commit
  ── Phase A 交付，Phase B 另議 ──
```

## 相容性

- live 樹零差異是硬約束：清場只動 repo `patches/` 與文檔，live 不應有任何寫入；`--check` 全 APPLIED 為證。
- 退役編號 0019/0042/0059/0061 永不重用（verifier absence 斷言機檢）。
- 18.1.14 計畫在 live 機器上會被版本閘擋（installed=18.1.18）——正常，它只在 18.1.14 沙盒內跑。
