# Design: fenced unlock for an unresolved OAuth refresh exchange

## Problem
`reserveCredentialRefreshExchange` returns `pending` forever for an unchanged refresh-token generation with no staged replacement (`pi-ai/src/auth/sqlite-credential-store.ts:1838-1863`). `refresh.ts:269-289` then throws before any POST. The session shows `No API key found` (`agent-session.ts:8200-8207`). The at-most-once lock is correct; there is no supported key.

## Architecture
Three layers, one direction of dependency: extension -> OAuth API -> store. Revised after plan review (see "Review resolutions").

1. **Store (pi-ai, family 0090)** - two new capabilities on `SqliteCredentialStore` and the `hasRefreshExchanges` capability (`pi-ai/src/auth/store.ts`):
   - `inspectUnresolvedCredentialRefreshExchange(id)` (read-only, redacted): returns eligibility plus an opaque **fence** = hash over (credential data, exchange `generation`, exchange `owner`, exchange `expected_hash`) and a reason code. No tokens, no account identifiers.
   - `releaseUnresolvedCredentialRefreshExchange(id, expectedData, fence, lease)` returns `released | not-pending | staged-replacement-present | row-changed | fence-mismatch | lease-not-held`. One `.immediate()` transaction (pattern of `reserveCredentialRefreshExchange`). Deletes only when ALL hold:
     - row exists, `credential_type='oauth'`, `disabled_cause IS NULL`, `data === expectedData`
     - caller holds an unexpired refresh lease for the row (`#holdsCredentialRefreshLeaseStmt`)
     - an exchange row exists and its recomputed fence equals the caller's fence (so a replaced same-generation marker from a later failed attempt is refused)
     - `replacement_data IS NULL`
2. **Refresher (pi-ai, family 0090)** - `OAuthRefresher.inspectUnresolvedRefresh(provider)` and `unlockAndRefreshStored(provider, { fence, ... })`, exposed next to `refreshStored` (`oauth.ts:371`). Unlock is NOT a separate pipeline: it is an option on the shared owned-refresh path (`#refreshStoredOwned`), so lease, abort, peer-rotation and timeout handling are reused. Order inside the pipeline is fixed:
   1. take row lease
   2. recover/stage any known in-memory result (`#unstagedResults`, `refresh.ts:260-265`) under the ORIGINAL exchange owner; if that yields a credential, return it with zero POST and do not release
   3. only then release (with fence) the unresolved exchange
   4. reserve -> single POST -> stage -> commit in the same lease
   The POST callback runs at most once. The unlock path never sets `isDefinitiveFailure` to disable the credential; a failure leaves the row active and a new pending marker (new fence), which is the correct ambiguous state.
   Fail closed (inspect reports ineligible, unlock refuses) for `REMOTE_REFRESH_SENTINEL` credentials and for override or delegated runtimes where this process does not mint locally (`refresh.ts:782-788`, `#mintsLocally()`): local inspection and preflight cannot attest broker state.
3. **Extension (`patches/auth-unlock-extension.ts` -> `~/.omp/agent/extensions/auth-unlock.ts`)** - `registerCommand("auth-unlock")`. Flow:
   - Resolve provider (default `anthropic`); call `inspectUnresolvedRefresh`; refuse with a reason when nothing is pending, credential disabled/absent, or ineligible (remote/delegated).
   - Capture the fence BEFORE confirmation; show provider, credential id and access-token expiry (no marker age: the exchange table has no timestamp and this task adds no schema change); require explicit `ctx.ui.confirm`; non-UI mode refuses.
   - Credential-free TLS preflight from the live process (unauthenticated GET to the token URL; Anthropic expects HTTP 405). Failure refuses and prints the TLS diagnosis.
   - Call `unlockAndRefreshStored` once with the captured fence; print one of: refreshed (new expiry), nothing-to-unlock, fence-changed (state moved since you looked; re-run), staged-result-recovered, failed (new marker may exist; fix TLS first).
   - Never print tokens or account identifiers.

## Error surfacing
When key resolution yields no credential because refresh is unresolved, the user-visible text must say: credential exists, refresh outcome unresolved, run `/auth-unlock <provider>`; it must not suggest creating `agent.db`. The seam: `select.ts:1118-1160` currently swallows the transient failure and adds a cooldown before `agent-session.ts:8200-8207` sees `undefined`. Requirements: keep the existing cooldown/fallback behavior; carry a durable unresolved-state diagnostic (derived from the store inspection, not from a log string) so the message stays correct across cooldown expiry; the change must not alter serialized system prompt, tool schemas, or cache-prefix fields (project invariant: byte-identical prefix). Exact seam chosen in implement.md step 1.

## Security invariants (each has a gate case)
- At-most-once preserved: no release without lease, fence match (credential data + exchange generation/owner/hash), and no staged replacement; known in-memory results are recovered before any release.
- No automatic release anywhere; only the explicit command, with confirmation.
- Never disable or delete the credential row from the unlock path.
- No TLS verification bypass, no node/proxy change, no credential exports, no tokens in logs.
- Peer rotation, overlapping confirmations and same-generation marker replacement are fenced by the opaque fence (credential data + immutable exchange owner/generation/hash) and the lease; stale consent can never release a newer attempt. The fence deliberately does NOT hash the mutable write-lease owner.
- Residual risk (cannot be closed by this design): `#unstagedResults` (`refresh.ts:103-104`) and a timed-out callback (`refresh.ts:351-355`) live in the memory of the process that sent the POST. If that process is still alive and holds a consumed-token result whose staging failed, a different process cannot see it, and unlocking from another process can cause a second POST with an already-consumed token. The zero-extra-POST guarantee is therefore limited to results visible to the unlocking refresher. Mitigation: the confirm prompt states "close or idle every other omp process before unlocking"; the extension refuses when this process itself holds an unstaged result.
- Remote/delegated runtimes are refused, never locally unlocked.

## Review resolutions (PlanReviewer, 2026-10-13)
- Blocker 1 (release-before-recovery loses a consumed-token result): unlock now runs inside the shared pipeline after known-result recovery and before reservation.
- Blocker 2 (stale confirmation could release a newer marker): fence captured before confirmation and checked transactionally; exchange identity includes `owner`.
- Major 3: read-only redacted inspect API added; marker-age display dropped (no timestamp column, no schema change); remote/delegated fail closed.
- Major 4: discriminating gates added in implement.md step 5, including fault variants and prefix-byte capture.
- Minor 5: comment-language check split into an additions-only ASCII scan plus an explicit English review.
- Round 2: prior finding 1 partially resolved (cross-process residual risk above, now explicit and gated), finding 4 partially resolved (fail-closed incomplete-tree control, structural-text-intact behavioral control, mandatory declaration consumer type-check, SHA-verified tarball zero-fuzz replay added in implement.md).

## Compatibility and rollout
- Changes live in the 0090 18.10.1 family patch (`.18.10.1-families/0090-...patch`, `NM`), so patch number/ledger changes follow the single-layer rule: re-derive the patch against pristine 18.10.1, update `manifest.json`, `plan.tsv`, `PATCHES.md`, runbook, `verify-release-family-plan.py`.
- Extension is a separate file deployed by `cmp`-verified copy; it must degrade cleanly (command reports "unsupported runtime") on a tree without the new API.
- Release goes through the immutable-release workflow; installation and activation reported separately; no in-place edits of the running release.

## Trade-offs
- Core API rather than extension raw SQL: heavier release flow, but the lock rules stay in one place and survive upgrades.
- Preflight can false-refuse if the token host blocks GET; the failure message names the cause and the command does not offer a bypass.
- Lease held across the single POST (up to the existing refresh timeout) is existing behavior of `refreshStored`, not new.
