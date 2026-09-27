# omp 媒體工具背景化

父任務：`09-27-media-models-unified`。

## Goal

所有多媒體生成工具（`generate_image`、`tts`，以及之後的 `generate_video`、`generate_music`）都不阻塞前台：主線程與子代理呼叫後立刻拿到背景工作編號並繼續工作，完成後結果（檔案路徑、使用的模型）自動送回呼叫者的會話；`/jobs` 與 `proc://` 看得到進度，可取消。
- 輸出位置（四個媒體工具統一，優先級最高）：原檔一律存到工作目錄下 `generated/<類別>/<時間>-<模型>.<副檔名>`（類別 = `image`、`audio`、`video`、`music`）；AI 給 `output_path` 時只是額外複製一份過去。`generate_image` 不再存系統暫存；`tts` 的 `output_path` 由必填改為選填。

## 使用者原則（2026-09-27）

- 「工具或命令存活於背景即可，不要阻塞主線程或子代理；所有多媒體任務都不該阻塞前台。」
- 做法：接 omp 既有的 `AsyncJobManager` 背景工作機制，一律丟背景（不採「先等幾秒再轉背景」）。內建的 codex、反重力生圖也一樣背景化。

## 已查證的 omp 現況

- 背景工作：`AsyncJobManager.register(type, label, run, options)`（`pi-coding-agent/src/async/job-manager.ts:319-330`），`run` 收到 `signal`、`reportProgress`；完成後由擁有者會話的 delivery sink 送回（`session/agent-session.ts:1928-1932`、`session/async-job-delivery.ts`）。子代理共用父代理的管理器（`tools/index.ts:430-440`）。
- 工作類型寫死 `"bash" | "task" | "eval"`（`async/job-manager.ts:46`；`pi-tui/src/tools/wait.ts:43` 同步）。
- `bash` 的背景化做法：`this.session.asyncJobManager.register("bash", …)`（`tools/bash.ts:795-840`）。
- `generate_image`、`tts` 是 `CustomTool`，執行時拿到的 `CustomToolContext` **沒有** `asyncJobManager`（`extensibility/custom-tools/types.ts:88-109`、`sdk.ts:1135-1145`），目前兩者都在前台等待完成（`tools/image-gen.ts:201-306`、`tools/tts.ts:186-229`）。

## 待對齊

- 背景工作類型命名（新增 `"media"`，或沿用既有類型）。
- 完成送回的內容（只有路徑與模型，或附縮圖／音訊資訊）。
- 本任務與子任務 1、3、4 的先後順序。
