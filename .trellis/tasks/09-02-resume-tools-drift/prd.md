# 修復 Resume Tools Description 漂移

## Goal

消除 session 在 temporary model 下續接時的工具說明漂移，讓 resume 首輪沿用與暫停前相同的 edit mode 與 tools 序列化前綴，避免可重現的單次 prompt-cache miss。

## Confirmed Facts

- `patches/PATCHES.md:149-154` 與提交 `a4f4912` 證明同類問題已由 0019 修過：當時是「切模後舊進程的 `read.description` 未刷新，resume 新進程反而正確」；0019 只覆蓋 `ModelControls → SessionTools.syncAfterModelChange()`。
- 本次現象方向相反：0019 已讓切到 temporary DeepSeek 的舊進程使用正確 sloppy 短版，但恢復 target model 的兩條路徑都沒有走 0019 的 description 同步路徑——行程內 `AgentSession.switchSession()` 直接 `agent.setModel()`；新進程 `createAgentSession()` 在 tools 建立後才 reclaim extension-backed temporary model（`src/sdk.ts` 晚期 session-model reclaim）——resume 進程因此留下建構期 hashline 長版。
- `model-controls.ts:257-292` 明定 temporary model 會寫 session log；`session-context.ts:259-264` 會投影為 `models.temporary`。實際呼叫 `getRestorableSessionModels({default, temporary}, "temporary")` 回傳 `[temporary, default]`，因此交接報告「temporary 不持久化而 fallback default」的根因結論不成立。
- `RESUME_TOOLS_DRIFT_REPORT.md:15-36` 的 payload 差異仍成立：漂移只在 `read` 工具的 `IS_HL_MODE` 條件行，其餘 13 個工具、參數 schema 與名稱相同。
- provider、帳號、model namespace 或 TTL 改變造成的設計性 miss 與本問題無關；本問題限定為這些條件與會話前綴均未變，OMP 卻因恢復時序自行改寫 tools bytes 的無端 miss。

## Requirements

- R1：刷新兩條恢復路徑成功後的 `read.description`——`AgentSession.switchSession()` 恢復 target model 後，以及 `src/sdk.ts` 晚期 session-model reclaim 成功時（`model = restoredModel` 後從 `toolRegistry.get("read")` 選擇性呼叫）——復用 0019 已有的 `ReadTool.refreshDescription()`。
- R2：不得改變 `default`、`ephemeral`、temporary model 的持久化、恢復順序或生命週期語義。
- R3：以新的獨立補丁接在 0019 之後；不改寫已進 active chain 的 0019。live 部署只限使用者本輪明確授權的 0042 source 與 ledger，不延伸到其他 runtime 檔案。
- R4：增加一個零 provider 回歸，走「hashline model 建構 session → `switchSession()` 恢復 temporary sloppy model」；須在未套新補丁時失敗、套用後通過。
- R5：修正 `RESUME_TOOLS_DRIFT_REPORT.md` 的錯誤根因，保留既有 payload 觀察。
- R6：只跑本修補必要的既有回歸與 pristine 全鏈重放；不延伸成 18.1.2 整鏈支援工作。

## Acceptance Criteria

- [ ] AC1：cache namespace、TTL 與會話前綴均未變的隔離回歸中，兩條恢復路徑（行程內 `switchSession()`；新進程 `createAgentSession()` 晚期 reclaim）完成後 active model 為 temporary sloppy model，`read.description` 與直接使用該 model 建立的工具完全相同，不再產生新的 tools 指紋。
- [ ] AC2：同一回歸在已有 0019、沒有新補丁時失敗；套用新補丁後通過，且零 provider 呼叫。
- [ ] AC3：既有 0019 的雙向切模回歸仍通過。
- [ ] AC4：canonical pristine 18.0.9 可完整重放 active chain，補丁狀態與新增符號定義／引用檢查通過。
- [ ] AC5：`RESUME_TOOLS_DRIFT_REPORT.md` 不再把 temporary 持久化誤判為根因。
- [ ] AC6：live 只寫入明確授權的 0042 source 與 ledger；未寫入任何 live DB、WAL/SHM、憑證或 Bun cache。

## Out of Scope

- 不改 Magic Context、Trellis extension 或 context hook。
- 不改 model role 恢復語義。
- 不做所有工具的通用重渲染或惰性渲染重構。
- 不新增 18.1.2 版本鏈、部署 live mirror、處理其他 cache miss。

