# Slice Compaction — 18.4.1 補丁遷移（含 review 後修正）

## 0. 執行通道
`slice_run` 未掛載（`read xd://slice_run` → `No such tool`），依 Main 的 EXEC CHANNEL DECISION 用 `bash(name=…)` + 每條命令 `source /home/chris/.cache/omp-1841-upgrade/Compaction/env.sh`。

## 1. 逐層結果

| layer | class | candidate | size | EMIT / replay |
|---|---|---|---|---|
| 0035 compaction-prefix-rollup | **A** | `patches/.18.4.1-candidates/0035-…-candidate.patch`（11 檔、24+3 hunks 全保留） | 44,427 → 44,292 B | `EMIT OK`；`APPLIED` |
| 0031 agent-session-providers-forward | **A** | `…0031-…-candidate.patch`（2 檔） | 2,744 → 2,762 B | `EMIT OK`；`APPLIED` |
| 0066 anthropic-native-compaction-live-context | **A** | 未修改（0 byte） | 5,873 B | 無需 port；`APPLIED`（fuzz=0） |
| 0067 remote-compaction-lane-trace-live-tools | **A** | 未修改 | 6,957 B | `APPLIED` |
| 0068 codex-stale-baseline-chain | **A** | 未修改 | 15,185 B | `APPLIED` |
| 0070 codex-compaction-chain-fail-closed | **B**（含 C 子元素） | `…0070-…-candidate.patch`（8 檔；17→19、9→10、2→3 hunks） | 69,293 → **73,524 B**（1587 行） | `EMIT OK`；`APPLIED` |

0066/0067/0068 未經 `emit`：`emit` 在 before/after 相同時設計上回 `empty diff: nothing to emit`；三者以 18.3.3 位元組在 18.4.1 上 fuzz=0 乾淨落層（driver `APPLIED`），即 EMIT OK 的等價證據。

## 2. 必要改動（file:line）

**0035（A）** 唯一 drift：18.4.0 telemetry 命名 `pi.*`→`omp.*`（`pi-agent-core/CHANGELOG.md` 18.4.0）落在 `pi-agent-core/src/compaction/compaction.ts` SummaryOptions doc comment（≈681-684，hunk#5 @688）與 `pi-agent-core/dist/types/compaction/compaction.d.ts:183-186`（hunk#2 @184）。只重錨該行 context。

**0031（A）** 唯一 drift：18.4.1 `pi-coding-agent/dist/types/session/agent-session.d.ts:17` 的 type-import 行新增 `Context`。修法＝把 `Provider,` 插進 18.4.1 的行。能力未被接管：18.4.1 `modes/status-line-host.ts:57` 已把 `providers` 傳進 `session.fetchUsageReports?.(signal, providers)`，但 `AgentSession` 端仍只有單參數。

**0070（B；C 子元素）** 原始 port 的三處：
1. `session-maintenance.ts:60-64`：18.4.1 的 `@oh-my-pi/pi-utils` import 多了 `prompt` → context 重錨。
2. `session-maintenance.ts:2100/2182`：18.4.1 改為 `resolveSpeculationMethod(model, settings, { skipRemote: this.#nativeSpeculationFailed(model) })`（`compaction-methods.ts:118-160`，#13478）。0070 的 guard 謂詞接到新形狀。
3. `compaction-v2-streaming.ts` 終結 frame 分支：18.4.1 自帶 standalone `error` 分支（#13502，C 子元素），但只在帶 `status` 時丟 `AIError.ProviderHttpError`，無法同時表達 chain verdict → port 成 typed `CompactionV2StreamFailure`（code + chainLost + **status**）。

### review 後的兩項 MAJOR 修正

**(1) status 不得先於 auth**（`compaction-v2-streaming.ts:819-845`）。修後順序：`chainLost` → permanent code → `AIError.classify` AuthFailed → `status` → Transient → `isRetryableCodexFailureEvent`。
敏感度（修正前的 0070 candidate，實跑）：
```
[Uncaught Exception] AssertionError: auth failure must not consume the V2 retry budget
3 !== 1   at patches/verify-codex-compaction-chain-fail-closed.ts:173
EXIT=1
```
修正後同一 gate：`verify-codex-compaction-chain-fail-closed: transport, retry, metadata and public types PASS`（EXIT=0）。gate 新增案例 `{type:'error',status:503,code:'auth_unavailable',message:'No available accounts'}`（斷言 code 保留、非 chain-lost、只送 1 次）；faults 新增 `PASS fault: status outranks auth`（把 status 判斷移回 auth 之前即可讓 gate 變紅）。

**(2) speculation guard 要用 effective lane 謂詞**。於 `pi-agent-core/src/compaction/compaction-v2-streaming.ts:132-143` 匯出
```ts
export function isCodexCompactionV2Lane(model: Model): boolean {
	return compactionV2Api(model) === "openai-codex-responses" || model.provider === "openai-codex";
}
```
並讓 (a) endpoint 解析（同檔 114）、(b) transport guard（同檔 307）、(c) `session-maintenance.ts:2111/2194` 兩個 speculation guard 全部改用它；`pi-agent-core/dist/types/compaction/compaction-v2-streaming.d.ts:54-55` 同步宣告。非 Codex 行為不變。
gate 新增兩種 alternate lane（版本限定 `aiVersion === "18.4.1"`，避免破壞 18.1.18/18.2.x/18.3.3 的同一份 gate）：
- `api:'openai-responses'` + `remoteCompaction.api:'openai-codex-responses'` + `v2StreamingEnabled`：斷言 `isCodexCompactionV2Lane(model) === true`、transport 在 0 次 HTTP 前丟 `CodexCompactionChainLostError`。
- `provider:'openai-codex'` + `api:'openai-responses'`：同上。
- 兩個 guard 的接線以來源斷言綁住（`session-maintenance.ts` 內必須出現 `isCodexCompactionV2Lane(model)` 的兩個 guard 呼叫）。
敏感度：把 guard 暫時改回 `model.api === "openai-codex-responses"`（predicate 仍在）→
```
[Uncaught Exception] AssertionError: speculation start guard must consult the effective Codex lane predicate
  at patches/verify-codex-compaction-chain-fail-closed.ts:222
GATE_EXIT=1
```
還原後 → `verify-codex-compaction-chain-fail-closed: transport, retry, metadata and public types PASS`（EXIT=0）。faults 新增 `PASS fault: narrow speculation lane predicate`（把謂詞縮回 `model.api` 才讓 gate 變紅 → `effective Codex lane must be recognized`）。

## 3. Gates（48/48 全綠樹，14/14 EXIT=0）

| gate | 輸出 |
|---|---|
| verify-prefix-cache-compaction.ts | `PASS prefix-cache compaction: structured=1 flat=1 windows=12` |
| verify-supersede-warm-prefix-guard.ts | `=== supersede warm-prefix guard OK ===` |
| verify-snapcompact-frame-reprice.ts | `PASS: selected source carries the reprice; 5024 ceiling rejects the reduction, shape repricing admits it` |
| verify-snapcompact-reduction-baseline.ts | `PASS: live source credits the superseded archive and reprices it; recorded rejection (projected 114693 >= baseline 77402) flips to accept (baseline 167232)` |
| verify-resume-cache-breakpoint.ts | `PASS resume-cache-breakpoint: stays within Anthropic's 4-breakpoint cap` |
| verify-codex-compaction-chain.ts | `verify-codex-compaction-chain: live baseline reuse + lite-off wiring hold` |
| verify-anthropic-native-compaction-live-context.ts | `PASS anthropic native compaction live context: scopes=live messages=3 tools=1` |
| verify-compaction-lane-trace.ts | `PASS compaction lane trace: codex-v2 live tools + trace, openai-v1 trace, anthropic-native trace` |
| verify-codex-compaction-chain-fail-closed.ts | `verify-codex-compaction-chain-fail-closed: transport, retry, metadata and public types PASS` |
| bash …-fail-closed-faults.sh | `PASS fault: status outranks auth` / `PASS fault: narrow speculation lane predicate` … `verify-codex-compaction-chain-fail-closed faults: 18 behavioral/type faults rejected` |
| verify-codex-effort-resume.ts | `PASS Codex effort: transport persistence, JSONL resume, branch isolation, immutable history, rewrite/compaction reset, legacy/provider/model boundaries` |
| verify-hindsight-recall-promotion-slot.ts | `verify-hindsight-recall-promotion-slot: ok` |
| verify-eval-state-context-persist.ts | `PASS eval state context persist: resume wire-equal, read-only snapshots write nothing, state change appends once` |
| verify-idle-ephemeral-reservation.ts | `idle ephemeral reservation verification: ok (18.4.1)` |

## 4. Sensitivity 總表

| 目標 | 手段 | 結果 |
|---|---|---|
| 0035 | `replay --before 0035`（applied=5 failed=0） | `TypeError: sharesActivePromptCacheIdentity is not a function … verify-prefix-cache-compaction.ts:84` EXIT=1；補上 PASS |
| 0066 | `--before 0066`（applied=33 failed=0） | `AssertionError: native lane must request the "live" scope (saw: <none>)`（:192）EXIT=1；補上 PASS |
| 0070（層缺席） | `--before 0070`（applied=37 failed=0） | `Missing expected rejection: v2Endpoint: Codex endpoint override must fail closed` EXIT=1（gate 與 faults 皆紅）；補上 PASS |
| 0070（status precedence） | 修正前 candidate | `AssertionError: auth failure must not consume the V2 retry budget — 3 !== 1` EXIT=1 |
| 0070（guard 接線） | guard 暫改回 `model.api` | `AssertionError: speculation start guard must consult the effective Codex lane predicate` EXIT=1 |
| 0070（謂詞行為） | faults 的 isolated-copy 變異 | `PASS fault: narrow speculation lane predicate` |

## 5. 下游與全鏈

```
APPLIED  0036 0045 0046 0048 0060 0062 0063 0069 0075 0076   （十層全部 APPLIED）
SUMMARY applied=48 failed=0
```
`0082` 仍 `APPLIED`；我的編輯只落在 0070 既有檔案集（`compaction-v2-streaming.ts`/`.d.ts`、`session-maintenance.ts`），未碰 `compaction.ts`、`compaction.d.ts`、`session-advisors.ts`。

## 6. Prefix / request-prefix 影響（逐層）

| layer | 影響前綴？ | 元素 |
|---|---|---|
| 0035 | 是 | 壓縮請求的 system/tools/messages 前綴、被摘要 vs 保留邊界、持久化 summary 文字（身分可證才用 live 前綴，否則退回手拼） |
| 0031 | 否 | 僅 `/usage` side request 的 provider 過濾 |
| 0066 | 是（最關鍵） | native compaction 的 system/tools/messages＋保留尾端切點；`live` scope 用 `host.agent.state.messages.slice()` 以免 host-only entry 造成 live/disk 分叉 |
| 0067 | 是 | Codex V2 lane 的 tools/system 取自 live context；另寫 trace JSONL（非 session 內容） |
| 0068 | 是（連鏈語意） | 禁止把已死 baseline 的鏈式幀發上新 socket（否則 400→全量重播→cachedInputTokens 0） |
| 0070 | 是（不降級＋連鏈內容） | 只准續鏈、不靜默全量重放；recovery 用 `generate:false` 且不持久化 ephemeral 注入 |

## 7. Native compaction speculation（含 review 後的謂詞修正）

- 算什麼：`session-maintenance.ts:2216-2276`（branch snapshot → `prepareCompaction` → `#compactWithFallbackModel(…, {sessionId: ':spec:'+Snowflake, preferWebsockets:false})` → `run.armed`）。
- 何時 commit：只經 `#claimArmedSpeculation`（2374-2400，由真正的 compaction 路徑 4408 呼叫），驗證在 `#armedSpeculationValid`（2304-2370：snapshot leaf 仍在 active path、其後無 compaction/reset boundary、native preserve data 仍可重用；branch 長過 snapshot 時投影需落在 recovery band 且嚴格小於 stored tokens）。
- 「speculative soft summary 能否帶不同 retained tail/prefix 被 commit」→ **可以且是設計**（armed 的 `firstKeptEntryId` 是 snapshot 切點）；但**不造成 live vs disk 分叉**：`#commitCompactionEntry`→`appendCompaction`（2398-2410）先持久化，才 `agent.replaceMessages` + `rebaseAfterCompaction`（2432-2436；4254-4257）。→ 非 D。
- 0035 不變量成立：speculation 路徑不傳 `buildCachePreservingContext`（只有 manual 3565、auto 5008、advisor `session-advisors.ts:2214` 傳），live 前綴只在身分可證時回傳。
- 0066 不變量成立：native lane 取 `live` scope（`compaction.ts:2121-2145`）；speculation 未傳 builder → 退回 `remoteSystemPrompt`/`tools` fallback，不會拿 spec session 冒充主 session。
- 0070 不變量成立：Codex chain-only lane 連 remote speculation 都不會起（現用 `isCodexCompactionV2Lane`，涵蓋 `remoteCompaction.api` 與 `provider === "openai-codex"`）。

## 8. Upstream overlap（file:line）

- `pi-agent-core/CHANGELOG.md` 18.4.0 telemetry `pi.*`→`omp.*` → 0035（A）。
- `pi-coding-agent/CHANGELOG.md:23` #13478 + `session-maintenance.ts:2100/2182` + `compaction-methods.ts:118-160` → 0070（B）。
- `pi-agent-core/CHANGELOG.md` 18.4.1 #13502（V2 standalone `error` surfacing）+ `compaction-v2-streaming.ts:687-695` → 0070 的 **C 子元素**；仍不可退役：upstream 對 `previous_response_not_found` 的 error frame 不會重建鏈重試，而 0070/gate 要求可重建（`stale`/`stale-once` 場景）。
- `pi-agent-core/CHANGELOG.md` 18.4.1 #13502（native remote compaction fail fast）+ `openai.ts:249-259`、`compaction.ts:1752`、`openai.ts:821`：以 `Flag.ContextOverflow` 標記，`session-maintenance.ts:5075` 的 `!AIError.is(id, Flag.ContextOverflow)` 因而跳過重試並前進下一方法 → 與 0070 同向。
- `pi-coding-agent/CHANGELOG.md:30` #13235（scrollback 顯示）+ `ui-helpers.ts:882/925/991`、`interactive-mode.ts:3233` → 純顯示（Display slice）。
- `pi-coding-agent/CHANGELOG.md:68` #13212（subagent mid-run）+ `task/executor.ts:1093-1101` → 不影響我的層。
- 18.4.0「Anthropic requests failing after native compaction when context notes enabled」：18.4.1 以 generation 戳記管理 reminder（`session/agent-session.ts:754/1787-1799/2100-2102/5547-5548`）；**是否為 18.4.x 新修 = [INFERENCE]**（沙箱無 18.3.3 官方源碼）。
- 18.4.1 #13104（directory-specific prompt sections 移到 static system prompt 之後）＝ **直接改變 system prompt 排列（prefix bytes）**，不在我的檔案；提醒首次升級會有一次 cache 重建。

## 9. 未關閉風險

1. 新 gate 的 alt-lane 斷言與 0070 的 predicate 只存在於 18.4.1 candidate，故版本限定 `aiVersion === "18.4.1"`；18.1.18/18.2.3/18.2.10/18.3.3 仍跑共同斷言（auth-status 案例對所有版本成立）。
2. `compactionV2Api` 與 `shouldUseCodexProviderTransport` 仍是 pi-agent-core 私有；若未來另一處要判斷 lane，應再匯出，勿再複製運算式。
3. 0066 live scope 的 `agent.state.messages.slice()` 與持久化內容等價性僅由 `verify-eval-state-context-persist.ts` 的 resume wire-equal 覆蓋，未在真實 provider 量測。
4. 我沒有 18.3.3 官方源碼可 diff，部分「upstream 新增」判定來自 CHANGELOG + candidate a-side 與 pristine 差異（已標 [INFERENCE]）。

## 10. 我改動的 repository 檔案（5 個）

- `patches/.18.4.1-candidates/0035-omp-compaction-prefix-rollup-v18.4.1-candidate.patch`
- `patches/.18.4.1-candidates/0031-omp-agent-session-providers-forward-v18.4.1-candidate.patch`
- `patches/.18.4.1-candidates/0070-omp-codex-compaction-chain-fail-closed-v18.4.1-candidate.patch`
- `patches/verify-codex-compaction-chain-fail-closed.ts`（新增 auth-status 案例、alternate-lane 案例、guard 接線斷言、`AGENT_ROOT`）
- `patches/verify-codex-compaction-chain-fail-closed-faults.sh`（新增兩個 18.4.1 版本限定的 fault）

未動：`apply.sh`、`PATCHES.md`、`0082`、`0066/0067/0068`、`compaction.ts`/`compaction.d.ts`/`session-advisors.ts`、其他 slice 的 candidate、`.18.3.3-candidates/`。沙箱樹保留 48/48 狀態供重跑；throwaway 腳本（splitpatch/filterpatch/gates.sh/scratch patch/pristine 抽取/replay JSON/backup 檔）已全數刪除；repo 與沙箱皆無 `.orig`/`.rej`。
