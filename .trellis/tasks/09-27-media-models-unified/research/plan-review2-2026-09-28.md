# 規劃獨立審查 第二輪（trellis-check，2026-09-28）

狀態：FINDINGS

## Findings

| id | 嚴重度 | 檔案:行 | 證據 | 影響 | 修正 |
|---|---|---|---|---|---|
| N01 | blocker | `.trellis/tasks/09-27-video-role-tool/design.md`:23-29 | D1 says P1 already adds "video" to ModelDefinitionSchema.kind?, but P1 design.md:19-24 explicitly limits it to chat\|image\|tts and defers video to P3. P3 implement.md:75 instructs implementing D1–D6 without an explicit video kind schema edit; its fixture loads kind: video. | P3's models.yml video rows fail schema validation, so the video role and generate_video cannot select their backends. | Make P3 explicitly append video to ModelDefinitionSchema.kind? and its published .d.ts; assert a real ModelRegistry loads a kind: video row and rejects an invalid kind. |
| F12 | major | `.trellis/tasks/09-27-custom-image-provider-jimeng/design.md`:39-42 | D6 and implement.md:33 claim a reference-image request to the direct jimeng proxy yields 404 then falls back. A read-only live POST to its unsupported /v1/images/edits returned HTTP 200 {code:-1000,data:null}; pi-ai/src/images/shared.ts:145-153 raises ProviderResponseError, which pi-coding-agent/src/tools/image-gen.ts:284-296 does not fall back on. Even if it returned 404, pi-ai/src/images/openai-images.ts:95-109 retries /images/generations with input_references, which the proxy's routes/images.ts:13-44 does not consume. | The advertised direct-phase edit fallback instead aborts the image chain, or could generate an image while silently ignoring the reference. | Remove the 404/fallback claim and failing P1 smoke expectation. Explicitly reject or skip jimeng for references in the direct phase, or move reference-image acceptance wholly to gateway G1; retain the documented business-error limitation. |
| N02 | major | `.trellis/tasks/09-27-media-tools-background/implement.md`:3,9-42,53-76 | The new design D14 requires isMediaFallbackEligible for four candidate loops plus closed-port, timeout and user-abort regression cases. The execution plan still cites D1–D12, requires 52/52 instead of the current 55 checks, and its gate has none of those cases. design.md:201-207 lists media-output.d.ts without the new exported function. | A later implementation could omit D14 yet follow this plan and falsely claim verification; the published declaration would be out of sync. | Update the P2 implementation and declaration checklist to D1–D14 and 55/55, and add discriminating fallback/abort gate cases for image and speech plus the P3/P4 consumers. |
| N03 | major | `.trellis/tasks/09-27-media-tools-background/design.md`:248-258 | D14's helper takes only (error,userSignal), classifies a fetch TypeError as a network failure, but also requires programmer/decode errors not to fall back. With only a bare TypeError, those origins are not inherently distinguishable; image-gen.ts catches errors from the whole generate/decode operation. | Classifying all TypeErrors as connection failures can mask programming failures and wrongly try another, potentially costly candidate. | Tag transport errors at the fetch boundary or require recognized network causes/codes rather than accepting arbitrary TypeErrors; test a non-network TypeError remains fatal. |
| N04 | major | `.trellis/tasks/09-27-video-role-tool/design.md`:178-190 | Shared runMediaJob throws a generic Error when the gateway reports terminal failed/cancelled/expired. P3 D4:111 and P4 D6:207-213 use P2 D14's helper, whose eligible classes exclude generic Error; gateway design.md:263-270 reports processing failures as a normal failed job rather than an HTTP error. | A failed H3 job will terminate generate_video instead of advancing to its configured jimeng fallback; P3's failed-job fixture has no fallback assertion. | Represent remote terminal failures explicitly and make eligible non-user-aborted failures retryable; add an H3 failed → jimeng success gate, while retaining no fallback on user abort. |
| N05 | minor | `.trellis/tasks/09-27-media-tools-background/design.md`:215-218 | D12 says to register P2 with ${AGENT} as main root plus ${TUI}, while P2 implement.md:46-47,77-78 correctly requires a single ${NM} root for its cross-package candidate. | Following the design rather than the implementation would break pi-tui patch replay. | Make D12 specify the single ${NM} root and pi-coding-agent/pi-tui-prefixed hunk paths. |
| N06 | minor | `.trellis/tasks/09-27-media-gateway-local/design.md`:170-185,518-530 | The H3 t2v model has supportsFrameImages:false and returns 400 for frames (D6.6:385-394), yet this configuration and P3 design.md:239-250 advertise input:[text,image]. Qwen-Image's example workflow maps no reference-image input but D12 also advertises input:[text,image]. P3's jimeng video rows omit image input while D12 advertises it. | Model lists report inconsistent or unavailable media input capabilities and needlessly route image-input requests through unsupported backends. | Mark t2v H3 and the unmodified Qwen t2i workflow text-only, add image only for an implemented input workflow, and align P3's jimeng rows with their G2 capabilities. |
| N07 | minor | `.trellis/tasks/09-27-media-gateway-local/implement.md`:78 | G7 says human listening or ffmpeg -af volumedetect can confirm an instrumental song has no vocals. ffmpeg -h filter=volumedetect identifies it only as an audio-volume detector, with no voice-content classification. | An acceptance run can mark a song containing vocals as instrumental. | Use human listening or a justified vocal/speech detector; do not treat volumedetect as a no-vocals proof. |
| N08 | major | `.trellis/tasks/09-27-media-gateway-local/check.jsonl`:11 | check.jsonl requires .trellis/tasks/09-27-media-models-unified/research/plan-review-2026-09-28.md; the parent task directory has no research/ and gateway implement.md:4 also refers to this nonexistent review. The present review recovered F01–F16 only from agent://PlanReview, not from the promised durable file. | A subsequent reviewer cannot fulfill the prescribed read-the-research check or reproduce the first-round rationale from the repository. | Persist the first-round review at the referenced path or change both references to an existing durable record. |
| N09 | minor | `.trellis/tasks/09-27-video-role-tool/revalidate.sh`:9,72-74 | The script labels itself read-only but invokes curl -X POST against /v1/videos/unknown/cancel. The endpoint is specified as a state-changing operation even though an unknown ID should yield 404. | A baseline inspection needlessly sends a mutating-method request to a live service and contradicts the parent PRD's read-only revalidation protocol. | Use a static route check or harmless GET for informational readiness; exercise POST cancellation only in the explicit implementation smoke. |
| F15 | minor | `.trellis/tasks/09-27-media-gateway-local/revalidate.sh`:53-72,168-187 | The script now checks all four ACE files plus Qwen VAE/LoRA and Qwen3's venv/weight directory, but the directory check can call an empty HF cache or credential directory present; qimg-text-encoder requires the fp8 file even though D6.7:408-414 allows nvfp4 on the GGUF route. needfind excludes symlinked files. | Readiness PREREQ may be false-positive or false-negative for the chosen model route, despite zero DRIFT. | Evaluate the selected Qwen route, inspect actual nonempty model assets including symlink targets, and check credential files' existence without exposing contents. |
| F16 | minor | `.trellis/tasks/09-27-media-models-unified/prd.md`:129-140 | Decision log:103 and P3 D1 corrected the old numbering and ModelOverride claim, but Resume still says four design/implement pairs are unwritten and P3/P4 should merge; video prd.md:3 and gateway prd.md:19 still use displaced child numbers. | Handoff can direct implementers to completed planning or the wrong owner. | Refresh current Resume and child PRD dependency numbers, leaving dated historical decisions intact. |

## 審查者報告原文

## 結論

**FINDINGS／尚不可按現稿開工。** 這輪是唯讀規劃審查，未修改檔案。五支重驗腳本在 18.3.3 基線為 **16／55／51／26／30 PASS、0 DRIFT**；這只證明錨點與環境現況，不證明影音生成可執行。尤其 P3 漏列 `kind: video` 的 schema 修改，P1 直連參考圖的 404 降級敘述被實際 HTTP 200 反證。Gemini、H3、Qwen-Image、ACE-Step 的實際輸出仍屬 **[INFERENCE]／待權重、憑證、workflow 與實作後驗收**。

## F01–F16 複核

| 原案 | 裁決 | 本輪證據 |
|---|---|---|
| F01 | 已解決（規劃層） | P3/P4 `revalidate.sh:42-70`／`:37-84` 改前序為 PREREQ；模擬 P1+P2／P1+P2+P3 後仍為 26／30 PASS、0 DRIFT。 |
| F02 | 已解決（規劃層） | P4 `design.md:20-34`、`implement.md:25-28,56-59` 納入 music schema、發佈宣告與真 ModelRegistry gate。 |
| F03 | 已解決 | P3 `design.md:284-285`、`implement.md:77-83` 用 `${NM}` 跨套件 root。 |
| F04 | 已解決 | gateway `design.md:90-155,518-526`、P3 `design.md:40-57,239-250`、P4 `design.md:214-225` 的公開模型 id 一致。 |
| F05 | 已解決 | gateway `design.md:84-122,482-493` 僅驗證 enabled 模型，G1 最小設定不載尚未匯出的 workflow。 |
| F06 | 已解決（按縮小後的 G5 範圍） | gateway `design.md:385-394` 明定 H3 t2v 首末幀報 400，G5b 才加 LoadImage；`:422-444` 給 ACE 補輸出與參考音分支；未聲稱真實生成已驗證。 |
| F07 | 已解決（設計） | gateway `design.md:210-225,266-269` 增逐 job cancel；P3 `design.md:134-205` 明定 abort 後呼叫。 |
| F08 | 已解決（設計） | P2 `design.md:222-243` 的宿主表、P3 `design.md:106-121`、P4 `design.md:204-213` 皆要求 asyncSettles 與 owner。 |
| F09 | 已解決（設計） | P3 `design.md:151-205` 和 P4 `design.md:170-189` 把 output_path 設為額外複製，並要求原件保留。 |
| F10 | 已解決（設計） | gateway `design.md:507-553` 寫明 Qwen → Gemini → xai 及 lite 僅列清單；但 gateway 停機 smoke 仍以 P2 D14 落地為前提。 |
| F11 | 已解決（設計） | gateway `design.md:357-371` 估活躍持有者＋排隊＋冷啟＋自身耗時，未知時 503，列有針對性測試。 |
| F12 | **部分解決** | P1 `design.md:39-42` 承認 HTTP 200 業務錯誤不降級、延到 G1；但參考圖宣稱 404 後降級與實測 HTTP 200 及內部 404 重試行為相反。見 F12。 |
| F13 | 已解決（設計） | P2 `design.md:146-177` 前景保留 display-only `details.images`，並規劃兩路 provider payload 對照 gate。 |
| F14 | 已解決 | gateway `prd.md:77-81`、`design.md:417-446` 明定 G7 由 gateway 交付，P4 `design.md:235-260` 以 G7 為前置。 |
| F15 | **部分解決** | gateway `revalidate.sh:168-187` 增 ACE 4/4、Qwen VAE 等檢查；路線 A TE、HF 目錄、符號連結及憑證目錄仍可能誤報。 |
| F16 | **部分解決** | parent `prd.md:103` 補歷史編號對照，P3 `design.md:23-29` 不再改 ModelOverride；parent `prd.md:129-140` 現行 Resume 和子 PRD 編號未更新。 |

## 新發現

| ID | 重要度 | 核心問題／最小處置 |
|---|---|---|
| N01 | blocker | P3 `design.md:23-29` 誤以為 P1 已允許 `kind: video`；P3 自己必須加 schema 值與 `.d.ts`，用真 registry 驗證。 |
| N02 | major | P2 `implement.md:3,9-42,53-76` 尚未接入新增 D14、53–55 與降級 gate；補計畫與發佈宣告。 |
| N03 | major | P2 `design.md:248-258` 若一律放行 TypeError，程式錯誤會被當作連線錯誤；只接受確證的傳輸錯誤。 |
| N04 | major | P3 `design.md:178-190` 的終態失敗丟普通 Error，與 D14 分類衝突，H3→即夢不會換手；標註可降級遠端失敗並測之。 |
| N05 | minor | P2 `design.md:215-218` 的 `${AGENT}`＋`${TUI}` 與正確 `${NM}` 登錄衝突；統一成後者。 |
| N06 | minor | gateway `design.md:170-185,518-530` 把不支援參考圖／幀的模型標成可吃 image；修正 capability 宣告。 |
| N07 | minor | gateway `implement.md:78` 把 volumedetect 當作無人聲證明；改用聆聽或可靠的聲音內容檢測。 |
| N08 | major | gateway `check.jsonl:11` 指向不存在的首輪審查研究檔；保存首輪結果或改指既有持久文件。 |
| N09 | minor | P3 `revalidate.sh:72-74` 稱唯讀卻呼叫 POST cancel；改靜態／GET 檢查。 |

其餘未聲稱 lint、typecheck、生成實測或補丁鏈重放通過；本輪只有規劃與外部協議的唯讀核對。
