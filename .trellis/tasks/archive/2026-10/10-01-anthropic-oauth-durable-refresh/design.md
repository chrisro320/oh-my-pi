# Durable OAuth refresh

## Decisions

- Keep the existing row lease, per-row single-flight and compare-and-set store. Do not introduce another credential store, retry loop, timeout extension or compatibility layer.
- Anthropic identity bootstrap is login-only. On refresh, return minted token bytes with any response identity, falling back to stored account ID/email. Optional profile data cannot gate token persistence.
- Keep caller cancellation while waiting for a lease. Once acquired, use the refresh operation's bounded signal, not the individual caller's signal; `raceSignal` continues to release cancelled waiters immediately while the shared durable owner finishes.
- Renew the same lease owner synchronously before the success CAS so timer starvation cannot discard a token solely because the lease deadline passed. Never renew another owner's lease. Preserve full-row CAS and lease fences; peer writes and logout win.
- Generate 0090 from the verified 18.4.4 pre-patch source in an isolated dependency-complete tree. The repository patch is authoritative; deploy atomically with backup and no live DB access.

## Risks and boundaries

Remote revocation and loss of the server's response before receipt are not recoverable by replaying a rotating token. This change protects tokens received by the client, not arbitrary process kills. No real authentication requests are used as tests. Existing live sessions must not be killed; a fresh process loads the fixed source.
