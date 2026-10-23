# Capability migration disposition: 18.10.1 → 18.12.6

Planning dispositions, NOT completed migration or executable adoption evidence. Every locally owned capability remains a retention requirement. `Retain/rebase` is conservative: applicability and execution still require proof. `Evaluate upstream overlap` never authorizes removal by itself. Full current path ownership is in the manifest and `shared-path-owners.json` (43 shared paths).

| Current owner | Capability IDs | Target disposition | Behavior/proof obligation |
| --- | --- | --- | --- |
| `family-status-accounting` | `0033`, `0004`, `0081` | Adapt | Footer/profile/spend interfaces; retain custom cache/reset/branch accounting. |
| `family-hindsight` | `0034`, `0075` | Adapt | Preserve snapshot, promotion and prompt composition through target memory lifecycle. |
| `family-usage-pipeline` | `0037`, `0025`, `0026`, `0030`, `0031` | Adapt | Auth/usage facade and account authority; retain filtering and canonicalization. |
| `0010-omp-extension-idle-ephemeral-turn` | `0010` | Adapt | Retain atomic session-bound ephemeral execution and busy/abort reservation semantics. |
| `family-antigravity-wire` | `0014`, `0054` | Adapt | Retain stable session identity and wire shaping on target adapter. |
| `family-image-budget-snapcompact` | `0036`, `0044`, `0052`, `0057`, `0062` | Adapt; evaluate count-policy overlap | Target uses model/catalog count and inline-byte policies plus official-host gating. Integrate on those APIs; preserve separate model billing/frame repricing. No upstream adoption without gateway/wire-family/request-body proof. |
| `0032-omp-goal-tool-resident` | `0032` | Retain/rebase | Resident goal-tool lifecycle; no source-clean reuse claim. |
| `family-persistent-prefix-resume` | `0038`, `0043`, `0047`, `0076`, `0077`, `0083`, `0084`, `0093` | Adapt | Target still lacks the custom provider-only/anchor-map path and keeps inherited-auto precedence. Retain durable reminder/tool/system identity and approved model-default precedence while preserving target unverified-model handling. |
| `0046-omp-supersede-warm-prefix-guard` | `0046` | Retain/rebase | Keep side-effect ordering and warm-prefix supersede protection. |
| `0048-omp-advisor-quota-rotation-bound` | `0048` | Adapt | Preserve advisor bounds and native dependency closure on target lifecycle. |
| `0050-omp-session-history-preview` | `0050` | Adapt | Target session selector/listing interfaces; preserve history preview. |
| `family-devin-wire` | `0055`, `0071`, `0056`, `0058`, `0060` | Adapt | Preserve JWT TTL, metadata, signed thinking, cascade identity and wire behavior. |
| `0065-omp-commandcode-deepseek-model-record-parity` | `0065` | Adapt | Rebase catalog source/generated data without reviving retired external registrant. |
| `0069-omp-codex-effort-history-resume` | `0069` | Adapt | Retain effort serialization/persistence using target Codex transport contracts. |
| `0072-omp-session-pin-static-auth-ui` | `0072` | Adapt | Target selector/auth imports; actual first-use model/switch UI required. |
| `0074-omp-anthropic-context-cache-boundaries` | `0074` | Adapt | Retain cache breakpoint/trace behavior while preserving target request lifecycle. |
| `family-image-display` | `0078`, `0079`, `0080` | Adapt; evaluate0078 different-layer adoption | Target Python `_value_image` prioritizes PNG before JPEG; prove single preferred output/fallback before adopting0078 upstream. Retain/adapt Kitty0079/0080; no removed-display shim or coverage drop. |
| `family-input-translation` | `0082`, `0085` | Adapt | Retain original display/queue/draft restore and updated extension/session contracts. |
| `family-compaction` | `0035`, `0063`, `0066`, `0067`, `0068`, `0070`, `0088`, `0089`, `0096` | Adapt; evaluate upstream overlap | Preserve chain-only recovery, cache-bound summaries, retained-tail and latest saved notebook semantics. Thread target fourth `model` argument and retain Codex lite/non-lite isolation. No forced manual save or reintroduced automatic freshness veto. |
| `0090-omp-oauth-durable-refresh` | `0090` | Adapt | Integrate upstream SIGTERM rotation drain while keeping Anthropic-only durable exchange journal, broker lease/CAS/unlock and account-local discovery protection; synthetic shutdown/recovery proof required. |
| `0092-omp-cache-warming-idle-budget` | `0092` | Adapt | Target still lacks custom idle override/parking/events. Retain them alongside target TTL/eligibility; reconcile shared SDK/event consumers with0010/0095 and verify companion cron behavior. |
| `0094-omp-anthropic-thinking-drop-resume` | `0094` | Adapt | Retain provenance-aware thinking-drop/resume semantics on target request serializer. |
| `0095-omp-context-audit-request-purpose` | `0095` | Adapt | Preserve request purpose/session ownership; request-only audit must not borrow response attribution. |
| `0098-omp-tls-verify-transient-retry` | `0098` | Retain/rebase | Keep bare transient verification classification without retrying deterministic TLS faults. |
| `0099-omp-retry-slow-schedule` | `0099` | Retain/rebase | Retain 3-3-5-5-10-10-15-15 schedule and existing server-window constraints. |
| `0100-omp-stepfun-step-plan` | `0100` | Adapt | Retain built-in step_plan routing and explicit custom-base override through regenerated catalog. |
| `0101-omp-subagent-warm-revival-persisted-prompt` | `0101` | Adapt | Pinned warm path still re-renders and lacks persisted yield-item restoration; retain0101 and prove exact systemPrompt/tool/yield state on actual revival. Cold-path restoration is not warm-path adoption. |

## Non-local and excluded capabilities

- `0017`: existing upstream-owned capability; revalidate the target native-replay/self-contained versus connection-bound eligibility behavior with existing consumer coverage. It remains in the 62-capability acceptance union even without a local patch.
- `0097`: explicitly excluded computer-use candidate; do not activate it or its separate native artifacts.
- Previously retired/absorbed IDs are not resurrected to reconstruct an old layer count.

## Ownership and retirement rules

An upstream-adoption proposal must identify the current capability owner, exact target implementation, a consumer scenario demonstrating the same boundary/error/persistence behavior, and a negative control where practical. The final target union must equal the baseline 62 IDs after merging local ownership and proven upstream adoptions; duplicate ownership or dropped IDs blocks release. Physical family count may shrink only with those proofs, not by a preselected count target.

All shared-file generation is integrated in current controller order by one owner. Workers may investigate independent families; they must not each generate a whole final shared file or rewrite another family’s delta. Source and all affected public declarations move together. Companion extensions and native overlay form a separate release checklist, not extra unapproved text-family capabilities.
