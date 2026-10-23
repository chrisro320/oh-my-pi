# Pinned target source: auth, compaction, warming and budgets

Read-only findings recovered from AuthCompactSource at pinned commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. These are source observations, not patch-applicability, behavioral equivalence or passing gate results. Raw report: `agent://AuthCompactSource`.

## Source layout

Installed package names are not upstream directory names: `pi-ai` → `packages/ai`, `pi-agent-core` → `packages/agent`, `pi-coding-agent` → `packages/coding-agent`, `pi-catalog` → `packages/catalog`, `pi-tui` → `packages/tui`, `snapcompact` → `packages/snapcompact`. The first research query against `packages/agent-core` returned no commits because that path is absent, not because compaction was unchanged. Always map package metadata before concluding absence.

## Observations and conservative dispositions

| Boundary | Pinned target source | Migration obligation |
| --- | --- | --- |
| 0090 refresh shutdown | `packages/ai/src/auth/refresh.ts:158-178` adds `#shuttingDown`, `postmortem.register("oauth-refresh", …, {exitOnly:true})` and refresh draining; upstream commit `9614a961529d646a7ac19f445b5cd492ce13eb6c` | Integrate upstream SIGTERM/cancellation rotation preservation with our durable exchange journal. Neither implementation alone proves combined crash/idempotency behavior. |
| 0090 durable journal/unlock | Inspected target `auth/refresh.ts`, `store.ts`, `sqlite-credential-store.ts` lack `hasRefreshExchanges`, exchange reserve/stage/commit/inspect/read/release and `inspectUnresolvedRefresh`/`unlockAndRefreshStored`; lease/CAS already existed at baseline | Retain Anthropic-only durable journal and fenced unlock APIs. Preserve companion `auth-unlock.ts` consumers and declarations; upstream leases are not adoption of our exchange journal. |
| Compaction model context | `packages/agent/src/compaction/compaction.ts:695-705`; `packages/coding-agent/src/session/session-maintenance.ts:472-477,3572,5393` now thread fourth `model` argument through `buildProviderContext`/`buildLiveProviderContext` | Update every caller and public declaration while retaining live-chain/cache-preserving context, target kept-tail/overflow selection and Bedrock replay behavior. Do not drop target `model` or replace upstream structure with an old parallel path. |
| Custom compaction trace/instructions | `packages/agent/src/compaction/anthropic.ts:193-198` still takes three instruction arguments; inspected directory lacks `compaction-trace.ts` and live-chain prompt variants | Retain custom trace, live-chain instruction and notebook/manual-compaction behavior. Absence is source evidence only; new-file/import/replay proof remains required. |
| Codex transport | `packages/ai/src/providers/openai-codex-responses.ts:170-180,1480-1485,3412-3414,3465-3473,4911-4914` contains `responsesLite` and lite/non-lite socket/session-key separation; inspected target lacks old `toolNamespacesInfo` | Rebase chain-only recovery onto target transport axes and code-mode removals without resurrecting obsolete APIs or SSE/replay fallback. This is a high-risk shared conflict surface, not clean reuse. |
| 0092 warming | `packages/coding-agent/src/session/cache-warmer.ts:61,433-443,464-471` retains literal 30-minute limit; target inspected class lacks `PI_CACHE_WARMING_IDLE_MAX_MS`, parking/resumption and result-event contract | Retain eligible-lane idle override/parking/events alongside target idle-compaction TTL behavior. Reconcile shared SDK/event unions with 0010 and0095; companion `cron.ts` consumes both0092 and0010. |
| Image count/byte policy | `packages/snapcompact/src/snapcompact.ts:583-592`, `packages/coding-agent/src/session/provider-image-budget.ts:143-146`, `packages/catalog/src/compat/rules.json` use `providerImageBudget(model)`, `resolveImageCountBudget(model, reachesBudgetedHost(model))`, catalog count/inline-byte policies | Adapt0036/0044 on target catalog policy rather than restoring `(provider, api)` hard-coded tables. Upstream adoption is only a candidate pending official-endpoint/gateway/wire-family consumer proof. Preserve separate0052/0057/0062 billing/frame behavior. Catalog generated assets also intersect0100. |
| Anthropic0074/0094 | Target `packages/ai/src/providers/anthropic.ts` still uses `copyPerCallContextMessage`; inspected tree lacks custom `anthropic-request-audit.ts`; provider and shared `types.ts` changed | Rebase cache/audit and provenance-aware thinking-drop deltas together, maintaining a compilable import set and shared family ownership. Source presence is not serializer/persistence proof. |

## Required proof after implementation approval

- Synthetic SIGTERM-during-refresh child-process scenario must exercise combined shutdown, staged exchange, durable commit and fenced recovery without production credentials or databases. Reuse OAuth durable-refresh, unlock-fence and account-eligibility gates; companion unlock probe remains required.
- Compaction gates must exercise the actual target four-argument context path, retained-tail overflow, native Anthropic context, Codex chain/fail-closed and trace/cache-liveness. Rebase unchanged-looking modules only after zero-fuzz replay; commit history is not applicability proof.
- Image-budget gates and intercepted request-body smoke must distinguish official endpoints, gateways, API families and count/byte limits. Check archive/frame repricing and model billing separately. Do not retire an entire family because one budget dimension overlaps upstream.
- Warming proof must observe result events, idle stop/park/resume and companion behavior with0010 reservation semantics; type-check shared event/SDK consumers across0092/0095/0010.
- Anthropic boundary/audit/thinking-drop gates must observe actual serialization and restoration, not imports or source strings alone.

## Primary links

- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/ai/src/auth/refresh.ts#L158
- https://github.com/can1357/oh-my-pi/commit/9614a961529d646a7ac19f445b5cd492ce13eb6c
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/agent/src/compaction/compaction.ts#L695
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/session/session-maintenance.ts#L472
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/ai/src/providers/openai-codex-responses.ts#L3465
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/session/cache-warmer.ts#L464
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/snapcompact/src/snapcompact.ts#L583
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/catalog/src/compat/rules.json

## Evidence boundary

No target acquisition, SHA-256/provenance check, patch application/reversal, gate, test, build, source CLI/provider execution or native/Tern acceptance occurred in this research. No capability is retired or declared upstream-adopted. Per-path history and symbol absence may miss renamed/different-layer implementations; executable consumer evidence remains the deciding gate.
