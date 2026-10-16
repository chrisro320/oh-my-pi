# cache-prefix-audit attribution

## Problem (observed)
- Live mirror `~/.omp/agent/extensions/cache-prefix-audit.ts` (mtime Oct 14) is NOT any committed blob: it is the pre-969369ed6 causal lineage plus a Devin Cascade adapter (`adaptDevinPayload`, `devinDrift`, `devinRecordByModel`).
- Its `message_end` handler writes `sessionId: activeSessionKey` (module-level, last REQUEST's session) and pairs the usage with `lastDiffByModel` of that session. Subagents share the process, so a subagent response is logged under whichever session requested last (main), with a borrowed verdict. Observed: 11:26:50Z revival of a subagent was logged as the main session's `MISS (prefix intact)` while the subagent's own request row said `SYSTEM_DRIFT`.
- Repo head (969369ed6) already fixed this by contract: usage rows carry `observedSessionId` from `ctx.sessionManager.getSessionId()`, `correlation: "unavailable"`, no borrowed diff/header/devin record. It has no Devin adapter, so syncing the mirror verbatim would drop the Devin lane (310 usage rows with a `devin` record for `gpt-6-1-sol` in the current logs).

## Decision (owner default; user can override)
Repo head is canonical (spec `Mirror Parity`, PATCHES.md "causal contract superseded"). Port the Devin adapter into repo head in request-only form, then sync the mirror with a backup. Do not reintroduce causal pairing.

## Scope
- `patches/cache-prefix-audit-extension.ts`: add `DevinSnapshot`, `adaptDevinPayload`, `firstDriftWithin`, `devinDrift`, `bigintSafe`; in `before_provider_request` adapt the payload before fingerprinting and attach the Devin identity record to the REQUEST row only. No `devinRecordByModel`; `message_end` stays uncorrelated.
- `patches/verify-cache-prefix-audit.ts`: Devin scenarios + a mutation control.
- Docs: PATCHES.md audit bullet, spec scenario, DECISIONS.md.
- Out of scope: header-probe session attribution (module-level `activeSessionKey` race for HEADER_DRIFT rows; no request ID exists), causal verdicts, deployment of the mirror (reviewer does it).
