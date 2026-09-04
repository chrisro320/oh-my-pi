# billion-context-pi 深讀報告（0.1.55）

日期：2026-09-03｜對象：`ranxianglei/billion-context-pi` HEAD｜版本：0.1.55，`acp-kernel` 0.0.48，`@earendil-works/pi-coding-agent` 0.83.0

## 為何在 Pi 上成立

- 攔 `context` 事件跑管線，入口 `src/index.ts:286` 的 `processTurn`，做完從 `src/index.ts:404` 回傳整組訊息。
- 每則訊息掛不可見 `<acp>` ref（`m00001` 起跳），座標空間放在 `<session>.acp.json` 側車（`src/state.ts:6`）。
- Pi 有 `buildContextEntries()`，每次呼叫前即時完整，偵測在 `src/runtime.ts:42-45`，所以 ref 對得上。
- 宿主自帶壓縮由 `src/index.ts:109-114` 的 `session_before_compact` 回 `{cancel:true}` 整個取消，自己當唯一壓縮權威。
- Pi 成立前置：`buildContextEntries` 即時、`context` 管線語義、`session_before_compact` 可取消、`before_agent_start` 可加系統提示、工具錯誤只對 `throw` 置 `isError`（`src/compress-tool.ts:281-284` 註釋）、側車可寫、單一 ref 權威。

## 為何擋 OMP

- 偵測只有一招：`src/omp.ts:13-15` 寫成 `isOmpHost = !isPiHost`，沒有 `buildContextEntries` 就判 OMP。
- 觸發點唯一：`src/index.ts:129` 的 `session_start` 設 `refused`，之後全部下游看此旗標。
- 擋掉之後的行為（程式碼實測）：
  - `compress`、`decompress`、`search_context`、`acp_status` 仍註冊，但執行只回導引文字（`compress-tool.ts:64`、`decompress-tool.ts:49`、`search-tool.ts:30`、`status-tool.ts:37`）。
  - `acp_delegate` 三工具直接不註冊（註冊點在 `index.ts:165-169`，位於提前返回之後）。
  - 系統提示不注入（`index.ts:418` 直接返回）。
  - `context` 回 `undefined`，訊息原樣透傳（`index.ts:198`）。
  - 宿主壓縮不取消，照常跑（`index.ts:111` 直接返回）。
- 當年案子是 issue #234：OMP 18.0.5、`omp -p`、外掛 0.1.52。`merge-live-entries` 的 unmatched 從 3 漲到 21，nudge 範例 ref 與會話真實 ref 分屬兩個座標空間，`compress` 全報 `does not exist in this session`。作者裁決即放棄進程內 OMP 支援。

## 更新檢查（糾正：不是只有開機）

- 呼叫點兩處：`src/index.ts:173`（`session_start`）與 `src/index.ts:400`（每次 transform 尾部）。
- 內部 3 分鐘節流加互斥，有新版真的跑 `npm install --no-save` 再驗證加回滾（`src/update.ts:211-272`）。
- 開關：`ACP_AUTO_UPDATE=0/false/no/off` 全關（`src/update.ts:314-322`）。驗證一律設 `ACP_AUTO_UPDATE=0`。
- OMP 拒絕態下兩處皆不可達，零網路。

## `acp_delegate` 子系統

- 五角色：`reviewer`、`researcher`、`planner`、`oracle` 受限 `read,bash,grep,find,ls` 加 ACP 四工具；`worker` 跑 Pi 全預設工具集。
- 子進程依賴 Pi 專屬旗標（`--mode json`、`--session`），`resumeFrom` 只認 Pi 宿主。OMP 上整個子系統不註冊。

## 未讀到

- `acp-kernel` 內部八階段實作、`src/commands.ts` 在拒絕態下的行為、`src/tool-guardrails.ts`、`src/log.ts`、`tests/*.test.ts`（僅知 `tests/omp-refuse.test.ts` 存在）。
- 現行 OMP 是否仍無 `buildContextEntries`，本倉視角無法證實，以實測為準。
