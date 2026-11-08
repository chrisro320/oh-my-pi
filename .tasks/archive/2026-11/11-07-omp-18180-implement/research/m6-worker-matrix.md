# M6 — 18.18.0 worker-mode matrix

## Candidate and isolation

- Final candidate supplied by M5: `/tmp/m5-final-snap`; runtime `/tmp/r2-run/m5final`; chain digest `64164a2a725ce6029e22b786be98fc90d9b3ed15dc36aacece09f7f23cd97494` (M5's chain receipt; M6 does not claim an independent chain replay).
- `patches/worker-matrix.sh` makes an independent reflink/copy of that runtime for **each invocation**, starts Bun inside `bwrap --unshare-net --unshare-pid --clearenv`, gives it a private HOME/XDG set, and mounts the repository read-only. Retained gates that create package-local probe files can write only the disposable runtime copy. Third-party dependency symlinks are read-only. No live installation, credentials, database, cache, or extension was modified.
- All provider operations use counted synthetic fetch implementations or the existing gates' offline transports. The OAuth9 fixture returns synthetic token responses in main; it never calls an external transport. The Q7 database is a newly initialized synthetic database copied inside the sandbox, **not** a read of the workstation's database.
- M6 never ran a harness write command, edited a family patch, staged files, or committed. `apply.sh` registration of `verify-worker-runtime.ts` was performed by M5 in the 18.18.0-only block.

## Reproduction commands and meaning of the modes

From the repository root:

```sh
# The two commands denoted M(g) and W(g) in the matrix below:
bash patches/worker-matrix.sh /tmp/r2-run/m5final main   patches/<gate>
bash patches/worker-matrix.sh /tmp/r2-run/m5final worker patches/<gate>

# Controller-selected worker-related gate set, both modes, bounded/drained JSON receipts:
python3 patches/run-worker-matrix.py /tmp/r2-run/m5final \
  .tasks/archive/2026-11/11-07-omp-18180-implement/research/m6-matrix-final.json --timeout 600

# Real MessagePort/service/lifecycle experiments and production mutation controls:
python3 patches/run-worker-runtime-controls.py /tmp/r2-run/m5final \
  .tasks/archive/2026-11/11-07-omp-18180-implement/research/m6-runtime-controls-final.json

# Every forced-mode leg must reject a pool that actually selects main:
python3 patches/run-worker-placement-controls.py /tmp/r2-run/m5final \
  .tasks/archive/2026-11/11-07-omp-18180-implement/research/m6-placement-controls.json
```

`main` means no worker pool: the standalone launcher declares no CLI worker host, so the production pool factory returns no pool. It deliberately does not preload the runtime before a gate establishes its private environment. `worker` uses `workerPoolForTests({entry: worker-matrix-entry.ts})`, hence `hostsOnMain:false` and `maxWorkers:()=>4`; a missing worker is a failure. An RPC receipt must name the acquired worker's thread. The worker entry boots the selected runtime's actual thread services.

The old gates construct SDK **roots**, including root-only disposal and local log-sink assertions. For those root fixtures only, the adapter resets the registry/lifecycle/IRC test globals in that realm and disables log forwarding so the existing assertions see their own records. This does **not** impersonate the main thread or move the gate back to a subprocess on main: Bun's worker identity and the runtime's worker identity remain worker. Exported runtime probes do **not** get those fixture resets; their settings, auth and memory objects traverse real production service bridges.

`worker-matrix-spawn.ts` preserves the selected mode across the gates' Bun re-exec/probe children. Each child has its own main controller plus its forced worker; disk-resume probes therefore execute the consumer in a worker too. The adapter captures a gate's explicit `process.exit`, returns its code by RPC, disposes the pool, and propagates successful exit from the standalone launcher. This avoids mistaking main-side service idle timers for unfinished assertions.

The matrix is a **realm/behavior twin** of each retained gate, supplemented by actual worker-to-main service probes. It is not a claim that a gate's historical SDK root is itself a production child. `verify-worker-runtime.ts` is the main-owned experiment controller: it checks both main-owned state and real worker behavior internally, not a recursively worker-homed copy of the controller.

## Runtime experiments and local-fix legs

The complete baseline and all mutation receipts are in `m6-runtime-controls-final.json`. The baseline exits 0. Twelve independently reported scenarios pass:

| Experiment / capability | Observed result |
|---|---|
| Shipped settings | `task.workerThreads=4`; `task.agentIdleTtlMs=420000`. The threshold behavior remains upstream's first worker at nine concurrent subagents; the forced fixture bypasses that threshold only for test placement. |
| Q1 / 0047b | Re-run by `verify-session-transfer-authority.ts` in the matrix. Main-held leases refuse worker adopt, exclusive/strict claim and packing; journal bytes, ID, path and directory remain unchanged, with no sibling/archive. After release, the worker adopts the same ID/path. The reverse ownership direction is also checked. This is the existing R2 Q1 leg, not a newly invented lock implementation. |
| Q2 / 0101 | A real worker runs `runSubprocess`, parks and warm-revives the child, records the provider-facing system/tool projection, then is terminated. A different worker calls the real `revivePersistedSubagent` against the surviving JSONL and sends its first request. Warm and cold bytes both equal the pre-park bytes: **12,646 bytes**, SHA-256 `aec48e4cf934b17a9f194f79726fb5c9368349e3e11dad4dd19edc6dd23676a7`. The fixture includes read/write/yield schemas and persisted work-pool items. No MCP server is installed in this fixture; equality is measured on the tools it actually sends. |
| Q3 / profile | The actual selected CLI `runCli(["--profile","m6-profile","--version"])` argument bootstrap runs after process start; a subsequently forced worker reports matching `getAgentDir()`, active profile, and `PI_CODING_AGENT_DIR`. Its idle-budget diagnostic also sees `777777`. On the observed Bun 1.4.4 runtime, runtime env writes **do** reach the new worker. The older research's plain-worker inference did not reproduce; no product env patch was justified. This exercises the source CLI argv bootstrap plus the authorized test worker entry, not a packaged-binary smoke test. |
| Q4 / 0090 | `bridges` calls the real worker `RemoteOAuth` inspection and unlock members against main's AuthStorage: `no-credential` and `nothing-to-unlock`, rather than a missing method. `OAuth9` uses **nine distinct real worker threads**, two bursts, exactly one token POST per burst; only `fixture-refresh-seed` then `fixture-refresh-1` are presented. Refresh grants returned to workers are redacted as `__remote__`. |
| Q5 / mirrors, 0034 | Ten local/remote method surfaces are enumerated in a real worker. A real main HindsightSessionState crosses the production class codec; worker reads change from `LIVE MAIN MM A` / recall A to MM B / recall B when main changes them, and the bank set remains live. The actual RemoteAgentSession also carries the advertised model plus `evalToolNames`. See the member inventory below. |
| Q6 / payload archive | Two real workers, same pid, same frozen millisecond `1800000000000`, same session/model/initial sequence: the M7 repo companion produces two different files because the filename contains the OS thread id. Removing only that discriminator produces one overwritten file and fails the count assertion. The live extension remains untouched. |
| Q7 / agent.db | Nine distinct real worker threads open one private copy of a synthetic AgentStorage database, synchronize at a SharedArrayBuffer barrier and commit 100 unique model-usage rows each. **900 rows**, zero captured write/lock failures, `PRAGMA integrity_check = ok`. This tests real concurrent SQLite handles, not nine Promise calls on one main-thread handle. |
| Q8 / reap versus resident TTL | With worker idle time compressed to 30 ms, a resident `retain()` keeps the worker alive for 100 ms; releasing that hold permits `exitReason="idle"`, and the next placement receives a different worker. Combined with Q2's warm/reaped-cold request observations and the asserted 420000-ms agent TTL, a worker idle deadline cannot reap a retained resident. The compression test releases the resident hold explicitly; it does not wait seven real minutes for the agent timer. |
| 0081 / 0033 | Journal entries are produced in a real worker and transported by RPC. Main's actual RemoteAgentSession indexes them, excludes a large auxiliary usage entry and returns **90**; the actual status segment renders `90.00%`. The retained cache-hit gate separately covers absent optional members, native/ANSI parity, branch truncation and the reset-count glyph in both realms. |
| 0055 / 0056 / 0071 | Four real worker realms each send two synthetic Devin turns: **one JWT mint per realm**, four distinct session UUIDs and eight distinct `(sessionId, requestId)` pairs. Bare request counters intentionally restart per realm; pair uniqueness is the contract. At the same frozen millisecond, four thread-discriminated JSON dump names survive. |
| 0031 / 0099 | The `bridges` worker receives the real main AuthStorage and Settings through production codecs. Main sees provider sets `[anthropic]`, `[anthropic,openai]`, and `[]`, twice and unchanged. Updating main retry base delay from 500 to 90000 reaches the worker mirror while the actual retry helper still produces `3000,3000,5000,5000,10000,10000,15000,15000,15000`. |
| Child compaction + Anthropic continuation | Main first primes an actual provider thread. A worker uses the **same session id** with its own provider state, receives main Settings by reference, calls real `createSubagentSettings` with a child threshold overlay, runs real `prepareCompaction` + `compact`, then continues. Two summary requests are unthreaded; the child's continuation still names `m6-msg-1`. Main then also continues its own `m6-msg-1`. Child settings are mid-turn=true, percent=10, tokens=1024, model thresholds disabled; main remains false/77/98765. No main anchor or overlay leakage is observed. M5's full warm/short/split/retry/OpenAI isolation gate is also run in both realms by the matrix. |

0083's suspected `^model:level` loss did not reproduce: the retained resume gate's effort and advertised eval-tool assertions are part of both modes. No speculative family fix was added.

## Q5 member inventory

Only consumers that cross a boundary need a mirror member. Owner-local implementation APIs must not be exposed as arbitrary new cross-thread commands.

| Family-added or extended surface | Ownership and evidence |
|---|---|
| SessionManager / SessionEntryIndex `getMainCacheHitRate` / `mainCacheHitRate`; optional StatusLineSession member | Actual worker entries → actual RemoteAgentSession index → status consumer in runtime leg 0081. All three optional status reads and native twins remain in the retained gate. |
| AgentSessionHandle / RemoteAgentSession / status host `fetchUsageReports(signal, provider)`; auth `usage.reports` provider/provider sets | Present on actual RemoteAgentSession; source-hop assertions remain in `verify-usage-thread-providers`; new `bridges` observes the actual worker-to-main provider sets, including empty scope. |
| RemoteOAuth `inspectUnresolvedRefresh`, `unlockAndRefreshStored` | Enumerated and invoked through the real worker class bridge; OAuth9 also exercises real async refresh ownership. Credential exchange/lease/store methods stay main-owned behind this API. |
| AgentSession `runIdleEphemeralTurn`, `hasIdleEphemeralReservation` | Present on the worker's local AgentSession prototype. Intentionally not added to RemoteAgentSession: these are root/UI idle-owner APIs, not child-control commands. Existing idle reservation/keepalive gates run in both realms. |
| SessionManager `retainWritableOwnership`, `adoptForWrite`, `beginWritableAdoption`; extended `setSessionFile`, `moveTo`; SessionStorage `claimSession` exclusive/strict | Writable ownership belongs to the thread holding the actual writer. Local methods are enumerated; the real-worker Q1 session-transfer gate drives refusal/adoption and transaction behavior. No fake remote manager writer is introduced. |
| AgentSession extended `buildDisplaySessionContext` persistence options, session switching/relocation, eval/recovery reminders | Owner-local transcript operations; disk replay, navigation and persistence are exercised by the resume/transfer gates in both realms. The view mirror has entries/indexes, not a second journal writer. |
| HindsightSessionState `beginMentalModelsTranscriptReload({readOnly})`; SessionMemory `promotionTail` and promotion snapshot tail arguments | Local session/memory owner APIs. Worker owns its own SessionMemory and Hindsight state; the parent's alias contract only reads client/config/banks/recall/MM. The new real-worker alias probe proves those reads stay live; recall-snapshot and promotion-slot twins cover local ownership/generation behavior. No missing remote reload method is inferred from an API that never promised one. |
| `getSessionAgents`, persisted advertised eval-tool names, work-pool yield restoration and mounted tools | Actual RemoteAgentSession methods/advertised surface are checked. Model-mention/resume twins cover eval-tool and effort replay. Warm-revival twins and Q2 cover the system/tool/init contract. `setWorkPoolYieldItems` is a real mirror command; no nonexistent mirror getter is assumed. |
| `ContextEvent.purpose`, `transformContext(..., purpose)`; extension action `appendEntryPersisted` / input-preparation surface | Extension factories rebind in their owning worker; these are local extension/session contracts, not separate RemoteAgentSession commands. Context-audit/resume gates exercise consumer behavior in both realms. |
| CacheWarmer `settling`, defer/report and cache-warming result hooks | Root/main idle-owner state. Production subagents are created with warming disabled. No new worker mirror or worker timer is introduced; main-owned warm/summary isolation is covered by M5's gate and the worker compaction scenario. |
| Devin conversation/request metadata and `conversationId`; persisted dropped-thinking replay; compaction context/options | Value payloads owned by their provider/session realm, not class methods to mirror. Devin, Codex, dropped-thinking and compaction twins plus the new worker scenario cover their serialization/continuation behavior. |

## Mutation evidence

- `m6-runtime-controls-final.json`: **18** controls change only disposable selected-runtime/package or staged companion copies. Each must exit nonzero, without timing out, and name its intended observable; a load failure is not accepted.
- Controls cover: wrong actual mirror cache ratio; dropped actual mirror model/eval-tool surface; changed cold persisted system prefix; stripped worker profile env; stale main-to-worker MM; lost DB writes; ignored resident retain; disabled Devin JWT reuse; reused Devin session UUID; non-incrementing request id; removed Devin dump thread id; re-enabled threads on summaries; wrong child mid-turn overlay; dropped provider sets; dropped settings mirror updates; missing unlock bridge; duplicate OAuth rotation; removed payload archive thread id.
- `m6-placement-controls.json`: each selected twin's forced-worker launch is also run with a copied fixture changed to `hostsOnMain:true, maxWorkers:()=>0`. Every one must fail specifically at `forced placement must not silently select main`. These are placement controls, **not** substitutes for the product behavior mutations above or the retained gates' own controls.
- Q1's lease mutation controls are the existing R2 `xthread-lease` / `xthread-strict` controls recorded in the task evidence; M6 re-runs the actual Q1 behavior leg rather than claiming a second new lock fix.

## Family fixes, fallback and ownership

No new family defect was demonstrated by the completed runtime experiments. No family diff is proposed for main to amend. In particular, Q3 did not justify the previously hypothesized env change and Q2 did not justify changing cold-revival system/tool reconstruction.

The initial matrix attempt exposed **test-harness** issues, not D4 candidates: package-local probe writes against a read-only runtime; root-fixture disposal reaching the worker's intentionally non-disposable remote lifecycle; log-sink assertions observing forwarded rather than local logs; audit fixture dirs cached before it reset its private agent dir; and standalone gate exits not propagated after RPC completion. The first four were fixed by disposable copies/root-fixture setup and M5's explicit audit-fixture `refreshDirsFromEnv()`; the launcher now propagates completed gate exit after pool disposal. Earlier red receipts (`m6-matrix-r5.json`, `m6-matrix-m5.json`) are retained as investigation history, not silently reclassified as product passes.

D4 fallback was **not** taken: `worker-disabled=[]`. The blocking default assertion remains **4**, not 0. A main-mode failure cannot be demoted under D4. Enabled Anthropic threads are used by the new scenario; no D3 rollback was taken either.

## Files changed by M6

New test/runner files:

- `patches/worker-matrix.sh`
- `patches/worker-matrix-runner.ts`
- `patches/worker-matrix-entry.ts`
- `patches/worker-matrix-spawn.ts`
- `patches/run-worker-matrix.py`
- `patches/run-worker-placement-controls.py`
- `patches/verify-worker-runtime.ts`
- `patches/worker-runtime-probe.ts`
- `patches/worker-thread-scenario.ts`
- `patches/run-worker-runtime-controls.py`

Evidence is under this task's `research/`, including this report and the JSON receipts. M7 owns the new `patches/payload-archive-extension.ts` companion; M5 owns the audit fixture correction and the apply.sh registrations. M6 did not edit TASK.md or any excluded other-work file.

## Gate matrix

The commands `M(g)` and `W(g)` are the exact two single-gate commands defined above with `<gate>=g`. The final JSON receipt records the expanded argv, exit code, deadline result, elapsed time, concurrently drained output hashes/byte counts, and bounded tails for each cell. The listed gates are the intersection of the 18.18.0 `--print-gates` menu and the worker-related set in plan §2/§3 (including the extra resume, idle-owner, compaction and thread consumers).

Accepted consolidated receipt: **`m6-matrix-accepted.json` — 43 gates × 2 modes = 86/86 PASS**. It is a lossless cell selection from `m6-matrix-final.json`, `m6-final-worker-completion.json` and `m6-final-shape-main.json`; the original red/incomplete attempts remain available. Every accepted cell has exit 0 and complete capture with no deadline expiration. The warm-revival worker leg required **788.277 s**, including all five production mutation copies; its original 600-s attempt expired after three controls. The runner now grants that specific leg 1800 s. Manual-compaction's worker root fixtures completed at 368.691 s. These are measured fixture/teardown costs, not hidden skips.

| Gate `g` | Main `M(g)` | Worker `W(g)` | Worker seconds |
|---|---|---|---|
| `verify-main-cache-hit.ts` | PASS | PASS | 1.114 |
| `verify-usage-reset-format.ts` | PASS | PASS | 1.117 |
| `verify-hindsight-recall-snapshot.ts` | PASS | PASS | 176.848 |
| `verify-hindsight-recall-promotion-slot.ts` | PASS | PASS | 2.026 |
| `verify-usage-statusline-gate.ts` | PASS | PASS | 1.296 |
| `verify-usage-thread-providers.ts` | PASS | PASS | 1.578 |
| `verify-session-transfer-authority.ts` | PASS | PASS | 2.660 |
| `verify-date-cwd-journal-prefix.ts` | PASS | PASS | 6.669 |
| `verify-interrupt-prune-symmetry.ts` | PASS | PASS | 2.062 |
| `verify-eval-state-context-persist.ts` | PASS | PASS | 2.557 |
| `verify-turn-recovery-reminder-persist.ts` | PASS | PASS | 2.701 |
| `verify-model-mention-surface-resume.ts` | PASS | PASS | 10.197 |
| `verify-length-stop-reminder-persist.ts` | PASS | PASS | 2.478 |
| `verify-prompt-effort-resume.ts` | PASS | PASS | 7.844 |
| `verify-model-selection-resume.ts` | PASS | PASS | 13.180 |
| `verify-devin-auth-cache.ts` | PASS | PASS | 1.214 |
| `verify-devin-metadata.ts` | PASS | PASS | 1.146 |
| `verify-devin-thinking-signature.ts` | PASS | PASS | 1.109 |
| `verify-devin-idle-cascade-pin.ts` | PASS | PASS | 1.634 |
| `verify-oauth-durable-refresh.ts` | PASS | PASS | 14.676 |
| `verify-auth-unlock-extension.ts` | PASS | PASS | 3.873 |
| `verify-codex-account-eligibility-retention.ts` | PASS | PASS | 1.158 |
| `verify-google-account-eligibility-retention.ts` | PASS | PASS | 1.157 |
| `verify-oauth-worker-single-owner.ts` | PASS | PASS | 1.584 |
| `verify-subagent-warm-revival-prompt.ts` | PASS | PASS | 788.277 |
| `verify-context-persist-audit.ts` | PASS | PASS | 2.230 |
| `verify-retry-slow-schedule.ts` | PASS | PASS | 1.090 |
| `verify-idle-ephemeral-reservation.ts` | PASS | PASS | 3.305 |
| `verify-session-cache-keepalive.ts` | PASS | PASS | 1.112 |
| `verify-resume-cache-breakpoint.ts` | PASS | PASS | 7.567 |
| `verify-prefix-cache-compaction.ts` | PASS | PASS | 1.143 |
| `verify-codex-compaction-chain.ts` | PASS | PASS | 2.083 |
| `verify-remote-compaction-target-key.ts` | PASS | PASS | 2.106 |
| `verify-compaction-cache-liveness.ts` | PASS | PASS | 1.704 |
| `verify-anthropic-native-compaction-live-context.ts` | PASS | PASS | 1.167 |
| `verify-compaction-length-stop.ts` | PASS | PASS | 2.082 |
| `verify-manual-compaction-direct.ts` | PASS | PASS | 368.691 |
| `verify-compaction-live-chain-midnight.ts` | PASS | PASS | 33.926 |
| `verify-anthropic-thinking-drop-resume.ts` | PASS | PASS | 1.154 |
| `verify-anthropic-request-audit.ts` | PASS | PASS | 2.382 |
| `verify-anthropic-cache-boundaries.ts` | PASS | PASS | 2.802 |
| `verify-anthropic-threads-cache-shape.ts` | PASS | PASS | 3.052 |
| `verify-anthropic-threads-warm-compaction-isolation.ts` | PASS | PASS | 3.605 |

The newly registered `verify-worker-runtime.ts` controller additionally passes all 12 scenarios internally in `m6-runtime-controls-final.json` (including the real main+worker continuation/isolation scenario); its 18 production/companion controls all reject their intended observable. It is not included as a recursive twin because its job is to own main while controlling real worker peers. Per-gate placement controls: **43/43 rejected** in `m6-placement-controls.json`.

M8 can run the registered runtime gate normally and run the twin matrix separately with the commands above. No full release oracle/build/typecheck is claimed by M6; those remain main's M8 work.
