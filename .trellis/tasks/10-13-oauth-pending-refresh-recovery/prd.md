# OAuth pending refresh exchange: supported unlock and accurate error

## Goal
After a TLS failure during an OAuth token refresh leaves a refresh exchange pending, the user must have a supported, explicit, fenced way to unlock it, and must see an accurate error instead of `No API key found`. Security first (the at-most-once lock stays), unblocking second. Source incident: `reports/12-anthropic-oauth-pending-refresh-tls-recovery.md`. Design: `design.md`. Plan: `implement.md`.

## Background (confirmed facts)
- Initiating failure: `postTokenRequest` wraps fetch failure as `OAuthError{kind:"token-refresh"}` with message `... failed: unknown certificate verification error` (`pi-ai/src/registry/engine/common.ts:198-245`); the string carries no reliable delivery-phase proof.
- Persistent blocker: `reserveCredentialRefreshExchange` returns `pending` for the same refresh-token generation with no staged replacement (`sqlite-credential-store.ts:1838-1863`); `refresh.ts:269-289` throws `OAuth refresh outcome is unresolved` before any POST. Cooldown expiry does not clear it.
- Session surface: empty key resolution becomes `No API key found for <provider>` (`agent-session.ts:8200-8207`).
- Store is private to `AuthStorage`; no public release API exists. Extensions get `ctx.modelRegistry.authStorage` (`extensions/types.ts:654`) and `refreshStored` (`pi-ai/src/auth/oauth.ts:371`).
- Owner: patch family 0090 (`.18.10.1-families/0090-omp-oauth-durable-refresh-v18.10.1.patch`, gate `patches/verify-oauth-durable-refresh.ts`). 0098 treats the TLS phrase only as a model-turn retry heuristic and does not clear the marker.

## Decisions (user-approved)
- Policy: explicit user-initiated unlock only; no automatic release on a guessed pre-send failure.
- Form: in-session slash command `/auth-unlock` delivered as an omp extension (precedent `cron-extension.ts`); CLI variant deferred.
- Placement: fenced release API in the 0090 core family + thin extension (not raw SQL in the extension). Robustness is preferred over a minimal diff.
- TLS root-cause investigation is a separate task.
- Assumed defaults (not contradicted by user): patch stays in family 0090 (no new number); command accepts a provider argument, default `anthropic`.

## Requirements
1. A read-only redacted inspection returns eligibility and an opaque fence (credential data + exchange generation/owner/hash). Release is a single transaction and succeeds only with: lease held, row active and unchanged, fence match, exchange present, no staged replacement. Remote/delegated runtimes are refused.
2. `unlockAndRefreshStored` runs inside the shared owned-refresh path: lease -> recover any known in-memory result -> release with fence -> at most one native refresh in the same lease; never disables or deletes the credential from this path.
3. `/auth-unlock` captures the fence before confirmation, runs a credential-free TLS preflight from the live process, shows provider, credential id and token expiry (no marker age: no schema change), requires explicit confirmation, calls the API once with the captured fence, and prints a result without tokens or identifiers. Non-UI mode refuses.
4. The session error for an unresolved refresh names the credential state and `/auth-unlock`; it no longer suggests creating `agent.db`.
5. Gate cases (a)-(n) in `implement.md` step 5, each with fault variants, proven red before and green after (including a weakened-fence mutation), using synthetic credentials and private SQLite only.
6. Shipped through patch ledger updates, pristine full-chain replay, `cmp` parity, and the immutable-release workflow.

## Acceptance criteria
- Synthetic stuck exchange: `/auth-unlock` in an isolated Tern/omp session unlocks, the next turn sends successfully, and the exchange row is gone.
- Staged-replacement, peer-lease, peer-rotation, stale-fence (replaced marker), generation-mismatch, disabled-row and remote/delegated cases are refused with no POST and no row change; a known in-memory result is recovered with zero extra POST.
- A transient failure during unlock leaves the credential active and does not trigger a second POST.
- TLS preflight failure refuses without touching the DB.
- Error text for unresolved refresh matches requirement 4 across cooldown expiry (gate (m)), and prompt/tool/cache-prefix bytes are identical (gate (n)).
- No production credential, `agent.db`, or real provider traffic is used in any test.

## Out of scope
- Automatic release or retry classification of TLS errors; TLS root-cause fix; CLI unlock; browser re-login; disabling TLS verification; proxy-node changes; blanket exchange deletion; providers other than those exercised by the default `anthropic` path beyond the generic API.

## Risks
- The lock rules change; a gate (b)-(e) failure blocks the task.
- Preflight can false-refuse if a token host rejects GET.
- Release flow is heavy (new immutable release, old sessions must exit before activation).
