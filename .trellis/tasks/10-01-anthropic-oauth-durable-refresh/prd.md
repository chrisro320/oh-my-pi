# Fix Anthropic OAuth refresh token loss

## Goal

Stop locally induced Anthropic sign-outs caused by discarding an already-rotated OAuth token. The user approved implementing the preceding investigation's repair plan with “Solve this problem”.

## Background

Synthetic fault injection against the installed 18.4.4 auth code reproduced loss after a 10-second identity-hook timeout, caller cancellation after token rotation, and a 16-second event-loop stall exceeding the 15-second refresh lease. A fast successful refresh and a fast bootstrap 503 both persisted correctly.

## Requirements

- R1: Anthropic refresh must not wait for optional account bootstrap; preserve stored identity when the token response omits it. Interactive login identity resolution stays intact.
- R2: Cancellation before obtaining refresh ownership must not issue a refresh. Once the durable owner starts token rotation, a caller may stop waiting without cancelling the persistence operation or a surviving waiter.
- R3: An expired but still-owned lease must be renewed synchronously before saving a minted token. A stolen lease or changed credential must never be overwritten or disabled by the previous owner.
- R4: Keep definitive invalid-grant disabling and transient-failure preservation; do not suppress the warning, add blind retries, or extend timeouts.
- R5: Ship a new immutable 18.4.4 patch, behavioral gate, ledger registration and safe deployment. Never open, restore, copy, or mutate the live credential DB during verification; use synthetic credentials only.

## Acceptance Criteria

- [x] AC1: Stored identity avoids bootstrap during refresh; missing identity also cannot delay saving rotated token bytes; login still resolves identity.
- [x] AC2: Already-aborted/waiting caller sends no token POST; cancellation after rotation rejects that waiter while the owner persists and a surviving waiter succeeds.
- [x] AC3: A >15-second synchronous stall does not lose the new token when the lease still belongs to the operation; takeover/peer-write does not clobber the winner.
- [x] AC4: Genuine invalid_grant disables exactly the attempted row; transient error leaves it active; a subsequent refresh uses the saved token.
- [x] AC5: The behavioral gate fails against the pre-fix tree and passes against the patched tree; the actual auth entry path is exercised with synthetic HTTP and SQLite.
- [ ] AC6: Full pristine chain replay, reverse/forward checks, scoped import/smoke and deployed-byte parity pass. Old patches remain unchanged.

## Out of Scope

Recovering a remotely revoked grant without user login; bypassing provider access controls; changing quotas; killing other user sessions; modifying unrelated providers' login UX.
