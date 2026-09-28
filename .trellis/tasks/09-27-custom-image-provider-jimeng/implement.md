# 0083（暫定編號）執行計畫與記錄（image + tts）

> 規劃基線：omp 18.3.3（2026-09-28 `revalidate.sh` 16/16 PASS）。本檔目前只是計畫；開工時先做步驟 0。

## 重驗紀錄
（開工時填：日期、omp 版本、`revalidate.sh` 輸出摘要、每個 DRIFT 的判定與對 design 的修訂）

## Boundary
- 補丁只改 `pi-coding-agent`（root `${AGENT}`）：`src/config/models-config-schema-bundle.ts`、`src/config/model-patch.ts`、`src/config/custom-models.ts`，以及對應的 `dist/types/config/*.d.ts`。
- 使用者設定：`~/.omp/agent/models.yml` 新增 `jimeng` provider、`~/.omp/agent/config.yml` 新增 `modelRoles.image` 與 `retry.fallbackChains.image`。兩檔改前做時間戳備份；其他 key 不動。
- 不改：`api_image` 工具、反重力 image_size、catalog 顯示名、`agent.db` / 憑證資料庫、Orca、其他版本計畫。
- 任何輸出、patch、log、commit 都不得出現 token 內容（只允許出現檔案路徑）。

## Sequence
0. [ ] **開工前重驗**：`bash .trellis/tasks/09-27-custom-image-provider-jimeng/revalidate.sh`；有 DRIFT 就依母任務「開工前重驗協議」判定並修訂 `design.md`，結果寫入上方「重驗紀錄」，請使用者核准修訂後再繼續。依當下 `patches/apply.sh` 重新分配補丁編號與計畫計數，並全文替換本檔與 design 中的暫定編號。
1. [ ] **Pristine base**：從官方 `@oh-my-pi/pi-coding-agent@<當下版本>` tarball 取得三檔與三個 `.d.ts`，套用該版本計畫中所有碰到這些檔案的前序補丁（先用 `apply.sh --print-plan` + grep 找出是否有），確認 a 側 = live 樹。
2. [ ] **紅燈閘門**：寫 `patches/verify-custom-model-kinds.ts`（root-selected imports：`OMP_PATCH_VERIFY_AGENT_ROOT` / `OMP_PATCH_VERIFY_NM`）。在隔離 `PI_CODING_AGENT_DIR` 放 fixture `models.yml`（假 baseUrl、`apiKey: "!printf fixture"`，不碰真實憑證），用真的 `ModelRegistry` 斷言：
   - schema 不報錯、自訂 provider 未被停用；
   - `jimeng/*` 列在 `getAvailable("image")`，不在 `getAvailable()`（chat）；
   - 同 provider 另一個未宣告 kind 的列仍是 `chat`，且物件沒有多出 `kind` 鍵；
   - `roleCandidatePool("image", ...)` 包含 fixture 模型，`resolveRoleChain` 在設定 `modelRoles.image` + `fallbackChains.image` 時的順序與設定一致；
   - 與內建模型同 `provider+id` 的覆寫路徑也帶上 kind（用 `openai-codex` 之外的無害 fixture provider 驗證 `applyModelPatch`）；
   - TTS：fixture provider `api: openai-speech` + `kind: tts` 指向 gate 內啟動的本地假 HTTP 服務（`Bun.serve`，隨機埠，只回固定位元組），模型出現在 `roleCandidatePool("speech")`，設定 `modelRoles.speech` 後呼叫真實 `ttsTool.execute` 寫出檔案，且假服務收到 `POST /audio/speech`、`model` 為 fixture id；
   - schema 仍拒絕 `kind: video` 與 `api: openrouter-images`（範圍不外擴）。
   對 live（未補）樹執行必須紅，且紅在 schema/kind 斷言，不是 fixture 缺失。
3. [ ] **實作**：依 design D2/D3 改三檔與 `.d.ts`；缺省 kind 不新增鍵。
4. [ ] **產生 candidate**：從 pristine+前序產生 `patches/.18.3.3-candidates/0083-omp-custom-model-kinds-v18.3.3-candidate.patch`，`patch -p1 --fuzz=0` 正向 dry-run、反向 dry-run、套用後 `cmp`、二次 `--forward` 必失敗。
5. [ ] **註冊**：`apply.sh` 18.3.3 分支在 0082（輸入英譯 `0082-omp-user-display-text`）後加 `_omp_tail_candidate "18.3.3" "0083-omp-custom-model-kinds" "${AGENT}"`；回歸區塊加 `if _omp_plan_has 0083; then bun "${HERE}/verify-custom-model-kinds.ts"; fi`；`verify-patch-family-rollups.sh` 的 `EXPECTED_PLAN_1833` 追加 0083 並把計數 48→49、註解同步；`PATCHES.md` 計畫表計數與新增 `### 0083` 條目。
6. [ ] **隔離驗證**：`bash patches/verify-patch-family-rollups.sh`（18.3.3 完整 pristine 重放 / 反剝）；隔離補後樹跑 `verify-custom-model-kinds.ts` 綠。
7. [ ] **獨立審查**：`trellis-check` agent 審 diff、閘門敏感性、`.d.ts` 同步、零鍵不變式；有發現則修正後重審。
8. [ ] **部署**：備份 live 三檔 + 三 `.d.ts` 到 `~/.omp/patches/backups/<date>-0083/`；`bash patches/apply.sh`（只新增 0083）；repo → `~/.omp/patches/` 同步 candidate、verifier、`apply.sh`、`verify-patch-family-rollups.sh`、`PATCHES.md`，逐檔 `cmp`。
9. [ ] **使用者設定**：備份 `models.yml`、`config.yml`；寫入 design D4 設定；`omp models --kind image` 列出 5 個 jimeng 模型且無 schema 警告；`omp models`（chat）不含 jimeng。
10. [ ] **冒煙（新 omp 程序）**：`generate_image` 不帶 `model` → provider=jimeng、model=jimeng-image-5.0-pro，保存檔案數 = 反代回傳 `data` 項目數；帶 `model: jimeng/jimeng-image-4.7` → 4.7 成功。`/models` kind 分頁 image 角色可見 jimeng 模型（TUI 文字或截圖證據）。**已知限制（design D6）**：帶參考圖或即夢業務錯誤時整個呼叫失敗、不降級，P2 落地（D14）後才會降級；本步只記錄「帶參考圖＋不指定模型 → 失敗」的實際錯誤訊息作為基準，並驗證「帶參考圖＋`model: openai-codex/gpt-image-1`」可成功。
11. [ ] **收尾**：`trellis-update-spec`（新增 custom image-kind 契約到 backend spec）；machine grep 重跑；commit。

## Validation commands
- `OMP_PATCH_VERIFY_AGENT_ROOT=<root> bun patches/verify-custom-model-kinds.ts`
- `bash patches/verify-patch-family-rollups.sh`
- `bash patches/apply.sh --check`
- `OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh`
- `omp models --kind image`

## Machine checks（交付前與覆核各跑一次）
- `grep -nE '0083-omp-custom-model-kinds|verify-custom-model-kinds' patches/apply.sh patches/verify-patch-family-rollups.sh`
- `grep -nE 'openai-images|openai-speech|"kind\?"|patch\.kind|modelDef\.kind|resolvedModel\.kind' patches/.18.3.3-candidates/0083-omp-custom-model-kinds-v18.3.3-candidate.patch`
- 憑證外洩：`git diff --cached | grep -nE '[0-9a-f]{32}'` 應無 token 樣式命中（fixture 用非十六進位字串）。

## Review gate
- 閘門在未補樹紅、補後樹綠的兩次輸出都要貼進執行記錄。
- 審查者只報告、不改碼；修正由實作 owner 做完再送審。

## Rollback
- 源碼：`apply.sh` 反向 0083，或以備份覆蓋三檔與 `.d.ts`。
- 設定：以時間戳備份還原 `models.yml`、`config.yml`。
- 生效/回退都需重啟 omp；`/resume` 不會熱載入。

## Execution log
（實作時追加）
