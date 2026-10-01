# 結論（先講答案）

**三個缺陷都是上游既有缺陷，不是「新版本引入」，更不是本機補丁鏈引入。**

決定性證據（皆為官方 npm 產物，非本機快取推論）：

| 檔案 | 18.4.1（舊，部署基準） | 18.4.4（新） | 判定 |
|---|---|---|---|
| `packages/ai/src/auth/refresh.ts` | sha256 `MV3zCW97yc4yQ0MY5JVm5yMwyL42dPP2S8I5reHbfGo=`，27000 B | 同左（同值同大小） | **逐位元相同，18.4.1→18.4.4 對此檔為 no-op** |
| `packages/ai/src/registry/oauth/anthropic.ts` | sha256 `qyq+HxkX9ml/NM6X1p1s1JFOM3ZaTDV2wYvUSXtZnZk=`，4045 B | 同左 | **逐位元相同；且與官方 18.2.10 同值（跨 1.x 世代未變）** |

- 本機（live 53 層）沒有任何補丁觸及 `pi-ai/src/auth/refresh.ts`、`src/auth/pool.ts`、`src/auth/store.ts`、`src/auth/sqlite-credential-store.ts`、`src/registry/oauth/anthropic.ts`、`src/registry/engine/*`。唯有 0026（usage gate core，動 `src/auth-storage.ts` + `src/auth/types.ts`）與 0030（usage cache baseurl，動 `src/auth-storage.ts`）在鄰近目錄，屬 usage 探測子系統，與本三缺陷無關（grep `patches/` 全鏈，模式見下「方法」）。
- 本機唯一會動這兩個檔的補丁就是修復本身：`patches/.18.4.4-candidates/0090-omp-oauth-durable-refresh-v18.4.4-candidate.patch`（尚未部署，`PATCHES.md:12/:14`：live 53 層、0090 為第 54 層待部署）。
- 上游 repo：`https://github.com/can1357/oh-my-pi`（`packages/ai`，見 18.4.1 `package.json` 的 `repository.directory`）。

---

# 逐缺陷表（舊版行為 / 新版行為 / 上游或本機 / 路徑行號）

> 全部機制敘述為 **source-only 靜態證據**（我在本輪未執行任何 runtime 重現）。18.4.4 上的 runtime 故障注入重現是 main 既有成果（`patches/PATCHES.md:834`）；歷史版本我未跑 runtime。

## 缺陷 1 — refresh 期間等 optional bootstrap identity（30s），落在通用 10s owner timeout 內，丟棄已輪替權杖

| 項目 | 內容 |
|---|---|
| 舊版行為（18.4.1） | `refreshStored` 以 `options.refreshTimeoutMs ?? OAUTH_REFRESH_OPERATION_TIMEOUT_MS`（=10_000）abort `refreshAbort`；token POST 成功後 `applyAfterExchange(phase:"refresh")` 會進 `anthropicIdentityHook`，該 hook 以獨立的 `AbortSignal.timeout(30_000)` 打 `/api/claude_cli/bootstrap`（**不接** context.signal，因此外部 abort 根本取消不了它）；10s 到 → 該次 refresh 以 `OAuthError(kind:"timeout")` 收場，provider 已輪替的新權杖位元組被丟棄。 |
| 新版行為（18.4.4） | **完全相同**（兩版檔案逐位元相同）。 |
| 上游/本機 | **上游**（本機無補丁觸及；0090 才是修復）。 |
| 路徑/行 | `src/auth/refresh.ts:44` (`OAUTH_REFRESH_OPERATION_TIMEOUT_MS = 10_000`)、`:45` (`DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 10_000`)、`:237-245`（refreshAbort/refreshTimeout）、`:236` 起 `options.refresh(current, refreshAbort.signal)`；`src/registry/oauth/anthropic.ts:61`（`AbortSignal.timeout(30_000)`）、`:95-110`（hook 於非 login 階段仍可呼叫 bootstrap）、`:100`（hook 不傳 signal）；`src/registry/engine/refresh.ts:91-97`（`applyAfterExchange(..., {phase:"refresh", signal, ...})`）、`src/registry/engine/common.ts`（`applyAfterExchange` 直接呼叫 hook）。 |
| 最早已證壞 | **≤ 16.1.17**（探測下界）。16.1.17 無 lease 但已有 `DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 10_000`（:537），且 `refreshAnthropicToken` 每次都 `await resolveAccountIdentity(...)`→`fetchBootstrapIdentity`（`AbortSignal.timeout(30_000)`，:130）——同一形狀。 |
| 最後已證好 | **探測範圍內不存在**（16.1.17、16.4.0、16.4.2、17.0.0、17.3.0、18.0.0、18.0.11、18.1.18、18.2.3、18.2.10、18.3.0、18.3.3、18.4.0、18.4.1、18.4.4 皆壞）。hook 形態（`registry/oauth/anthropic.ts`）至少自 18.2.10 起即與 18.4.4 同 hash。 |

## 缺陷 2 — 呼叫者 abort 取消共享 token refresh / 毒化共享 waiter，輪替後遺失新權杖

| 項目 | 內容 |
|---|---|
| 舊版行為（18.4.1） | **壞**。`refresh()` → `#refreshSingleFlight(..., signal, ...)`，其中 `const promise = this.#refreshOAuthCredentialUnshared(provider, credential, credentialId, signal, reason)`——**發起呼叫者的 signal 被綁進存進 `#oauthCredentialRefreshInFlight` 的那個共享 promise**；`:453` 再 `return raceSignal(promise, signal, ...)`；`#refreshOAuthCredentialUnshared` 把 `options.signal` 交給 `refreshStored`（租約等待用），並在 refresh callback 用 `AbortSignal.any([signal, refreshSignal])` 串進 `#requestOAuthCredentialRefresh`（10s 上限 + abort listener）。⇒ 發起者一按 ESC，共享的 HTTP refresh 被 abort、所有共用同一 map entry 的 waiter 一起收 AbortError；若 provider 已輪替，新 refresh token 沒人保存。 |
| 新版行為（18.4.4） | **完全相同**（逐位元相同）。 |
| 上游/本機 | **上游**。 |
| 路徑/行（18.4.4=18.4.1） | `src/auth/refresh.ts:436`（unshared 呼叫帶 `signal`）、`:452-453`（存 map + `raceSignal(promise, signal)`）、`:476`（`AbortSignal.any([signal, refreshSignal])`）、`:456-479`（`#refreshOAuthCredentialUnshared`）、`:~555-575`（`#requestOAuthCredentialRefresh` 的 cancellation/10s/abort listener）。對照 18.4.4 的 `refresh()` 在 `:404-417`，0090 的 hunk header `@@ -413,10 +427,14 @@`、`@@ -427,7 +445,7 @@`、`@@ -450,7 +468,7 @@`、`@@ -468,12 +486,15 @@` 正是這些行。 |
| 最早已證壞 | **18.4.1**（邊界：18.4.0 好 → 18.4.1 壞）。 |
| 最後已證好 | **18.4.0**（也含 18.3.0/18.3.3/18.3.4，以及 18.2.10、18.1.18、18.0.11、17.0.0、16.4.2、16.1.17）。證據：這些版本一律是 `const promise = this.#refreshOAuthCredentialUnshared(provider, credential, credentialId).finally(...)`——**不帶 signal**（18.4.0:374、18.3.4:374、18.3.3:同、18.3.0:同、18.2.10:5586、18.2.3:5586、18.1.18/17.0.0/16.4.2/16.1.17:同形），呼叫者中止只 `raceCredentialRefreshWithSignal(existing, signal)` 解除自己，共享操作照常完成並落盤。⇒ 這是 18.4.1 的「單飛 + recent-mint（`#recentMints`/`OAUTH_REMINT_COOLDOWN_MS`/`refreshById(id, signal, options?)`）」重構引入的**回歸**，但**不是** 18.4.4 引入的。 |

## 缺陷 3 — 15s durable refresh lease 可在大於 15s 的事件迴圈停滯中過期，成功 CAS 丟掉剛鑄好的權杖

| 項目 | 內容 |
|---|---|
| 舊版行為（18.4.1） | **壞**。租約 TTL 15s，只有 5s 週期的背景 renewal（`Bun.sleep` 在同步停滯期間一樣被餓死）；成功 refresh 後**直接**進 `tryUpdateAuthCredentialIfMatches(..., {owner, nowMs})`，SQL 條件含 `EXISTS(SELECT 1 FROM auth_credential_refresh_leases WHERE credential_id=? AND owner=? AND expires_at_ms>?)`，租約一過期 → `changes=0` → 回 `refreshed:false`，剛輪替的權杖被丟棄（且 row 仍是舊 refresh token）。 |
| 新版行為（18.4.4） | **完全相同**。 |
| 上游/本機 | **上游**。 |
| 路徑/行 | `src/auth/refresh.ts:41`（`OAUTH_REFRESH_LEASE_TTL_MS = 15_000`）、`:43`（renew 週期 5s）、`:217-231`（renewal loop，`:224` `renewCredentialRefreshLease`）、`:300-315`（merged 後直接 `tryUpdateAuthCredentialIfMatches`，0090 hunk `@@ -300,6 +300,20 @@` 就是在此插入「先 renew 再 CAS」）；`src/auth/sqlite-credential-store.ts:423-441`（兩條 update 的租約 `EXISTS` 圍籬）、`:480-487`（acquire 只在 `expires_at_ms <= now` 時可奪）、`:492-494`+`:1683-1687`（renew 只認 owner）、`:1438-1476`（`tryUpdateAuthCredentialIfMatches(id, expectedData, credential, lease?)`）。 |
| 最早已證壞 | **16.4.2**（官方 16.4.2 `src/auth-storage.ts:616` 已有 `OAUTH_REFRESH_LEASE_TTL_MS = 15_000`、`:1924` acquire、`:1977-1981` renew loop）。 |
| 最後已證好 | **16.4.0**（無 lease API）。16.4.1 亦無（`tryAcquireCredentialRefreshLease`／`auth_credential_refresh_leases`／`OAUTH_REFRESH_LEASE` 皆 0 命中）⇒ 此缺陷類別隨 durable lease 一起誕生，非 18.x 引入。 |

---

# credential19（月度原始憑證到期）vs credential31（新憑證被失效）——source-only 可判定與不可判定

**可判定（source-only）**

1. `ANTHROPIC_OAUTH_GRANT_TTL_MS = 30d`，錨定互動登入的 `authorizedAt`，refresh **不延長**：`mergeRefreshedCredential` 用 `refreshed.authorizedAt ?? current.authorizedAt`，且 `mapCredentials` 的 optional 欄位清單不含 `authorizedAt`（`anthropic-constants.ts`、`engine/common.ts`）。所以「月度到期」有獨立的 30 天時鐘。
2. `isDefinitiveOAuthFailure` 只認 `/invalid_grant|invalid_token|unauthorized_client|\brevoked\b|refresh[\s_]?token.*expired/i`（`error/auth-classify.ts:12-14`、`error/flags.ts:294-295`）。**逾時、呼叫者中止、租約遺失都不落入 definitive**（transient pattern 反而含 `timeout`），因此缺陷 1/2/3 當下的錯誤**不會**立刻停用該 row——它只是丟掉已輪替的權杖位元組。
3. 但該 row 仍持有「已被 provider 作廢的舊 refresh token」；下一次 refresh 會拿舊 token 去換 → provider 回 `invalid_grant` → **同一條 definitive 路徑**把 row CAS 停用、`disabledCause = "oauth refresh failed: <provider 錯誤>"`。
4. ⇒ 兩種情境最終都會以 `invalid_grant` 停用形式出現，**不能靠錯誤字串或事故時間線推斷**。來源上可用的判別式只有：`authorizedAt + 30d`（月度）vs 停用時間戳與該視窗內是否存在本機遺失事件（逾時／abort／ownership lost，且 0090 之前這些訊息不會出現在 row 的 cause 裡，因為它們非 definitive）。**此判別必須由 live DB／telemetry 完成，超出本工作單（禁止存取憑證 DB），我未做也未推測。**

**不可判定（必須由 main 取得實據）**：credential19 是否真的是 30 天到期、credential31 是否真的是本三缺陷造成的「新鮮失效」，或反過來；以及哪一筆先發生。禁止從事故時間線反推。

---

# 方法與可信度標註

- 18.4.1／18.4.4 用**本機已下載的官方 tarball**：`/home/chris/.cache/omp-1841-upgrade/tgz-18.4.1/pi-ai.tgz`、`/home/chris/.cache/omp-oauth-refresh.ctKEdY/upstream/package`（18.4.4，SHA256 已由 main 對過 pinned）。18.4.1 的 tarball 內容與 unpkg 對 18.4.1 宣稱的 integrity 一致（`refresh.ts` = `MV3zC…`、`anthropic.ts` = `qyq+H…`）。
- 歷史版本用 **unpkg 提供之官方 npm 發行包原文**（`https://unpkg.com/@oh-my-pi/pi-ai@<ver>/src/...`），並以其 `?meta` 的 sha256 互校；**我沒有**把每個舊版的 sha512 對回 npm registry index（單一來源，標為 official-artifact/unpkg-served）。`--verify-rollups` 的六基線 oracle（18.0.9／18.1.14／18.2.3／18.2.10／18.3.3／18.4.1，`PATCHES.md:16`）可用於把上面探測範圍內的舊版換成本機已釘住的 tarball。
- 本機 vs 上游：grep `patches/`（模式 `src/auth/refresh\.ts|src/auth/pool\.ts|src/auth/store\.ts|registry/oauth/anthropic\.ts|src/auth-storage\.ts` 與 `a/src/auth/store\.ts|a/src/auth/sqlite-credential-store\.ts|a/src/auth/pool\.ts|a/src/registry/engine`）→ 只有 0026／0030／各版 `0030-*-candidate` 命中 `src/auth-storage.ts`，其餘 0 命中；`.18.4.4-candidates/0090…` 是唯一命中 refresh.ts／anthropic.ts 者。
- **未做**：任何 runtime／測試／格式化／建置；任何憑證 DB、憑證檔、真實 OAuth/HTTP 認證請求；未改任何檔案。

# 建議 main 可執行的重現（我不執行）

1. **既有閘門（18.4.4 現行壞樹 → 0090 好樹）**：`OMP_PATCH_VERIFY_AI_ROOT=<樹> bun patches/verify-oauth-durable-refresh.ts`；依 `PATCHES.md:1366` 它已覆蓋三條腿（refresh 不觸發 bootstrap、輪替後取消只拒絕該 waiter、>15 秒同步停滯不丟權杖）。紅→綠即坐實修復。
2. **證明「非 18.4.4 引入」**：把同一閘門指向 pristine 官方樹——18.4.4（`/home/chris/.cache/omp-oauth-refresh.ctKEdY/upstream/package`）與 18.4.1（解開 `tgz-18.4.1/pi-ai.tgz`）預期**紅得一模一樣**（兩檔逐位元相同）。注意閘門的樹完整性檢查要求 `AI_ROOT` 同時有 `src/auth-storage.ts` 與 `src/auth/refresh.ts`（`patches/verify-oauth-durable-refresh.ts:59-61`），故 ≤18.2.10 的純 `auth-storage.ts` 樹會 exit 2，需先補樹或改用 18.3.0+ 基線。
3. **定位缺陷 2 的引入點**：在 18.4.0（預期**綠**：呼叫者中止只解除自己）與 18.4.1（預期**紅**）之間對跑「輪替後取消」那一腿，即可把回歸釘在 18.4.1。
