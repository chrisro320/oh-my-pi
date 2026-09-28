# 規劃獨立審查 第一輪（trellis-check，2026-09-28）

狀態：FINDINGS

## Findings

| id | 嚴重度 | 檔案:行 | 證據 | 影響 | 修正 |
|---|---|---|---|---|---|
| F01 | blocker | `.trellis/tasks/09-27-video-role-tool/revalidate.sh`:51-54 | P3 仍要求 P1 新增的 kind、openai-images、openai-speech 不存在；P4 revalidate.sh:44-60 也要求 P1/P2/P3 的新增項不存在，且 :68 要求 ACE 權重為零；兩份 implement.md:37、:38-39 卻要求前序已套用、權重已下載後 exit 0。 | 照計畫順序執行時開工閘門必定報 DRIFT，無法分辨真正的上游漂移。 | 把 P3/P4 的預期基線改為已套前序補丁；權重改列 PREREQ，保留必要的原版基線檢查為獨立檢查。 |
| F02 | blocker | `.trellis/tasks/09-27-music-kind/implement.md`:20-29 | P1 design.md:19-24 僅開放 kind chat\|image\|tts，P3 design.md:21-24 只追加 video；P4 的改檔清單沒有 models-config-schema-bundle.ts，卻要在 design.md:198-212 讀取 kind: music。 | 音樂自訂模型仍會被 models.yml schema 拒絕，--kind music 和角色池都無法用。 | P4 加入 ModelDefinitionSchema 的 music 字面值、對應發佈宣告、candidate hunk 及真實 models.yml 載入閘門。 |
| F03 | blocker | `.trellis/tasks/09-27-video-role-tool/implement.md`:68 | 登錄命令明寫跨 pi-tui 的候選使用 ${AGENT}，即使同句括號說跨套件用 ${NM}。 | pi-tui 的 patch 路徑會相對 pi-coding-agent 展開，重放無法套用。 | 登錄候選根直接改成 ${NM} 並對跨套件 pristine replay 做檢查。 |
| F04 | blocker | `.trellis/tasks/09-27-media-gateway-local/design.md`:142 | gateway 模型 key 是 minimax-h3-t2v，但 P3 design.md:40、:208、:227 註冊並首選 local/minimax-h3；video transport 送出的 model id 是後者。 | 預設 H3 路徑會得到 unknown_model，無法跑本機首選。 | 統一 gateway key、omp models.yml、角色/priority 與測試的公開 model id。 |
| F05 | blocker | `.trellis/tasks/09-27-media-gateway-local/design.md`:142-190 | 範例 models.yml 一開始列 H3/Qwen-Image/ACE workflow，且規定啟動時對每個 selector fail-fast；implement.md:26-35 卻到 P5/P6/P7 才匯出對應 workflow。 | 若按範例設定 P0/P1 服務即啟動失敗，無法分階段交付即夢圖片。 | 明訂各階段僅載入已就緒模型；每階段先匯出、驗證 workflow，然後才把該模型加入啟動設定。 |
| F06 | blocker | `.trellis/tasks/09-27-media-gateway-local/design.md`:155-183 | H3 selector 要兩顆 LoadImage，實際 t2v UI workflow 無 LoadImage；ACE selector 要 SaveAudioAdvanced、LoadAudio，實際 blueprint 都沒有。implement.md:33-35 只要求匯出現成圖；啟動時又要 fail-fast。 | P5/P7 的 config validation 失敗；首末幀與參考音無法依約工作。 | 加入並正確接線 H3 兩顆 LoadImage、ACE 參考音分支及輸出節點，匯出後分別測 selector 0/1/2 命中與實際輸入/輸出。 |
| F07 | blocker | `.trellis/tasks/09-27-media-gateway-local/design.md`:229-250 | POST /v1/videos 先回 202 後即結束連線；計畫只用後續獨立 poll/download 請求的斷線推斷取消，未設以 job id 定位的取消入口。 | omp 在兩次輪詢間取消時，gateway 無可靠訊號取消 ComfyUI 的特定 prompt；違反影片/音樂取消驗收。 | 規劃認證的 job-id 取消端點及 P3/P4 abort 呼叫，對 queued/running 均驗證只取消該 prompt。 |
| F08 | major | `.trellis/tasks/09-27-media-tools-background/design.md`:70-71,128-131,346-348 | §9 明確要求 asyncSettles 才能在會 settle 的宿主背景化；D2/D6 和 P3/P4 只判斷 manager 與 async.enabled，且 agentId 可為 undefined 時仍註冊。 | print/ACP job 可能在 dispose 時取消；無 owner 的已完成 job 沒有 delivery sink。 | 把 asyncSettles 透傳所有 ctx；只有會 settle 且 agentId 已定義時註冊，其他情況同一路徑前景執行並測 print/ACP/缺 owner。 |
| F09 | major | `.trellis/tasks/09-27-video-role-tool/design.md`:133-180,231-234 | video/music schema 都收 output_path，但共享 RunMediaJobOptions/結果/行為流程都只寫 generated/；P2 已提供 copyMediaToOutputPath，P3/P4 閘門沒有驗證額外複製。 | 使用者指定 output_path 時可能沒有副本，兩個 PRD 的明確驗收落空。 | 兩工具成功落地後調用 P2 複製 helper、保留原檔，閘門驗證原件和副本位元組一致與錯誤處理。 |
| F10 | major | `.trellis/tasks/09-27-media-gateway-local/implement.md`:18-39 | gateway/P2 部署步驟只籠統新增 provider 和工具開關，沒有寫 media 的 Qwen/Gemini TTS 模型列及 modelRoles.speech、fallbackChains.speech；P1 明定不配置正式 TTS。 | 即使服務可用，也不能保證父任務指定的 Qwen → Gemini → xai 優先鏈。 | 增加 models.yml、config.yml 精確配置和實際候選順序/503-失敗切換的 gate/smoke，Gemini lite 僅列清單。 |
| F11 | major | `.trellis/tasks/09-27-media-gateway-local/design.md`:340-348 | TTS estimatedWait 只算冷啟加待排 job 數乘平均值，漏掉目前持有 GPU 鎖的影片剩餘時間和這次推論耗時。 | 影片正在執行但 queueDepth=0 時仍可能接下 TTS，直到 omp 60 秒硬逾時才失敗，雲端備援被延誤。 | 估算活躍占用者、待排工作、冷啟與本次推論；無法上界估計時保守 503；測正在執行但待排為零的案例。 |
| F12 | major | `.trellis/tasks/09-27-custom-image-provider-jimeng/design.md`:30-32 | P1 直連 :5100 並宣告 image 輸入；omp 帶圖走 /images/edits 而代理沒有該路由且用 HTTP 200 錯誤回應；代理業務錯誤亦是 HTTP 200、data:null，image-gen 僅針對 ProviderHttpError 做候選 fallback。 | P1 期的修圖必敗，點數不足等失敗不會依 image 備援鏈切換。 | 明確區分直連期只可文生圖且無業務錯誤備援；把修圖和錯誤備援的驗收放到 gateway 上線後，或先提供實際 adapter 才承諾這兩項。 |
| F13 | major | `.trellis/tasks/09-27-media-tools-background/design.md`:128-132,153-168 | foreground fallback 計畫移除 details.images，只留下 imagePaths；現有 pi-tui tool-execution.ts:54-60、:533-548 的前景縮圖只讀 details.images/content，async-result 縮圖僅背景訊息。 | async.enabled=false、print/ACP 前景模式失去原本的圖片縮圖。 | 前景結果仍提供 display-only details.images，或讓 TUI 前景 renderer 讀新增預覽鍵；背景繼續只用 mediaPreview，測兩種路徑皆不進 provider payload。 |
| F14 | major | `.trellis/tasks/09-27-media-gateway-local/prd.md`:52,64-65 | PRD 把 ACE 封包列為第 5 子任務且說 v1 不含；gateway implement.md:35 已把 ACE P7 當本任務必做；P4 implement.md:30 排除 gateway 改動。 | 封包實作責任和交付時點相互矛盾，照兩份 PRD 分工可能沒有人實作音樂後端。 | 指定 gateway 子任務的 P7 在 P4 驗收前完成 HTTP 交付，統一 PRD 的 v1 範圍與任務 owner。 |
| F15 | minor | `.trellis/tasks/09-27-media-gateway-local/revalidate.sh`:128-138 | 資產 PREREQ 未查 Qwen-Image VAE、Qwen3-TTS 權重/venv，ACE 只需任一匹配就報 present；憑證只看目錄存在。 | 下載未齊或無憑證時資訊列可能誤報就緒。 | 按選定路線逐項檢查可讀非空檔案/必要環境和憑證存在性，PREREQ 不讀或印出秘密。 |
| F16 | minor | `.trellis/tasks/09-27-media-models-unified/prd.md`:82-85,106-116 | Decision log 仍把 gateway 稱為子任務 2、影片為子任務 3；Resume 仍稱四份設計/實作尚未寫完；P3 design.md:21 又宣稱 P1 已加 ModelOverrideSchema.kind，與 P1 design.md:24 明確排除相反。 | 交接與逐檔執行可能指向錯誤 owner/改檔範圍。 | 保留歷史決策但補更正註記，更新現行 Resume/子任務編號，移除 P3 對 ModelOverrideSchema 的誤述。 |

## 審查者報告原文

## 結論

**not-ready（FINDINGS）**。五份規劃的兩層架構、影片／音樂共用 `openrouter-video`、`generated/` 與單一 `media` 工作類型大方向一致，但目前存在開工必卡的重驗／跨套件補丁問題，以及模型 ID、工作流和取消鏈的端到端斷點。以下僅審閱，**未修改檔案**。

驗證：五支 `revalidate.sh` 在現有 18.3.3 基線分別為 **16／52／45／28／33 PASS，均 0 DRIFT、exit 0**。影片、音樂用無效 `OMP_ROOT`、gateway 用無效 `COMFY_ROOT` 的陰性對照分別 **exit 1（23／24／15 DRIFT）**。掃描六個任務目錄未找到符合長十六進位、API-key 或 Bearer 字面值模式的憑證；未執行生成或程式碼型別檢查（本次只有規劃文件）。

## Findings

| ID | 嚴重度 | 檔案:行 | 證據與影響 | 最小修正 |
|---|---|---|---|---|
| F01 | blocker | `09-27-video-role-tool/revalidate.sh:51-54`；`09-27-music-kind/revalidate.sh:44-68` | P3/P4 要求前序 P1/P2/P3 **尚未**改過 schema、job type 和 helper；實作步驟卻要求前序已套用，P4 甚至同時要求 ACE 權重已下載及尚不存在。按序開工必報 DRIFT。 | 重設 P3/P4 為「前序已套」的預期；權重列資訊性 PREREQ。 |
| F02 | blocker | `09-27-music-kind/implement.md:20-29` | P1 的 `kind?` 只容 `chat|image|tts`，P3 加 `video`，P4 沒有改 schema，卻要求 `kind: music` 可從 `models.yml` 載入。 | P4 納入 `models-config-schema-bundle.ts` 的 `music` 與宣告同步，測實際載入。 |
| F03 | blocker | `09-27-video-role-tool/implement.md:68` | 寫了跨 `pi-tui` 的候選，註冊 root 卻是 `${AGENT}`；跨包路徑無法從 agent 根重放。 | 註冊時使用 `${NM}`，驗證完整反剝／重放。 |
| F04 | blocker | `09-27-media-gateway-local/design.md:142`；`09-27-video-role-tool/design.md:40,208,227` | gateway key=`minimax-h3-t2v`，omp 首選送 `local/minimax-h3`；本機 H3 會回 unknown_model。 | 公開 ID 在 gateway、models.yml、priority、role 和測試中統一。 |
| F05 | blocker | `09-27-media-gateway-local/design.md:142-190`；`implement.md:26-35` | 初始模型表列 H3／Qwen／ACE，卻到 P5／P6／P7 才匯出 workflow；啟動即 fail-fast 驗證 selector，故 P0/P1 即夢圖片階段可能無法啟服務。 | 各階段僅啟用已具有效 API workflow 的模型。 |
| F06 | blocker | `09-27-media-gateway-local/design.md:155-183,362-395` | H3 設定指向兩顆 `LoadImage`，現有 t2v UI 圖無此節點；ACE 指向 `LoadAudio`、`SaveAudioAdvanced`，現有 blueprint 亦無。單純匯出 API 格式不會產生節點。 | 先在 ComfyUI 加節點與連線、匯出；測首／末幀、參考音及 selector 命中。 |
| F07 | blocker | `09-27-media-gateway-local/design.md:229-250` | `/v1/videos` 的 POST 已在回 202 後關閉，後續 poll 是獨立請求；僅用連線中斷無法在 poll 間傳達 omp 取消。影片、音樂的 ComfyUI 精確取消驗收無法保證。 | 增 authenticated job-id 取消入口，由 P3/P4 abort 時呼叫，測 queued/running 只取消該 prompt。 |
| F08 | major | `09-27-media-tools-background/design.md:70-71,128-131,346-348`；`09-27-video-role-tool/design.md:106-114` | §9 已查證 print/ACP 不 settle，卻未把 `asyncSettles` 接進 D2/D6 或後續工具；`agentId` 可為 undefined 仍註冊，會 dead-letter。 | 背景條件須 `manager && asyncSettles && agentId && async.enabled`；其他宿主同一路徑前景執行並驗證。 |
| F09 | major | `09-27-video-role-tool/design.md:133-180,231-234`；`09-27-music-kind/design.md:128-162,215` | 兩工具接受 `output_path` 並承諾副本，共用 job 流程只寫 `generated/`，未明確調用 P2 的複製 helper，也未在閘門驗證。 | 成功落地後調用 `copyMediaToOutputPath`，測原件和副本位元組相同。 |
| F10 | major | `09-27-media-gateway-local/implement.md:18-39` | P1 明定不做正式 TTS 設定，後續只籠統要求工具開關／provider，沒有 `media` Qwen/Gemini TTS 列與 `modelRoles.speech`、`fallbackChains.speech` 的明確配置。 | 列出 Qwen→Gemini→xai 實際設定與候選順序／切換 smoke，lite 僅進清單。 |
| F11 | major | `09-27-media-gateway-local/design.md:340-348` | 50 秒預估只算冷啟與「等待隊列長度×平均秒數」，不算當前影片持有 GPU 鎖與本次推論；忙碌但 queueDepth=0 會拖過語音 60 秒逾時。 | 計入活躍工作剩餘時間及自身預估；無可靠上界時直接 503。 |
| F12 | major | `09-27-custom-image-provider-jimeng/design.md:30-32`；`prd.md:36-41` | P1 直連 :5100 卻宣告支援 image input；omp 編輯走 `/images/edits`，代理無此路由且以 HTTP 200 回錯。代理業務錯誤也以 HTTP 200／`data:null` 回傳，不會觸發 `ProviderHttpError` 候選備援。 | 明訂直連期限制，將編輯及業務錯誤備援放到 gateway 上線後驗收，或提供真 adapter 才承諾。 |
| F13 | major | `09-27-media-tools-background/design.md:128-132,153-168` | 計畫前景結果移除 `details.images`，只留路徑；現有前景 TUI renderer 只讀 `details.images`／content，背景 `async-result` 預覽接線不覆蓋前景。 | 前景保留 display-only 圖片或讓 TUI 讀新預覽鍵；背景仍不得放 `latestDetails.images`。 |
| F14 | major | `09-27-media-gateway-local/prd.md:52,64-65`；`implement.md:35` | PRD 說 ACE 封包屬第 5 子任務且 v1 不含，gateway 實作卻承諾 P7；音樂補丁 `implement.md:30` 排除 gateway 改動。 | 固定 gateway P7 的實作 owner 與在 P4 前的 HTTP 交付，改一致的 PRD 邊界。 |
| F15 | minor | `09-27-media-gateway-local/revalidate.sh:128-138` | 資產指示沒檢查 Qwen-Image VAE、Qwen3-TTS venv/權重；ACE 任一匹配即可報 present，憑證只測目錄。 | 按選定方案逐一測必要檔案／存在性，仍保持不讀出密鑰。 |
| F16 | minor | `09-27-media-models-unified/prd.md:82-85,106-116`；`09-27-video-role-tool/design.md:21-24` | 母任務仍誤稱 gateway=子任務 2、影片=3，Resume 說四份文件未完成；P3 又宣稱 P1 已修改 `ModelOverrideSchema.kind`，和 P1 明確排除此欄矛盾。 | 補現行更正與 Resume，明確 P3 只延伸 `ModelDefinitionSchema.kind`。 |

## 跨計畫契約對照表

| 契約 | P1 即夢圖片 | P2 背景化 | 子 3 gateway | P3 影片 | P4 音樂 |
|---|---|---|---|---|---|
| model kind／runner | `image/tts`；`openai-images/openai-speech` | 沿用 P1 | 按 id 派發三種既有 wire | `video/openrouter-video` | `music/openrouter-video`；**music schema 未補** |
| URL／id | 直連 `:5100/v1`；後改 gateway | 沿用模型設定 | `127.0.0.1:5200/v1`、Bearer；H3=`minimax-h3-t2v` | `media/local/minimax-h3` **不符 gateway** | `media/ace-step-1.5-turbo` **相符** |
| 同步／非同步 | 圖片/TTS 同步 transport | `media`、`queued:true`，第一個同步回應後 `markRunning` | 圖/TTS 同步；影片/音樂 202→poll→content | 共用 `media-job.ts`；25 分鐘總逾時，3→15 秒退避 | 完全重用 P3 `media-job.ts` |
| owner／交付／取消 | — | ownerId=agentId，文字送路徑；display-only 圖縮圖 | 精確取消 ComfyUI prompt；**無外部 job-id 取消入口** | manager 註冊，abort fetch | 同 P3 |
| 原檔／output_path | P1 既有暫存，等 P2 改 | `generated/image|audio/`，helper 額外複製 | 自己另留底 7 日，不知道 session cwd | `generated/video/`，**複製未落入流程** | `generated/music/`，**複製未落入流程** |
| 優先序／開關 | image=5.0pro→codex→5.0lite→反重力；TTS 未配置 | image/speech gate 與 `async.enabled` | TTS 應 Qwen→Gemini→xai，尚缺 omp 實際設定 | H3→seedance fast，mini 僅清單；預設關 | ACE 唯一；預設關 |
| 補丁／部署 | 0083 暫定，agent root | 0084 暫定，跨包 `${NM}` | 獨立 Bun/systemd service，非補丁 | 0085 暫定，**命令誤用 `${AGENT}`** | 0086 暫定，跨包 `${NM}` |

## 未核實假設

- Gemini API key 尚未具備；3.8 TTS 在真實 key 下的服務、配額與語音格式仍待實測，不能把文件查證當成功生成。
- Qwen3-TTS 權重與獨立環境尚未就緒；RTX 4080 的實際冷啟、推論和 50 秒預算需測。Qwen-Image GGUF 或 fp8/offload 路線亦尚待使用者決定與 VRAM 實測。
- H3 turbo LoRA、ACE 完整權重及可用 API workflow 尚未備妥；ACE 純演奏無人聲、參考音正確進入 conditioning 均需真實輸出證明。
- 即夢反代目前只以 GET／原始碼核實契約；實際部署版本、憑證有效性、點數、編輯與影片 POST 成功率未驗。影片 20 分鐘級上限為設計預算，非本次生成實測。
- `Bun.write(path, ReadableStream)` 能否在部署的 Bun 版本保持串流落地，需 P3 實作時以真實檔案大小與記憶體行為驗證；不得宣稱已通過。
