# 補丁功能族 Rollup 設計

## 問題邊界

目前行為正確，但補丁鏈將多次修正同一功能的歷史過程保留在 active chain，導致 `apply.sh` 必須以 6 組 `superseded_by_*` 動態推斷狀態。這次只重整補丁表示法與套用控制流，不改動最終 TypeScript 原始碼。

預期修改：

- `patches/apply.sh`：active chain、root 映射、移除 supersede 狀態機、掛接驗證。
- `patches/PATCHES.md`：active 清單、rollup 對照與驗證證據。
- `patches/0033-*.patch` 至 `0037-*.patch`：五個新功能族 rollup。
- `patches/.retired/08-30-family-rollups/`：原樣保存被取代補丁。
- `patches/verify-patch-family-rollups.sh`：pristine 等價、正反向與冪等驗證。
- `~/.omp/patches/`：在 repo 完成並驗證後同步權威鏡像。

明確不做：修改 runtime TypeScript 行為、合併獨立故障域、升級套件、處理 Trellis 未追蹤資料。

## 基線與資料流

```text
Bun 18.0.9 cache（pristine）
  ├─ 套用某功能族舊鏈 → old-final
  └─ 套用新 rollup       → new-final

old-final ── recursive byte diff ── new-final
new-final ── reverse rollup ─────── pristine / family pre-state
```

共用檔案不能以完整 runtime 直接生成 rollup：

- `session-maintenance.ts` 同時被壓縮族與圖片/frame 族修改。
- 每個 rollup 必須在獨立 pristine sandbox 只套用該族舊補丁，再由該族的 before/after 生成差異。
- active chain 仍維持原本的跨族先後關係：壓縮族先於圖片/frame 族。

## Rollup 對照

| 新編號 | 功能族 | Root | 舊補丁 |
|---|---|---|---|
| 0033 | cache turn status | `pi-coding-agent` | 0002、0003 |
| 0034 | Hindsight snapshots | `pi-coding-agent` | 0006、0021、0023、0024 |
| 0035 | compaction prefix | `@oh-my-pi` node_modules root | 0013-core、0013-agent、0018 |
| 0036 | image/frame budgets | `@oh-my-pi` node_modules root | 0015-snapcompact、0015-agent、0020-snapcompact、0020-agent、0022 |
| 0037 | usage statusline gate | `pi-coding-agent` | 0005、0007、0029 |

跨套件 rollup 使用 `pi-agent-core/...`、`pi-coding-agent/...`、`snapcompact/...` 路徑並從 `${NM}` 以 `-p1` 套用，避免一個功能族再拆成多個檔案。

## Active Chain

整併後保持 15 項：

1. 0033 cache turn status rollup
2. 0004 token total cacheRead
3. 0034 Hindsight snapshot rollup
4. 0037 usage statusline gate rollup
5. 0010 idle ephemeral turn
6. 0035 compaction prefix rollup
7. 0019 read description refresh
8. 0014 Antigravity deterministic identity
9. 0036 provider image/frame budget rollup
10. 0017 OpenAI native replay warm
11. 0025 Ollama usage API
12. 0026 usage fetch core gate
13. 0030 canonical usage cache key
14. 0031 AgentSession provider forwarding
15. 0032 goal resident tool

0037 必須保留在 0034 之後與 0010 之前沒有語義要求，但需在舊 `0005/0007/0029` 原相對區段，方便審查；0035 必須先於 0036。

## 舊補丁保存

- 移動而非改寫，保存到 `patches/.retired/08-30-family-rollups/`。
- 驗證腳本同時以舊檔作為等價 oracle，因此歷史檔不是死文件。
- 0012、0016 原本就不在 active chain，不屬於本次 rollup，也不移動。
- `.retired/0011` 維持原位。

## 驗證契約

`verify-patch-family-rollups.sh` 應：

1. 從本機 Bun cache 的明確 18.0.9 套件建立暫存 sandbox；缺少基線時明確失敗。
2. 對每個功能族建立 old/new 兩份獨立副本。
3. 依歷史順序套用舊鏈；依相同前置條件套用新 rollup。
4. 對該族擁有的檔案做遞迴逐字節比較。
5. 反向撤銷新 rollup並比較 family pre-state。
6. 確認第二次正向 dry-run 不會再套出變更，且反向 dry-run仍識別為 applied。
7. 失敗時列出功能族與第一個差異檔，成功時逐族輸出 PASS。

完整驗證再執行現有功能回歸、`apply.sh --check`、正式 `apply.sh` 與實際 CLI smoke。

## 相容與回復

- Runtime 已是舊鏈最終狀態；新 rollup 應由 reverse dry-run直接識別為 applied，因此切換 `apply.sh` 不應再次修改 runtime 原始碼。
- 若任一 rollup 無法在 runtime 被識別為 applied，停止同步，不以 fuzz 或手工改 runtime 掩蓋。
- 回復方式：恢復舊 `apply.sh`、把留存補丁移回原路徑、刪除五個 rollup；runtime 原始碼不需改動。

## 否決方案

- **每個套件一個巨型補丁**：最少檔案，但混合故障域，上游吸收單一功能時難以撤除。
- **直接把現有 runtime 與 pristine 整檔 diff**：會把共用檔案中的其他功能烘入錯誤 rollup。
- **原地修改舊定稿補丁**：破壞歷史雜湊與既有定稿不可變契約。
