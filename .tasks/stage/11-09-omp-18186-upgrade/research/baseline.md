# 規劃前量測：18.18.0 → 18.18.6（2026-11-09）

- 目前執行中：客製 18.18.0，release `18.18.0-f74e59923d16-3b2faede-9ac28b0e`（`~/.bun/bin/omp` 指向該 release）。`patches/versions.json` 登記 18.16.0、18.18.0；`patches/PATCHES.md` 開頭的版本表仍寫 18.16.0 為 active，已過時。
- 上游 tag（`git ls-remote https://github.com/can1357/oh-my-pi`）：`v18.18.5` = `1891f380b296aeda26971abd81b89ef3247eea06`；`v18.18.6` = `9058ab9d229663e229e2867824ba6df6f21e9e59`（npm 發布 2026-11-09T23:44Z）。
- omp #18483（平行隔離子代理 patch 合併無鎖）：issue 與修正 PR #18484 皆仍 OPEN（`gh pr view 18484`：`mergedAt: null`），18.18.6 不含修正。

## fuzz-0 鏈式重放（`drift-replay.py`，依 `.18.18.0-families/plan.tsv` 順序，`patch -p1 --fuzz=0 -N`）

| 版本 | 失敗組 | 失敗 hunk |
|---|---|---|
| 18.18.0（對照組） | 0/24 | 0 |
| 18.18.5 | 10/24 | 63 |
| 18.18.6 | 10/24 | 66 |

18.18.6 失敗明細（log：`/var/tmp/omp-18186-drift/18.18.6/logs/<family>.txt`）：

| 補丁組 | hunk | 主要檔案 |
|---|---|---|
| family-input-translation | 34 | `agent-session.ts`（14）、`main.ts`、`interactive-mode.ts`、`session-listing.ts`、型別檔 |
| family-compaction | 10 | `pi-agent-core` `compaction.ts`（4）、`session-maintenance.ts`（3）、`agent-session.ts`（2） |
| 0010-omp-extension-idle-ephemeral-turn | 8 | `agent-session.ts` |
| family-persistent-prefix-resume | 6 | `agent-session.ts`（4）、`session-tools.ts` |
| family-status-accounting | 3 | `pi-tui` status-line |
| family-hindsight | 1 | `agent-session.ts` |
| family-image-budget-snapcompact | 1 | `pi-catalog` `rules.json`（重生即可） |
| 0090-omp-oauth-durable-refresh | 1 | `pi-ai/src/auth/usage.ts` |
| 0094-omp-anthropic-thinking-drop-resume | 1 | `pi-ai/src/providers/anthropic.ts` |
| 0101-omp-subagent-warm-revival-persisted-prompt | 1 | `src/task/executor.ts` |

18.18.5 與 18.18.6 只差 family-input-translation（31 → 34）。

## 影響客製或使用者行為的上游改動（18.18.1–18.18.6 發布說明，`gh release view`）

- **18.18.4 暫停 Google Antigravity**：`pi-catalog/src/rules/auth/google-antigravity.kdl:3` 加 `disabled "Google may restrict accounts…"`，編進 `rules.json`；被暫停的 provider 不列登入、拒絕登入／token 更新／額度查詢／請求，已存登入保留，規則拿掉即恢復。使用者近 30 天 Antigravity 4101 則（`DECISIONS.md`「退役清單勾選（2026-11-08）」）。
- 18.18.2 壓縮：遠端 OpenAI 壓縮在目前模型無法重播時改為展開內容（`canReplayRemoteCompactionFrom()`）→ family-compaction（Codex 壓縮鏈）需重寫並重驗。
- 18.18.2 `SessionStorage.hasAssistantTurn()` 改為 `scanLines()` → session-listing 相關 hunk。
- 18.18.2 `logoutCredential()` 改收 `AgentSession` → 0090 OAuth 區域需重看。
- 18.18.3 `ask` 工具改為 HTML 表單（`{ html }`），舊 `questions[]` 移除。
- 18.18.3 delegation：無規則的模型（Claude 等）不再被推去開子代理；`task.eager` 只影響主代理系統提示 → 系統提示變動，上線當下 cache 重建一次屬預期。
- 18.18.1 bash 指令改用 `LANG/LC_ALL=C.UTF-8`。
- 18.18.5 新增 Claude Fable 5.2、Mythos 5.2。
- 18.18.6 晚到的額度錯誤不再擋住已切換的 provider；Tern 手機選單；GTK4 原生修正。

## 18.18.6 鎖定（M0，2026-11-09）

上游 tag `v18.18.6` = `9058ab9d229663e229e2867824ba6df6f21e9e59`（`git ls-remote https://github.com/can1357/oh-my-pi refs/tags/v18.18.6`，exit 0）。13 個 `@oh-my-pi/*` 套件的 tarball sha512 全部等於 `npm view @oh-my-pi/<pkg>@18.18.6 dist.integrity`（13/13），bytes 與 sha256 如下；檔案本體在 `~/.cache/omp-plan-18186/tarballs/<package>-18.18.6.tgz`（同一 inode 另有 npm pack 名稱 `oh-my-pi-<package>-18.18.6.tgz`）。18.18.0 的 6 個 pinned archive 也在同一 cache（檔名 `<package>-18.18.0.tgz`，sha256 逐一對 `patches/.18.18.0-families/manifest.json` 相符），重放工具與 oracle 共用這一個離線 cache。

| 套件 | bytes | sha256 |
|---|---|---|
| omp-stats | 600076 | `7fea55b89ba106833eda1fc21eb568c3bcce42171a596398f990f4c707933f57` |
| omptype | 234473 | `73f94ef483ac116509fe41afd40b70bd628ef136b859d7b5a55eafdb0db05347` |
| pi-agent-core | 356522 | `137fd596d0293904b2c2f33e2b57eb2ecf370da9c95a3cdbf49aead65b633273` |
| pi-ai | 2058385 | `e1252ce8d4eb6c85aa4d5a9ffcd40cb9d2adc7f12a0fa74dbfb4ef437df55408` |
| pi-catalog | 973870 | `633dcd1adcfab7f24642a26485b36669d5a233d994824f91fd76f60c6f038189` |
| pi-coding-agent | 15832970 | `799c74d3b400622a915a3e017096ceb9e9f47f8373d8e086da651d5c6aa484bb` |
| pi-mnemopi | 236114 | `687e13297c97984f9365ee629686a928523ea8a7e5c3fd63ed9cacaf45daa701` |
| pi-natives | 134842 | `5fb2f5ef2997fe73126c4aff4dda6c2d761a753c0c612dbe5551dea3d1a74152` |
| pi-natives-linux-x64 | 104073017 | `796f259b5143589e3f2337a224a40414ad514c22bc4bc25aa066916a6999f640` |
| pi-tui | 2860575 | `c3beb9cfc2f1c77ba7527a52f094583f0004dd076556d38fbd28f713553eeeb1` |
| pi-utils | 507279 | `6ae1918c3c42b9325c628f97312c0c17cb0e1563897217ff875e6c0196219887` |
| pi-wire | 62522 | `ef21b1dec1c8b3dd26bc1ee734fa310df7ad0657154b901ff08d1861073c53ea` |
| snapcompact | 56205 | `df0a511d3c8b2eaad73439540fa6f8b83b2b11b66f29f5e95b9b1ae05ec15b1d` |

- sha512（base64）逐套件與 `npm view` 相同，已寫進 `.18.18.6-families/manifest.json` 的 6 個 archive row（`pi-agent-core`、`pi-ai`、`pi-catalog`、`pi-coding-agent`、`pi-tui`、`snapcompact`，另含 sha1／bytes），oracle 會用本身重算比對。
- 18.18.6 pristine 樹（6 個 archive 解開、目錄模式正規化為 0755）digest = `5ebdf4f495826c380c9e7fc46ce4f059f460afdac3bcdccff34a1c46d7b9f4da`；同一程序對 18.18.0 重算得到 `88a0fb78b8d98cf2bc49c0aecb2c17a5444690d39c128484f2bd44ae716234ba`（與既有 manifest 相符），證明抽取程序一致。
- `pi-coding-agent@18.18.6` 的 dependency 集合與 18.18.0 **完全相同**（只有 11 個 `@oh-my-pi/*` 的版本 pin 由 18.18.0 改為 18.18.6；`@babel/parser`、OpenTelemetry 7 項、`axe-core 4.13.0`、`puppeteer-core 25.3.0` 不變；無新增、無移除、無 peer／optional）。`engines.bun` 兩版都是 `>=1.4.4`。
- 版本輪替：`patches/versions.json` = `["18.18.0", "18.18.6"]`；18.16.0 的計畫（29 檔）與只為它選取的 `verify-extensions-load-18160.ts` 移到 `patches/.retired/11-09-pre-18.18.6-plans/`（逐檔 sha256 在 `research/m0-retire-moves.json`）；`patches/native/18.16.0/` 由 M7 移到 `patches/.retired/11-09-pre-18.18.6-plans/native/18.16.0/`（同一份紀錄的 `observed_elsewhere`）。
