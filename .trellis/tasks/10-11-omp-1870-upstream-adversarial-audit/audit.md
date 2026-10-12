# OMP 18.7.0 -> 18.10.0 adversarial audit

## Decision

**NO-GO for a direct upgrade.** The current baseline has independently important defects, and stock 18.10.0 neither subsumes the patch capabilities nor avoids new retry/transfer risks. Prepare a semantic family rebase, not a blind update/reapply. No product code or live installation was changed in this audit.

This audit delivers an implementation-ready proposal, not a patched candidate. The task remains in planning pending explicit approval of `design.md` and `implement.md`.

## Authoritative artifacts

| Artifact | Update responsibility |
|---|---|
| `risk-register.json` | 27 stable findings: 14 concrete defect/diagnostic records and 13 migration/deployment records; remediation, evidence level, acceptance and ownership |
| `family-migration-matrix.json` | All 24 active families, immutable baseline digest/order, disposition, required action and linked findings; 0097 separate and excluded |
| `design.md` | Boundary decisions, rejected alternatives, compatibility and rollback trade-offs |
| `implement.md` | Ordered implementation proposal, required skills and unchecked product acceptance work |
| `verification.md` | Executed observations, explicit gaps and bounded V01-V11 future acceptance groups |
| `research/baseline-manifest.json` / `release-manifest.json` | Working plan, captured user changes, exact package bytes and source endpoints |
| `research/review-*.json` / `reviewer-model-bindings.json` | Eight primary reviews, three independent reviews and resolved-model proof |

Every reviewer was dispatched with `model: "@default"`; all 11 session records resolve to `openai-codex/gpt-6-astra`, without fallback. Reports were reconciled: duplicates are merged, conditional failures retain their conditions, and rejected allegations are listed below.

## Pinned inputs and replay result

- Baseline: official v18.7.0, `e0fc1cf4ea354b445a359b37fa5eb58deaa85598`, plus the captured current working family bytes, including the uncommitted navigation repair.
- Target: official npm 18.10.0, `b83200eb866821f02625332025b453f06ce4e12a`; upstream main matched at capture. This is a point-in-time target, not a promise about later `latest`.
- Current deployed selector: 24 families. Repository selector: the same 24 plus undeployed 0097.
- Baseline strict replay: 24/24. Target old-patch applicability: 3 clean, 21 blocked. These are text results, not 21 runtime regressions. Failed families were skipped whole; the partial target is unusable as an upgrade candidate.
- The three clean entries are Antigravity wire, resident goal tool and advisor quota-rotation bound. None is proven upstreamed.
- No unconditional family retirement is supported. 0017 can potentially shrink around upstream's ordinary-native initialization, while preserving connection-bound initialization. 0094 requires a semantic provenance split.

Primary upstream sources: [npm 18.10.0 metadata](https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/18.10.0), [pinned target commit](https://github.com/can1357/oh-my-pi/commit/b83200eb866821f02625332025b453f06ce4e12a), [upstream comparison](https://github.com/can1357/oh-my-pi/compare/v18.7.0...v18.10.0). Archive integrity and endpoint path inventories are persisted; the shallow log is not used as a definitive release commit count.

## Highest-risk conclusions

1. **R01 — Existing OAuth protection is not exactly-once redemption.** Actual baseline AuthStorage/SQLite/provider code sends the same synthetic refresh token again after simulated response loss. The second synthetic invalid_grant disables that row. This establishes duplicate client sends, not actual Anthropic account revocation. Keep 0090 and add a durable ambiguity policy; merely extending a lease cannot solve an unknown remote outcome.
2. **R06 — New Anthropic retry rung bypasses the credit guard.** The actual target provider emits a tokenless second request after cache-control rejection, despite prior server-tool content in the credit refusal. Both cache-control retry rungs must use the credit-aware rebuild path. Actual rebilling was not measured.
3. **R02/R03/M02/M03 — Resume protection is incomplete across entry points.** Current navigation repair passes, but actual baseline fork changes sol/medium back to astra/high after a fresh process. The real date/cwd injector also loses historical anchor state on a new session ID. Target stock navigation independently loses model selection, and its Codex effort planner still needs the durable local replay capability.
4. **R04/R05 — Two hidden remote-compaction replay paths survive.** The outer effective-API catch was exercised and emitted one intercepted full-history V1 request. The buffered entitlement-error SSE route was independently source-confirmed but not executed. A lower-layer no-SSE test cannot certify its outer caller or every alternative admission.
5. **R07/R08 — New transfer ownership hazards.** [INFERENCE] In-process writable resume bypasses startup moved-session handling; import compares local journals before acquiring ownership, so a racing append can be overwritten by older incoming content. Two reviewers independently traced both. No production data loss or executable race reproduction is claimed.

Additional concrete defects: native `cache_turn` description throws (R09, observed); native/ANSI totals disagree (R10); broker filtering can reach unrelated provider usage/auth (R11); Devin assignment auth failures leave cached JWT state (R12); native Anthropic compaction classification and side/main miss attribution are unreliable (R13/R14). Full conditions and fixes are in the register rather than duplicated here.

## Compaction coverage and migration policy

| Lane / transition | Finding and retained contract | Evidence limit |
|---|---|---|
| Manual/automatic/advisor summarize | M06: retain full host-vouched context, same-host-model gate, session/leaf ownership and one-call split-turn path | Source review; no live cache-hit measurement |
| Anthropic native | M05/M06/R13: preserve shared-prefix builder, intended incompatible-envelope stripping and current compact classification | Native namespace/beta behavior is not client-prefix proof |
| Codex V2 live/reconnect | R04/R05: chain-only policy must survive outer catch and every SSE admission; retain generate:false recovery and deferred acceptance commit | R04 executed; R05 static-independent |
| Alternate effective Codex API | R04: `remoteCompaction.api` selects policy even when native model API differs | Actual outer consumer emitted intercepted V1 request |
| Ordinary OpenAI V1/V2 | Do not globally impose Codex-only transport restrictions or erase explicit host method policy | No new provider failure proved here |
| Soft/snapcompact/image passes | M08/M09: repeated archive credit, resolved image limits/measured billing and zero-suffix warm-prefix guard | Source migration review; no redundant broad suite |
| Speculative/background/idle work | M09/M10: retain admission/epoch cancellation, purpose, model/lineage isolation and budget parking | Lower-layer behavior is not proof of full host ownership |
| Capacity/explicit configured fallback | Preserve classified provider rejection and existing declared method transitions; reject hidden internal history replay | No claim that every fallback is forbidden |

## Anthropic-specific guardrails

The review traced final JSON serialization/fetch, OAuth attestation rewriting, checkpoint walking, signed/redacted history, disabled-thinking stripping, effort controls, foreign-model safeguards, tool-result normalization, endpoint-scoped runtime cache fallbacks and native compaction envelope stripping. No additional proven regression is asserted for the compatibility paths that were only inspected.

- Capture final fetch bytes, not only `onPayload`; distinguish legitimate attestation/envelope changes from historical content drift.
- Count actual content blocks for checkpoint distance, not user turns. Preserve requested TTL and `cacheRetention=none` semantics.
- Keep old durable client omissions compatible on resume without deleting new server-managed drop reports.
- Preserve auth owner-only persistence, waiter-only cancellation and login-only bootstrap. Target's new account pools/broker behavior are not proof that 0090 is obsolete.
- Endpoint/model cache-option learning remains process-local; a cold process may relearn it. Do not label every compatible retry as a bug, but keep credit and signed-prefix authority intact.
- Prefix equality cannot prove cache hits when native compaction changes beta/context namespace. Real usage is a separate, explicitly authorized acceptance step.

## Rejected or qualified allegations

- Patch conflicts are not evidence of runtime bugs; clean application is not evidence of semantic safety.
- There is no demonstrated automatic token-POST retry inside the registry exchange engine: it performs one POST. The confirmed duplicate comes from later caller/ownership attempts after ambiguity.
- The reviewed agent schema remains 6 and auth schema remains 8. No invented schema-version migration defect; equal versions still do not prove rollback safety.
- Intentional `fallback` role restoration, explicit SDK model/thinking overrides and documented reclamping are not accidental A->B->A drift.
- Upstream Anthropic head relocation compensates for head breakpoint accounting; a claimed extra head breakpoint was rejected. Tool/image distance and local eligibility still require rebase.
- Parallel extension imports bind factories sequentially; no demonstrated registration-order race merely from parallel importing.
- The Antigravity discovery return-shape change has an updated consumer. The configured translator model is present in the actual baseline catalog.
- Proxy peer trust is explicitly gated; daemon generation IDs and reset fences have actual consumers. Their mere addition is not a vulnerability finding.
- Transfer notices correctly enter model context and a move intentionally changes cwd/identity. Historical prefix ownership matters; demanding whole-request equality across an intentional transfer would be wrong.
- Do not revive the retired CommandCode plugin merely to satisfy a parity fixture; exercise the actual built-in catalog/wire consumer.
- Native accepted-compaction metadata is already deferred until collector acceptance. That correct transaction does not block a separate SSE admission escape.

## Implementation and deployment recommendation

Approve the proposal in this order: auth/Anthropic authority boundaries -> session/transfer/compaction ownership -> remaining family rebase and UI/diagnostic repairs -> one integrated candidate acceptance. Keep same-family ownership and remove obsolete paths, not compatibility shims.

The audit modified only its task artifacts and the focused verification spec clarification. Existing user-dirty patches/controller/extensions/specs were preserved. No live mirror, real credential, production DB, proxy setting, global package/cache, commit, push or deployment was changed. Source CLI smoke does not stand in for the future interactive UI acceptance.

Updatable deliverables are complete. Remaining product work is explicitly enumerated in `implement.md`; it is not silently performed under an audit request.
