# Direct native Fusion design

## Decision and smallest behavior gap

OMP currently treats the selected Fusion composite as a direct chat model. Native Devin assigns its lead and maintains a persistent sidekick session with role-specific assignment, tools, history, and lifecycle. Implement those contracts directly over Devin RPC while retaining OMP's host tool executor and permission system.

This is a cross-layer feature, not a provider-only switch. Existing transport, agent-loop, tool-dispatch, and session-persistence primitives remain the foundation. Do not route through ACP, spawn Devin in production, or delegate Fusion to task/hub agents.

## Ownership

| Owner | Contract | Expected changes |
|---|---|---|
| Catalog discovery/types | Preserve explicit Fusion metadata and assignment eligibility through normalization, materialization, and cache reload | `pi-catalog/src/discovery/devin.ts`, `pi-catalog/src/types.ts`, affected serialization/declaration consumers |
| Protobuf and Devin provider | Encode internal routing field 6; perform role-aware assignment; reuse lead assignment for its valid session lifetime; map server-returned model identity; expose cancellation and request identity without owning filesystem tools | `pi-catalog/src/discovery/devin-proto.ts`, `pi-ai/src/providers/devin.ts`, necessary public option types/declarations |
| Fusion session coordinator | Exactly one child history and active handoff per owning OMP session; background/blocking reads, updates, cancellation, completion delivery, serialization | A focused module under `pi-coding-agent/src/session/`, wired through `agent-session.ts` |
| Tool registration/execution | Register Fusion-only `sidekick` and `read_subagent`; execute child OMP tools through the same validated/permission-aware path; expose progress via existing events | `pi-coding-agent/src/tools/index.ts` and minimal dedicated tool implementation; use `pi-agent-core` public agent execution primitives |
| Session persistence | Durable child history and handoff outcomes scoped to branch/reset boundaries, no persisted bearer tokens | Existing SessionManager custom entries; extend core persistence only if existing records fail the contract |
| Delivery | Replayable version-gated canonical patches, acceptance gates, ledger and runtime parity | `patches/`, `patches/apply.sh`, `patches/PATCHES.md` |

File names for new focused modules are implementation choices. Re-ground existing symbols and references before editing. Adding a generic provider-to-tool execution framework is not justified: `execHandlers` is Cursor-specific, not a ready-made Devin hook. The host session coordinator owns executable tools; the provider owns wire behavior.

## Data flow

1. Discover explicit Fusion metadata; preserve the selected composite as user-facing identity.
2. Create/load Fusion state under the owning OMP session and current branch/reset boundary.
3. Assign the lead through native RPC. Store the assignment only in transient, auth-scoped state. Send the returned UID/JWT on lead requests.
4. Expose native-semantics handoff/read tools only while Fusion is selected. Child receives permitted OMP tools but not recursively enabled Fusion handoff tools.
5. For an idle/completed child, assign a new handoff through field 6, restore its retained history, create the handoff's cascade/trajectory, and run its agent loop.
6. For an active child, queue the lead update in that handoff. Do not reassign or create another child. Preserve completed tool results and deliver the update at the appropriate model/tool boundary.
7. Blocking calls await that handoff. Background calls return immediately and arrange delivery through the owning session queue. Tool results are correlated by call ID; full reports are separate context notifications, once per handoff.
8. Persist child history/outcome at durable boundaries. On process reload, reconstruct completed history and reacquire transient assignment/auth. In-flight work lost with the process becomes interrupted, not implicitly resumed tool execution.

## State and invariants

Conceptual states: idle → running → completed / failed / cancelled. A running update stays within running; a completed/failed/cancelled state may receive a subsequent explicitly requested handoff. Cancellation uses an ownership generation so a late transport completion cannot overwrite the final state or publish a report.

Durable data consists of the complete typed child transcript (briefs, replies, thinking/signatures, tool calls/results), role/model selection, local handoff identity, terminal outcome, and delivered-report identity. Store this snapshot through `appendCustomEntry`; it is metadata and MUST be explicitly decoded/restored into the child Agent's messages before its next provider request. It must not automatically enter the lead context. Lead-visible completion notifications use the existing queued/custom-message path, including `appendCustomMessageEntry` when appropriate. On reload, traverse only the selected branch after its latest reset boundary and reconstruct child context from the last matching Fusion snapshot; compaction must retain that restore anchor and report-delivery identity. Never treat metadata presence alone as restored context: acceptance inspects the outgoing child messages. No API keys or assignment JWTs are persisted. Transient state owns assignments, abort controllers, waiters, and execution resources. `ProviderSessionState.close()` releases resources but is not the durable history store.

Identity rules:

- Stable local record IDs are distinct from regenerated wire message IDs.
- Tool result IDs must resolve to exactly one corresponding call in replayed context.
- Running updates preserve child cascade/trajectory; a new completed-handoff continuation uses the observed fresh handoff identity with retained history.
- Keep parent assignment cascade separate from child chat cascade. Decode and preserve the role-specific native request fields; do not attach the lead JWT to child traffic by assumption.
- Native trajectory/execution fields need a documented semantic mapping and live validation. Byte equality is not the acceptance criterion for incidental UUIDs/metadata.

## Tool safety and user experience

Keep OMP's normal user-facing lead stream. Attribute child progress and tool events using existing event/rendering facilities; avoid a second terminal or parallel transcript framework. Fusion-only tool definitions are registered with executable handlers before exposure. Switching away removes them and invalidates outstanding deliveries.

Existing authorization and tool allowlists remain authoritative. Background operations requiring interactive approval are denied rather than silently granted. A blocked read can finish before an update; side-effecting tool interruption must preserve atomicity and report the actual execution state. Native permission quirks are evidence, not permission to weaken OMP policy.

Use existing context-budget and compaction mechanisms for the child history, preserving required signatures and tool associations. Completion notifications belong to the lead context, not a wholesale copy of the child's transcript.

## Compatibility, validation, and rollback

Initial target is the installed and inspected OMP 18.2.3 release; recheck before implementation because other sessions are active. Other patch-plan versions remain unchanged until separately verified. Existing 0055/0056/0058/0060 behavior is preserved; overlapping changes are generated at their actual chain position, never repaired by cumulative ad hoc patch layers.

Build from verified pristine package archives plus the exact existing chain in a dependency-complete sandbox. Do not generate patches from live runtime/cache. Assign a patch number only after re-reading the current ledger; another session has already added 0073 during this investigation.

Validate at three distinct levels: native saved evidence, actual OMP sandbox behavior with controlled RPC, and authorized real-provider Fusion smoke. Keep these claims separate. The full feature is accepted only after AC1–AC9, not after the router-only improvement.

Rollback uses the existing chain-aware reverse/reapply mechanism and restores only this task's artifacts. Deployment and paid/live requests each require explicit approval for target and scope. A failed smoke preserves captured evidence and keeps production acceptance open; it does not change model selection to a cheaper substitute.

## Technical risks to resolve during implementation

- Exact session/model-switch hooks and queue ownership must avoid deadlocks while a blocking handoff waits.
- Native field 6 has observed bytes but no confirmed official field name; use a clearly documented internal name.
- Persisted branch/reset/compaction behavior needs actual OMP scenarios, not only provider fixtures.
- Retryable failures, wait timeout, disposal races, and side-effecting-tool interruption extend beyond the pinned native four-scenario set and must be exercised before acceptance.
- Live assignment/billing/cache semantics are not inferred from synthetic responses.
