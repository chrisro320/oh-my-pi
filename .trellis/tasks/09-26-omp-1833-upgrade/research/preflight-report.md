# 18.3.3 升級預檢結果（快取優先）

## 結論

不能直接更新後套舊鏈。現行 18.2.10 controller 實際列出 **47** 件；18.3.3 的 strict fuzz=0 有 **21** 件可作文字套用，**26** 件拒絕；以現行 controller 使用的預設 fuzz 重放，有 **31** 件文字套用、**16** 件拒絕。兩組是各自順序重放、失敗層整件跳過後的結果，包含依賴連鎖，**不是 26/16 個獨立 bug，也不是 21/31 件已安全遷移**。

保守分類：3 件可沿用（已驗限定場景），1 件退役候選（會話核心已驗，待正式catalog與全鏈），21 件需適配，5 件語義衝突/需重設，17 件證據不足的文字候選。分類不改現行補丁或部署計畫。

## 本輪直接執行的證據

| 對象 | 官方 18.3.3 / 原樣舊補丁 | 隔離確認 | 結論 |
|---|---|---|---|
| 0076 eval 提醒 | pristine 的 resume wire 與 live 不同 | 只套0076/0077/0078後，resume相等、唯讀不寫、狀態變化只附尾一次 PASS | 上游未修，需保留 |
| 0077 retry 提醒 | pristine empty-stop 持久化提醒 0，應為1 | 同一真實AgentSession恢復路徑，套補丁後持久化與wire相等 PASS | 上游未修，需保留；未覆蓋另兩種retry實際觸發 |
| 0078 Python MIME | pristine 同時輸出PNG和JPEG | 原patch後PNG優先/JPEG-only/獨立display/其他bundle輸出 PASS | 可沿用候選已驗此契約 |
| 0073 read getter | 上游已提供 per-access description | 裸getter雙向PASS；追加真實SDK/registry切換及跨程序resume，7組system/read/edit前綴比較PASS | 會話核心已驗；正式catalog/plugin、全工具及新版全鏈未驗，仍僅退役候選 |
| 0014 Antigravity | 原patch零fuzz套入成功 | 真實buildRequest丟 ReferenceError: createHash is not defined | 文字CLEAN不代表可執行；需補import且保持UUID bytes不變 |

持久化探針先因 AuthStorage API 搬遷無法到達斷言；僅在臨時副本將 `setRuntimeApiKey` 改為 `keys.setRuntime`，再得到上述產品失敗/通過對照。read probe 改用真實 `Settings.isolated`，不用舊 `{get()}` stub；不再釘死舊模板文字，而保留兩方向fresh-tool equality與不同描述前置條件。初次載入失敗均完整保留在 runtime-gates.json，不計為產品失敗。

0073初次結論修正：裸getter探針不足以證明會話無drift。追加實驗已走真實SDK、registry、setModelTemporary/setModel、磁碟session及獨立程序resume，詳見下方。正確不變量仍是同一最終有效模型/設定的前綴一致，不是不同模型間永遠不變；人工catalog正確不代表正式插件metadata正確。

舊基線也做對照：六個18.2.10 tarball與倉庫既有SHA256一致，預設fuzz下47層正向及逆向成功，檔案/目錄/符號鏈結集合及檔案bytes完全恢復pristine。**0066 在舊基線就需 fuzz=2**；strict拒絕不是此次18.3.3才引入。沒有宣稱執行現成全量oracle或全部行為gate。

## 快取優先阻塞點

1. **0043 interrupted history**：18.3.3 `pi-coding-agent/src/session/messages.ts:1087-1092` 增加 requestControls/tool_removal 重放。舊 early-return 若直接搬入，可能遺失請求控制資料。這是語義問題，不是只改行號。
2. **0066 native Anthropic compaction**：`pi-agent-core/src/compaction/compaction.ts:1843-1920` 現在只摘要prefix，`safeCut`/`nativeFirstKeptEntryId` 決定snapshot/rewind邊界，system fallback為空陣列。不能把整份live messages硬覆蓋回去。需要在新切點保留live-normalized tools/system及相同prefix。
3. **0068/0070 Codex**：`pi-ai/src/providers/openai-codex-responses.ts:1813-1838` 仍先建chainedBody再settle連線；`:1843-1883` 新增steering與換socket分支。需統一連線身份、append baseline與steering生命週期；0070還需兼容rate_limit/slow_down保留append狀態和新版speculation失敗抑制。
4. **0038+0047 date/cwd**：必須以最終組合判斷。0038本身能模糊套入但0047拒絕，不能部署半套，把reminder重新留在每輪移動的synthetic tail。
5. **0034/0075記憶與0069 effort**：仍需branch/session持久化契約；文字可套不足以證明冷啟動/branch/compaction都等價。
6. **0036/0044/0052/0057圖片與0046 supersede**：仍有歷史中段改寫風險。擴大圖片上限不是無限保真；上游新加另一條prune pass的8k warm suffix也不等於不改前綴。
7. **未被0077涵蓋的提醒候選**：`agent-session.ts:9301-9320` checkpoint rewind-before-yield warning只見agent.appendMessage，未見同路徑session落盤。這是靜態風險，尚未跑checkpoint生命週期復現；18.2.10 `:8817` 已有同函式，**不是已證明的新版新增回歸**，列入後續drift檢查，不擅自加補丁。

## 全量補丁矩陣

`strict/default` 為各自順序探測結果；來源路徑、patch完整名稱、前置失敗重疊及完整patch輸出見 matrix.json / replay-*.json。以下「證據不足」表示尚未完成新版行為驗證，不表示可刪除能力。

| 順序 | ID | Root | strict/default | 主要分類 | 發現／下一步 |
|---|---|---|---|---|---|
| 1 | 0033 | TUI | 通過/通過 | 證據不足（文字可沿用候選） | cache_turn 顯示上游仍缺；文字通過，未驗 UI。 |
| 2 | 0004 | TUI | 通過/通過 | 證據不足（文字可沿用候選） | cacheRead 統計口徑仍需本地政策；未驗 UI。 |
| 3 | 0034 | AGENT | 通過/通過 | 證據不足（文字可沿用候選） | 記憶快照與 reset/deadline 凍結仍需保留；新版 lifecycle gate 未跑。 |
| 4 | 0037 | NM | 拒絕/通過 | 需適配 | 配額刷新需銜接新 AuthStorage facade；default fuzz 能套但不可直接交付。 |
| 5 | 0010 | AGENT | 拒絕/拒絕 | 需適配 | idle reservation/epoch 能力上游仍缺；cron extension 硬依賴，需重錨 lifecycle/types。 |
| 6 | 0035 | NM | 拒絕/通過 | 需適配 | 摘要仍未重用完整 live provider-ready 管線；import 鄰接改變，需逐 hunk 審計。 |
| 7 | 0014 | AI | 通過/通過 | 需適配 | 零 fuzz 可套卻在 buildRequest 實測 createHash 未定義；必須修 import，保持 UUID bytes 不變。 |
| 8 | 0036 | NM | 拒絕/通過 | 需適配 | provider/api 預算與 shape bytes 能力仍缺；依賴鏈需重錨，非保證 200 圖安全。 |
| 9 | 0017 | AI | 通過/通過 | 證據不足（文字可沿用候選） | native replay warm 行為仍需；新版 resume wire 未跑。 |
| 10 | 0025 | AI | 通過/通過 | 證據不足（文字可沿用候選） | Ollama usage 上游仍是空 limits；未呼叫官方 API。 |
| 11 | 0026 | AI | 拒絕/拒絕 | 需適配 | AuthStorage 拆成 auth/usage.ts，需移植 provider 篩選/節流接線。 |
| 12 | 0030 | AI | 拒絕/拒絕 | 語義衝突／需重設 | cache key 移到 auth/usage-cache.ts，endpoint canonicalization 與 legacy cache 遷移需重設接線。 |
| 13 | 0031 | AGENT | 拒絕/拒絕 | 需適配 | fetchUsageReports 的 provider 轉發要改用新 facade。 |
| 14 | 0032 | AGENT | 拒絕/通過 | 需適配 | goal 工具常駐需配合新 eager/lazy 註冊；工具簽名漂移策略仍為本地政策。 |
| 15 | 0038 | NM | 拒絕/通過 | 需適配 | 不可單獨部署 provider-only tail；最終 date/cwd 行為依賴 0047，後者未套成。 |
| 16 | 0043 | AGENT | 拒絕/拒絕 | 語義衝突／需重設 | aborted/error early-return 可能吃掉新版 requestControls/tool_removal 重放，需保留控制語義。 |
| 17 | 0044 | NM | 拒絕/通過 | 需適配 | wire-api 圖片預算鍵仍缺，依賴 0036；觸頂仍可能改歷史。 |
| 18 | 0052 | NM | 拒絕/通過 | 需適配 | 精確模型幀價與 commandcode 預算未吸收；需重新驗證實測表消費路徑。 |
| 19 | 0057 | NM | 拒絕/通過 | 需適配 | Devin 圖片預算仍缺，依賴 0044；未驗端到端圖片。 |
| 20 | 0045 | AGENT | 通過/通過 | 證據不足（文字可沿用候選） | shape-aware reduction 仍需；新版投影行為待驗。 |
| 21 | 0046 | AGENT | 通過/通過 | 證據不足（文字可沿用候選） | supersede guard 仍需；上游另一 prune pass 加 8k warm suffix，不等於全面 append-only。 |
| 22 | 0048 | AGENT | 拒絕/通過 | 需適配 | quota 換號仍可能立即 recovered；grace=1 本機限制不應擴大宣稱通用。 |
| 23 | 0050 | NM | 拒絕/拒絕 | 需適配 | session selector 多檔案需適配，未驗真實 UI。 |
| 24 | 0054 | AI | 通過/通過 | 證據不足（文字可沿用候選） | requestType:agent 上游仍有；本輪未呼叫 Antigravity 驗證現行服務端反應。 |
| 25 | 0047 | AGENT | 拒絕/拒絕 | 需適配 | sdk sessionId callsite 上下文已變；必須和0038合看最終錨點持久化。 |
| 26 | 0055 | AI | 通過/通過 | 證據不足（文字可沿用候選） | Devin auth cache/timing 尚未吸收，需新 provider fixture。 |
| 27 | 0071 | AI | 通過/通過 | 證據不足（文字可沿用候選） | Devin request dump 仍為本地觀測；私有 HOME 限制必留。 |
| 28 | 0056 | NM | 通過/通過 | 證據不足（文字可沿用候選） | Devin metadata tuple/counters 仍未對齊；provider 接受未驗。 |
| 29 | 0058 | AI | 通過/通過 | 證據不足（文字可沿用候選） | 末尾獨立 thinking signature + sealed 回放仍需，不能把原有簽名欄位當吸收。 |
| 30 | 0060 | NM | 拒絕/拒絕 | 需適配 | idle cascade pin 依賴0010；前置失敗不能單獨判可用。 |
| 31 | 0062 | AGENT | 通過/通過 | 證據不足（文字可沿用候選） | 舊歸檔納入 reduction baseline 仍需；依賴0045。 |
| 32 | 0063 | NM | 通過/通過 | 證據不足（文字可沿用候選） | V2 live chain 仍缺；文字可套不代表0068/0070鏈契約成立。 |
| 33 | 0065 | NM | 拒絕/拒絕 | 需適配 | catalog KDL 與生成 rules.json 都需更新，不能覆蓋新增上游規則。 |
| 34 | 0066 | NM | 拒絕/拒絕 | 語義衝突／需重設 | native Anthropic 新 safeCut/snapshot/rewind 只壓 prefix；不能以整份 live messages 覆蓋新邊界。 |
| 35 | 0067 | NM | 拒絕/拒絕 | 需適配 | live tools/system 仍需；Anthropic 部分依賴0066重設，三 lane 需個別驗。 |
| 36 | 0068 | NM | 拒絕/拒絕 | 語義衝突／需重設 | chainedBody 仍先於連線 settle 建立；新增 steering 分支，需重排而非硬套。 |
| 37 | 0069 | AI | 拒絕/通過 | 需適配 | effort仍需branch-local持久化；types.ts及.d.ts的第2 hunk strict拒絕：上游在payload後新增AnthropicOutputEffort/tool-change型別；default fuzz通過，wire行為未驗。 |
| 38 | 0070 | NM | 拒絕/拒絕 | 語義衝突／需重設 | 需協調 steering、rate_limit/slow_down append-state保留、speculation抑制與fail-closed；不是 helper 新增衝突。 |
| 39 | 0072 | AGENT | 拒絕/拒絕 | 需適配 | selector auth lazy import 舊補丁衝突；需新程序實際首次呼叫驗證。 |
| 40 | 0073 | AGENT | 拒絕/拒絕 | 退役候選（會話核心已驗，待正式catalog與全鏈） | 上游getter；真實SDK切換與跨程序磁碟resume的7組system/read/edit前綴相等，9程序14離線請求。尚未驗正式provider插件/catalog、全工具及完整新版補丁鏈。 |
| 41 | 0074 | AI | 通過/通過 | 證據不足（文字可沿用候選） | Anthropic cache boundaries/audit 仍需；未驗真正出站/服務端命中。 |
| 42 | 0075 | AGENT | 拒絕/拒絕 | 需適配 | session-memory 增加 runtimeCwd 等欄位；recall promotion 唯一槽需新版本重錨。 |
| 43 | 0076 | NM | 通過/通過 | 可沿用（已驗限定場景） | 本輪 pristine resume wire不等；原patch零fuzz套用後真實AgentSession三組行為PASS。 |
| 44 | 0077 | AGENT | 通過/通過 | 可沿用（已驗限定場景） | 本輪 pristine empty-stop reminder持久數0；原patch後恰一則且重建wire相同。 |
| 45 | 0078 | AGENT | 通過/通過 | 可沿用（已驗限定場景） | 本輪 pristine雙MIME輸出兩圖；原patch後PNG優先、JPEG-only及獨立display等PASS。 |
| 46 | 0079 | TUI | 通過/通過 | 證據不足（文字可沿用候選） | 非同步轉圖退休屏障上游仍缺；本輪只驗文字套用，未驗TUI。 |
| 47 | 0080 | TUI | 通過/通過 | 證據不足（文字可沿用候選） | PNG bounded cache與插槽指紋上游仍缺；本輪只驗文字套用，未驗TUI。 |

## 最小遷移方案（待批准，未實作）

1. 保留18.2.10回退計畫；新增精確18.3.3路由，不放寬版本gate。以本矩陣為47項能力對照，不複製未驗證候選。
2. 先遷移快取核心：0076/0077保留；0073核心會話切換/resume實驗已過，但新版omit仍須正式catalog/plugin及完整鏈驗證，不宣稱整體無drift。0014補缺少import；0034/0038+0047/0043/0069/0075按新版生命週期重錨。每個修訂先呈現最小diff，不新增修補修補的層。
3. 單獨設計0066新的prefix cut與0068/0070連線/steering一致性，之後才把0035/0063/0067整合。保留既有fail-closed費用保護，但不得破壞上游snapshot/rewind。沒有真實provider數據就不宣稱命中率改善。
4. 0065須先適配KDL，再用18.3.3 pi-catalog的 `bun scripts/compile-compat.ts`（gen:compat）重生成rules.json，不能用舊整行JSON覆蓋上游新增規則。0034/0075/0069既有gate靜態版本白名單尚不接受18.3.3；先確認新版fixture/API與不變量，再增加新版分支，不單純繞過fail-closed檢查。AuthStorage新facade下重做0026/0030/0031及0037接線；其餘UI/Devin/圖片小補丁依清單處理，不砍未驗證能力。
5. 新版完整pristine apply/reapply/reverse/CLI啟動後，跑明確限定的resume/model-switch/branch/compact/retry/image/extension場景。工具介面hub→wait/proc和task complexity還須核對真實載入的規則/技能/擴展；不可用小範圍grep零命中宣稱全相容。
6. 正式部署另行批准；先備份可回滾安裝與台帳，憑證/session不覆寫，SQLite只能online backup。使用者現有程序不由本輪重啟。

## 隔離與可重現證據

- `baselines.json`：12個官方tarball的URL、registry integrity、SHA256與解包路徑（兩版本各六套件）。下載先驗registry完整性，再記錄SHA；18.2.10另比對既有pinned SHA。
- `isolation.json`：私有HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_DATA_HOME/BUN_INSTALL_CACHE_DIR/TMPDIR，執行子程序用allowlist環境，沒有繼承API key。這不是OS級斷網沙盒；npm下載有網路，但行為探針使用mock provider／純buildRequest，無真實模型呼叫。
- `dependency-install.txt` / `runtime-resolution.json`：以全部六套件精確18.3.3 registry依賴 `bun install --ignore-scripts`；未放行postinstall。把六套件source換成verified archive的獨立copy，避免cache hardlink污染；實際import.meta.resolve全指向私有runtime且version都是18.3.3。
- `plan-18.2.10.txt`：`OMP_PATCH_VERSION=18.2.10 bash patches/apply.sh --print-plan` 真實輸出，47項；僅此命令解析計畫。
- 文字探測：每層執行 `patch --batch --fuzz=0 --no-backup-if-mismatch -p1 --forward -i <patch> --dry-run`，通過才實套；另一獨立樹移除 `--fuzz=0` 以比對controller預設行為。失敗層完全不寫入，不污染後續判定；繼續探測用來完整盤點，不能部署這棵缺層樹。
- `replay-18.2.10.json` / `replay-18.3.3.json`：strict輸出；`replay-default-fuzz-*.json`：預設fuzz輸出。
- `old-baseline-roundtrip.json`：舊版47層逆向恢復的證據；不把它當新版已通過。
- `runtime-gates.json`：全部probe嘗試與錯誤，包含harness不相容及最終產品結果。
- `probe-*.ts`：實際臨時探針留存；在依賴完整、私有HOME且指定 `OMP_PATCH_VERIFY_NM`/`OMP_PATCH_VERIFY_AGENT_ROOT` 的sandbox內用 `bun <probe>` 執行。型別匯入不指向live，runtime匯入按root。

## 審查更正與限制

三份scout輸出僅是調查材料，最終判定以本報告及實測為準：
- TUI/provider目錄搬遷在18.2.10已存在，不是18.3.3新增破壞。
- 0070的isCodexStalePreviousResponseError在18.2.10就有；由function改export function不產生重複宣告，不能列為此次上游新吸收。
- 0035/0036不是已證明「只有行號位移」；strict探測拒絕，仍需逐hunk審計。
- 0058原本就有部分簽名處理，並不表示末尾独立簽名與sealed回放修復已吸收。
- hub工具相容性未完成正式載入驗證；本地規則可能綁tool:hub(*)而在新版靜默失效。零引用的小範圍搜尋不足以排除。
- 只做本次列出的行為probe，不宣稱整套新版可啟動、所有補丁可執行、UI驗收或真實provider快取命中。完整新版鏈目前未成立。
- 已更新兩份spec中的具體防回歸契約：zero-fuzz仍可能缺import、18.3.3 fixture API與0073退役判準。產品碼、既有patch、controller與live全部未修改。


## 覆核結果

CacheCompaction覆核其16項切片無blocker，接受主報告对safeCut/steering/三lane驗證的邊界；原研究的0070重复宣告說法已撤回。CachePersistence指出兩項報告缺口，已修正：補上0065生成產物遷移，以及統一NM/package root路徑前綴後重新計算前置失敗重疊。實際patch執行cwd無誤，修的是診斷metadata；31/21數字與probe結果不受影響。0069失敗已定位到src/types.ts及dist/types/types.d.ts第二hunk，非openai-codex-responses實作hunk；原scout未看完整trailing context的說法不採用。

0014 crash來自其新增helper缺少createHash import；同次套用的0054僅刪requestType欄位，不涉及crypto。0034/0075/0069 gate此輪未執行，版本白名單不接受新版是源碼檢查，不冒稱為執行輸出。

## 0073 追加會話級實驗

使用者批准後，以子任務 `09-26-read-model-lifecycle` 執行；原任務completed不能由start重開，子任務已正式planning→in_progress後才執行。未修改任何產品碼或補丁。

命令：`python3 .trellis/tasks/09-26-omp-1833-upgrade/research/run-model-lifecycle.py`。
結果：**9個獨立程序、14次離線adapter請求、7組同模型前綴比較全部通過**。六個OMP套件的全部pristine原有檔案逐bytes比對相等。完整快照、SHA256、長度、PID和命令輸出在 `model-lifecycle-results.json`。

| 場景 | 磁碟resume結果／比較基準 | system與read/edit |
|---|---|---|
| A→temporary B | 恢復B，對照live B | 相等 |
| A→default B（persist） | 設定與session都恢復B | 相等 |
| A→temporary B→default A | 恢復A，亦對照初始A | 相等 |
| A→ephemeral B | 恢復原A，不能拿B當基準 | 與初始A相等 |
| temporary B vs default B vs fresh B | 相同最終B | 相等 |

獨立oracle：人工註冊A具text/image且應為hashline，B具text且依上游deepseek政策應為replace；每次請求都檢查實際metadata和有效edit mode。另斷言A/B的system、read description及edit schema确實不同，避免同一錯誤設定讓空比較通過。

fixture修正：初版嘗試覆寫內建openai-completions被18.3.3拒絕，改用正式registerProvider自訂API；不是產品失敗。初版Settings.isolated不能驗證磁碟default，正式結果改用Settings.loadIsolated、flush及獨立程序重讀，resume不重設default或指定model。設定與session都在私有sandbox；fetch攔截計數為0，不是OS網路隔離。

最終比較直接使用adapter入口保存的 `raw.system`／`raw.tools` 字串UTF-8 bytes，不從解析後的物件重新序列化。tools按pi-ai/src/types.ts:1438–1474全部provider Tool欄位取值（含strict、deferLoading、customFormat、customWireName、native、examples），不漏掉policy欄位；runtime物件上的runner/session/settings快取不是provider schema。一次直接序列化整個runtime物件的反例產生差異，確認位於這些執行期欄位，保存在 `model-lifecycle-fixture-corrections.json`，不當作wire漂移。

邊界：只載入read/edit，memory/擴展/MCP停用；捕獲位置是自訂provider adapter入口，不是實際HTTP序列化。這證明18.3.3原生會話核心在這些場景無drift，不能證明正式供應商註冊資料、thinking/compat預設、完整補丁鏈或服務端cache hit無問題。因此0073仍不執行退役。
