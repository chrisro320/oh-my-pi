# Native Fusion protocol evidence

## Evidence boundary

Native version: 3000.10.31. OMP inspected: 18.2.3. Canonical archive: `native-evidence.zip`; per-file and archive SHA-256: `evidence-manifest.json`. Captures contain synthetic credentials only. Real user logs, HOME trees, and session databases are deliberately excluded. Original working directory: `/tmp/omp-fusion-native-61tdZC`.

The probe uses native ACP only as a controllable test driver for the executable. ACP is not the proposed product integration. Every native network request ran inside a disconnected bwrap namespace against a local controlled server. Server assignment UIDs, JWTs, model replies, and error messages are fixtures. Request ordering, client state, tools, persistence, and generated protobuf bytes are observations.

## Observed contracts

| Contract | Captures / proof |
|---|---|
| Fusion selection calls AssignModel, then uses returned lead UID/JWT | `repeat/requests.json`, captures 12–14; `direct-ab-result.json` compares real OMP public-provider paths |
| Internal assignment keeps parent cascade and adds string field 6 containing the full Fusion ID | `repeat/captures/015.bin`, `020.bin`; independent raw TLV check distinguished field 5 nested prompt from field 6 string |
| Sidekick receives selected child UID from the controlled assignment; observed child chat omits assignment JWT | `repeat/identity-decoded.json`, requests 17 and 21; server-side necessity is not established |
| Completed handoffs retain history but rotate child cascade | repeat requests 17 → 21; child history 3 → 5 messages |
| Running handoff update retains child cascade and avoids re-assignment | `async-steer/identity-decoded.json`: child requests 19 → 21, one internal assignment at 16 |
| Background lead continues while child response is held | `async-steer/probe.py`: explicit `child_started` / `release_child` barriers; request 18 proceeds before child completion |
| Completion delivered as correlated tool result plus separate report notification | async-steer request 22; exactly one notification in that request |
| Cancel marks child cancelled, despite temporarily open transport; late success is ignored | `lifecycle/cancel-late/verified-summary.json`, timeline, request 21 |
| Nonretryable child failure returns to lead, which continues | `lifecycle/failure/verified-summary.json`, child request 19, lead request 20 |
| Completed child history persists across native process restart | `lifecycle/resume/verified-summary.json`, child requests 18 → 25; old brief/reply and new brief present |
| Actual read execution survives a concurrent lead update, then result precedes update | `lifecycle/tool-read-execution/verified-summary.json`, child requests 19 → 21, one internal assignment; two-stage FIFO distinguishes preflight from execution |
| Background approval-required operations are denied | `lifecycle/permission-observations.json`; exec and webfetch attempts are permission evidence, not successful execution evidence |

## Identity details

`messageId` is regenerated even for retained prompt text within the same running child cascade. `toolCallId` remains the correlation to the model-emitted call ID. Native async-steer requests retain `trajectoryReference.trajectoryId`, advance `stepIndex` from 0 to 1, and populate an initially empty `executionId` on continuation. Completed-handoff reentry rotates trajectory and cascade. These observations do not prove server cache/billing requirements.

Current OMP `pi-ai/src/providers/devin.ts:871-896` generates an execution ID per request and does not populate trajectoryReference. This is a measured representation difference, not by itself a proven failure cause. Do not mutate unrelated metadata merely to make bytes look similar.

## Corrections that must survive handoff

- `harnessUids` is decoded correctly. Discovery deliberately excludes these routers; normalized model output loses Fusion-specific metadata.
- The source comment claiming all harness-backed composites are direct chat UIDs is contradicted by current native traffic; do not use it as an oracle.
- Field 6 is distinct from field 5. Its official name is not recovered; do not invent authoritative naming.
- The SWE-1.6-fast helper request is not the selected SWE-2-high sidekick. Native logs identify title updates around the helper; full helper semantics are not required for Fusion acceptance.
- Same-session history persistence does not imply stable wire messageId or a permanently fixed child cascade.
- The resume fixture uses `STREAM_BLOCK_HANDOFF`, whose sidekick call has `block:true`; the lead receives completion before process termination. A stale probe comment suggested an explicit read call, but the actual fixture and captured report establish completion.
- The first FIFO experiment interrupted preflight and produced a skipped-tool result. Only `tool-read-execution` proves interruption during actual read execution.
- Socket remaining open after cancel does not mean the native handoff remains active. The next read reports cancelled and late success is absent from lead history.
- Fixture success is not an OMP implementation result. Product code remains unchanged at planning time.

## OMP ownership map

Paths relative to installed `@oh-my-pi` package root; line anchors are investigation-time anchors, re-ground before editing.

- `pi-catalog/src/discovery/devin.ts:390-428,453-460`: normalized metadata and router exclusion.
- `pi-catalog/src/discovery/devin-proto.ts:1157-1169`: AssignModel fields 1,2,3,5 only.
- `pi-catalog/src/types.ts:940`: DevinCompat public contract.
- `pi-ai/src/providers/devin.ts:259-267,782-818,871-896`: assignment dispatch, unary transport, outgoing chat.
- `pi-ai/src/types.ts:340-342,543-546,636-637`: transient provider state and Cursor-only exec handlers.
- `pi-agent-core/src/agent-loop.ts:1844-1856,2803-2885`: provider call and host tool execution ownership.
- `pi-agent-core/src/agent.ts:1105-1119`: steering/follow-up queues; semantics require deliberate integration, not blind reuse.
- `pi-coding-agent/src/tools/index.ts:477,519-555,638`: tool factories and model/session-aware construction.
- `pi-coding-agent/src/session/agent-session.ts:5115-5138`: transient provider resource disposal.
- `pi-coding-agent/src/session/session-manager.ts:2859-2868`: reset boundary and durable custom entries.

## Reproduction

Extract the archive into an isolated research directory, preserve its layout, then run:

```sh
python3 lifecycle/verify-observations.py
```

This validates saved native observations, not a new native execution and not OMP behavior. Fresh execution uses the archived Python controllers under the same bwrap isolation described by this session; the scripts assume `/work`, `/opt/native`, and scenario-specific fixtures. The identity decoder currently pins the investigation machine's absolute package path; parameterize roots before promoting any probe into a repository regression gate.

Do not copy synthetic fixture replies into production. Permanent regression tests must exercise the selected package tree and include a negative control; they must not merely reread these saved PASS summaries.
