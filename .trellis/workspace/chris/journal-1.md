# Journal - chris (Part 1)

> AI development session journal
> Started: 2026-08-24

---



## Session 1: Session cache keepalive

**Date**: 2026-08-25
**Task**: Session cache keepalive
**Branch**: `master`

### Summary

Replaced the generic cron scheduler with a session-local prompt-cache keepalive, added an atomic guarded ephemeral-turn seam, fixed reset/dispose/tree-navigation races, added regression harnesses, and verified a live cache hit without transcript growth.

### Git Commits

| Hash | Message |
|------|---------|
| `091192b` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Bound finite cache keepalive runs

**Date**: 2026-08-25
**Task**: Bound finite cache keepalive runs
**Branch**: `master`

### Summary

Replaced unbounded cache keepalive repetition with finite command/tool budgets, hardened zero-budget reschedule races, synchronized the live extension, updated the runtime contract, and verified narrow harnesses plus live Codex cache-hit/disable behavior.

### Git Commits

| Hash | Message |
|------|---------|
| `8a0a8e8` | (see git log) |

### Status

[OK] **Completed**


## Session 3: Soft compaction prompt-cache wire identity

**Date**: 2026-08-27
**Task**: Soft compaction prompt-cache wire identity
**Branch**: `master`

### Summary

Reused the active Agent provider-ready context under a strict runtime/wire model gate, regenerated 0013 patches, passed a real Opus compaction at 97.046215% cache hit rate, and wrote the executable contract into backend specs.

### Git Commits

| Hash | Message |
|------|---------|
| `ceb6f75` | (see git log) |

### Status

[OK] **Completed**


## Session 4: 修復 Resume Tools Description 漂移

**Date**: 2026-09-02
**Task**: 修復 Resume Tools Description 漂移
**Branch**: `master`

### Summary

修復行程內與新進程 resume 的 cached read.description 漂移，部署 0042 至本機 OMP，並記錄啟動期 late model reclaim 契約。

### Git Commits

| Hash | Message |
|------|---------|
| `b439762` | (see git log) |
| `c5eb069` | (see git log) |

### Status

[OK] **Completed**


## Session 5: 會話 01a07221 中段 cache miss 歸因：supersede 虧本剪枝 + audit 多模型串線

**Date**: 2026-09-05
**Task**: 會話 01a07221 中段 cache miss 歸因：supersede 虧本剪枝 + audit 多模型串線
**Branch**: `master`

### Summary

查 01a07221 的中段 cache miss。37 筆 usage 與 37 份 payload 嚴格對齊，浪費 239316 token，定出三類：① turn8 真中段改寫——同檔案讀兩次，pruneSupersededToolResults 把中段那條 read 結果就地換成 [Superseded by a newer read of this file]，cacheRead 40832 倒退 32640；閘門 suffixTokenLimit 只數候選之後的 suffix（1122），但帳單是回退到快取檢查點的距離（8192），省 638 賠 8192、重算 input 單價約 cacheRead 10 倍，需 116 輪回本。出 0046 改無條件 suffixTokenLimit: 0；語義是改排程非關功能——supersede 候選按構造必有後繼故 suffix 恆>0，全部推遲到快取已冷的 idle flush。② turn32 整段重算 108854（佔浪費 45%）——before_provider_request 層前綴逐字節一致、tools 與參數全同、三個 extension 均不改 payload、turn33 命中 turn32 寫入的前綴，omp 側排乾淨；該層不等於出站 bytes，剩 HTTP headers 與 fetch 層需錄製反代，未修。③ 其餘 35 輪約 121757 token 是階梯滲漏，非缺陷。排查中另抓到 cache-prefix-audit 的多模型串線：diff 在請求離站算、verdict 在回應抵達寫，單槽被最後發請求的模型佔據，luna 的請求插在 deepseek 請求與回應之間，turn32 被誤歸因 HISTORY_REWRITE index 160（該請求只有 74 條 message），改為 lastDiffByModel 按 model 分槽。兩項均有負向對照：0046 源碼閘在 pristine 必紅；audit 新回歸換回修前 extension 精準紅在歸因斷言 SYSTEM_DRIFT vs HISTORY_REWRITE。

### Git Commits

| Hash | Message |
|------|---------|
| `b472095` | (see git log) |
| `2e29da2` | (see git log) |
| `367ebd4` | (see git log) |

### Status

[OK] **Completed**

## Session 6: agent.db 體檢、備份鏈重建與 repo 收尾（0047/0048/vision）

**Date**: 2026-09-08
**Task**: （無正式 task；運維 + 收尾）
**Branch**: `master`

### Summary

live `agent.db` 體檢：integrity ok、外鍵無違例、忽略 WAL 的主檔獨立 ok、WAL 1003 幀在 autocheckpoint=1000 正常循環、唯一持有進程為當前會話。隱患集中在備份鏈——9/7 的「credential-safe」與 corrupt-20260907 報錯逐字相同（同為損壞現場複製），全部可信備份停在 8/30/16 憑證。處置：對 live 做 `.backup` 新備份 `credential-safe-20260908-080025.db`（integrity ok、憑證列與 live 逐行 sha256 一致、刪 sidecar 後單檔自足），刪除 36 個過時/損壞備份（含 db-repair-0907/ 整個目錄——其 dump.sql/cred.txt 為 644 明文憑證外泄面），含密鑰 db 全部收斂 600。教訓：本會話早期把 auth_credentials 整表白文打進了 transcript，後續一律 quote→sha256 比對，不回顯。

repo 收尾：0048 補齊 runtime 同步；0047 沉澱為僅 18.1.10 計畫鏈（base 計畫=18.0.9 實測 --fuzz=0 四 hunk 全掛，否決入 base；改在 OMP_PATCH_VERSION=18.1.10 分支 _omp_version_candidates 後 PATCHES+=，live 樹反向逐字節吻合 + GATE1/2 PASS + 18.1.10 全鏈 --check 零衝突）；vision-warmup 鏡像登記 §3（部署版 cmp 逐字節一致）；runtime ~/.omp/patches 零漂移複驗通過。

### Git Commits

| Hash | Message |
|------|---------|
| `4ddb151` | chore(vendor): bump pi-commandcode-provider → usage provider + pool active |
| `ae287cb` | feat(patches): 登記 0047/0048 與 vision-warmup；0047 限定 18.1.10 計畫 |
| `6168299` | docs(agents): 新增 Trellis spec 機制段（換模輪替強制項） |
| `5d26c24` | docs(trellis): acp-omp-eval S1.7a 靜態隔離證據 + obs 0907 回滾材料易主；journal S6 |

### Status

[OK] **Completed**


## Session 6: 0063 Codex V2 compaction E2E PASS + 工作區收尾

**Date**: 2026-09-14
**Task**: 0063 Codex V2 compaction E2E PASS + 工作區收尾
**Branch**: `trellis/ds-snapcompact-tuning`

### Summary

E2E verified patch 0063: real session 01a0a05f (openai-codex/gpt-5.6-luna) /compact produced cachedInputTokens=23040, cached/input=95.4% (PRD >=80%), exit 0. Fixed check-codex-compaction-cache.sh formula (cached/input per PRD, not cached/(cached+input)) and added >=80% gate with exit 3 partial-hit. Spec: verification-gate-contracts gained provider usage-record contract. Lane-split commits: 0063 registration hunks separated from wave2 A2 in apply.sh/PATCHES.md/rollups via git apply --cached; wave2 A2 committed separately; three stale task archives + two docs committed; task archived.

### Git Commits

| Hash | Message |
|------|---------|
| `4462ba4` | (see git log) |
| `4f27f66` | (see git log) |

### Status

[OK] **Completed**


## Session 7: read 描述 constructor 快照致 resume 斷前綴（0073 getter 化）

**Date**: 2026-09-19
**Task**: read 描述 constructor 快照致 resume 斷前綴（0073 getter 化）
**Branch**: `trellis/ds-snapcompact-tuning`

### Summary

用戶報「這次會話又出現 resume 後 cachemiss」：會話 01a0b7c9 首筆 input=16346 / cacheRead=9088（嚴格 35.7%），前一條 99.1%。payload 逐位元組比對：system 與 messages[1..2] 全同，13 個工具只有 read 的描述不同（少 {{#if IS_HL_MODE}} 那一行；tools hash 7e70748d823727f9 → 9ab44c61be923039），斷點與 miss 量吻合。根因：ReadTool.description 只在 constructor 渲染一次，而模板帶模型相關的 IS_HL_MODE（resolveEditMode 對 deepseek 家族強制 hashline → replace）；本會話 tools 建於 gemini-3.8-flash，隨後 retry.fallbackChains 自動降級到 deepseek，而 syncAfterModelChange 只刷 system prompt；resume 後新進程按 stored model 重建工具 → tools bytes 改變 → 前綴斷裂。同族第三次復發：0019／0042 都是入口級補丁，2026-09-13 隨死計畫退役，判據只核對 INSPECT_IMAGE_ENABLED 而漏了同位置的 IS_HL_MODE，觸發源從未消失。修法改為 getter 每次現算（與上游 grep/glob 同形、無入口依賴），落成 0073 並登記 18.2.3 計畫（38 項）；閘門 verify-read-description-live.ts 直接改 active model 斷言與冷啟逐位元組相同，負對照在 pristine 樹失敗。附帶：cache-prefix-audit 多模型串線把 TOOLS_DRIFT 誤報成 SYSTEM_DRIFT（advisor 的 luna 與主線交錯），延後定位；payload 另一差異（reasoning_effort 缺席 + reasoning_content 未重放）落在 0065 領域，機制未坐實，另案。收尾時把另一視窗（session 01a0b7c5）已完成未提交的 0072 session-pin 產出併入（兩者在 apply.sh/PATCHES.md 同一 hunk 無法切分）。未跑獨立 trellis-check agent：驗證由可執行閘門 + 負對照 + apply.sh --check 全 APPLIED + repo/runtime ledger 零漂移承擔。

### Git Commits

| Hash | Message |
|------|---------|
| `9cd249a` | (see git log) |
| `3864190` | (see git log) |

### Status

[OK] **Completed**


## Session 8: 完成 0080 Kitty 共用 PNG 快取

**Date**: 2026-09-26
**Task**: 完成 0080 Kitty 共用 PNG 快取
**Branch**: `trellis/ds-snapcompact-tuning`

### Summary

修正原 Promise 與有界 pending LRU、淘汰後失敗原因及工具/native 槽位碰撞；官方 18.2.10 全鏈重放與 live 離線 gate 通過，已部署但舊 OMP 行程須完整重啟。

### Git Commits

| Hash | Message |
|------|---------|
| `008294b52` | (see git log) |

### Status

[OK] **Completed**


## Session 9: OMP 18.10.1 S1 + Tern footer releases

**Date**: 2026-10-12
**Task**: OMP 18.10.1 S1 + Tern footer releases
**Branch**: `trellis/ds-snapcompact-tuning`

### Summary

Published 18.10.1-87c8c1c88769 then 18.10.1-14ba3537d44c (S1 0010 guard removal; cache_turn turn/session rate; 16-cell middle-truncated branch; bare reset-credit count). Recreated and committed installed smoke harness. Footer confirmed in Tern after dropping token_total.

### Git Commits

| Hash | Message |
|------|---------|
| `d54fbfb7c` | (see git log) |
| `6ee8098e0` | (see git log) |
| `512dea8a6` | (see git log) |
| `dd3726ae6` | (see git log) |
| `aedf5ec08` | (see git log) |
| `2abb429d1` | (see git log) |
| `d070e7b30` | (see git log) |

### Status

[OK] **Completed**
