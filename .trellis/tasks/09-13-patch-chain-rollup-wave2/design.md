# Design — 補丁鏈清場＋rollup wave 2

## 術語

- **canonical 清單**：`PATCHES` 陣列的新定位——所有存活計畫共用的補丁母集，本身不是可部署計畫。
- **族（family）**：同一功能的初版＋補漏歷史，rollup 時從官方 pristine 單獨套該族舊鏈生成單一補丁。
- **反向剝離法**：全鏈樹按逆序 `patch -R` 剝掉待併補丁得 t_a，`diff(t_a, t_full)` 即合併補丁。
- **存活計畫**：18.1.14（回退）、18.1.18（當前部署）。其餘版本分支全部死亡。

## 決策樹

### D1：unset `OMP_PATCH_VERSION` → fail-closed

- **選擇**：未設版本即 exit 2，錯誤訊息列支援版本。
- **為什麼**：base 陣列的 a 側是多版本混合形態（0045/0046 是 18.1.x 形態、canonical 0010/0035 等是 18.0.9 形態），對任何單一版本都不是可部署計畫。留著「unset=18.0.9 鏈」正是本次混淆源。`_omp_version_candidates` 的版本閘本來就會在錯版機器上 fail-closed，行為一致。
- **否決項**：unset 預設最新版——隱式選計畫違背本倉庫 fail-closed 慣例；`--verify-rollups` 在版本選擇前 exec，不受影響。

### D2：死物一律退役留檔，不純刪

- **選擇**：0019/0042/0059 patch、4 個死候選目錄、2 個死 verify 腳本全部進 `.retired/09-13-dead-plans/`＋SHA-256。
- **為什麼**：`patch-rollup-contracts.md`——進過 active chain 的補丁必須留 bytes＋pinned hash。候選檔是計畫成員同適用。verify 腳本雖非補丁，留檔成本為零且保留復活可能。
- **0059 特例**：已 staged 刪除，改為 `git mv` 進 .retired（它進過 18.1.18 計畫）。

### D3：verify-rollups 修復而非退役

- **選擇**：更新 `entries` 期望值、absence 清單、retired manifest、OLDCHAIN 為「18.0.9 可套的當前語義集」。
- **為什麼**：腳本已腐壞（`entries==18` 對 28 條必死、OLDCHAIN 缺 0043 以降全部）。它的族等價＋全鏈等價仍是 rollup 正確性的唯一機檢，Phase B 還要用。
- **OLDCHAIN 口徑**：18.0.9 是**生成/驗證基線**（構建工件），不是部署目標。0045/0046/0063 在 18.0.9 本來套不上，兩側同時不含它們，等價檢查仍成立。
- **否決項**：基線搬 18.1.14——族舊鏈（0002/0003/0013/0015/0020/0022 等）是 18.0.9 形態，在 18.1.14 多半套不上，等於重寫整套驗證機制。

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
