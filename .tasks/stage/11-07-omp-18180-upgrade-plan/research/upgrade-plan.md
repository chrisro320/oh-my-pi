# OMP 18.18.0 升級計畫（2026-11-07）

TASK.md 是任務紀錄；本檔是計畫交付物本身：§1–§10 是分類與設計，§11 是實作里程碑。

Sources:
- baseline.md
- classify-18180.md (24 per-family reports)
- compaction-prefix.md
- worker-threads.md
- upstream-risks.md
- extensions-compat.md
- native-overlay.md
- adoptions-recheck.md (the AdoptionsRecheck result with 18.18.0 file:line evidence for the six §2.2 rows)

Where two reports disagree on a class, the table takes the more conservative class and says so in the note.

Labels used below:
- D2–D5: the decisions recorded in TASK.md 做法 and DECISIONS.md "OMP 18.18.0 升級計畫（2026-11-07）". D2 = plan only; build, install and publish each need separate approval. D3 = adopt Anthropic message threads. D4 = ship worker threads on (`task.workerThreads=4`). D5 = Codex text verbosity follows upstream `low`.
- "M12" without a release means the 18.16.0 upgrade's physical acceptance (DECISIONS.md, physical acceptance entry); M0–M9 are this plan's milestones (§11).

## 1. Numbers
- Manifest: 62 capability IDs, made up of 56 in 26 families plus 6 upstream adoptions. 3 are retired by the user (0065, 0025, 0100), which leaves 24 families to carry.
- fuzz-0 chained replay on 18.18.0 fails in 12/24 families, 67 hunks in total. The 18.16.0 control fails 0/26.
- "Applies" is not "correct". Five clean or partly clean applies are semantically wrong on 18.18.0:
  - 0074 hunk 1 removes an import that upstream threads now use, which crashes on the first Anthropic request.
  - 0092 hunk 11 references the removed `isCurrent`/`touchedAt`, which throws in a timer.
  - 0090 `model-manager` declares a new parameter that is never passed, so the 403 retention silently becomes a no-op.
  - family-compaction `openai-codex-responses.ts` hunks land at offsets −90…−585, i.e. at the wrong place.
  - 0010 hunk 13 calls a 2-argument preflight whose definition is still 1-argument, which does not compile.
- Rule for implementation: any hunk with an offset greater than 50 lines, or one in a file upstream rewrote, is re-authored and reviewed, never accepted from `patch` output.

## 2. Capability classification (62/62)

Class values:
- RETIRED-USER
- ADOPT-CANDIDATE: upstream now provides it; retiring the local code needs a consumer proof and a negative control.
- UPSTREAM-ADOPTED: already retired before 18.18.0; re-verified here.
- MECH: mechanical re-anchor.
- SEM: semantic rebase.
- REDESIGN.

Worker column:
- no: no main-thread assumption.
- crash / silent: the failure kind when `task.workerThreads>0`, fixed as noted.

### 2.1 Families
| ID | family | class | effort | gate(s) | worker | note |
|---|---|---|---|---|---|---|
| 0033 | status-accounting | MECH | S | verify-main-cache-hit, verify-usage-reset-format | crash (via 0081 contract) | `cache_turn` sits beside upstream's new `cache` segment; add legs for branch truncation and `✦<count>` |
| 0004 | status-accounting | MECH | S | verify-main-cache-hit | no | upstream `token_total` still excludes cacheRead |
| 0081 | status-accounting | SEM | M | verify-main-cache-hit + mirror legs | crash → fixed | `getMainCacheHitRate` becomes optional; implement it on `RemoteAgentSession` from its `SessionEntryIndex` |
| 0034 | hindsight | MECH | M | verify-hindsight-recall-snapshot | silent (inherited) | keep `HindsightSessionStateApi`; a worker reads main's live MM through the alias, so add a leg |
| 0075 | hindsight | SEM | M | verify-hindsight-recall-promotion-slot | no | the reset moves after upstream's reordered base-prompt refresh (`agent-session.ts:13783-13802`) |
| 0037 | usage-pipeline | MECH | S (+M gate) | NEW verify-usage-statusline-gate | no | no gate today |
| 0026 | usage-pipeline | MECH | S | NEW (folded into the 0037 gate) | no | 0090 depends on `invalidateReport` |
| 0030 | usage-pipeline | MECH | S | NEW (7-input key collapse leg) | no | `claude-api.ts` canonicalizer unchanged |
| 0031 | usage-pipeline | MECH | M | NEW thread-boundary leg (single, multiple and empty provider sets over a real worker RPC) | silent → fixed | forward `provider(s)` through `session-publisher`, `agent-session-handle`, `remote-agent-session`, `auth-protocol` **and** the RPC tuple plus both dispatch sides (`thread/session-mirror.ts:286`, `services/auth-remote.ts:471-489`, `services/auth.ts:270-274`); an empty set must not widen into an unrestricted probe |
| 0025 | usage-pipeline | RETIRED-USER | S | verify-ollama-cloud-usage leaves the 18.18.0 selection only | — | drop patch block `:732-882` and the manifest path in the 18.18.0 family copy. The gate file and its registration for older arms stay (§10 Class C); this supersedes the "delete the gate" steps (4)–(5) in classify-18180 §0025 |
| 0010 | 0010 | SEM | M | verify-idle-ephemeral-reservation, verify-session-cache-keepalive | no | adopt upstream's preflight generation body; add a second parameter to both helpers; re-anchor 4 hunks |
| 0014 | antigravity-wire | MECH | S | verify-antigravity-envelope | no | file byte-identical upstream |
| 0054 | antigravity-wire | ADOPT-CANDIDATE | S | verify-antigravity-envelope:42 (negative control; the gate stays because it also covers 0014) | — | upstream sends no `requestType`. Through M0, 0054 stays owned by the 18.18.0 antigravity-wire family so the oracle's ownership/adoption contract passes. In M1, after its consumer proof and negative control, one atomic change removes its hunks from the 18.18.0 family, registers it as an upstream adoption in the 18.18.0 manifest, and adds the controller marker `PLAN_CAPABILITIES[0054]=upstream` for the 18.18.0 arm (same pattern as `apply.sh:385-399`), so it stays counted and gated. `patches/0054-*.patch` and its apply.sh base-list entry stay, because the retained 18.4.4 arm derives its candidate from them (`apply.sh:115-159,248-252`) |
| 0036 | image-budget-snapcompact | MECH | S | verify-provider-image-budget | no | `rules.json` is generated: stage the exact-tag pi-catalog compiler (`git -C upstream.git` at `v18.18.0`, offline deps) and compile; the npm tarball has no `scripts/`. Fallback if the compiler cannot be staged: the scripted transformation from classify-18180 §image-budget, accepted only if it equals compiler output on the pristine 18.18.0 KDL set (round-trip proof) |
| 0044 | image-budget-snapcompact | MECH | S | verify-provider-image-budget, verify-catalog-regen-parity | no | `image-budget.kdl` enters `rules.files` |
| 0052 | image-budget-snapcompact | MECH | S | verify-snapcompact-model-billing | no | measured frame table still ours |
| 0057 | image-budget-snapcompact | MECH | S | verify-provider-image-budget | no | Devin image budget |
| 0038 | persistent-prefix-resume | ADOPT-CANDIDATE | S | verify-date-cwd-journal-prefix | — | upstream date/cwd journal (providerOnly tail already retired in 18.16.0) |
| 0047a | persistent-prefix-resume | ADOPT-CANDIDATE | S | verify-date-cwd-journal-prefix | — | anchors retired since 18.16.0 |
| 0047b | persistent-prefix-resume | SEM | L | verify-session-transfer-authority | crash/silent → fixed | module-level `sessionLeases` is per-thread; cross-thread exclusion must go through main. Q1 asserts session ID and path unchanged, no sibling file, or an explicit refusal while the old owner holds the lease (upstream may move writes to a sibling: `session-manager.ts:1157-1182,1533-1536`) |
| 0043 | persistent-prefix-resume | SEM | M | verify-interrupt-prune-symmetry | no | the pool says SEM, CompactionPrefixDesign says MECH; conservative SEM |
| 0076 | persistent-prefix-resume | SEM | M | verify-eval-state-context-persist | no | partial adoption: upstream persists the initial eval snapshot (`agent-session.ts:2175-2188`) |
| 0077 | persistent-prefix-resume | MECH | S | verify-turn-recovery-reminder-persist | no | — |
| 0083 | persistent-prefix-resume | SEM | M | verify-model-mention-surface-resume | no | carry `evalToolNames` through resume. A `^model:level` effort loss on resume is **suspected only**: the reviewer showed the `model_mention` journal keeps `thinkingLevel` and dispatch resolves it (`model-mentions.ts:21-48,110-163`; `structured-subagent.ts:516-519`; `executor.ts:4805-4806`). Implementation first demonstrates a failing path; with no such path there is no change and no red expectation |
| 0084 | persistent-prefix-resume | MECH | S | verify-length-stop-reminder-persist | no | after 0076 |
| 0093 | persistent-prefix-resume | SEM | M | verify-prompt-effort-resume, verify-model-selection-resume | no | `switchSession` rebase at `agent-session.ts:13723-13734` |
| 0046 | 0046 | MECH | S | verify-supersede-warm-prefix-guard | no | byte-identical region |
| 0048 | 0048 | MECH | S | verify-advisor-quota-rotation | no | O2 declined by the user (2026-11-07): behaviour stays as today |
| 0050 | 0050 | MECH | S | verify-session-history-preview | no | 8 version literals |
| 0055 | devin-wire | MECH | S | verify-devin-auth-cache + NEW worker leg | silent | the module-level JWT cache is per thread, so each worker makes 1 extra `GetUserJwt`; accepted cost, leg asserts at most 1 per worker |
| 0071 | devin-wire | MECH | S | none (dump is opt-in debugging) | silent (diagnostic) | add a thread id to the dump file name |
| 0056 | devin-wire | MECH | S | verify-devin-metadata + NEW worker leg | silent | per-thread `sessionId`/`requestId` counters; leg asserts IDs stay unique per thread |
| 0058 | devin-wire | MECH | S | verify-devin-thinking-signature | no | — |
| 0060 | devin-wire | MECH | S | verify-devin-idle-cascade-pin | no | retarget the `preferWebsockets` context line to `resolveWebsocketPreference` |
| 0069 | 0069 | MECH | S | verify-codex-effort-resume | no | regenerate as a pure addition (restore the upstream comment) |
| 0074 | 0074 | SEM | M | verify-anthropic-cache-boundaries, verify-anthropic-request-audit + NEW thread gates | no | keep the `isPerCallContextMessage` import; audit tracks the full accepted thread history (§4) |
| 0080 | image-display | MECH | S | verify-kitty-shared-png-cache + dispose-in-flight leg | no | set `#disposed` before upstream's new shell-replay teardown, not an early return |
| 0082 | input-translation | MECH | M | verify-user-display-text-queue (18.18.0 arms; allowlist stops at 18.12.6), verify-rejected-prepared-draft-restore, NEW extensions-load-18180 | no | 7 failed hunks to re-anchor (5 import drift, 1 `CostGateApi` context, 1 field anchor from 0010; classify-18180 §input-translation). O1 (approved): drop the midnight-reverting hunk at `:2283-2297` |
| 0085 | input-translation | MECH | S | verify-rejected-prepared-draft-restore | no | — |
| 0035 | compaction | SEM | M | verify-prefix-cache-compaction, NEW verify-compaction-live-chain-midnight (O1) | no | the pool says SEM, CompactionPrefixDesign says MECH; conservative SEM because of the midnight interaction |
| 0063 | compaction | SEM | L | verify-codex-compaction-chain | no | re-author on `ResponsesWebSocketConnection`; upstream has no compaction chain branch |
| 0067 | compaction | SEM | M | verify-compaction-lane-trace | no | rides on 0063 |
| 0068 | compaction | SEM | L | verify-codex-compaction-chain, verify-remote-compaction-target-key | no | chaining decision after reservation inside the rewritten transport |
| 0070 | compaction | REDESIGN | L | verify-codex-compaction-chain-fail-closed + -faults.sh | no | socket close now lives in `responses-websocket-connection.ts`, a new owned path |
| 0088 | compaction | MECH | S | verify-compaction-cache-liveness, verify-anthropic-native-compaction-live-context | no | plus the Anthropic-only thread opt-out on every summary request (§4 item 2) |
| 0089 | compaction | MECH | S | verify-compaction-cache-liveness | no | — |
| 0096 | compaction | SEM | M | verify-codex-compaction-chain-fail-closed | no | same file as 0063 |
| 0090 | 0090 | REDESIGN | M | 5 existing OAuth gates + NEW verify-oauth-worker-single-owner | crash → fixed | 2 `model-manager` hunks keep upstream's `{models,error}` contract; add `inspectUnresolvedRefresh`/`unlockAndRefreshStored` to `AuthStorageProtocol`, `serveAuthStorage` and `RemoteOAuth` (main-owned) |
| 0092 | 0092 | SEM | L | verify-cache-warming-idle-budget, verify-cron-idle-owners | no (main only) | rebase as one unit on `entry.touchedAt` / `change()`; `stopsAt` must honour the idle budget; Anthropic warm replays opt out of threads (§4); after 0010 |
| 0094 | 0094 | MECH | S | verify-anthropic-thinking-drop-resume + thread leg | no | — |
| 0095 | 0095 | MECH | S | verify-context-persist-audit + worker leg | no | — |
| 0098 | 0098 | MECH | S | verify-tls-verify-transient-retry | no | `flags.ts` unchanged |
| 0099 | 0099 | MECH | S | verify-retry-slow-schedule + settings-mirror/worker legs | no | — |
| 0101 | 0101 | SEM | M | verify-subagent-warm-revival-prompt + worker reap leg | silent → fixed | upstream now holds the roster (partial adoption); keep the system prompt and work-pool items; keep the `followMCPTools` scope argument; the cold revival after a worker reap must keep a byte-equal prefix |
| 0102 | 0102 | MECH | S | verify-computer-control-confirm-deadline | no | file byte-identical |
| 0065 | 0065 | RETIRED-USER | S | verify-commandcode-model-record-parity leaves the 18.18.0 selection only (§10 Class C) | — | drop the family row. 18.18.0 evidence: pristine `pi-catalog/src/compat/rules/providers/commandcode.kdl:146-149` still declares `deepseek/deepseek-v4.1-flash` with `strip-image-input #false` and text+image input, the block 0065 extended. Only overlap: image-budget also edits `commandcode.kdl` (its `@@ -8` provider block vs 0065's `@@ -147` model block) and `rules.json`; the regenerated 18.18.0 `rules.json` (row 0036) is compiled from KDL without 0065's edit. A case-insensitive grep for `commandcode` across `.18.16.0-families/` and `~/.omp/agent/extensions` finds no consumer of 0065's model record (extension hits are generic provider routing) |
| 0100 | 0100 | RETIRED-USER | S | verify-stepfun-step-plan leaves the 18.18.0 selection only (§10 Class C) | — | drop the family row; StepFun step-plan access ends. 18.18.0 evidence: pristine `providers/stepfun.kdl:32` seeds `https://api.stepfun.ai/v1` and `provider-models/openai-compat.ts:5490` defaults to the same URL, so upstream has no step-plan route. Dependency search: a grep for `step_plan` across `.18.16.0-families/` and `~/.omp/agent/extensions` matches only 0100's own patch (its KDL, `openai-compat.ts`, and generated `rules.json`/`models.json` hunks). A broader `stepfun` grep also matches the generated `rules.json` hunks of image-budget (`family-image-budget-snapcompact-v18.16.0.patch:198,200`) and retired 0065 (`0065-omp-commandcode-deepseek-model-record-parity-v18.16.0.patch:4,6`): these whole-file catalog lines carry upstream's ordinary StepFun entries (file list, taxonomy, the `https://api.stepfun.ai/v1` auth validation), not the step-plan edit. Generated catalogs are rebuilt from 18.18.0 KDL without 0100 (row 0036), so none of these is a dependency |

### 2.2 Upstream adoptions (re-verified on 18.18.0; file:line evidence in adoptions-recheck.md)
| ID | family | class | effort | gate(s) | worker | note |
|---|---|---|---|---|---|---|
| 0017 | 0017 | UPSTREAM-ADOPTED | S | verify-prefix-cache-compaction:794-885 | no | identical code; add 18.18.0 to **both** the allowlist `:891` and the fixture condition `:794`, plus a control proving the fixture runs |
| 0078 | image-display | UPSTREAM-ADOPTED | S | verify-python-display-mime-preference | no | producer unchanged; manifest evidence path moved to `archive/` |
| 0066 | compaction | UPSTREAM-ADOPTED | S | verify-anthropic-native-compaction-live-context | no | unchanged; gate version arms `:63,129,176,322,432` |
| 0072 | 0072 | UPSTREAM-ADOPTED | S | verify-session-pin-static-auth-ui | no | byte-identical; gate `:23`, `:75` |
| 0079 | image-display | UPSTREAM-ADOPTED | S | verify-kitty-conversion-finalization | no | barrier gained a `presentation.mode === "full"` term; contract holds |
| 0062 | image-budget-snapcompact | UPSTREAM-ADOPTED | S | verify-snapcompact-frame-reprice; NEW legacy-archive legs | no | implementation changed; gate `PRICED_PAIR` (`:29`) must include 18.18.0 or the leg silently skips. Correction to adoptions-recheck.md: a pre-16.1 text-less archive loses the standing-summary credit, so a second snapcompact pass is rejected **only when** its projection does not reduce context (`session-maintenance.ts:1491-1498`); a large enough new region can still reduce and pass, while the old frames' unreconstructable content counts as truncated (`snapcompact.ts:2546-2554`). On rejection, an explicit `/compact snapcompact` errors with "Run /compact <mode> instead" (`:1315-1324`); otherwise the next **configured** method runs (no summary fallback when the order is `["snapcompact"]`). The new legs pin the method order and cover: rejected explicit pass, reducing successor, and fallback under a pinned order. Upstream's reduction check is not removed to make them pass. M9's double `/compact snapcompact` uses a current-format archive |

### 2.3 Machine check
Run from the repo root. It compares manifest IDs with the rows above; suffix letters are stripped, and 0047a/0047b form one deliberate split.
```
python3 -c "import json,re;m=json.load(open('patches/.18.16.0-families/manifest.json'));want={c for f in m['families'] for c in f['capabilities']}|{a['capability'] for a in m['upstream_adoptions']};rows=[re.match(r'\| (\d{4}[ab]?) \|',l).group(1) for l in open('.tasks/stage/11-07-omp-18180-upgrade-plan/research/upgrade-plan.md') if re.match(r'\| \d{4}[ab]? \|',l)];have=[re.sub('[ab]$','',r) for r in rows];print('rows',len(rows),'ids',len(set(have)));print('missing',sorted(want-set(have)));print('extra',sorted(set(have)-want));print('dup',sorted({h for h in have if have.count(h)>1}))"
```
Expected output: 63 rows, 62 IDs, missing [], extra [], dup ['0047'] (the deliberate a/b split).

The a/b split is a planning device only. In the 18.18.0 manifest, 0047 stays **one** owned capability, with its anchor half recorded as a partial hunk adoption; no new manifest ID is invented.

## 3. Worker mode (D4: ship `task.workerThreads=4`)
- **Activation:** worker placement starts only at 9 or more concurrent subagents (`thread/subagent-worker.ts:57`, `allowedSubagentWorkers`). Typical sessions never leave the main thread; large fan-outs such as a 24-item pool do.
- **What moves:** the whole subagent `AgentSession` runs in the worker. Auth, settings and the agent registry stay single-owner on main and cross the MessagePort by reference. Subagents get `cacheWarming:false`, `hasUI:false` and `mode:"print"`. Module singletons, extension module state, `globalThis.fetch` wrappers, session leases and runtime `process.env` writes are per thread.
- **Local fixes required** (each with a gate leg that is red before the fix):

| Fix | Detail | Leg that proves it |
|---|---|---|
| 0090 worker bridge | `RemoteOAuth` gets the two unlock APIs | NEW verify-oauth-worker-single-owner: 9 worker callers, exactly 1 token POST per rotation, the refresh token is never presented twice |
| 0081 mirror | `getMainCacheHitRate` on the mirror | no throw with the method absent; the mirror reports the right ratio |
| 0047b leases | cross-thread exclusion goes through main | Q1: transfer/revival across threads keeps session ID and path, creates no sibling file, or returns an explicit refusal while the old owner holds the lease; no two-writer corruption |
| 0031 provider forwarding | forward `provider(s)` across the thread boundary | the usage fan-out stays provider-scoped |
| 0101 cold revival after reap | prefix must survive a worker reap | revive after `worker.terminate()`: system+tools bytes equal to the pre-park request |
| 0083 (suspected) | demonstrate first (row 0083) | only if a failing path exists |
| Devin per-thread state | 0055/0056 per-thread JWT cache and counters; 0071 dump name | per-worker JWT count of at most 1; unique IDs per thread |
| `payload-archive.ts` | user extension; add a thread id to the file name | two instances in the same ms do not collide |
| Compaction and threads inside a worker | a subagent compacts and continues an Anthropic thread in a worker | child compaction overlay correct, continued anchor intact, no leakage into main-thread provider state |

- **Shared gate fixture:** `workerPoolForTests` builds `new SubagentWorkerPool({ hostsOnMain: false, maxWorkers: () => 4, worker: { entry } })` (18.18.0 API: `thread/subagent-worker.ts:333-346,482-484,519-524`) and registers it with `setSubagentWorkerPoolForTests`. Every subagent-touching gate, plus the compaction and thread scenarios above, runs twice: once with `pool=null` and once forced into a worker, offline in `bwrap --unshare-net`, each leg with a mutation control.
- **Runtime experiments the implementation must run** (worker-threads.md §4):
  - Q1 session lock on worker reopen
  - Q2 warm vs cold revival prefix
  - Q3 `--profile` env propagation to workers
  - Q5 remote mirrors expose every patched member
  - Q7 `agent.db` under 9 concurrent writers (private-HOME copy only)
  - Q8 reap vs `agentIdleTtlMs`
- **Fallback (D4), and how it stays achievable:**
  - Only a forced-worker leg that cannot be made green justifies shipping `task.workerThreads: 0`.
  - This applies at whichever milestone owns the leg (M2 0031/0047b/0101 legs, M4 verify-oauth-worker-single-owner, M6 matrix). That milestone still passes when every in-process (main-thread) gate passes; the red forced-worker leg goes to a recorded `worker-disabled` evidence set: the red leg, its receipt, and the re-enable condition that this leg turns green. Later milestones continue; M6 collects the set.
  - From then on the release batch runs every in-process gate as blocking and also asserts the shipped default really is `0`.
  - No other gate may be demoted this way.

## 4. Anthropic official-API message threads (adopt per D3)
- **What it is:** 18.17 sends only the appended messages, with `thread:{type:"continue"}`, for Claude ≥4.5 on the official endpoint.
- **Eligibility:** `anthropic.ts:2257-2262`, `anthropic-threads.ts:140-150,321-327`. All of the following must hold: provider session state present, a session id, a compatible transport/client and model (or explicit flags), a threadable request shape (no compaction/credit/`clear_at` bodies), and no per-call context message. `config.yml` has no `baseUrl` override, but the effective live route is **unverified** until the implementation resolves it in the sandbox.
- **Effect:** latency only; upstream states tokens and price are unchanged.
- **Suppression in practice:** Trellis, the old per-call producer, is retired in this project, so threads are expected to engage here. Projects that still load the Trellis extension keep today's behaviour.
- **Local conflicts and fixes** (total M):
  1. The cache-warmer replay settles the thread anchor away. Fix: warm replays **to Anthropic only** opt out of threads (0092).
  2. A cache-preserving summary request can take over the main anchor [INFERENCE until a fixture confirms]. Fix: Anthropic summary/compaction requests opt out, and the option is plumbed through `SummaryOptions` into **every** summary request literal that forwards `sessionId`/`providerSessionState` in 18.18.0 `pi-agent-core/src/compaction/compaction.ts`: ordinary `generateSummary` (`:1059-1061`), `generateShortSummary` (`:1292-1294`), split-turn `generateTurnPrefixSummary` (`:2427-2429`), and the summary-lane literals (`:1914-1916`, `:1992-2009`, `:2075-2077`, `:2247-2249`, including the retry path). The option takes effect only for Anthropic (family-compaction/0088). The isolation gate exercises the ordinary, short and turn-prefix summaries and a retry.
     - `statefulResponses:false` must **not** be set for OpenAI Responses or Codex, because there it disables HTTP/WebSocket chaining (`openai-responses.ts:551-570`).
     - A leg proves OpenAI Responses chaining stays enabled.
  3. Audit baseline. Fix: the 0074 audit tracks the **complete accepted thread history** (create plus every continue, reconstructed logically) separately from the archived wire deltas.
     - Test: create, then several continues, then mutate a message first sent in a continue; the audit must report `prefix-different`.
  4. `before_provider_request` hooks (`cache-prefix-audit`, `payload-archive`) see the **logical** full body before `threadTurn.plan()` (`sdk.ts:4721-4723`, `anthropic.ts:2321,2671-2674`), not the wire delta. `/payloads` therefore no longer equals what was sent. Fix: keep the logical hook as is, and add correlated, redacted, bounded final-wire records (via the 0074 wire audit). A create/continue test compares the two observations.
- **New gates:**
  - verify-anthropic-threads-cache-shape
  - verify-anthropic-threads-warm-compaction-isolation
  - an extension of verify-anthropic-request-audit
  - thread legs for 0074 and 0094
- **Rollback switch (D3), and how it stays achievable:**
  - Only an enabled-thread leg that cannot be made green justifies shipping `PI_ANTHROPIC_MESSAGE_THREADS=0`.
  - M5 then still passes when the same gates pass with threads disabled. The red enabled-thread leg goes to a recorded `threads-disabled` evidence set: the red leg, its receipt, and the re-enable condition that this leg turns green.
  - M6 then runs the compaction-and-thread scenario in its disabled-thread variant in both main and worker modes: requests are unthreaded (no `thread` field) and the summary/warm isolation still holds; the continued-anchor assertion stays in the `threads-disabled` set.
  - From then on the release batch runs the thread gates in disabled mode as blocking and asserts the deployed switch really is off.

## 5. Codex text verbosity (D5)
- **Where the setting lives:** `textVerbosity` defaults to `low` (`pi-coding-agent/src/session/settings.ts:625-629`). It applies to `openai-codex-responses` and `openai-responses` (`settings-stream-fn.ts:104-107`) and is written into the Codex body as `text.verbosity` (`pi-ai/src/providers/openai-codex/request-transformer.ts:529-533`). The user's `config.yml` sets nothing, so the default applies.
- **Verification** (new leg in verify-codex-effort-resume or a small new gate, offline loopback transport):
  - The Codex request body carries `text.verbosity:"low"`.
  - `textVerbosity: medium` in settings still overrides it.
  - Within 18.18.0, a resumed Codex session's first request equals the warm request's prefix. Across versions, the known one-time prompt/tool changes (U8, delegation text) are baselined first, and only the remainder is compared.

## 6. Native overlay
See native-overlay.md.
- The Escape `MappingNotify` fix is now upstream (`bc706beb10`), so that half is an ADOPT-CANDIDATE. The proof is the 18.16.0 M12 physical Escape scenarios re-run on the pristine-Escape build, plus a negative control.
- The AT-SPI 2 s connect timeout and the Chrome profile-title match are not upstream and are rebased.
- New recipe `patches/native/18.18.0/overlay.json`; rebuild; `verify-native-overlay.py` with the new hashes.

## 7. Companion extensions
See extensions-compat.md, including the main correction about `ctx.ts`.
- The extension API delta is additive only. Every enabled extension loads once per worker realm. No extension needs a worker redesign.
- Required:
  - A new `verify-extensions-load-18180.ts` that loads the live set, follows symlinks, and replaces the 18.16.0-pinned gate.
  - The patch dependencies of four extensions (`prepare_user_input`, `cache_warming_result`, `runIdleEphemeralTurn`, `ContextEvent.purpose`) must be present in the rebased chain.
- Companion deployment: `publish` excludes `~/.omp/agent`. The implementation produces an explicit list of companion files whose bytes must change for 18.18.0, each reconciled against the **live** copy. Live-only behaviour is preserved unless the user approves a migration:
  - `magic-commands.ts` registers `/jevify` only in the live copy.
  - `context-notes-save-gate.ts` copies intentionally keep different validation schemas (DECISIONS 2026-11-05).
  - No bulk sync (O4 changed accordingly).
- `spec-update-gate.ts`: retired and deleted from the live extensions directory (O5, done); `verify-extensions-load-18180` must not expect it.

## 8. Optional items (pre-existing, not caused by the upgrade; user decides)
| ID | Item | Recommendation |
|---|---|---|
| O1 | Midnight compaction cut: our input-translation hunk (`:2283-2297`) reverts upstream's date/cwd control counting, so after midnight the live compaction prefix is cut k messages early. This is live on 18.16.0 today [INFERENCE: proven by code reading, no live repro]. | **Approved** (user, 2026-11-07): delete our hunk and add NEW verify-compaction-live-chain-midnight |
| O2 | 0048 grace is not reset in `#resetRecoveryBudgets`, so after an abandoned advisor turn the next quota episode gets zero same-provider rotations | **Declined** (user, 2026-11-07): advisors are not run across multiple accounts, so the case does not arise |
| O3 | Gate gaps with no gate today: 0037/0026/0030 usage pipeline, 0071 dump, and 6 extensions | 0037/0026/0030 included (cheap, protect quota display); the rest optional |
| O4 | `context-notes-save-gate.ts` live copy differs from the repo copy, partly by design | No sync; reconcile only the bytes 18.18.0 requires (§7) |
| O5 | Retire `spec-update-gate.ts` (Trellis-only, disabled) | **Done** (user, 2026-11-07): the live file was deleted (sha256 `f6ad4627305b9b6122cb344747338531ee5b5e2cead2024ce719322ff0bd4858` before deletion); there was no repo copy and no gate. The `disabledExtensions` entry in `config.yml` is left as a harmless no-op |

## 9. Upstream risks (upstream-risks.md, 36 U-rows)
P0 rows and their owners:
| Row | Risk | Owner |
|---|---|---|
| U1/U2 | Anthropic threads | §4 |
| U3 | `AuthStorage` became backend-composed; 4 gates call the removed `setRuntimeApiKey` | gate ports |
| U6/U19 | Worker settings mirror and worker threads | §3 |
| U8 | The system prompt gains environment-triggered sections (`ovnfs` "Separate checkouts", intent guidance). This is a one-time prefix change at upgrade, and it moves again if `ovnfs` appears on PATH. | verify-prompt-rebuild-inputs gets an 18.18.0 arm, including the `ovnfs`-present and `ovnfs`-absent inputs |
| U13 | CacheWarmer API inverted | 0092 |

Unchanged wires: kimi-code, deepseek, cline-pass, workbuddy, pixel, cpa. Also unchanged: `messages.ts`, `date-cwd-reminder.ts`, `session-storage.ts`, `session-context.ts`, and the Bun floor.

Correction to upstream-risks.md:129: the `before_provider_request` cache audit receives the **logical** full body, not thread deltas, so no delta port is needed there. Logical and wire bodies are separate observations (§4 item 4).

## 10. Gate porting
- **Class A (version-only):**
  - About 30 gates whose version allowlists stop at `18.16.0` and fail closed; they gain `18.18.0` arms.
  - `"18.16.0" ===` arms become set membership.
  - `-faults.sh` mutation anchors are re-created exactly, including tabs.
- **Class B (semantic):** verify-cache-warming-idle-budget, verify-cron-idle-owners, verify-anthropic-request-audit, verify-tool-schema-bytes, verify-anthropic-cache-boundaries, verify-prefix-cache-compaction, verify-cache-prefix-audit, verify-date-cwd-journal-prefix, verify-subagent-warm-revival-prompt, the three Hindsight gates, verify-main-cache-hit, verify-usage-reset-format, verify-read-description-live, verify-oauth-durable-refresh, verify-auth-unlock-extension.
- **Class C (retire from the 18.18.0 selection only):** verify-ollama-cloud-usage, verify-commandcode-model-record-parity, verify-stepfun-step-plan. Their registrations become version-armed so 18.18.0 does not select them; the gate files and the registrations for retained older arms stay, so historical coverage and the gate-parity check (`verify-patch-family-rollups.sh:414-427`) are unchanged.
- **New gates:**
  - verify-compaction-live-chain-midnight (O1, approved)
  - verify-anthropic-threads-cache-shape
  - verify-anthropic-threads-warm-compaction-isolation
  - verify-oauth-worker-single-owner
  - verify-extensions-load-18180
  - the usage-statusline gate (0037/0026/0030)
  - the Codex text-verbosity leg
  - the worker-mode twin runs (§3)

## 11. Implementation milestones (run only after separate approval)

Each milestone ends with its gates PASS in `bwrap --unshare-net` on a private HOME, and every new leg has a mutation control that turns red. Rules for every milestone:
- No live runtime, DB, credential or cache access.
- Hunks are re-authored, never accepted from `patch` with a large offset (§1).
- Effort labels: S under 1 h, M about half a day, L a day or more.

| # | Milestone | Content | Depends on | Effort | Proof |
|---|---|---|---|---|---|
| M0 | Plan scaffolding | <ul><li>`.18.18.0-families/` plan, manifest and apply.sh arm.</li><li>**Release-oracle contract for 18.18.0:** snapshot, retirement and adoption contract in `verify-release-family-plan.py` (`:33-60,105-130`); archive URLs and the pristine tree digest in the manifest; 0047 kept as one capability with a partial hunk adoption. The candidate tree digest is left for M8, after the rebases.</li><li>Pinned archives from research/baseline.md.</li><li>Retire 0065, 0100 and 0025 (drop the ollama block) and remove **their** gates from the 18.18.0 selection only (§10 Class C). 0054 stays owned by the 18.18.0 antigravity-wire family until M1 moves it atomically to the adoption list (row 0054); its patch file and 18.4.4 apply-list entry stay, and `verify-antigravity-envelope` stays and is ported.</li><li>Class-A version arms on all gates; `-faults.sh` anchors.</li><li>Shared `workerPoolForTests` fixture (§3 API).</li></ul> | — | M | `--print-plan` and `--print-gates` accept the 18.18.0 arm; the oracle's version, ownership, retirement and adoption checks accept it (no full replay yet: the failing families are rebased in M1–M5); only the three user-retired gates leave the 18.18.0 selection, and older arms' gate lists are byte-identical |
| M1 | Mechanical families | <ul><li>0098, 0099, 0102, 0046, 0048, 0050, 0095, 0094, 0069 (pure-addition regen), antigravity 0014; 0054 consumer proof and negative control, then one atomic change: its hunks leave the 18.18.0 family, it is added to `APPROVED_ADOPTIONS["18.18.0"]` in `verify-release-family-plan.py` (the oracle derives family ownership from that list, `:116-121`), it enters the 18.18.0 manifest's adoption list, and the controller marker is added; the oracle ownership/adoption checks are re-run; usage-pipeline (minus 0025).</li><li>image-budget: stage the exact-tag catalog compiler and regenerate `rules.json`, or use the round-trip-proven scripted fallback (design row 0036).</li><li>image-display 0080, devin (0060 retarget), status-accounting 0033/0004, hindsight 0034.</li><li>input-translation: re-anchor the 7 failed hunks; port the 18.18.0 arms of `verify-user-display-text-queue` and `verify-rejected-prepared-draft-restore`; drop the midnight-reverting hunk (O1).</li><li>0085.</li><li>0062 legacy-archive legs (row 0062).</li></ul> | M0 | M | Per-family gates |
| M2 | Session semantics | <ul><li>0010, then 0092 (one unit; `entry.touchedAt`/`change()`; `stopsAt`).</li><li>0075 reorder.</li><li>0047b → 0093 → 0083 (`evalToolNames`; the `^model:level` effort question only if a failing path is demonstrated) → 0076 → **0077 and 0084**, with their gates.</li><li>0043, 0101.</li><li>0081 optional contract and mirror.</li><li>0031 full worker dispatch forwarding.</li></ul> | M1 | L | Gates plus the new legs in §2/§3 |
| M3 | Codex compaction block | One owner: 0063, 0067, 0068, 0070 (new owned path `responses-websocket-connection.ts`) and 0096 on the rewritten transport; 0035/0088/0089 re-anchors; NEW verify-compaction-live-chain-midnight (O1) | M1 | L | verify-codex-compaction-chain*, -faults.sh, lane-trace, target-key, cache-liveness, midnight |
| M4 | Auth | 0090: `model-manager` contract merge; worker bridge (`AuthStorageProtocol`, `serveAuthStorage`, `RemoteOAuth`) | M1 | M | 5 OAuth gates; NEW verify-oauth-worker-single-owner, or its red leg recorded under the §3 fallback |
| M5 | Anthropic threads adoption | <ul><li>Effective-route check in the sandbox.</li><li>0074 import kept; full-history audit.</li><li>Anthropic-only thread opt-out for warm (0092) and every summary request (0088; §4 item 2 lists the literals, including short and turn-prefix summaries).</li><li>Final-wire records beside the logical hook.</li></ul> | M2, M3 | M | NEW threads gates; 0074/0094 thread legs; OpenAI Responses chaining leg. A leg that cannot be made green follows the §4 rollback path (disabled-mode gates pass, switch-off asserted, re-enable condition recorded) |
| M6 | Worker-mode matrix | Every subagent-touching gate plus the compaction and thread scenarios run twice (main vs forced worker), using the disabled-thread variant if M5 took the §4 rollback; runtime experiments Q1, Q2, Q3, Q5, Q7, Q8; Devin per-thread legs | M2–M5 | M | All legs green. Otherwise the D4 fallback per §3: the red worker legs go to a recorded `worker-disabled` evidence set, all in-process gates stay blocking, and the shipped default `0` is asserted |
| M7 | Extensions, natives, verbosity | <ul><li>NEW verify-extensions-load-18180 (live set, follows symlinks).</li><li>Explicit companion byte list reconciled against the live copies (§7).</li><li>Native recipe 18.18.0: Escape half adopted, ax.rs half rebased, rebuild, `verify-native-overlay.py`.</li><li>Codex `text.verbosity` leg.</li></ul> | M1 | M | Gates; native hashes; companion list |
| M8 | Candidate acceptance | <ul><li>Fix the candidate tree digest and family hashes in the 18.18.0 manifest.</li><li>Full oracle: zero-fuzz replay, candidate digest match, reverse to pristine, identical second replay.</li><li>Every controller-selected gate in one bwrap batch with an unchanged runtime hash manifest; any recorded `worker-disabled`/`threads-disabled` set is applied exactly as §3/§4 define.</li><li>Sandbox smoke and the exact-version fail-closed check on an 18.18.1 tree.</li><li>Independent `reviewer` pass.</li></ul> | M0–M7 | M | Recorded JSON receipts |
| M9 | Physical acceptance (👤 live approval) | M12-style Tern surfaces on the staged release under a private HOME, including the Escape scenarios that prove the native adoption, and a live double `/compact snapcompact` | M8 | M | 👤 |
| — | Publish / activate | Separate approval per D2 and the runbook; `publish` excludes `~/.omp/agent`, so only the companion byte list from M7 is deployed, each with a `cmp` check against the repo source and live-only behaviour preserved | M9 | — | Runbook receipts |

O1 is approved and scheduled (M1 hunk removal, M3 gate); O2 is declined; O5 is done.

Suggested execution shape at implementation time:
- One `taskex` owner each for M3 and M2/0092; these are the hard semantic slices.
- `task` workers for the M1 families.
- M6 owned by the worker-design author.
- Main integrates and runs gates once per milestone.
- `reviewer` at M8.
