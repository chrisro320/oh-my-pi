---
title: 精簡 /init 指令：只寫現況、不重複、準確
status: review
created: 2026-11-11
from: 11-10-repository-guidelines
base_commit: 268defa945a0068f5ddd5c0fd13b912e6149c820
---
RESUME: （待驗收）

- [ ] 暫停

## 目標
優化 `/init` 指令本身：精簡、無重複；產出的 AGENTS.md 只寫現況（過時內容就地替換，不留「已取代」再追加的疊加寫法）、不和 DECISIONS.md／.tasks/lessons.md 重疊、內容準確。以本專案 AGENTS.md 為成品範本。

## 驗收
- [x] 🎯 在 omp-move 載入 slash commands，`init` 來自使用者層級覆蓋檔，內容與 [research/init.md](research/init.md) 一致。
- [x] 🎯 實跑 `/init` 於含三個對照的既有 AGENTS.md（疊加的「已取代」註記、抄自 DECISIONS.md 的一句、抄自 lessons.md 的一句）：產物三者皆移除、無取代／日期註記，並以路徑連結 DECISIONS.md 與 `.tasks/lessons.md`。
- [x] 新指令涵蓋：精簡、同一事實只寫一次、只寫現況且就地替換、只連結不複製 DECISIONS.md／.tasks/lessons.md、命令與路徑皆有來源且缺少的工具明說。
- [x] 保留原指令的八節結構、標題與平行研究方式；合併原有重複指示（路徑要求兩次、架構與程式模式重複要求）。
- [x] 只改 `~/.omp/agent/commands/init.md` 與 DECISIONS.md（新增 `/init` 主題、Trellis 主題改為永久停用）；不改補丁鏈、不重發 release。
- [x] 🎯 第二輪規則（略去已停用／僅供參考的流程與目錄；不得換句話說 DECISIONS.md／lessons 的選擇）實跑：產物不列 Trellis 工作流程，不以架構描述重述 DECISIONS.md 已記的選擇，三個對照仍全部移除。
- [x] 🎯 第三輪規則（AGENTS.md 一律英文）實跑：對話設定為繁中時，產物仍為英文，且前兩輪檢查仍成立。

## 做法
執行方式：main 獨做；單一檔案、步驟有先後，派代理沒有時間收益。

1. 將 [research/init.md](research/init.md) 寫入 `~/.omp/agent/commands/init.md`；上游載入順序為使用者／專案 commands 先於內建，同名即覆蓋，不需補丁或重建。
2. 以安裝中 runtime 的 `loadSlashCommands` 在 omp-move 載入，核對 `init` 來源與內容。
3. DECISIONS.md 新增 `/init` 覆蓋主題（決定／否決／理由）。
4. 實跑驗證依本人選擇：在拋棄式 ovnfs checkout 執行 `/init`，檢查產物是否符合新規則。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|

## 證據
- 本人選 1A（全域覆蓋）、2A（實跑驗證）、第三輪 1B（一律英文）。
- 載入核對（bun 直接呼叫 runtime `loadSlashCommands`，cwd=omp-move）：`source "via OMP User"`、body 與檔案 trim 後相等、含第二輪兩條規則（`omit retired or reference-only`、`copy or paraphrase`）；research/init.md 與覆蓋檔同步。
- DECISIONS.md：新增「`/init` 指令覆蓋」主題（規則只指向覆蓋檔）；Trellis 主題改為本專案永久停用。
- 實跑：ovnfs checkout `init-trial` 種入三個對照後執行 `omp -p "/init"`（756 s，四路平行研究）。產物 52 行／5,263 bytes、八節齊全；`.trellis/tasks/` 取代註記、`maxRetries=8` 重試節奏、退役 gate 斷言三句皆移除，全文無取代／日期註記；Important Files 以路徑連結 DECISIONS.md 與 `.tasks/lessons.md` 並註明不複製。
- 抽查新增內容：`--with-unscoped`（`patches/run-gates.py:23,461`）、apply `--check`（`patches/verify-release-family-plan.py:282`）屬實。`ovnfs diff init-trial` 僅 `M AGENTS.md`；checkout 已 `ovnfs rm`。
- 第一輪觀察（觸發第二輪）：產物另列 `.trellis/spec/backend/index.md`，並以一句描述不可變 release。現行 `patches/PATCHES.md:280`、`patches/DEPLOYMENT-RUNBOOK.md:134` 仍要求遵循 `.trellis/spec/backend/patch-rollup-contracts.md`，runbook 的 smoke 腳本也在 `.trellis/tasks/archive/`。
- 第二輪實跑：`~/checkouts/init-trial2` 同三個對照，`omp -p "/init"`（961 s）。產物 47 行／4,881 bytes、八節齊全；全文無 Trellis、無不可變 release 重述、三個對照皆移除；Important Files 連結 DECISIONS.md／`.tasks/lessons.md` 並註明不複製或換句話重述。抽查 `strace` 前置屬實（`patches/apply.sh:215`）。`ovnfs diff` 僅 `M AGENTS.md`；checkout 已 `ovnfs rm`。
- 第二輪新發現（觸發第三輪）：產物改用繁體中文撰寫（第一輪與範本為英文），指令未規定語言；第三輪在標題規則加 `write in English`。
- 第三輪實跑：`~/checkouts/init-trial3` 同三個對照，`omp -p "/init"`（994 s）。產物英文、46 行／4,727 bytes、八節齊全；無 Trellis、無決策重述、三個對照皆移除，連結 DECISIONS.md／`.tasks/lessons.md`。抽查 package root 鍵 `AGENT|CORE|AI|SNAP|TUI|NM` 屬實（`patches/apply.sh:113`）。`ovnfs diff` 僅 `M AGENTS.md`；checkout 已 `ovnfs rm`。

## 紀錄
- 2026-11-11 建立
- 2026-11-11 依文字計畫開工
- 2026-11-11 開始實作
- 2026-11-11 未附改動報告：repo 內只改 DECISIONS.md 一個主題；主要變更是 repo 外的 ~/.omp/agent/commands/init.md，證據已記於 TASK.md
- 2026-11-11 送交驗收
- 2026-11-11 重開：本人選 A：補兩條規則（不寫已停用／僅供參考的流程、不換句話說 DECISIONS 的決策）
- 2026-11-11 未附改動報告：repo 內只改 DECISIONS.md 兩處主題；主要變更是 repo 外的 ~/.omp/agent/commands/init.md，證據已記於 TASK.md
- 2026-11-11 送交驗收
- 2026-11-11 重開：本人選 1B：AGENTS.md 固定以英文撰寫
- 2026-11-11 未附改動報告：repo 內只改 DECISIONS.md 兩處主題；主要變更是 repo 外的 ~/.omp/agent/commands/init.md，證據已記於 TASK.md
- 2026-11-11 送交驗收
