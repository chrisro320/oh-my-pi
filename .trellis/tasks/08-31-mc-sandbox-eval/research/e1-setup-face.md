# E1 — MC setup 改動面沙盒實測（dry-run）

日期: 2026-08-31 | MC 版本: @cortexkit/magic-context@0.41.1 (npx) | OMP: 18.0.11
環境: `unshare -m` 遮蔽 live（mask-check 通過，內容子路徑全 ENOENT）+ 沙盒 HOME + `MAGIC_CONTEXT_STORAGE_DIR=$SBX/mc-db`

## 沙盒環境準備中發現

1. **MC CLI 要求 node>=24**（`styleText` 缺失直接 crash on node 18）→ 沙盒內 PATH 指向 nvm node v24.15.0
2. **omp 偵測鏈**（omp-helpers.ts detectOmpBinary）: PATH → package → `$HOME/.bun/bin/omp`。沙盒無 omp → 寫 shim `$SBX/home/.bun/bin/omp`（bash wrapper → bun cli.ts）
3. **沙盒無憑證時 omp models 只回 ollama 本地 3 條**；wizard 模型選擇列表跟著 ollama 走
4. `MAGIC_CONTEXT_STORAGE_DIR` 覆寫優先於 XDG（data-path.ts 197 行註釋確認），符合設計預期

## DRY-RUN 完整 prompt 序（乾淨 cwd，無 project overlay）

| # | Prompt | 選擇 | 前置條件 |
|---|--------|------|---------|
| 0 | `[dry-run] would migrate legacy Magic Context config` | 自動 | 總是 |
| 1 | Configure Oh My Pi (OMP) to load Magic Context? | Yes | omp 偵測成功（顯示版本+路徑） |
| 2 | `[dry-run] would register @cortexkit/pi-magic-context in $HOME/.omp/plugins/omp-plugins.lock.json` | 自動 | Yes 後 |
| 3 | Select a model for the historian | ollama/glm-5.3-flash:cloud | 沙盒只有 ollama 目錄（無憑證）|
| 4 | Enable dreamer for overnight memory maintenance? | Yes | |
| 5 | Select a model for the dreamer | ollama/glm-5.3-flash:cloud | |
| 6 | Use recommended task schedules? (verify nightly; curate weekly; classify+retrospective daily; docs off) | Yes | |
| 7 | Enable sidekick for /ctx-aug? | No（預設 No）| |
| 8 | Select embedding provider | Local (Xenova/all-MiniLM-L6-v2) | |
| 9 | Disable OMP native compaction? | Yes | 沙盒 compaction.enabled=true 觸發 |
| 10 | Disable OMP memory backend? | **未出現** | 沙盒 memory.backend=off（OMP 預設）不觸發 |

## 實際改動面（dry-run 宣告 + source 對照）

dry-run 聲明的寫入點（real run 時會做）：
1. `$HOME/.omp/plugins/omp-plugins.lock.json` — plugin 註冊（`omp plugin install @cortexkit/pi-magic-context`）
2. `omp config set compaction.enabled false` — 關原生 compaction
3. `omp config set memory.backend off` — 僅當 memory.backend≠off（沙盒預設 off 未觸發）
4. `$HOME/.config/cortexkit/magic-context.jsonc` — MC 共享配置（historian/dreamer 模型、schedules、embedding、sidekick）

源碼對照（setup-omp.ts beforeWrite）:
- `omp config get --json` 讀 compaction.enabled / memory.backend；讀不到 → 拒裝（"refusing to install two context managers blindly"）
- 寫入有 rollback：`omp config set` 失敗會逆序回滾已套用的 changes
- plugin 安裝走 `omp plugin install`，rollback 走 `omp plugin uninstall/disable`

## 實測踩到的行為特徵（real-run 前的風險預警）

1. **`getOmpSetting` null 導致 abort**：MC 用 `spawnSync` 呼叫 omp shim 讀 config——**沙盒 agent.db 尚未初始化時 omp config get 會 throw**（"Failed to open agent database... unable to open database file"）→ MC 收 stderr→ status!=0 → 回 null → 拒裝。
   → **real-run 前必須先在沙盒以 chris 身份跑一次 `omp --version`（觸發 agent.db 初始化），否則 wizard 必在 compaction 段 abort**（本次第4跑實測踩中，權限修復+db 初始化後通過）。
2. **root 汙染**: ns 內以 root 身份創建/寫入沙盒檔案後，chris 身份的 omp/npm 讀寫 EACCES——已兩次踩中（.npm/_cacache、.omp/、work/e1/.omp）。內層腳本紀律：root 只 mount，其餘 setpriv 降權 + 事後 chown。

## R6 分支（project/overlay 拒絕）重現 ✅

cwd=$SBX/work/e1 帶 `.omp/config.yml`（空 {}）時，wizard 在「Disable OMP native compaction? → Yes」後拋：

```
■  OMP effective settings come from project/overlay config; refusing to mutate the global config.
│  - /home/chris/mc-sandbox/work/e1/.omp/config.yml
│  Edit those files directly, then rerun setup.
└  Setup stopped — could not configure Oh My Pi (OMP).
```

與 setup-omp.ts:123-131 預期一致：`changes.length>0 && nonGlobalSources.length>0` → 拒絕。本機 live 的多層 config（~/.omp config + project overlay）在真實接入時也會踩此分支——**MC 在有 project overlay 的 repo 目錄跑 setup 根本改不了全域 config**，屬接入前必處理項。

## 沙盒殘留（E1）

- `$SBX/home/.npm/`（npx 緩存，root 汙染後已 chown）
- `$SBX/home/.bun/bin/omp` shim
- `$SBX/home/.omp/agent/agent.db`（omp 初始化產生，無憑證）
- `$SBX/work/e1/.omp/config.yml`（R6 誘導檔）
- context.db 未產生（dry-run 不寫）