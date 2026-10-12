# OMP 18.10.1: retry transient TLS verification failures

## Problem
Model turns (main session and subagents) end immediately on Bun's `unknown certificate verification error`. Logs show 440 such errors in 5 days across every provider; the next request succeeds, so it is a network/proxy fault.

## Decisions (user)
- Scope: model turns only; usage/quota fetches unchanged.
- Match: only `unknown certificate verification error`; deterministic TLS failures stay terminal.
- Release: publish after smoke, with approval at publish time.

## Change
New family `0098-omp-tls-verify-transient-retry` (root AI, `pi-ai/src/error/flags.ts`): the message is classified `Flag.Transient`; the existing retry policy applies. Post-cutover families are declared in `verify-release-family-plan.py` `ADDED_FAMILIES`.

## Acceptance
- `verify-tls-verify-transient-retry.ts` passes on the candidate and fails on the previous release.
- `verify-release-family-plan.py --version 18.10.1` PASS with 25 families / 60 capabilities.
- All selected gates pass on the staging runtime; installed private smoke PASS; native overlay PASS.

## Retry pacing (added by the user at publish time)
Family `0099-omp-retry-slow-schedule`: retries wait 3-3-5-5-10-10-15-15 s instead of 0.5 s doubling to 8 s; config `retry.maxRetries: 8`.

## Known limit
The schedule covers about 66 s of outage; a longer outage on one route still ends the turn (model fallback applies only where `retry.fallbackChains` defines a chain).
