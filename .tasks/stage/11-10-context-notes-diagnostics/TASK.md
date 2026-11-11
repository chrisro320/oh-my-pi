---
title: 減少筆記狀態誤填與重複存檔失敗
status: review
created: 2026-11-10
from: 10-25-context-notes-retention
base_commit: 268defa945a0068f5ddd5c0fd13b912e6149c820
---
RESUME: （待驗收）

- [ ] 暫停

## 目標
讓代理不用猜 `context_notes` 的合法狀態；存錯時可直接知道哪個欄位與如何修正，已完成的 topic 不再為了存檔而誤標為 `open`。
延續已歸檔的 `10-25-context-notes-retention`，屬新的使用體驗改善；不重開暫緩中的壓縮／分支繼承／合併鎖任務。

## 驗收
- [x] 🎯 新 session 首次儲存前能取得各分類的合法狀態，並以 `completed` 儲存已完成 topic，不必先失敗或假標 `open`。
- [x] 🎯 用截圖同類輸入（topic status `done`）實測：回報出錯 ID、`status`、實際值與 `open|completed|archived`，改成 `completed` 後一次存入。
- [x] 維持既有 schema、ID 保留與 supersession 規則；錯誤儲存不覆寫舊筆記。
- [x] 查清 repo 與執行中 extension 的版本差異；交付清楚標示套用位置、啟用方式與是否已生效。
- [x] 定點 review 與相關 behavioral gate 通過；文件僅更新確有變更的契約，持久決策成立才更新 DECISIONS.md。

## 做法
執行方式：main alone；變更集中於 notebook companion 與既有驗證，主代理直接實作、定點 review 和執行最小驗證，避免額外分工成本。

1. 確認執行中 extension 與 repo 差異、首次儲存前的指引來源；重用現有診斷，不重做已完成程式。
2. 補足合法狀態提示與必要的欄位診斷，保留固定 schema，不新增 `done`／`closed`／`resolved` aliases 或自動改寫。
3. 用真實儲存路徑證明無效狀態可修復、`completed` 可存、舊筆記受保護；完成定點 review，交代啟用狀態。

本人已確認文字計畫，要求直接刪除被取代內容，不留 deprecated 或新舊雙份規則。部署僅更新 companion 與靜態指引，不重啟目前會話，不動 immutable runtime／release ledger；保留部署版既有 placeholder 保護與必填 supersedes 規則。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| notebook 狀態提示與診斷 | 確認版本、最小實作、review、驗證與交付 | main | 全部 |
| 交付變更報告 | 僅本任務觸及路徑的說明、render 與 report lint，不改產品檔 | NotebookChangeReport（task） | report.html 與 lint PASS |

## 證據
- 已替換 `patches/context-notes-save-gate.ts` 與 `~/.omp/agent/extensions/context-notes-save-gate.ts` 的 schema guidance；部署版泛用 row 錯誤已拆為實際欄位／值／合法選項，舊 INDEX_FORMAT pseudo-JSON 已移除。未覆蓋部署版其他防護。
- 已直接改寫 `~/.omp/agent/APPEND_SYSTEM.md` 的 `<context_notes>`，首次請求即列出分類欄位與合法狀態；PATCHES.md 與 DECISIONS.md 原章節同步改寫，沒有 deprecated 雙份內容。
- `bwrap --die-with-parent --unshare-net --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp /home/chris/.bun/bin/bun patches/verify-context-notes-retention.ts` → PASS 16/16；既有 wording-only probes 已刪，替換為 16 種壞 schema 不覆寫、completed 修復、ID 保留的真實 SDK 行為。
- 部署版 throwaway smoke（私有 HOME／XDG、`bwrap --unshare-net`、synthetic MockModel／fetch denied）→ PASS 9/9：首次請求含 schema 且 completed 首存成功，done／closed／resolved 均給精確診斷，修成 completed 一次存入，placeholder body/source、必填 supersedes、登記 ID 防護均維持；僅兩筆有效 revision／ack。
- 實際 status 診斷：`context-notes-save-gate: t-android-0916: invalid status "done"; valid statuses for topics are open|completed|archived.`
- 定點自審：schema enum 單一來源、錯誤候選保留其他已登記 ID 以免被 retention 假陽性遮住、失敗不增加 revision／ack、部署既有 placeholder 與 supersedes 契約保留。無可用 LSP，未聲稱 typecheck；未呼叫真實遠端模型。
- 檔案已更新；全新 SDK session 已實測載入新版 extension 與 APPEND_SYSTEM，當前會話未熱載入。下次全新啟動的 OMP 會話才載入新版；未實測恢復舊 session 是否重繪 system prompt。未變更 immutable runtime／release ledger。
- 變更報告：[report.html](report.html)，僅本任務觸及的 5 個 repo 路徑，明示同檔先前變動與部署檔不在 Git diff。主代理執行 `python3 /home/chris/.omp/agent/skills/oil-diff/scripts/lint_report.py --repo /home/chris/orca/projects/omp-move --report-dir /home/chris/orca/projects/omp-move/.oil-diff` → `PASS: 0 errors, 0 warnings`；tasks `report --open` 成功。throwaway smoke 已刪。

## 紀錄
- 2026-11-10 建立
- 2026-11-10 依文字計畫開工
- 2026-11-10 開始實作
- 2026-11-10 本人確認開始；新增限制：直接替換舊內容，不疊加 deprecated 版本。查得 repo 已有細項診斷、部署版仍是泛用訊息，首次存檔的 APPEND_SYSTEM 缺少合法狀態。
- 2026-11-10 完成最小實作與文件原地替換；retention 16/16、部署 SDK smoke 9/9 通過，無重啟。
- 2026-11-10 改動報告：report.html
- 2026-11-10 送交驗收
