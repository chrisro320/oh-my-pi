# 專案決策

現行選擇與理由；能力清單見 [PATCHES.md](patches/PATCHES.md)。

## 升級與版本支援
僅支援 `18.18.0`、`18.18.6`；只留穩定版與替代版；加新版同步退役最舊版登記、plan、patch／專屬 gate。
預設採用上游新功能；暫停須有具體衝突證據與重新開啟條件。`task.workerThreads=4`，Codex 採上游 `textVerbosity: low`。

## 發布與退回
採不可變 release；安裝／發布須另經核准，舊程序正常退出後重開，不強制接管 owner。`18.18.6` 首次啟動前才可退回 `18.18.0`，避免舊 OAuth 程式讀取新 journal。
外掛另部署，保留正式副本的 `/jevify`／auto-continue 英文字串，不整份覆蓋。

## `/init` 指令覆蓋
以 `~/.omp/agent/commands/init.md` 同名覆蓋內建 `/init`（使用者層級優先於內建）；產出規則以該檔為準。
否決：補丁改內建 prompt（兩版補丁、gate 與重新發布只為改文字）；只放本專案 `.omp/commands/`（其他專案用不到）。
理由：不動原始碼、升級不失效；代價是上游對內建 `/init` 的改進不會自動帶入。

## omp-move 停用 Trellis，改用 Task
本專案永久停用 Trellis（不再恢復），改用 `tasks`；保留 `.trellis/tasks/`、`.trellis/workspace/`、`.trellis/spec/` 與 `.trellis/legacy-omp/` 供參考。
不轉換／恢復舊任務，不改其他專案或全域設定。

## OMP2 遷移原則
讀取 OMP2 原始碼，逐項比對現有能力與封存故障簽名，判定已涵蓋、需重設計或可刪除；優先 cache／prefix 與憑證安全，不直接搬補丁或只看 release notes。
壓縮前存筆記、筆記子代理與壓縮後分支等 OMP2 架構確定或使用者要求再做；不得卡住壓縮，須看實際剩餘空間。

## 平行隔離合併鎖
omp #18483 等上游，不自行移植 PR #18484；ovnfs 修正不能替代 omp 的合併鎖。

## ovnfs 與系統提示
透過 PATH 提供 `ovnfs`，不設定 `ovnfs.path`；避免重組執行中會話的 system prompt、破壞 prefix cache。

## sudo
採 `/etc/sudoers.d/90-chris-nopasswd` 免密碼，代理用 `sudo -n` 失敗即停；不存密碼或用互動視窗，以免無人時卡住。
接受任何 `chris` 程序皆可無聲取得 root 的風險；刪該檔即撤銷。外流的舊密碼仍須更換。

## 排隊與 steering
Alt+Up 先撤回 live-owned 訊息再 abort，還原顯示文字、保留其他排隊訊息；不靠關閉 steering 解決 ownership 錯誤。
初始 idle admission 與取得 in-flight slot 後的 queue policy 分開；保留等待後安全檢查，不用 timeout／重試掩蓋排程錯誤。

## Kitty 圖片 placement
Orca 的 `d=i` 只刪 placement（含 `p`），保留 source；`d=I` 才刪資源。不逐幀重送 base64 或加 cache 掩蓋協定錯誤。

## 狀態列與額度
`cache_turn` 共用規則顯示當回合／主會話命中率；當回合無 cache read 則只顯示會話值。branch 中段截為 16 cells；重置倒數一位小數、整數省 `.0`，credits 用 `✦N`。
`rightSegments` 為 `session_name, cache_turn, context_pct, usage`；不放 `token_total` 或重複的 `cache_hit`，usage 優先顯示。
額度輪詢只查目前 provider；Anthropic 只由自身回合查詢，其他 provider 的回合只看 Anthropic 快取、沒有就略過，避免 IP 限流。

## TLS 與重試節奏
僅模型回合將 `unknown certificate verification error` 視為 transient，主會話與子代理相同；不擴成所有 TLS 錯誤或額度查詢重試。此文字只是 heuristic，缺 CA 仍可能白等。
`maxRetries=8`，固定等待 `3,3,5,5,10,10,15,15` 秒；保留 retry-after 與 `retry.maxDelayMs` 上限，忽略 `retry.baseDelayMs`。

## 原生桌面安全
AT-SPI 初始化最多兩秒，失敗仍保留 X11 capture/input。Chrome 只接受 exact title 或其後接 ` U+2013 ` 與非空 profile 名稱；限 `google-chrome`，保留 PID 所有權與歧義拒絕，不泛用 prefix／座標猜測。
Escape 採上游修正，不保留重複 Rust 監看。前景 `control.acquire` 確認到 `min(run deadline, 60 s)` 即為 `unanswered`，不可用會自選 Yes 的 timeout。

## Anthropic-only durable OAuth protection
只有 Anthropic 啟用 durable reservation、未知結果拒絕、result staging 與 `/auth-unlock`；所有 provider 仍保留 single-flight、lease／renewal、正常錯誤處理與 CAS publication。
忽略非 Anthropic 舊 pending marker，不清 auth state；符合的已 staged replacement 仍經 lease/CAS 發布一次。接受其他 provider 沒有額外 at-most-once 保證，不繞過 lease/CAS。

## OAuth 未知結果與解鎖
未知結果不得重送可能已消耗的 token；解鎖以 fence 在同一交易釋放舊 reservation 並取得新 reservation，不能先刪再搶。記憶體中的新 token 先由原 exchange owner 落盤；remote／broker 無法證明安全時 fail closed。
取消只結束 caller 自己的等待，不取消共用 exchange；晚到結果從原始 provider promise staging，shutdown 等其完成，不因 timeout 遺失旋轉後的 token。

## OAuth 探測與落盤
Usage probe 仍寫 journal；只有其 token endpoint 回覆 status ≥400 且解析得 `error: "invalid_grant"`，才 fenced 地解除自己的 marker、保留 active row。傳輸錯誤、timeout、abort、壞 payload、5xx／429 不解除，不以訊息文字判斷。
共用 SQLite 採 `synchronous=NORMAL`，僅四個 OAuth 換 token 紀錄交易暫用 `FULL`；不讓每次 worker 寫入都強制落盤。

## Discovery 403 保留
Codex 與仍啟用的 Antigravity 遇 `403` 時，只沿用該已設定帳號自身曾成功發現的 rows，`accountAccess` 不借用別人的權限；成功結果含空集合均取代該帳號舊 roster，`401` 不變。
不恢復已移除／無成功歷史帳號的資格；Google 成功帳號若無 key，整個 union 都移除 per-account hints。沿用 cache TTL，不加重試或保證 generation 成功。

## Antigravity 暫停
`18.18.6` 接受上游暫停，保留已存登入，上游撤規則即恢復；不提供繞過開關以免封號。0014／0054 及其 gate 在新版退役，`18.18.0` 保持原狀。

## Notebook compaction gate removed
壓縮僅提醒，不以筆記新鮮度擋手動／自動壓縮或 `new_context`；`/compact` 直接 rollover，不強迫存筆記或安排 repair turn。notes-backed rollover 只保留最新已存筆記，未存進度不會自動恢復。

## 45% notebook midpoint checkpoint
45% 指完整 active context window，在安全 step／整批工具完成後提醒；main 且四個 notebook tools 可用時，每個 compaction/reset boundary 一次，存新 revision 不重置。
idle 時延至下一次 prompt，不喚醒或要求 continuation；用已持久化訊息與 in-flight latch 去重，不用 timer、revision 或 process-only 去重。

## Rollover 補回已回覆請求
補回的最後請求若截斷前（含保留尾段內）已有文字回覆，改送一般使用者訊息：提醒＋第一則回覆（引用資料、`<` 全轉義、最多 2,000 字，超過指向完整歷史）＋原請求（原樣、原順序），不包成插話；只標「已回覆」不標「已完成」。未回覆照舊；父代理指派同樣處理（0104）。
否決：只改 rollover 說明文字（擋不住「最優先」）、附最後一則回覆（常是後來別的事）、請模型摘要回覆（多花費且每次重建不穩定）、在 rollover 模式省略工具輸出（這次主要空間不是工具輸出）。
近期原文保留量 `compaction.keepRecentTokens` 調為 30,000（全域設定，也影響一般壓縮）。

## Notebook child isolation
依 `ctx.agent.kind === "main"` 判斷筆記提醒與 hooks，不依 depth（`/tan` 是 depth-zero child）。子代理在既有 overlay 固定 `compaction.experimentalContextManagement:false`，沿用 `methodOrder`，不另建 SDK overlay 破壞繼承。

## 筆記結構保護
使用單一 version-1 `context-notes-index` block，constraints／topics／decisions 有穩定唯一 ID、status、source 與內容；保留舊紀錄與 `supersedes`，自由 prose 不自動受保護。
阻擋漏 ID、壞 schema、斷鏈、缺 successor、跨類別引用、cycle 與 terminal constraint／decision ID 復活；只驗結構，不保證重要性、語意正確或已召回原始紀錄。
從 active branch 的 core notes／write acknowledgement 重建，到 reset 為止；拒絕未確認的重疊寫入，storage failure 不報成功。不另建 ledger 或恢復壓縮擋門。

## Append-only notebook projection
筆記 revision 留在 chronological tail，只有 compaction 把最新有效筆記放進 head；重播採持久化 delivery 位置，不因 resume 改寫 prefix。
相同文字仍算新 revision，但不加重複訊息；clear 加 tombstone，不刪歷史。中斷的 delivery 在 idle prompt 前恢復，不打斷 streaming／工具批次或另建 persistence。

## 筆記格式與讀取提示
首次存檔前由靜態 `<context_notes>` 提供分類欄位與合法 status，完成 topic 用 `completed`；read／clear 不提示，非空 save 才附格式與 history 指引，不要求 read-back。
不新增 status 別名、自動改寫或重複的舊版指示；狀態與欄位契約見 [PATCHES.md](patches/PATCHES.md#82-context-notes-save-gate)。
事前指引避免猜值，欄位診斷提供實際值與合法選項；保留既有結構與登記保護，不以錯誤狀態換取存檔成功。

## Warm subagent revival keeps the persisted system prompt
warm revival 重用 `session_init.systemPrompt`、還原 `workPoolYieldItems`，不重繪 roster 破壞 prefix；無 init／空 prompt 才沿用 render，不拋錯。

## Anthropic 前綴與訊息
採上游 date/cwd journal，跨午夜／resume／branch／revival 一致，不留 `providerOnly` tail。live／rebuild 同樣剪掉 aborted/error turns 及配對 results，保留 committed-text stall continuation 與 request-control carriers。
採 message threads，在本地修正暖機／摘要搶 anchor 與邏輯／wire body 差異；稽核在 gzip 前看 raw body，不改送出 bytes。不能只為避開可修的衝突而關閉 threads。
未標記請求視為主對話，旁支在發出處明確標記；`context-persist-audit` 只移除使用者通知，保留 diagnostics／persistence，不修改歷史。

## Anthropic 圖片前綴
所有圖片數量均套 2,000px ceiling，含 Kimi Anthropic shim；保留更嚴 host dimension、payload-byte 上限與既有 decode concurrency，避免跨過 20 張時重編前面的圖片。
接受大圖解析度降低與切換時一次 prefix 變動；單加 image-count budget 或 shim 不轉送的 override 無效，不另建 family。

## xd:// 目錄順序
在既有 `resume-cache-breakpoint` 用同一規則正規化 Codex `instructions` 與 Anthropic `system[]` 的完整、無歧義目錄；保留 `cache_control`，已正規化時回傳原 payload，只複製改動的容器。
重複／有歧義目錄不動；不改 session prompt／tool schema 或用 `before_agent_start` override，避免改變 mount notice／mid-turn rebuild。

## Devin request-only audit
保留 Devin adapter，身份與 diff 只存在 request row；response 不借用最後 requester 的 session／diff，以免誤歸因子代理。`HEADER_DRIFT` 的 session 標記仍僅 best-effort，不作因果證據。

## 模型 effort 預設
explicit temporary effort 優先；有目標模型 default 時勝過繼承的 `auto`，沒有才沿用原 auto/current 選擇，啟動與切換均遵守。不改 YAML、全域停用 auto 或特判模型。

## CPA Claude protocol
只有 `cpa.models` 的 `claude-opus-5-5`／`claude-sonnet-5-5` 使用 `api: anthropic-messages`、`compat.injectClaudeCodeInstruction:false`，保留 signed thinking 並避免 billing `cch` 改 prefix。
provider 預設、URL、auth 與其他模型不變；不改整個混合 provider，也不保證 cache hit。

## Cron 預算與時間
保留跨 provider `/cron`，只作使用者指令、不給模型工具；overseer-omp 的 `overseer-rails` extension 以 `disabledExtensions` 關閉（工具清單變動會讓系統提示不穩、resume 快取失效）。`/cron add loop<n>` 必須明給正整數，只增加 remaining／total，總數含已耗用最多 100。保留 timer、deadline、interval、generation、in-flight 與 counters；無效／停用／host-warmer／超額不改狀態，不自動重啟 exhausted schedule。
`next`／`last` 用 host locale／timezone 的 24 小時、秒與時區顯示，不猜 Taiwan timezone；diagnostic JSON 保留 UTC ISO，排程時刻不變。

## Idle request ownership
warm replay、idle recap、keepalive、idle compaction 同時最多一個在 wire，直到 settle 才釋放（含 abort 後）；dispatch 前後重查 ownership，先宣告持有再通知 observers。
warmer 遇他人持有延 30 秒，deferred streaming 仍受一小時界線；只被 replay 擋住的 step 兩秒後重試、不動其他 deadline，不與原 reschedule 並跑。keepalive 遇 replay 記 skip。

## 單一 writer resume
主執行緒與 worker 透過原生 OS lease 互斥，同 ID 釋放後才接手；不 silent fork 或另建主執行緒橋接。

## 歷史預覽
0050 保留最後模型欄；`18.18.6` 在 Tern／ANSI 恢復空白鍵預覽，顯示首輪提問與最新回答，Enter 接續、Esc／空白鍵返回；Tern 搜尋框空時收原始空白鍵，點擊仍可用 Preview 動作。
保留上游側邊版面，不無據改放下方；預覽可捲動，載入完成依 session path 刷新。從尾端最多讀 1 MiB，超限明示，不能拿較舊回答冒充或無限全讀。

## 退役與保留能力
退役項目與版本歸屬以 PATCHES.md 為準，不恢復已退役客製；保留 0047b 單一 writer 與 0093 commit 半。
advisor Tools「Done」可見性獨立為 0103，不隨 0048 額度換號退役，也不塞進 input-translation。Hindsight 暫留且三開關關閉，Devin 保留。
HTML `/export` 接受 canonical English user text；其他顯示路徑不變。
