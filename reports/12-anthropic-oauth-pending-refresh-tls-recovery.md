# Anthropic OAuth: TLS failure stranded a refresh exchange; original login recovered

- Date: 2026-10-13. Log times below are normalized to UTC.
- Status: **Production credential recovered and a real Claude completion verified. No permanent code or TLS configuration fix shipped.**
- Audience: `omp-move` maintainers; operational incident report and engineering handoff.
- Runtime inspected: OMP release `18.10.1-755f89d58f76-54053d23-5f7644b4`, Bun `1.3.14`.
- Scope: one Anthropic subscription OAuth credential, local row ID `36` in `/home/chris/.omp/agent/agent.db`. Row IDs are local evidence, not reusable recovery targets.
- User constraints: preserve the existing login; no browser reauthentication; no credential deletion; no proxy-node changes. The user explicitly approved removing this one stuck refresh-exchange record and attempting one refresh with the existing token.
- Privacy: no access/refresh tokens, authorization codes, account identifiers, email addresses, controller secrets, or credential exports are included.

## 1. Conclusion

The subscription credential had not disappeared or been disabled. Its access token had expired. An attempted refresh failed with `unknown certificate verification error`, leaving a durable refresh-exchange record with no replacement credential. Subsequent refresh attempts encountered that record and failed locally before another token POST could run. The interactive session then displayed the misleading generic error `No API key found for anthropic`.

Three distinct facts must remain separate:

1. **Observed initiating failure:** TLS verification failed during a token request. The underlying reason for the intermittent TLS failure was not conclusively isolated.
2. **Confirmed persistent blocker:** the unresolved exchange was keyed to the current refresh token and had no staged replacement. Cooldown expiry did not resolve it.
3. **Completed recovery:** after a successful TLS preflight with the system CA bundle, an explicitly authorized, narrowly fenced removal of that one exchange allowed the native durable refresh path to succeed. The original refresh token was usable in this incident; the provider issued new access and refresh tokens, which were committed to the original database.

Reauthentication was therefore **not necessary for this incident**. That is an observed outcome, not a claim that arbitrary ambiguous refresh attempts can safely be replayed.

## 2. Evidence and sequence

### 2.1 User-visible failure and existing log evidence

The screenshot showed:

```text
Error: No API key found for anthropic.
Use /login, set an API key environment variable, or create /home/chris/.omp/agent/agent.db
```

Relevant existing logs:

| Time (UTC) | Evidence | Source |
| --- | --- | --- |
| 2026-10-12 19:03:52.964 | Stored access-token expiry, already past during the incident | Read-only metadata query of credential `36` |
| 2026-10-13 06:02:34.118 | Anthropic preflight refresh failed: `anthropic request to https://api.anthropic.com/v1/oauth/token failed: unknown certificate verification error`; `isDefinitiveFailure:false` | `~/.omp/logs/omp.2026-10-13.3192078.log:9` |
| 2026-10-13 06:04:08.367 | Refresh failed with `OAuth refresh outcome is unresolved for provider: anthropic; recovery or sign-in is required` | Same log, line `21` |
| 2026-10-13 06:11:48–06:11:59 | Usage path saw the unresolved refresh, then repeated TLS verification errors | Same log, lines `40–43` |
| 2026-10-13 06:13:19.862 | Usage request received HTTP `401` after its refresh had already failed locally | `~/.omp/logs/omp.2026-10-13.3203798.log:11–16` |

The usage `401` is not evidence that the refresh token was revoked. That path was consulting the existing credential after refresh failure; the access token was expired.

### 2.2 Database state before recovery

Read-only SQLite queries established:

- `auth_credentials`: row `36`, `provider='anthropic'`, `credential_type='oauth'`; access and refresh values present; `disabled_cause IS NULL`.
- `auth_credential_refresh_exchanges`: exactly one relevant record, with `replacement_data IS NULL`.
- Its `generation` matched the SHA-256 fingerprint of the stored refresh token; its `expected_hash` matched the serialized credential data.
- An `auth`-scope cooldown existed during the first inspection. Immediately before approved recovery, there were **no remaining blocks and no refresh lease**, but the exchange still existed.

This distinguishes the persistent failure from both a missing login and a five-minute cooldown.

### 2.3 TLS observations and their limits

All diagnostic endpoint probes sent no OAuth credentials.

- An early plain Bun GET of the token endpoint returned HTTP `405`.
- A later recovery-process preflight, after loading the native auth modules, failed with `unknown certificate verification error`. It stopped **before any database mutation or token POST**; observed refresh-attempt count was `0`.
- `curl` HEAD succeeded with HTTP `405`. Verbose output showed system trust bundle `/etc/ssl/certs/ca-certificates.crt`, certificate subject `CN=api.anthropic.com`, issuer `Google Trust Services / WE1`, valid September 21 through December 20, 2026, and `SSL certificate verify ok`.
- DNS returned `198.18.0.123`, consistent with the local fake-IP/TUN setup; this is not the public origin IP.
- One standalone OpenSSL diagnostic ended with unexpected EOF and no peer certificate. Its boilerplate verification line was **not** treated as successful TLS evidence.
- A fresh Bun process importing the auth module and started with `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` returned HTTP `405`.
- The actual recovery process used the same CA setting and independently passed its preflight before changing state.

HTTP `405` is expected for an unauthenticated GET/HEAD to a POST-only token endpoint. It establishes a completed HTTPS exchange, not valid OAuth authentication.

**Causality limit:** these were sequential probes, not a controlled comparison under identical timing and import state. They establish a working per-process CA configuration, but do not prove that Bun's default root store, an OMP fetch wrapper, the proxy, or timing was the unique TLS cause. Earlier advice attributing the problem categorically to a bad node or a dead subscription credential would exceed this evidence.

### 2.4 Required proxy node

Read-only Mihomo controller GETs verified:

- Controller mode: `rule`.
- Enabled `DomainSuffix` rule for `anthropic.com` selected `🧲 AI`.
- `🧲 AI` selected **`pro-家庭宽带-美国ATT01-2X`**, exactly the node required by the user.
- The Anthropic domain rule had recorded hits.
- Earlier UDP/443 rejection rules did not describe the HTTPS/TCP request path.

The unrelated general manual-selection group selected a different node; that did not override the dedicated AI rule. `/connections` had no active Anthropic flow at the instant queried. The evidence is the loaded routing policy and rule hits, **not a captured per-request connection chain**.

No controller PUT/PATCH, node selection change, proxy restart, or network-configuration write was performed.

## 3. Why the existing implementation remained stuck

Installed runtime source root:

```text
/home/chris/.bun/install/omp-releases/18.10.1-755f89d58f76-54053d23-5f7644b4/runtime/node_modules/@oh-my-pi
```

References below are relative to that root; line numbers refer to the inspected release.

| Location | Observed behavior |
| --- | --- |
| `pi-ai/src/auth/sqlite-credential-store.ts:109–114` | `refreshExchangeFingerprint()` derives `generation` from the refresh token, falling back to access token only when refresh is absent. A metadata rewrite is not a new generation. |
| `pi-ai/src/auth/sqlite-credential-store.ts:1838–1863` | `reserveCredentialRefreshExchange()` returns `pending` whenever the prior generation matches. With no replacement, there is nothing to recover. |
| `pi-ai/src/auth/refresh.ts:269–289` | The durable owner checks/reserves the exchange, then throws `OAuth refresh outcome is unresolved...` when a pending exchange has no recovered credential. |
| `pi-ai/src/auth/refresh.ts:343–359` | The real refresh callback occurs later. The unresolved path never reaches this token POST. |
| `pi-ai/src/auth/refresh.ts:361–426` | Non-definitive refresh errors propagate without retiring the unresolved exchange. |
| `pi-ai/src/auth/refresh.ts:462–495` | Successful refresh stages/commits the replacement through the store and releases the lease. |
| `pi-ai/src/auth/sqlite-credential-store.ts:1887–1895` | Successful refresh commit removes the exchange record. |
| `pi-ai/src/auth/select.ts:1118–1160` | A transient refresh failure may temporarily block the credential and return no OAuth resolution. |
| `pi-coding-agent/src/session/agent-session.ts:8200–8207` | An empty key resolution becomes the generic `No API key found` message. |
| `pi-ai/src/registry/engine/common.ts:198–245` | The token request wraps fetch failures in `OAuthError`; the displayed certificate-error string alone does not carry a reliable delivery-phase classification. |

The guard exists for a valid reason: a remote server might consume a rotating refresh token before the client durably saves the response. Lease expiry or network recovery does not prove that replay is safe. The defect exposed here is the operational dead end and misleading diagnosis after this TLS failure, not a justification to remove the at-most-once protection globally.

### Related patch ownership

- `patches/PATCHES.md`, family `0090`: durable OAuth refresh protection. Its listed scenarios and `patches/verify-oauth-durable-refresh.ts` are the first places to inspect for a focused regression case.
- `DECISIONS.md`, “Follow-up: retry transient TLS verification failures”, and family `0098`: classification of the bare TLS-error phrase for model-turn retry. That decision explicitly treated the phrase as a heuristic.
- Merely adding retries cannot solve this pending-exchange state: subsequent attempts are rejected before the network callback.

No patch-family change, release modification, deployment, or test-suite run was performed in this incident session.

## 4. Recovery actually performed

This was a user-approved operational repair, not an existing public “unlock” command and not a general-purpose recovery recipe.

1. Checked the stored credential, exchange fingerprint, absence of staged replacement, absence of an active lease, and required proxy selection.
2. Loaded the installed native `AuthStorage` and registry refresh implementation before mutation.
3. Started the recovery Bun subprocess with the system CA bundle. Refused disabled TLS verification and required its unauthenticated preflight to return the expected `405`.
4. Used a short SQLite `BEGIN IMMEDIATE` transaction against the **original live database**. Re-read the active Anthropic row and required the same pending-exchange owner, matching refresh generation, matching exact serialized-data hash, no replacement, and no unexpired lease. Removed exactly that exchange record. No credential row was deleted or rewritten by this transaction.
5. Called the native durable entry `auth.oauth.refreshStored('anthropic', ...)` for credential `36`, with the observed credential and native `refreshOAuthToken()` callback. The native code retained lease acquisition, staging, fenced commit, and peer-rotation handling. The callback was allowed to run only once.
6. Passed `isDefinitiveFailure: () => false` for this one recovery invocation to prevent the diagnostic operation from disabling the login on failure. No production source policy was changed.
7. The native refresh succeeded and committed the provider's replacement tokens to the original credential row. No copied database was used to redeem a live refresh token.

There was a transaction boundary between the authorized marker removal and native refresh ownership acquisition. The native path re-read and fenced the credential; no exclusive offline shutdown was claimed. SQLite WAL files were not removed, copied independently, repaired, checkpointed, or integrity-tested. No credential export or persistent recovery script was created.

### Observed successful refresh output

```json
{"phase":"tls_preflight","bun":"1.3.14","status":405,"credentialsSent":false}
{"phase":"pending_exchange_removed","credentialId":36,"rows":1,"credentialRowUnchanged":true}
{"phase":"refresh_result","attempts":1,"refreshed":true,"removed":false,"credentialPresent":true,"disabled":false,"accessChanged":true,"refreshChanged":true,"expiresAt":"2026-10-13T14:28:32.359Z","usableByExpiry":true,"pendingExchanges":0}
```

The subprocess exited `0`. This directly establishes that the original refresh token was usable for the approved recovery; it was not necessary to obtain a new browser grant.

## 5. End-to-end verification

A separate Bun subprocess, also using the system CA bundle:

- Opened the original credential database read-only.
- Required credential `36` to remain active and unexpired.
- Loaded bundled model `anthropic/claude-sonnet-5-5` and the installed native `completeSimple()` implementation.
- Sent only `Reply with exactly OK and nothing else.`, with `maxTokens:32` and a 30-second abort deadline, using the restored access token.

Observed result:

```json
{"provider":"anthropic","model":"claude-sonnet-5-5","stopReason":"stop","text":"OK","error":null}
```

The subprocess exited `0`. This was a real model completion, not a mock or a token-presence check.

**Verification boundary:** the user's existing interactive Tern/OMP session was not driven after recovery. The native API path worked with the repaired database and per-process CA setting. The user was told to resend in the original window; that subsequent interaction was not observed here.

## 6. Remaining engineering work for omp-move

Operational recovery is complete. The following are recommendations, not changes made or separately authorized implementation work:

1. **Preserve the real auth failure at the session boundary.** Distinguish absent credentials from an active credential with an unresolved refresh exchange. Do not imply that an existing `agent.db` must be created or that the user must necessarily reauthenticate.
2. **Define a supported, narrowly scoped recovery transition.** Inspect the existing durable-refresh family before choosing an API. Only a positively established pre-send failure may permit automatic release/retry; an opaque TLS string, elapsed lease, timeout, or lost response is not sufficient proof. Preserve ambiguous-generation protection, staged-result recovery, exact-row fencing, and peer-rotation behavior.
3. **Investigate TLS independently.** Compare the actual OMP process environment, imported fetch path, Bun default trust, and the verified system bundle without changing the required node or disabling verification. A successful CA-configured subprocess is not a permanent fix for already-running sessions or future launches.
4. **Extend the existing focused regression gate using synthetic credentials and private SQLite.** Cover a definitely-unsent failure, an ambiguous post-send failure, staged replacement recovery, a peer rotation between recovery admission and commit, and accurate user-visible error propagation. Do not use production tokens for regression tests or redeem them in a disposable database.
5. **Verify the eventual shipped fix through the actual interactive path.** Confirm the original session can send a turn and later refresh automatically, with the required node unchanged. Follow the immutable-release workflow; do not patch the active release in place.

### Rejected shortcuts and decision notes

- Browser `/login`: rejected by the user; not used.
- Export/import of the same credential: not a proven fix. With the same row and refresh token, the generation match survives. Do not claim that rewriting metadata clears ambiguity.
- Waiting five minutes, restarting, or force-refreshing without addressing the journal: does not retire the pending generation.
- Disabling certificate verification or switching nodes: not used and not an acceptable substitute.
- Blanket deletion of exchanges or credentials: not performed. The approved operation was restricted to one inspected record.
- Copying the live database and redeeming its production token there: not performed; it could rotate the real token without updating the authoritative store.
- Declaring the TLS root cause permanently fixed: unsupported. `NODE_EXTRA_CA_CERTS` was applied only to the diagnostic/recovery/smoke subprocesses.

## 7. Handoff review questions

1. Which persisted field distinguishes a genuinely missing credential from this incident?
2. Why does an unchanged refresh token keep the exchange pending even after the cooldown expires?
3. What delivery-phase evidence would permit a safe retry, and what must remain ambiguous?
4. Which observed result proves recovery without browser reauthentication, and what interactive behavior remains unverified?
5. Why does this one successful CA-configured recovery not establish a permanent TLS fix?
