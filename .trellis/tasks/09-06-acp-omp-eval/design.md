# Design: ACP 壓縮裝進 omp 的評估架構

## 決策：主基線 = `billion-context-omp` v0.3.3

三條候選路徑與取捨：

| 路徑 | 內容 | 判定 |
|---|---|---|
| A 代理 | `bili omp`（`dist/agent/omp.js` 薄橋 + proxy 側壓縮） | **只作量測對照組**，不作長期方案：壓縮在宿主之外，本機 20 項補丁的 payload 歸因體系全部落在代理上游 |
| B 解封 pi 版 | fork `billion-context-pi`，關掉 `refused` 閘 | **否決**。閘只是薄層（commit `6ada21f5`，+259/-9），但解封等於繼承 `getBranch()+mergeLiveEntries` 啟發式對齊，即 issue #234 的病灶，且上游已放棄該分支 |
| **C fork omp 版** | fork `billion-context-omp` v0.3.3 | **採納**。`context` 降為純觀測、折疊在 `before_provider_request`（request-local，不可回喂），作者已自行拆掉 B 的做法 |

## 邊界：改哪裡、不改哪裡

使用者約束「盡可能不改 omp 源碼」直接決定分層：

```
┌─ 宿主 omp 18.1.10 ─────────────────────── 零改動（無新補丁）
│   settings / env 為唯一調節面：
│     PI_OPENAI_STATEFUL=0            → G0.1
│     compaction.enabled               → G0.2a
│     snapcompact.systemPrompt/toolResults → G0.2b
│     extensions[] 陣列 → 僅為來源之一，**不保證順序**（見下）
│     HOME / ACP_OMP_FOLD_DIR          → G0.5 隔離
├─ vendor/billion-context-omp（fork）──── 所有必要行為調整寫在這裡
│     刪 update.ts、預設刪 tool-guardrails.ts
│     折疊前排除 0038 尾條（fold id 空間）
└─ 觀測層 ────────────────────────────── 唯讀，handler 必須回 undefined
      cache-prefix-audit / payload-dump + 最終 HTTP body 抓取
```

若某閘門經實測**只能**靠改宿主才過，停下來讓使用者拍板，不自行動手（PRD「使用者追加約束」）。

## 資料流與衝突點

單次 provider request 的實際順序（已核實）：

```
transformProviderContext (sdk.ts:3459-3477)
  ├─ inline snapcompact       (:3461)   ← G0.2b，早於 ACP
  ├─ 圖片 clamp                (:3462)   ← 折疊改不了它的輸入
  └─ 0038 date/cwd 尾條        (:3472)   ← 折疊會看到它，wire 上已無 providerOnly 標記
        ↓
onPayload → emitBeforeProviderRequest (sdk.ts:3478-3480)
  └─ 順序鏈式 reduce (runner.ts:1668-1694)
       ext1 → ext2 → ... 後者收到前者的 currentPayload
       ACP 折疊 / audit / payload-dump 都在這條鏈上
        ↓
adapter 套用 replacement
  anthropic.ts:2206-2210 → toWellFormedDeep(:2210) → fetch wrapper 補 cch(:719-723)
  openai-responses.ts:527-534（但 :304-330 的 delta 決策更早 ⇒ G0.1）
        ↓
最終 HTTP bytes  ← 真正的觀測點
```

三個結構性後果：
1. **鏈式非合併** ⇒ ACP 不需與 0038/0046 合進同一 handler，但轉換的**非交換性**必須驗（ACP 在 audit 之前或之後，觀測到的東西不同）。
2. **0038 尾條必然在 payload 內** ⇒ 折疊前需排除，否則參與 content-hash id 空間，威脅 `restoreFold` 跨進程收斂。同類先例：kernel 的 openai system-prefix hoist（`wire-fold.ts:73-80`）。
3. **`before_provider_request` ≠ 最終字節** ⇒ G0.4。

## 量測設計（為何是三組）

v1 只有 EXT/PROXY 兩組，兩組都帶壓縮 → 無法判「淨收益」。三組：

- `BASE`：現行宿主 20 項補丁鏈，無 ACP。這是收益的分母。
- `EXT`：v0.3.3 extension。
- `PROXY`：`bili omp`。

固定變量：同 scenario 與**完成品質終點**（不是跑到 token 用完）、同 provider/model、同 cache namespace/TTL、同 history 起點與 tool outputs。EXT 組須關掉原版會動的 bash timeout / tool output cap（`README.md:158-159`），否則 token 差不能歸因壓縮。

成本口徑：按 provider 價格算**全部請求**，含 summary 的 output、重試與子請求。等權 `input+cacheRead+cacheWrite` 不是錢——`input` 與 `cacheRead` 已實證約十倍價差（`PATCHES.md:209`）。命中率記兩個數：`ΣcacheRead/Σtotal` 與 `≥0.5 請求占比`；無有效 usage 記 NA。

## 覆蓋面的硬邊界

codec 路由按 payload 形狀而非 api 集合，所以覆蓋面比 `CODEC_VIABLE_APIS` 寬（`azure-openai-responses` / `openai-codex-responses` 也可能被折）；但 **Antigravity 全家（20 個模型 api=`google-gemini-cli`）的 Google `contents` 形狀在 `index.ts:229-231` 直接略過**。若主力會話在 Antigravity 上，EXT 組收益結構性歸零——這一條要在 Phase 0 先算清占比，且明確不在本任務補 codec。

另：有 codec ≠ 每個 payload 真被壓。`document` / `redacted_thinking` / server-tool 會被 kernel 丟掉，靠整請求 fail-open 保資料（`wire-fold.ts:114-153`）；`index.ts:246-255` 的 fail-open 意味「工具報 compress 成功」與「provider 真收到 block」是兩件事，驗收必須分開測。

## 相容性矩陣（Phase 2 才展開，逐條各自證據）

需覆蓋：0010（cron side-channel）、0017（Responses native replay + stateful）、0038、0043（打斷清理）、0044（wire-api 圖片預算）、0045（手動 snapcompact 重計價）、0046（持久化 supersede idle flush）、`resume-cache-breakpoint` extension，以及 restart / fallback / interrupt / side-channel / 手動 compact 五條 request path 各自驗收。
`0033/0004/0037/0025/0026/0030/0031/0032/0041` 屬量測、路由或常駐工具前綴條件，**未發現可斷言的 ACP 衝突**，不列冲突項。`0034` 記憶快照需保持三組同狀態。`0019/0042` 在 18.1.10 已退役。

## 回滾形狀

評估階段本身不需回滾——所有改動落在沙盒 `HOME` 與 vendor fork。判定拒絕時：刪沙盒目錄（歸檔觀察結果後）、`vendor/` 保留於 git 供將來重啟。live 側恆等於未介入狀態，以 `apply.sh --check` 前後一致 + `~/.omp` 無改動證明。
