# omp 音樂類別與工具

父任務：`09-27-media-models-unified`。依賴：子任務 1（0083 自訂 `kind`）、子任務 2（媒體工具背景化）、子任務 3（轉接服務；ACE-Step 轉接器由轉接服務 G7 交付，本任務只依賴它，2026-09-28 更正）、子任務 4（影片，提供共用 `media-job.ts`）。

## Goal

omp 新增 `music` 模型類別、音樂角色與 `generate_music` 工具；模型出現在 `/models` 並可設定預設與順序；由本機 ComfyUI 的 ACE-Step 1.5 生成音樂，背景執行，不阻塞前台。

## 已查證的現況（2026-09-28）

- omp 沒有音樂類別：`pi-catalog/src/types.ts:27-38` 的 `MODEL_KINDS` 只有 `chat, tiny, image, tts, stt, search, judge, embedding, rerank, video`；`KIND_API_KINDS`（`:43`）與 `RUNNER_APIS`（`:48-61`）也沒有音樂相關項目。新增 `music` 會動 pi-catalog 型別，影響面比 0083 大。
- 角色清單寫死在 `pi-tui/src/overlays/model-browser.ts:53-82`、`pi-coding-agent/src/config/model-roles.ts:55-89`（與影片任務相同的改點）。
- 本機 ComfyUI（`/media/chris/Agents/LLM/ComfyUI`）已原生支援 ACE-Step 1.0 與 1.5：`comfy_extras/nodes_ace.py`（`TextEncodeAceStepAudio1.5` `:31-35`、`EmptyAceStep1.5LatentAudio` `:87-92`、`ReferenceTimbreAudio` `:109-114`）、`comfy/supported_models.py:2229`（`ACEStep15`）。**本機尚無 ACE-Step 權重。**
- 外部條件（網路查證）：ACE-Step 1.5 為 MIT 授權，2026-02 進 ComfyUI；標準版低顯存可跑，XL 版建議 12GB 以上（[ComfyUI 公告](https://comfyui.org/en/ace-step-15-is-now-available-in-comfyui)、[GitHub](https://github.com/ace-step/ACE-Step-1.5)）。Suno 沒有官方公開 API（[tunova](https://tunova.ai/guides/is-there-an-official-suno-api)）。YuE 7B 在 16GB 卡上需 fp16 下限、每分鐘音訊數分鐘、CC BY-NC（[spheron](https://www.spheron.network/blog/deploy-open-source-ai-music-generation-gpu-cloud-2026)）。

## 已對齊（2026-09-28）

- 後端：只用本機 ACE-Step 1.5（ComfyUI），先用標準版，XL 版視顯存實測再評估。**不接 YuE、暫不接雲端 Suno**（之後要加只需新增 provider，不動 omp 補丁）。
- `generate_music` 參數：`prompt`（風格描述，必填）、`lyrics`、`duration`（秒）、`instrumental`（純演奏）、`reference_audio`（參考音色，對應 `ReferenceTimbreAudio`）、`output_path`（選填，只做額外複製）。
- ComfyUI 細節參數（步數、取樣器、CFG、種子等）由使用者在 ComfyUI 前端調好存成 API 格式 workflow，轉接服務只做封包；workflow 不支援某參數時回明確錯誤，不靜默忽略（與影片相同）。
- 輸出：一律存工作目錄 `generated/music/<時間>-<模型>.<副檔名>`；`output_path` 只額外複製。
- 背景執行：走 `09-27-media-tools-background` 的 `"media"` 背景工作；GPU 任務在轉接服務排隊，omp 端以 `queued: true` 註冊。
- 工具開關：omp 內建預設關閉；本任務完成時在使用者 `config.yml` 開啟。

## 待對齊 / 設計階段決定

- omp 端傳輸協議：沿用影片任務決定的轉接服務非同步介面（提交→輪詢），還是另定 `music` 專用 runner api。原則：與影片共用同一套非同步介面，避免兩種協議。
- `music` kind 的落點：改 pi-catalog `MODEL_KINDS`（型別正統，但動到 catalog 套件），或與影片任務一起把 `video`/`music` 的 kind 擴充合併成一層補丁。
- ACE-Step 1.5 權重下載來源與檔案清單（標準版），以及 `duration` 上限。

## Acceptance Criteria

- [ ] `models.yml` 可宣告 `kind: music` 的自訂模型；`omp models --kind music` 與 `/models` 顯示、可設為音樂角色預設。
- [ ] `generate_music` 呼叫後立即回傳背景工作編號；完成後送回檔案路徑與中繼資料（時長、模型、耗時），不含音訊內容。
- [ ] 實測：`prompt`＋`lyrics`＋`duration` 生成有人聲歌曲；`instrumental: true` 生成純演奏；`reference_audio` 生效；不支援的參數回明確錯誤。
- [ ] 取消背景工作會一路取消到 ComfyUI 佇列。
- [ ] 檔案落在 `generated/music/`；給 `output_path` 時另有一份副本。
