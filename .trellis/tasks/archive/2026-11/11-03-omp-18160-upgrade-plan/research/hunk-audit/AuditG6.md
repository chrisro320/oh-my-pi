# Hunk audit — 0090 / 0092 / 0094 / 0095 / 0098 / 0099 / 0100 / 0101 (18.12.6 → 18.16.0 work tree)

Auditor: AuditG6. Read-only (no edits to `work/`, `fragments/`, `state.json`, `patches/`;
no builds, no gates, no git).

Sources: `patches/.18.12.6-families/<family>-v18.12.6.patch` (the `.18.16.0-families/*`
exports are stale and were ignored). Trees: `rebase/work`, `pristine-18.16.0`,
`pristine-18.12.6`, `rebase/old-work` (18.12.6+families). References: per-path accepted
fragments `rebase/fragments/<family>/<path>/{before,after,current,proposal}` and
`DECISIONS.md` §"OMP 18.16.0 upgrade plan".

## Method

1. Parsed each family patch by `--- a/<path>` + `@@`: **198 hunks over 8 families**
   (0090 128 / 0092 28 / 0094 12 / 0095 14 / 0098 2 / 0099 1 / 0100 8 / 0101 5).
2. Line pass: every added line must appear in `work/<path>` (whitespace-normalized) and
   every removed line must be gone. 150 of 198 hunks pass this outright and are only
   counted below.
3. The 48 failures were re-checked with whitespace-collapsed block matching, then read by
   hand against `work`, `pristine-18.16.0` and `old-work`. Both false-fail classes are
   common here: 18.16.0 reformatted/rewrote the same construct (0092/0094/0095), or the
   family's single-line JSON hunks were regenerated (`0100` `rules.json`/`models.json`,
   work's `models.json` is the interned `{version,keys,booleanShapes,nodes,compat,providers}`
   form). Correctness of the *port*, not textual identity, is what the verdicts below judge.
4. For every family except 0090, `work/<path>` is byte-identical to
   `fragments/<family>/<path>/after`; for 0090, 29 of 30 paths are identical and
   `pi-coding-agent/src/session/agent-session.ts` differs only because
   `family-usage-pipeline` also owns it (that repair landed in this file, verified below).

Scope note on the brief's "already-decided drops": none of them is a hunk of these eight
families. In particular "0090b keep Anthropic only" is **applied**, not dropped
(`DURABLE_EXCHANGE_PROVIDER = "anthropic"` `work/pi-ai/src/auth/refresh.ts:111`, the
`#mintsLocally()` gate at `:530`, the "Durable unknown-outcome protection is Anthropic-only"
comment block at `:792-795`, and the gate's non-Anthropic scenarios (n)/(v)/(z2) in
`patches/verify-oauth-durable-refresh.ts`). `decided-drop` appears exactly once below, and
for a different reason (`DECISIONS.md:699`).

## Result

| Family | Hunks | present | superseded | decided-drop | loss | loss? |
|---|---|---|---|---|---|---|
| 0090-omp-oauth-durable-refresh | 128 | 122 | 1 | 1 | 2 | 2 |
| 0092-omp-cache-warming-idle-budget | 28 | 28 | 0 | 0 | 0 | 0 |
| 0094-omp-anthropic-thinking-drop-resume | 12 | 12 | 0 | 0 | 0 | 0 |
| 0095-omp-context-audit-request-purpose | 14 | 14 | 0 | 0 | 0 | 0 |
| 0098-omp-tls-verify-transient-retry | 2 | 2 | 0 | 0 | 0 | 0 |
| 0099-omp-retry-slow-schedule | 1 | 1 | 0 | 0 | 0 | 0 |
| 0100-omp-stepfun-step-plan | 8 | 8 | 0 | 0 | 0 | 0 |
| 0101-omp-subagent-warm-revival-persisted-prompt | 5 | 5 | 0 | 0 | 0 | 0 |
| **total** | **198** | **192** | **1** | **1** | **2** | **2** |

Only 0090 has non-`present` hunks: six of its 128 (2 `loss`, 2 `loss?`, 1 `superseded`,
1 `decided-drop`), all in `pi-ai/src/auth/refresh.ts`. Four sit in the
`#refreshOAuthCredentialUnshared` → `#requestOAuthCredentialRefresh` tail
(work `:1439-1575`), one in the late-response staging window of `#exchangeLeased`
(work `:1100-1130`), and one is the deliberately kept `let refreshed` (work `:1643`).
Everything else in the family — the journal, the fenced unlock API, the projection
consumers and the 403 catalog retention — is present.

## Non-`present` hunks

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| 0090 | 1322 | `pi-ai/src/auth/refresh.ts` `@@ -559,7 +957,73 @@` | **loss** | The family replaces the non-leased tail of `#refreshOAuthCredentialUnshared` with a fail-closed broker-only path: `+ if (credential.refresh !== REMOTE_REFRESH_SENTINEL \|\| this.#mintsLocally()) throw new AIError.ConfigurationError("Local OAuth refresh requires durable exchange storage")`, then a `refreshAbort` owner with `OAUTH_REFRESH_OPERATION_TIMEOUT_MS`, an override-publication fenced by `expectedData`, and a store re-read. Work keeps 18.16.0's tail `return this.#requestOAuthCredentialRefresh(provider, credential, credentialId, signal, reason, DEFAULT_OAUTH_REFRESH_TIMEOUT_MS)` (`work:1493-1500`) and that function still races the exchange against a 10 s `Promise.withResolvers` cancellation (`work:1537-1566`). `"Local OAuth refresh requires durable exchange storage"` exists in work only inside the `hasRefreshLeases` branch (`work:805,808`). Nothing in 18.16.0 supersedes it: `pristine-18.16.0` has the same 10 s race. | On any credential store **without** refresh leases — a custom/in-memory/dev store, not the sqlite store (always leases) nor the broker store (rows carry `REMOTE_REFRESH_SENTINEL`, so `localExchange` is false) — a local Anthropic mint is still admitted without a journal. If the provider answers after the 10 s timer, the caller gets a timeout and the rotated refresh token is dropped: the row keeps the spent token, the next resolve replays it, and the account needs a fresh login instead of surfacing "requires durable exchange storage". Gate: **not covered** — `patches/verify-oauth-durable-refresh.ts` never asserts this refusal (string absent from the file). |
| 0090 | 1277 | `pi-ai/src/auth/refresh.ts` `@@ -490,11 +885,11 @@` | **loss** (caller-cancellation half is present; fail-closed half is not) | The family (a) stopped racing a joined waiter — present: `const joined = await existing;` `work:1401` — and (b) turned a missing stored id into a hard error: `+ throw new AIError.ConfigurationError("OAuth refresh requires a stored credential id")`, while its `#refreshOAuthCredentialUnshared` signature became `credentialId: number`. Work took the tightened signature (`work:1466-1470`, `credentialId: number`) but kept 18.16.0's fall-through `if (credentialId === undefined) return this.#refreshOAuthCredentialUnshared(provider, credential, undefined, ...)` (`work:1412-1421`; pristine's signature was `number \| undefined`). The refusal string has no match in `work/pi-ai/src`, so `work` also carries an ill-typed call (`undefined` into a `number` parameter) — the accepted tree would not pass `tsc --noEmit`, it only runs because Bun strips types. | Reachable from `select.ts:1129/1145`, which refresh a pool/in-memory credential that has no store row (the family's own hunk `@@ -1112,16 +1102,13 @@` tests exactly that `credentialId === undefined` case, and it is `present`). With no id, work skips the durable path entirely (`if (credentialId !== undefined && hasRefreshLeases …)`, `work:1469`) and mints through the 10 s race: the new token is returned but never persisted, so the rotated refresh token is lost and the next resolve replays the old one → forced re-login, instead of a clear `requires a stored credential id` error before any token is spent. Gate: **not covered** (`requires a stored credential id` absent from `patches/verify-oauth-durable-refresh.ts`). |
| 0090 | 1075 | `pi-ai/src/auth/refresh.ts` `@@ -308,19 +611,55 @@` | **loss?** | The family attaches staging to the provider promise, so it also runs when the owner stops waiting: `options.refresh(current, refreshAbort.signal).then(refreshed => { …merge…; if (localExchange && exchangeStore) { this.#unstagedResults.set(…) ; // "This continuation also retains a late response after the owner timeout. It stages only; a current lease owner must publish it." ; exchangeStore.stageCredentialRefreshResult(…); … } })` then `raceSignal(exchange, …)` — `old-work…/refresh.ts:635-648`. Work merged this into the 18.16.0 shape and stages **only after** the race resolves: `const refreshed = await Promise.race([options.refresh(current, refreshAbort.signal), backstopReached.promise]); … this.#unstagedResults.set(…); exchangeJournal.stageCredentialRefreshResult(…); this.#unstagedResults.delete(…)` (`work:1106-1124`), where `backstopReached` is armed at `OAUTH_REFRESH_EXCHANGE_BACKSTOP_MS` = 60 s (`work:1065-1080`, backstop constant `:72`). | A minted token that lands **after** the 60 s backstop is discarded instead of staged: the journal keeps a `pending` generation with no replacement, so every later refresh reports "OAuth refresh outcome is unresolved … recovery or sign-in is required" and `/auth-unlock` can only re-send an already-consumed refresh token → re-login. Not `loss` outright because the practically relevant case (a **caller-budget** timeout) is safe: the exchange promise is tracked (`work:930-944`) and continues past `Promise.race([exchange, budget.promise])` (`work:951`), so it still stages; the gate scenario "known result arriving after owner timeout is published without another exchange" (`verify-oauth-durable-refresh.ts:1924-1950`) and "(k) a timed-out attempt's late result is published without another exchange" (`:2888-2916`) therefore exercise only the covered path and will not fail on this gap. No gate asserts the post-backstop window. |
| 0090 | 1168 | `pi-ai/src/auth/refresh.ts` `@@ -361,30 +722,56 @@` | **loss?** (lease-renew + commit half present; the refusal verdict is not) | The lease-renewal/acquisition-before-CAS, `commitCredentialRefreshResult` fenced publish, and `tryUpdateAuthCredentialIfMatches` fallback are all present (`work:1040-1260`, `#persistExchangedCredential` `work:365-434`). Missing is the family's explicit unpublishable-mint verdict for unlock callers: `+ return this.#withUnlock(…, "failed", "the minted result could not be published; the credential row changed")`. Work's `#persistExchangedCredential` only logs and returns `false` (`work:365-434`, `logger.warn("OAuth exchanged token not saved")`), and `could not be published` has no match in `work/pi-ai/src`. | An `/auth-unlock` whose freshly minted token cannot be published (row replaced or lease lost between stage and commit) is reported as `nothing-to-unlock`/generic failure through the `result.unlock ?? { outcome: "nothing-to-unlock" }` fallback (`work:628-631`) rather than "failed: the minted result could not be published; the credential row changed". The user is told there is nothing to fix while the generation stays unresolved and the minted token is only recoverable in memory. Gate: partially covered — scenario (l)/(s) assert refusal *classes*, not this message/outcome. |
| 0090 | 1405 | `pi-ai/src/auth/refresh.ts` `@@ -591,35 +1056,9 @@` | **superseded** | The family removed the `Promise.withResolvers` cancellation + `abort` listener from `#requestOAuthCredentialRefresh` and returned `refreshPromise` ("Never discard a late result here before that owner can stage or adopt its complete winning row"). Work still contains it (`work:1537-1566`, `return await Promise.race([refreshPromise, cancellation.promise]);` `:1561`), but 18.16.0 reached the same contract by a parameter: pristine `refresh.ts:1081-1084` already carries `// Stop awaiting after \`timeoutMs\` or on \`signal\`. Leased exchanges pass no timeout: \`refreshStored\` stops its caller waiting without dropping the result, and only its backstop signal ends the exchange itself.` with the same race, and work's leased caller passes `undefined` (`work:1459-1466`). The caller's own wait is bounded one level up by `raceSignal(…, signal, "credential refresh aborted")` (`work:1381`). | None on its own: for leased exchanges the inner race only reacts to the same 60 s backstop the outer `#exchangeLeased` already reacts to. Its residual effect is row `@@ -308`-adjacent (the discarded late result), which is reported there and must not be double-counted. |
| 0090 | 1452 | `pi-ai/src/auth/refresh.ts` `@@ -675,9 +1115,8 @@` | **decided-drop** | The family deleted `let refreshed: OAuthCredentials;` and used a bare `await this.#refreshSingleFlight(...)`. Work keeps the declaration and assignment (`work:1643-1651`) while the hunk's actual semantic — re-read the authoritative row instead of consuming the return value — is present (`// Every selected refresh operation publishes or adopts its winning row. No consumer may merge pre-await metadata or persist the result again.` + row re-read, `work:1679-1686`). Keeping `let refreshed` is the deliberate decision recorded in `DECISIONS.md:699` ("the accepted `refresh.ts` dropped pristine's `let refreshed: OAuthCredentials;` … restored by amend"), because 18.16.0's body uses it. | None (dead local only). Recorded because the brief describes this hunk as just restored: it *is* restored in `work`, as pristine's declaration, i.e. the family hunk's deletion stays dropped by decision. |

### Present but re-expressed (recorded so they are not re-opened)

0090 `refresh.ts`, all verified in `work`:

- `@@ -6,7 +6,12 @@` / `@@ -14,8 +19,13 @@` (imports incl. `hasRefreshExchanges`, unlock type names) — `work:9-37`.
- `@@ -155,11 +178,15 @@` and `@@ -174,10 +201,141 @@` (`#trackRefresh` / `#refreshStoredOwned` / `#performStoredRefresh`, plus
  `inspectUnresolvedRefresh` / `unlockAndRefreshStored`) — same behaviour under 18.16.0's
  names: `#track` + `#refreshStored` (`work:445-470`), `inspectUnresolvedRefresh`
  (`work:525-580`), `unlockAndRefreshStored` (`work:582-635`), and the shutdown drain is
  the family's `while (this.#pendingRefreshes.size > 0)` loop (`work:484-488`).
- `@@ -185,6 +343,14 @@` … `@@ -394,7 +781,10 @@` (every `withUnlock` return: nothing-to-unlock,
  peer-lease refusal for an explicit unlock, fence-mismatch / row-changed / unresolved
  refusals, `staged-result-recovered` vs `refreshed`) — present as the private `#withUnlock`
  method (`work:342`) plus 16 guarded returns (`work:664-899`). The three early returns in
  the pre-lease loop are unwrapped (`work:683-690`), which is equivalent: the verdict then
  falls back to `nothing-to-unlock` in `unlockAndRefreshStored` (`work:628-631`), and
  `inspectUnresolvedRefresh` refuses to reach them for an unlock caller.
- `@@ -262,19 +438,146 @@` (`DURABLE_EXCHANGE_PROVIDER` gating, staged-result persistence before any release,
  fenced release outcomes, `reserveCredentialRefreshExchange`, the non-journal
  "adopt a legacy staged replacement read-only" migration) — `work:787-905`.
- `@@ -349,7 +688,29 @@` (broker revalidation after a failed operation, "never keep a stale mirror when its
  authority cannot be read") — `work:1136-1148`.
- `@@ -471,15 +861,20 @@` and `@@ -509,24 +904,27 @@` (`refresh()` races only its own wait;
  `#refreshSingleFlight` returns the tracked promise unraced; the family comment "Share the
  durable operation, never an individual waiter's cancellation") — `work:1373-1386`,
  `:1388-1448`.
- `@@ -694,17 +1133,13 @@` (row re-read instead of the merged return) — `work:1679-1686`.

Other paths of 0090 (all present): `remote-store.ts` (`tryDisableAuthCredentialIfMatches`
implementation removed — absent from the file — and `refreshOAuthCredential` returns the
snapshot row / throws "was removed during refresh", `work:1290-1315`); `health.ts:343-360`
and `usage.ts:196-230` re-read the stored row via `buildUsageCredential` instead of merging
(`mergeRefreshedUsageCredential` / `persistRefreshedCredential` are gone);
`pool.ts` `reload()` no longer prunes duplicates (`work:298-307`; `pruneDuplicates` survives
only for explicit writes); `select.ts:849-853`, `:1156-1160` (`#syncOAuthSelectionFromStore`);
`sqlite-credential-store.ts` journal (`reserve`/`stage`/`commit`/`inspect`/`read`/`release`
`work:1883-2000`, `#backfillCredentialIdentityKeys` deleted);
`store.ts` type + `hasRefreshExchanges` (`work:148-380`); `types.ts` unlock types;
`engine/refresh.ts` (`applyUserinfo` dropped, `accountId`/`email` carry-over `work:89-90`);
`registry/oauth/anthropic.ts:91-96`, `factory-droid.ts`, `snowflake.ts` (`throwIfAborted`
now guarded by `kind === "token-exchange"`, `work:28,42,50`);
`pi-catalog` `model-manager.ts:528-532` (`fetcher(previous)`) and
`provider-models/google.ts:109-215` / `special.ts:70-160` (`retainedAccountCatalog` on 403,
all-or-none `accountAccess` stripping);
`pi-coding-agent/cli/auth-broker-cli.ts`; `session/agent-session.ts:9205-9232`
(`inspectUnresolvedRefresh` before the missing-credential error, plus the
fallback-model warning; `/auth-unlock` itself ships as the out-of-tree
`patches/auth-unlock-extension.ts`, which is why nothing in the repo registers it);
`pi-tui/overlays/mcp-add-wizard.ts` (`#cancelWizard`, `#closed`, `#attempt++`, `work:723-729`
and all five call sites) — 15 hunks;
all `dist/types/*.d.ts` mirrors (`CacheWarmingResultEvent`-style supersets aside).

**0092** (28/28 present): `IDLE_WARMING_AGE_ENV`/`idleWarmingAgeMs`
(`cache-warmer.ts:65-79`), `PARKED_POLL_MS`/`#parked`/`#park`/`#pollParked`/`#resumeParked`/
`#dropParked` (`:288-620`), `touchedAt` anchoring, `#report` + the three call sites
(`:527-550`, `:707`, `:716`, `:726`), `CacheWarmingResultEvent` + `on("cache_warming_result")`
in both `src/extensibility/*` and `dist/types/*`, and `report: event => void
extensionRunner.emit(event).catch(() => undefined)` (`sdk.ts:4780`). The one line-level
failure (`dist/types/extensibility/extensions/types.d.ts` `ExtensionEvent` union) is a
superset line in work (`dist …:1329` contains `CacheWarmingResultEvent`), and
`IDLE_WARMING_AGE_ENV` is declared in `dist/…/cache-warmer.d.ts:42`.

**0094** (12/12 present): `ProviderDroppedThinkingReplay` (`src/types.ts:1225`, `dist/types/types.d.ts:980`),
`droppedThinkingReplay?` on the assistant message (`src/types.ts:1407`), `readDroppedThinkingReplay`
(`anthropic.ts:518`), `restorePrefixDroppedThinking` (`:541-556`) called before the request
(`:1989`), `rememberPrefixBindingFailure` with the `(params, message, state, output, scope)`
signature returning `boolean` and writing `output.droppedThinkingReplay` (`:1678-1725`), the
old `rememberPrefixDroppedThinking` gone, the `replayEndpoint` line (`:1979`) and the
"`droppedThinkingReplay` is deliberately NOT reset" comment inside the retry reset block
(`:3400-3403`). The ported comment `/** Thinking replay keys in the assistant turn … */`
keeps its body (`:1728`).

**0095** (14/14 present): `purpose: "turn" | "side-request"` on `ContextEvent`
(`shared-events.ts:197`), the runner signature + event construction
(`extensibility/extensions/runner.ts:2291`, `:2317`), the hooks runner pinning `"turn"`
(`hooks/runner.ts:383`), `transformContext` third parameter through `sdk.ts:4609-4614` and
`agent-session-types.ts`, and the side-request tag on the provider boundary host
(`agent-session.ts:2571`) — the 18.12.6 `streamFn` host became 18.16.0's
`SessionProviderBoundary`, and `#transformContext` is not tagged anywhere else.

**0098** (2/2): `TRANSIENT_TLS_VERIFY_PATTERN` (`flags.ts:592`) and its use in
`isTransientErrorText` (`:601`). **0099** (1/1): `RETRY_DELAY_SCHEDULE_MS` +
`calculateRetryBackoffDelayMs(_baseDelayMs, attempt)` (`retry-fallback-chains.ts:94-99`);
all three call sites still pass `baseDelayMs` and are unaffected
(`session-advisors.ts:238`, `turn-recovery.ts:2703`, `:2765`).

**0100** (8/8): the two single-line JSON hunks are regeneration artifacts and both are
carried by work — `rules.json` stepfun `providers`/`auth` entries use
`https://api.stepfun.ai/step_plan/v1` and `models.json` has `step_plan` ×1 with **zero**
`api.stepfun.ai/v1` (pristine 18.16.0: 0 `step_plan`, 1 `/v1`; work is pristine ± exactly the
KDL-caused fields, as `DECISIONS.md:697` describes). The `.kdl`, `openai-compat.ts` and
`dist/types` hunks are line-identical.

**0101** (5/5): `extractSessionInit` import (`executor.ts:82`), the verbatim-prompt comment +
`const init = extractSessionInit(reopened.getEntries())` (`:4177`), the conditional
`systemPrompt: () => [...init.systemPrompt]` (`:4207`), `setWorkPoolYieldItems(init.workPoolYieldItems)`
(`:4234`), and the blank line before `AgentRegistry.global().syncSessionStatus` (`:4256`).

## Notes for the plan owner

1. **The "just restored" refresh.ts hunks are in `work`** — but not the two the brief
   names. `work/pi-ai/src/auth/refresh.ts` is byte-identical to
   `fragments/0090-omp-oauth-durable-refresh/pi-ai/src/auth/refresh.ts/after` (both
   mtime 07:45), so what is in `work` is exactly the accepted fragment:
   - restored: `refresh()` leaf race only (`:1381`), unraced joined waiter (`:1401`),
     unraced tail (`:1446`), `let refreshed` present (`:1643`) — matches `DECISIONS.md:699-700`;
   - **not** restored: the `#requestOAuthCredentialRefresh` withResolvers race (`:1537-1566`)
     and the family's durable-storage refusal (`:1493-1500`). Both are reported above, the
     first as `superseded`, the second as `loss`.
2. **No existing P0 gate covers the two `loss` rows.** `patches/verify-oauth-durable-refresh.ts`
   (a)-(s) + `verify-oauth-unlock-fence-faults.sh` (p)/(q)/(s)/(t)/(z2) +
   `verify-auth-unlock-extension.ts` cover inspect/unlock/fence/scope/late-result-after-
   *caller-budget*. None of them asserts the family's "Local OAuth refresh requires durable
   exchange storage" / "OAuth refresh requires a stored credential id" / "the minted result
   could not be published" strings — those three occur only inside the family patch files
   themselves, in no `patches/verify-*` — and no scenario covers staging after the 60 s
   `OAUTH_REFRESH_EXCHANGE_BACKSTOP_MS`. A gate addition is needed if these are to ship
   fixed; the `loss?` rows would need new negative controls, not just re-runs.
3. 0092's idle-horizon/`/cron` coupling has no consumer in this repo (the extension that
   sets `PI_CACHE_WARMING_IDLE_MAX_MS` lives outside the tree), so presence of the warmer
   half is all that can be audited here; `DECISIONS.md:690` records the `/cron` decision.
4. 0094's second durable-write path is intentionally absent: the "latest assistant turn
   rejected as modified" retry only adds to the session set (`anthropic.ts:3421-3437`) and
   writes no `droppedThinkingReplay`, exactly as the family's doc comment states
   ("Server drop_block reports … never call this path"). Not a loss.
