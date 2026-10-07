# OMP 18.7.0 升級設計決策

## 邊界與術語

本任務是高風險跨層升級，規劃交付採 `hard` 所需的 PRD／design／implement 完整度。本專案目前 `task.py --help` 沒有 `profile` 子命令；不為此升級 Trellis 或臆造工具 gate。

- **pristine**：由官方 npm pinned tarball 解壓，先核對 registry sha512、記錄 SHA-256；不是 Bun cache，也不是 live source。
- **baseline**：18.4.4 pristine + controller 解析出的完整 55 層。125 個 patch-declared paths 已與 live bytes 比對一致。
- **text-clean**：該層在指定重放狀態可用 `--fuzz=0` 套入；不代表 import、runtime 或語義正確。
- **partial upstream replacement**：上游只解決能力的一部分。候選 patch 只保留缺口，但不能整層省略。
- **retirement**：僅新版本計畫不再攜帶已證明由上游完整覆蓋的能力。18.4.4 rollback baseline 與 finalized patch bytes 仍保留。
- **live cache prefix**：上一輪仍存活的 provider request 前綴；不是在舊摘要邊界重建而可能早已過期的條目。

## 決策樹

### D1：直接更新，或先完成候選鏈？

選擇獨立 `.18.7.0-candidates/` 計畫，已完成54層隔離驗證；controller新增精確18.7.0路由，未知版本仍fail closed。初始只有28/55 text-clean是保留先遷移後部署順序的原因。

否決：放寬 18.4.4 version gate、向 live 裸打修補、從 Bun cache 複製「pristine」、以新版 stock bundle 能啟動取代 source chain 驗收。

### D2：同名能力由誰負責？

先比 contract，再看 implementation。上游等價或更強 → 以移除 local 片段的 consumer 行為作證，再採 upstream；上游只處理子案例 → 承接 upstream，候選層保留最小剩餘能力；只有 changelog 或 clean hunk → 不允許退役。

重點比較：0090 durable owner、0038/0047 date/cwd、0035/0066/0088/0089 compaction、0036/0045/0052 image budget、0092 warmer。最終能力與驗證表由 PRD、三份 research 比較和 patch matrix 約束。

否決：疊新層修舊候選、為減層而移除保護、重套舊完整函式覆蓋新 upstream 修復。

最終僅0045在新版由upstream單一frame pricing接管；0052 measured exceptions進入共用billing／Tokenizer cache key，0062 archive credit保留。0036採上游shape-aware cap/re-render，provider count budgets仍由本地補丁承擔。負向consumer與3 MB實際payload證據見migration results。

### D3：憑證安全

refresh 已取得且已收到的 rotation 必須由 bounded durable owner 保存；每個 caller 只擁有自己的等待。選用 identity lookup 不得擋住 save；same-owner lease 可同步續期，row/owner CAS 不放寬。peer login/logout 勝過 stale owner；不能第二次寫回過期 metadata。

驗證只用 synthetic grants、private SQLite 與 loopback token endpoint。不能複製真實 DB 當 fixture。部署前才在停止相關程序後用 SQLite online backup 備份 operator DB，備份與 secrets 不進 repo/artifact。回滾程式碼不等於回滾 token bytes：不得把舊 backup 覆蓋後來已輪替的 grant。

否決：壓掉 invalid-grant warning、無差別 retry rotating token、延長 timeout 當修復、把 caller abort 當作已收到 token 可丟棄的理由。

### D4：compaction 與 cache 的責任邊界

session host 提供可信的完整 provider-ready prefix；compaction 只界定要摘要的 target。保留 whole/split-turn single-request live lane 與 previous-summary 條件；provider 才能判定容量。真 overflow 才回 cold，普通 cold planner 必須覆蓋全部目標及 sentinel。

Anthropic native 的 retained-tail/signed-thinking/date-cwd 修復採 upstream，不用舊補丁覆蓋。wire prefix、TTL 與 server usage 分開驗收；同 bytes 不等於 server 一定 hit。

native優先使用`buildCachePreservingContext("live")`取得的attested完整Context；不成立時採upstream `buildProviderContext(summarized, retained)`，最後才用普通手建Context。request只解包一次，保留upstream `context: Context`與`filesDueBefore`；不能以truncated prefix偷換whole-live契約。

### D5：warmer 與診斷

保留宿主唯一 replay owner，cron extension 只負責 policy，不引入第二套 Anthropic keepalive。承接 upstream retention、start/end accounting 與 API policy override；0092 的 idle budget、post-settle park/rearm、extension result consumer 以新版生命周期移植。

只有當 upstream event 對 **extension** 的 payload、時機與取消／失敗結果都等價，才移除本地 result event；RPC-only event 名稱相似不算相同契約。resume/cache audit 保留 per-session、per-model、前次尾段連續性及四斷點/TTL 約束。

### D6：遷移／部署單位

六個 patch roots 必須同版本；依官方 dependency graph 補齊其他 OMP dependencies，禁止 nested unpatched selected packages。每個候選層從實際 before/after files 產生，不手寫 hunk counts。共享 session-maintenance、agent-session、sdk、types 的切片由單一 integration owner 串接；parallel research 不等於允許 concurrent source edits。

新版 source tree、controller/ledger/verifiers、standalone extensions 形成同一部署單位。舊 tree 與 old ledger 是 rollback pair；`deploy-delta-1844.py` 的同版本 delta 契約不能直接冒充跨版本部署工具。

### D7：授權與切換

使用者於隔離驗證交付後明確要求直接使用18.7.0，已完成code-only正式部署。沿用既有global／ledger directory exchange，不新建framework或追加provider試跑；live agent/session/auth資料不由部署程序操作。完整退出再啟動才載入新程式碼。

## 不改動項

不改使用者既有未提交檔案；不升級 Trellis；不推 Git；不新增 credential store、keepalive scheduler 或通用 migration framework；不以新 feature 蓋過本次 auth/compaction/cache 目標。

## 回滾邊界

任一 tarball integrity、完整重放、declaration closure、source import、credential safety、cache-prefix 或原子切換 gate 失敗均中止。部署 staging 失败不碰 live；切換失敗恢復相配的 code/ledger/entry/extension。DB 必須按 schema 相容性及最新 grant 狀態另行決策，禁止盲目回復舊憑證快照。

正式部署沿用既有staging／digest／renameat2 exchange與反交換helper，global及ledger舊樹保留，交換階段寫入private transaction記錄；兩個目錄仍是各自原子交換，並非跨目錄transaction。部署未連線live DB，因此沒有回寫過時token snapshot。
