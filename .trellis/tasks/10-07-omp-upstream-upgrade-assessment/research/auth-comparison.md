# Parent review notes (authoritative qualifications)

- Retain 0090's added durability protections; do not read the report's opening "none of seven" as absence of all auth safeguards. Its matrix correctly records that pre-ownership abort, CAS and invalid-grant handling partly pre-existed upstream.
- `AUTH_SCHEMA_VERSION=8` and unchanged lease DDL are static compatibility evidence only. The report's "no compatibility gate needed" conclusion is rejected: a private SQLite reopen/rollback rehearsal is still required. No live DB was inspected.
- 0041 is not a separate active layer in the current 18.4.4 plan; its 60s policy is folded into 0037. Use the versioned active candidates, not canonical historical paths, for migration.
- Matching hunks in a failed dry-run were NOT applied: the whole 0090 layer was skipped. Only usage.ts import context failed.
- Upstream improvements must be retained, especially mergeRefreshedOrganizationScope; do not repair the import by deleting the new upstream helper.

---

# 0090 credential-protection assessment vs official 18.7.0

Sources compared: 18.4.4 pristine, local effective 18.4.4+patches (`18.4.4/replay`, confirmed 0090 applied), 18.7.0 pristine, `18.7.0/replay`. Patch text: `patches/.18.4.4-candidates/0090-omp-oauth-durable-refresh-v18.4.4-candidate.patch`. Contract: `.trellis/spec/backend/verification-gate-contracts.md:761-840`. Release notes corroborated against source (not accepted on label alone).

## 1. Conclusion

**0090 MUST be retained.** 18.7.0 does not implement any of 0090's seven contract behaviors. The upstream 18.4.4→18.7.0 auth/refresh delta is: (a) a new `mergeRefreshedOrganizationScope()` helper; (b) store-level write-churn no-ops; (c) a broker-client logout/newer-login guard. None of these substitute for 0090.

The parent's `status: blocked` for 0090 on 18.7.0 is a **text-only** conflict, not upstream absorption: `replay-1870.json:841-855` shows every refresh.ts hunk (#1-#7), both select.ts hunks (#2-#3-#4) and both anthropic.ts hunks applied with offsets (25/28 lines), and only `pi-ai/src/auth/usage.ts` hunk #1 FAILED at line 37. That hunk is a bare import edit whose context line is `import { OAUTH_REFRESH_SKEW_MS } from "./refresh";` (18.4.4 usage.ts:37); 18.7.0 changed it to `import { mergeRefreshedOrganizationScope, OAUTH_REFRESH_SKEW_MS } from "./refresh";` (18.7.0 usage.ts:37). One-line rebase.

Severity-ranked risks if 0090 were dropped on the upgrade:
1. **High — silent token loss / self-inflicted logout.** Surviving-waiter cancellation and the 10s identity-hook wait still sit between token receipt and persistence on 18.7.0 (refresh.ts:455, 501; anthropic.ts:95-107). Repeats the 2026-10-01 fault injection described in PATCHES.md:833-836.
2. **High — timer-starvation lease expiry.** 18.7.0 renews the lease only from the 5s timer loop (refresh.ts:249); a >15s synchronous stall still expires the lease before the fenced CAS.
3. **Medium — double write / revision churn.** 18.7.0 select.ts:735 and `#forceRefreshCredentialByIdUnshared` still remerge pre-await metadata and persist after the durable owner already saved/reloaded; this churns `auth_change_revision` and reloads peer processes.
4. **Medium — unguarded public abort.** 18.7.0 `refresh()`/`refreshById()` still have no `signal?.aborted` pre-check (refresh.ts:432-443, ~600).

## 2. Contract-by-contract matrix

Legend: 18.4.4p = pristine, LOCAL = `18.4.4/replay` (0090 applied), 1870p = pristine, 1870r = `18.7.0/replay` (0090 blocked).

| # | Contract (spec 761-840) | 18.4.4p anchor | LOCAL (0090) anchor | 18.7.0p anchor | Overlap in 18.7.0? | Recommendation |
|---|---|---|---|---|---|---|
| C1 | Caller cancelled before ownership sends no token request | refreshStored pre-lease abort: `refresh.ts:130` | unchanged (18.4.4 already has it) | `refresh.ts:155` identical | YES (pre-existing upstream) | retain, no 0090 action |
| C2 | After ownership, caller cancellation cannot abort a received rotation or poison a surviving waiter | `refresh.ts:430` `if (existing) return raceSignal(existing, signal, ...)`; `:584` same in refreshById; `:476` `AbortSignal.any([signal, refreshSignal])` | `:449` `if (existing) return existing;`; `:663`+ refreshById returns raw promise; `:498` passes `refreshSignal` only; outer `refresh()`/`refreshById()` own `raceSignal` | **absent** — 1870p `refresh.ts:455` `if (existing) return raceSignal(existing, signal, ...)`, `:609` same, `:501` still `AbortSignal.any`; `refresh()` 432-443 returns `#refreshSingleFlight(...)` with no raceSignal | **NO** | **retain 0090** (core value) |
| C3 | Reject already-aborted public calls before starting shared work | none | `refresh.ts:432` and ~`:602` `if (signal?.aborted) throw new AIError.AbortError(...)` | **absent** (no `signal?.aborted` in either public method) | **NO** | retain |
| C4 | Optional identity lookup must not sit between token receipt and persistence | `anthropic.ts:95-107` bootstrap runs on refresh; no `stored` fallback | `anthropic.ts:95-99` `if (context.phase === "refresh") { credentials.accountId ??= context.stored?.accountId; credentials.email ??= context.stored?.email; return credentials; }` | **absent** — 1870p `anthropic.ts:95-107` byte-identical to 18.4.4p | **NO** | retain |
| C5 | Timer renewal alone insufficient; renew same owner immediately before fenced save; never renew a peer / overwrite changed-or-deleted row | only timer-loop renew `refresh.ts:224` | `refresh.ts:308-316` second same-owner renew immediately before `tryUpdateAuthCredentialIfMatches`, else `ConfigurationError` | **absent** — 1870p only timer-loop renew at `refresh.ts:249`; no pre-CAS renew | **NO** (partial: 1870p `sqlite-credential-store.ts:1480-1481` no-op CAS branch still requires a held lease, so 0090's renewal is complementary) | retain |
| C6 | Durable owner is sole persistence boundary; force refresh / selection / usage / health must not remerge pre-await metadata and write twice | select.ts preflight `:707` and tryOAuth `:990`/`:1002` remerge+replaceById; `#forceRefreshCredentialByIdUnshared` remerges | select.ts `:702-707` short-circuit; `:1002-1017` `hasRefreshLeases` branch + `checkedAccountId`; `refresh.ts:663-666` short-circuit in forceRefreshById; `usage.ts:187` `if (hasRefreshLeases(...)) return;` | **absent** — 1870p select.ts `:735` calls `#syncOAuthSelectionFromStore` with no `hasRefreshLeases` guard; tryOAuth `~:988-1012` uses `selection.credential.accountId`; no guard in `#forceRefreshCredentialByIdUnshared`; no guard in usage.ts | **partial only**: 1870p `sqlite-credential-store.ts:1444-1455` (`updateAuthCredential` no-op when bytes match) and `:1468-1481` (CAS no-op) reduce write churn, but do not stop the select/usage remerge+second write | retain |
| C7 | CAS peer writes / logout; never resurrect a changed/deleted row | `tryDisableAuthCredentialIfMatches` CAS + `disableDefinitiveFailure` `refresh.ts:383-420` (owner fence) | unchanged + C5/C6 fences | 1870p adds broker-client `remote-store.ts:1180-1201` (`#refreshThroughBroker`: if this client's copy changed mid-flight, reload and let the broker's row win — logout stays logged out, newer login kept) | **partial**: upstream guards the broker-client layer, not the SQLite durable-owner layer; both useful | retain 0090; note upstream C7 broker guard as additive |
| C8 | Keep invalid-grant disabling; never blindly replay a consumed token | `refresh.ts:330-360` disable path | unchanged (0090 does not touch it) | 1870p identical disable path | pre-existing upstream | retain |

## 3. Upstream improvements worth showing (with limitations)

1. **`mergeRefreshedOrganizationScope`** — `18.7.0p/pi-ai/src/auth/refresh.ts:47-70`, used by `mergeRefreshedCredential` (`:85`) and `mergeRefreshedUsageCredential` (`18.7.0p/pi-ai/src/auth/usage.ts:88`); `buildRefreshableOauthCredential` also gained region/inferenceRegion/activeOrganizationId passthrough (`usage.ts:74-76`). Behavior: refreshed org/residency fields win; stored org/region/inferenceRegion carry over **only while the org is unchanged**; `activeOrganizationId` always falls back to stored. Limitation: this is a merge-policy change, not a persistence-timing fix — it does not cover C2/C4/C5/C6. It is the *cause* of 0090's one-line usage.ts conflict. (Corroborated by CHANGELOG 18.7.0:15 "newly refreshed and existing accounts now retain the account email".)
2. **Write-churn no-ops** — `18.7.0p/pi-ai/src/auth/sqlite-credential-store.ts:1444-1455` (`updateAuthCredential` returns without writing when persisted bytes already match) and `:1468-1481` (`tryUpdateAuthCredentialIfMatches` returns true without writing when the row already holds exactly this credential and the lease fence is held). Corroborates CHANGELOG 18.4.9:104 ("unnecessary credential and session updates … needless authentication reloads in other running processes"). Limitation: only suppresses identical writes; 0090's C6 guards suppress *redundant recomputation* on the select/usage side and remain necessary. Interaction to verify: the new no-op branch returns false if the lease already expired, so 0090's C5 renewal makes it behave as intended.
3. **Broker-client logout/newer-login guard** — `18.7.0p/pi-ai/src/auth-broker/remote-store.ts:1180-1201`. Corroborates CHANGELOG 18.4.11:86. Limitation: broker-transport only; irrelevant to a local SQLite store but relevant if the user runs the auth broker.
4. **Anthropic usage failure backoff** — `18.7.0p/pi-ai/src/usage/claude.ts:25` `FAILURE_BACKOFF_MS = 60_000`, wired at `:802` `failureBackoffMs: FAILURE_BACKOFF_MS` on the anthropic usage provider. Corroborates CHANGELOG 18.6.3:35 ("Claude usage being re-polled every 10 seconds … a failed refresh now waits a minute"). 18.4.4p claude.ts has no `failureBackoffMs` (only muse-code has one).
5. **Broker sweep resilience** — CHANGELOG 18.6.3:38; source: `auth-broker/refresher.ts:101-104` catches sweep failure and retries next tick.
6. **`recordAffinity: false`** (CHANGELOG 18.6.3:28) — 1870p `select.ts:~1046` guards `this.#deps.affinity.record(...)` behind `options?.recordAffinity !== false`; 18.4.4p records unconditionally. Not a credential-safety change.

## 4. Local usage-path patches (0026/0030/0037/0041) — overlap with upstream lifecycle

| Patch | Local anchor | 18.7.0 status | Conflict / recommendation |
|---|---|---|---|
| 0026 | `pi-ai/src/auth-storage.ts` `fetchUsageReports` gains `providers?: readonly Provider[]` and filters the fan-out | **absent**: 1870p `UsageReportsOptions` (`pi-ai/src/auth/usage.ts:108-111`) and the `AuthStorage.reports` facade (`types.ts:1128-1131`) have only baseUrlResolver/signal; no `providers` | retain; rebase against 18.7.0's `UsageCache` construction change (`auth-storage.ts:186` now takes `provider => usage.providerFor(provider)`). |
| 0030 | `UsageCache.readReport(request, cacheKey, stale)` with legacy-key fallback (`replay usage-cache.ts:261-278`); `reportKey` canonicalises `(baseUrl, provider)` (`:344`) | **absent**: 1870p `usage-cache.ts:271-273` normalises `(request.baseUrl)` only; usage.ts still calls plain `getStale` (`:329`, `:382`) | retain; semantic divergence to re-check, not a duplicate. |
| 0037/0041 | `STATUS_USAGE_REFRESH_TTL_MS=50_000`, `ANTHROPIC_USAGE_TURN_GATE_MS=60_000`, turn-end bypass, provider-whitelisted fetcher (pi-coding-agent statusline component) | **absent** at the statusline layer | **overlap, not conflict**: 18.6.3's 60s `failureBackoffMs` is a usage-cache *failure cooldown* (any caller); the statusline gate limits *repaint/success-path* poll cadence. Upstream does not replace it. Keep 0041's 60s (aligned with upstream's 60s), and re-verify 0037's `sessionFetcher.call(session, signal, [activeProvider])` still type-checks against 18.7.0's `fetchUsageReports(signal?)` signature (`agent-session.ts:11558`). |

No auth API was removed in 18.5.0–18.7.0 (no Breaking Changes sections in the pi-ai CHANGELOG for that window); 18.7.0 *added* `getOAuthCredentialProvider()`. The 18.3.5 removal of stream-level `anthropicCacheRefresh` predates 18.4.4 and is out of this slice.

## 5. Schema / DB compatibility

- `AUTH_SCHEMA_VERSION = 8` in both (18.4.4p `sqlite-credential-store.ts:91`; 18.7.0p `:108`).
- `auth_credential_refresh_leases` DDL and index identical (18.4.4p `:540-546`; 18.7.0p `:565-571`).
- Lease API surface identical in both (`tryAcquireCredentialRefreshLease`, `getCredentialRefreshLeaseExpiresAt`, `renewCredentialRefreshLease`, `releaseCredentialRefreshLease`; 18.7.0p `:500-522`, `:1705-1716`).
- 18.7.0 adds two internal statements (`#getCredentialStateStmt`, `#holdsCredentialRefreshLeaseStmt`, `:517-522`) used only by the new no-op CAS branch — no schema change.
- **Conclusion:** a store written by local 18.4.4+0090 is read and written unchanged by 18.7.0. No migration, no compatibility gate needed for this slice.

## 6. Recommendation

- **0090:** RETAIN. Classification: **partial upstream replacement candidate is NOT available**; no full-replacement candidate exists. Rebase the single `usage.ts` import hunk (accept 18.7.0's `mergeRefreshedOrganizationScope` import line) and re-run the whole patch; the other six hunks already apply.
- **0026, 0030, 0037, 0041:** RETAIN. No upstream equivalent. 18.6.3's `failureBackoffMs=60_000` is complementary to 0041, not a replacement.
- **0092:** out of this slice (cache-warming; parent owns).

## 7. Credential-safe synthetic acceptance scenarios (for later implementation; do not run here)

All scenarios use synthetic rotating grants and a private temp SQLite store; no operator credential, no provider traffic, no live `agent.db`.

1. **C2 surviving waiter** — start refresh A (lease held, token request in flight), attach waiter B, abort A's signal after the token endpoint has responded but before persistence; assert: A rejects promptly, B resolves, the persisted row holds the rotated `access`+`refresh`, and the next refresh accepts the saved grant.
2. **C2 poisoning regression** — assert the single-flight map stores the *durable* promise (not `raceSignal(existing, signal)`); grep-level: LOCAL `refresh.ts:449` `if (existing) return existing;` present, 18.7.0p `:455` differs.
3. **C3 pre-abort** — call `refresh()`/`refreshById()` with an already-aborted signal and a transport spy; assert no token request is issued and an `AbortError` is thrown.
4. **C4 identity** — refresh response with no `accountId`/`email`/`orgId`; assert the saved row keeps stored identity and the rotated token persists, with zero bootstrap HTTP calls on the refresh path (loopback spy counts requests).
5. **C5 stall** — hold the lease, then run a synchronous busy loop longer than `OAUTH_REFRESH_LEASE_TTL_MS` (15s) before the CAS; assert the pre-CAS renew succeeds and the row is updated (and that a peer owner inserted during the stall makes the renew fail and the refresh abort without writing).
6. **C6 sole owner** — with a lease-backed store, drive selection + usage-probe + force-refresh concurrently for one row; assert exactly one `tryUpdateAuthCredentialIfMatches` write and that `auth_change_revision` advances at most once (18.7.0's new no-op branch helps here; verify it does not mask a needed write).
7. **C7 logout / peer write** — delete or peer-rotate the row mid-refresh; assert the local owner neither resurrects nor overwrites it. Broker variant: assert `remote-store.ts:1180-1201` keeps the logout/newer login.
8. **C8 invalid grant vs transient** — invalid_grant disables the attempted row (not a peer replacement); a transport failure before receipt keeps the credential active.
9. **Usage-polling (0041/0037)** — synthetic statusline session: assert a completed assistant turn bypasses the TTL, an idle repaint is suppressed for 60s on anthropic, and only the active provider is passed to the fetcher; assert 18.7.0's `failureBackoffMs` path does not cause a second probe inside the 60s window.

## 8. Evidence limits

- I did not run tests, builds, or provider traffic; all behavioral claims are source/CHANGELOG-anchored, not runtime-verified.
- No live credential, `agent.db`, or session was read.
- `[INFERENCE]` C2's runtime effect on 18.7.0 (poisoned survivor) is inferred from the identical 18.4.4p code shape plus PATCHES.md:834's fault-injection record; it is not re-reproduced here.
- `[INFERENCE]` The exact C6 double-write count on 18.7.0 is inferred from the absent `hasRefreshLeases` guards; the new store no-op may reduce the observed revision churn, so scenario 6 must be measured before any retirement decision.
- 18.7.0/replay confirms 0090 did not apply, but the parent owns the final effective-tree semantics.
