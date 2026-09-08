# S1 evidence status v2 — task 09-06-acp-omp-eval

Supersedes `S1-status.md` (kept unmodified: it is the document the reviewer
audited). Every wording below is the reviewer's `defensible_wording` or
narrower. Full verdict table: `review-verdicts.json`.

Sandbox: `/tmp/acp-sandbox`, host omp 18.1.10 source-mode, model
`hyper/qwen3.8-flash` (`api: openai-completions`).

## What v1 got wrong (all four are mine)

1. **I deleted evidence I then cited.** Between runs I ran
   `rm -f evidence/bodies/*.json`, destroying the four `pid4090648` BASE bodies
   and the `pid4099007` hook pair. Every v1 claim resting on them is
   unverifiable — permanently, not pending re-collection. Affected: S0.2's
   four round-trips, S1.3's body checks, S1.1's field-absence claim, and the
   tail-append wire summary.
2. **"Byte-identical" was canonical-JSON equality.** The v1 proxy stored
   `JSON.parse(bodyText)`, discarding the original bytes. It could never have
   shown byte identity.
3. **"Live DBs byte-identical" was stat-only.** `inode`/`size`/`mtime` are all
   I recorded, and content hashing of live DBs is forbidden by red line 1 — so
   metadata equality is the permanent ceiling, not an oversight to fix.
4. **"Corrects the PRD" was false.** PRD G0.2 already prescribed per-setting
   gating and `implement.md:24` only escalates *if* no settings exit exists.
   Neither asserted that none existed.

Also corrected: v1 said the host has no binary-update setting. Wrong —
`startup.checkUpdate` exists and governs the banner (`main.ts:579-587`); the
notification path performs no automatic install.

## Source-backed closures (hold independently of the deleted captures)

| # | Gate | Evidence | Defensible claim |
|---|---|---|---|
| S1.3 | G0.2b inline snapcompact | `settings-schema.ts:2729-2732,2755-2757`; `sdk.ts:3442-3461`; sandbox `config.yml` has no snapcompact override | With `systemPrompt=none` and `toolResults=false`, `SnapcompactInlineTransformer` is **not constructed**. Scope: **other provider-context transforms remain active** (`sdk.ts:3462-3477` still clamps images, normalizes, drops unreadable images, decorates image URLs, injects the reminder). This is not "the request path performs no image work" |
| S1.4 | G0.2c stale/useless prune | `session-maintenance.ts:508-518`; `pruning.ts:252-266`; `settings-schema.ts:2705-2707,2716-2718`; sandbox `config.yml` sets both false | The settings exit **anticipated by** PRD G0.2 / `implement.md:24` is located: disabling both `compaction.supersedeReads` and `compaction.dropUseless` prevents this pass **including its idle-flush branch**, with no host change. Reviewer independently confirmed the sole production caller (`:513`), the sole invocation of the private pass (`:2084`), and that idle handling sits *after* the empty-candidate return rather than in a bypass timer. Scope: source closure for **this pass only** — other history rewrites (manual `dropImages`/`shake`, recovery, general pruning) exist and are not covered; no empirical idle-run proof |
| GATE 1 | probe must not mutate payload | `probes/probe-seq.ts:50-78`; `runner.ts:1689-1691` | The probe reads/serializes `event.payload` without assigning or mutating, and returns `undefined` on both the success and the caught-failure path, so the chained reduce keeps the upstream payload |
| S1.5 | G0.3 discovery + per-request dispatch | `handler-seq.log`; `loader.ts:675-691`; `runner.ts:1668-1694` | The sandbox probe is discovered by ambient discovery and bound (`module_load` then `factory_called`), and its handler fires once per request with a monotonic sequence number. **No ACP-relative ordering is claimed** — ACP is not installed |
| S0.4 | patch chain baseline | `S0.4-patch-check.txt:1-22` | That captured baseline records `OMP_PATCH_VERSION=18.1.10`, 20 APPLIED entries and the source-mode `bin/omp` link. It supports the baseline only, **not** a later unchanged-chain comparison. S5.2 must re-run with the same env var — bare `apply.sh --check` reports bogus CONFLICTs on this box |

## S1.2 v2 — G0.2a closed empirically, plus a gate v1 missed

Scout `CheapS12Path` found the cheap path and one real hole. Both acted on.

**The hole**: `compaction.enabled=false` is NOT sufficient by itself.
`runAutoCompaction`'s master gate is `reason !== "idle" && !compaction.enabled`
(`session-maintenance.ts:3049-3051`) — the **`idle` reason exempts itself from
the enabled check entirely**. It is armed only when `compaction.idleEnabled` is
true (default false, `settings-schema.ts:2653-2655`) with context above
`idleThresholdTokens` (default 200000). Default-off is luck, not a gate, so
`compaction.idleEnabled=false` is now pinned explicitly in the sandbox.
Every other automatic path honours `enabled=false`: post-turn threshold
(`:2086-2088`), overflow recovery (`:1935-1940`), incomplete/length recovery
(`:2035-2036`), mid-turn (`:1738-1745`), speculation (`:1287-1289`), advisors.

**The cheap path**: `compaction.thresholdTokens` (`settings-schema.ts:2583-2586`,
number, default `-1` = auto) wins over the percentage when `> 0` and is clamped
only to `[1, contextWindow-1]` (`compaction.ts:373-379`). Setting 400 makes a
tiny session cross the threshold, so the gate is exercisable without pushing a
1M window to 80%.

**Two-condition experiment**, same harness / model / `thresholdTokens=400`,
differing only in `compaction.enabled`:

| condition | requests | compaction entries in session jsonl |
|---|---|---|
| gate — `enabled=false` | 9 | **0** |
| control — `enabled=true` | 21 | **15** |

Gate run reached 109916 body bytes on its last request, far past a 400-token
threshold, with `compaction-trace.log` **absent** (zero executed compactions).
The control run's 15 entries prove the harness genuinely crosses the threshold,
so the gate run's zero is the gate holding — **not** a failure to reach it.
That control is what makes this a closure rather than an absence.

Evidence: `s12/gate-bodies/`, `s12/ctrl-bodies/`,
`s12/S1.2-gates-restored.txt`.

**Noted deviation from scout's prediction**: scout expected the control run to
emit `Auto-compaction threshold decision` (`:2128-2147`). Both runs logged it
**zero** times, yet control compacted 15 times — so the executed path was not
that Case-4 branch. The session-entry counts are the evidence; that log line is
not load-bearing here and its absence is unexplained.

**Scope**: proves the enabled gate suppresses automatic compaction for this
model/config at an artificially low threshold. It does **not** prove behaviour
at the real auto threshold, and `thresholdTokens` has been restored to `-1`.

## S1.6 v2 — new evidence, not a repair of the deleted run

New collection into fresh directories (`bodies2/`, `final2/`,
`logs/handler-seq2.log`); the v1 artifacts were left untouched. Proxy now
writes the untouched request text to its own `.body` file and records
`rawSha256`; pairing data in `S1.6v2-pairing.json`.

Two pairs, hook→final 4 ms apart (`17:45:05.221`→`.225`,
`17:45:09.289`→`.291`):

| | hook canonical | wire canonical | raw bytes | raw sha256 (sidecar == recomputed) |
|---|---|---|---|---|
| #1 | `37bc358ae1c072de` | `37bc358ae1c072de` | 70440 | `026f5dbd30e9278c` ✓ |
| #2 | `34cdd4f966129991` | `34cdd4f966129991` | 70529 | `4973ce5c3d598be9` ✓ |

**Claim, at its true strength**: on `openai-completions`, the hook payload's
canonical form equals the final wire bytes' canonical form, and the raw wire
bytes are retained with a verified digest for recheck.

**Why byte identity is not claimable on the hook side at all**: the hook
receives an *object* (`probe-seq.ts` archives `event.payload`), so no bytes
exist there to compare. This is a structural limit, not a gap in method.

**Observation boundary** (reviewer-verified SUPPORTED): interception sits after
host serialization — `openai-completions.ts:770-799` calls the hook then
`postOpenAIStream`, and `utils/openai-http.ts:90-96` serializes before `fetch`.
Anthropic's `toWellFormedDeep` (`anthropic.ts:2206-2210`) and its fetch wrapper
(`:715-730`) both run *before* a request reaches an endpoint proxy.

**Correction to a v1 factual error**: v1 listed the final headers as
exhaustive. Captured ingress headers are `accept`, `accept-encoding`,
`authorization` (redacted), `connection`, `content-length`, `content-type`,
`host`, `user-agent` — v1 omitted three. None is named `cch`,
`prompt_cache_key` or `anthropic-beta`. And **checking header absence is not a
cch test**: Anthropic patches `cch` into the *body* (`anthropic.ts:710-730`),
so that concern is out of scope for this API-scoped result, not disproven.

## Open — do not claim

- **S0.2 (credentials) — CLOSED under the 2026-09-07 spec revision.**
  *Original deviation, retained verbatim*: `prd.md` red line 1 as first
  written required fresh in-sandbox login; the `hyper` key was **copied from
  live `models.yml`**. The reviewer judged this row OPEN on that basis, and
  sanitizing local artifacts does not retract copies already transmitted or
  logged. The four original round-trips remain unverifiable (captures deleted).
  *Why the requirement was unsatisfiable*: `hyper` is a static-API-key
  provider with no login flow — an in-sandbox "login" retypes the same key and
  yields a byte-identical credential, so the isolation gain is zero. The
  original wording was an unmeetable acceptance item, not an execution slip.
  *Revision (user's call, `prd.md:28-39`)*: static-key reuse is permitted; the
  criterion becomes sandbox-DB-and-OAuth independence. Re-verified against the
  three new criteria: ① sandbox `agent.db`/`models.db` are fresh files at
  sandbox paths (`inode=6194080/6194084`, `S0.2-sandbox-db.txt`) — **pass**
  ② zero auth rows in the sandbox DB — **pass** ③ live `auth.json` and OAuth
  credentials untouched — **pass ONLY within the ACP sandbox execution window
  (S0 → S5.2); NOT assertable for the task as a whole.**
  *Criterion ③ exception, explicitly excluded from S0.2 acceptance*: outside
  that window the 09-07 main-session repair (a) **read** the live
  `auth_credentials` row `id=19` including its `access` and `refresh` token
  values (compared via sha256; plaintext never written to disk) and (b)
  **replaced the live `agent.db` file that holds that row**. `prd.md:39` still
  requires live OAuth credentials be neither read nor written, so ③ is
  satisfied for the sandbox window and **carries a standing exception for the
  repair**. What remains positively verified across the repair: `auth.json`
  byte-metadata identical at all three checkpoints
  (`mtime=1788414915 size=304 inode=54925019`), and the full
  `auth_credentials` table byte-identical before and after
  (sha256 `1b45b5dc…1ad330`). Detail: `obs-live-db-rebuild-0907.md:77-94`.
  *Still owed by the revision*: the key reached this session's transcript,
  five `pid4102443` bodies and one sandbox session jsonl; all six on-disk
  occurrences were replaced with `<redacted-apikey>` and the repo archive had
  zero hits, but `prd.md:39` requires listing every landing site **and
  recommending rotation** at task close. Rotation is therefore still advised —
  transcript copies are outside reach.
- **S1.2 real-threshold behaviour**: closed at an artificially low
  `thresholdTokens=400` (see the S1.2 v2 section). Behaviour at the real auto
  threshold on a 1M window is still unobserved, and v1's "2% peak" was never
  retained as checkable evidence.
- **S1.1 (G0.1 Responses stateful)**: not applicable to this group — this model
  uses `openai-completions` (`openai-completions.ts:770-799` sends
  chat-completions shape, not Responses chaining). If the measurement model
  moves to a Responses API, close this gate first. v1's claim about field
  absence in the deleted four bodies is unverified.
- **S1.7a (G0.5 static isolation) — CLOSED 2026-09-07.** Live fold path
  `~/.omp/acp-omp-folds` absent, sandbox `folds/` empty, `autoUpdate=false`
  via both sandbox JSON and `ACP_AUTO_UPDATE=0`, `ACP_OMP_FOLD_DIR`
  redirected. Evidence: `S1.7a-static-isolation.txt`. **Scope**: proves the
  static configuration only. The empty `folds/` reflects *no writer* rather
  than *writes correctly redirected*.
- **S1.7b (G0.5 runtime isolation) — OPEN, blocks S2.** Runtime fold-write
  isolation is still unexercised. The original `implement.md` scheduled ACP
  installation at S2.2, leaving nothing to verify during S1 — a self-contradiction
  in that document. Resolved (user's call, `implement.md:28-51`) by pulling an
  **ACP preflight into S1.7b**: trigger one fold write, verify every checkpoint
  lands under `ACP_OMP_FOLD_DIR` with `~/.omp/acp-omp-folds` still absent. The
  preflight collects **no cost data**; S2.2's measurement is unchanged.
  Deferring this to S2.2 was rejected — it would let S2.1 run before GATE 0 is
  fully green.
  **The preflight MUST use a separate sandbox `/tmp/acp-preflight`, never
  `/tmp/acp-sandbox`.** Once ACP runs it leaves fold files, session jsonl,
  `agent.db`/`history.db` rows and extension-load traces behind; **unloading
  the extension does not undo those**, and the residue would contaminate the
  S2.1 BASE group so BASE is no longer a clean baseline. Preflight evidence
  (fold landing sites with filename/size/sha256 plus a JSON structural key
  check — `state`/`coreMessages`/`appliedCallIds`/`rejectStreak`, key names and
  array lengths only — proving a real write rather than a directory that merely
  exists; **raw checkpoint content must never be archived**, since
  `fold-persist.ts:51-55,84-86` stores full `coreMessages` and block bodies
  which may carry user content or sensitive tool output, plus the discovery
  listing and
  ACP version fingerprint) is archived under `research/evidence/s17b/` **before**
  the directory is deleted. Before S2.1 starts, re-verify `/tmp/acp-sandbox`
  never loaded ACP: re-list the four discovery stages, confirm
  `/tmp/acp-sandbox/folds` is still empty, and confirm no ACP-related session
  records exist in that sandbox.
  **Also note**: the three live-file `inode`/`size`/`mtime` retention that the
  original S1.7 relied on no longer extends past S5.2 (see the rebuild entry
  below); content equality was never testable without prohibited reads.
- **S1.4 behaviour run — INVALID.** The double-read run (11 requests,
  `pid4102443`) shows no supersede notice, but the model issued only **one**
  fixture read, so no candidate ever existed. Absence proves nothing. The gate
  rests on the two source guards, not this run.
- **S1.7 / S5.2 baseline invalidated after the fact (2026-09-07).** The live
  `agent.db` was rebuilt by a **separate main-session repair** — the library
  failed `integrity_check` while the Anthropic quota cache sat frozen, two
  facts that **coexisted; the causal link was never established** (see
  `obs-live-db-rebuild-0907.md:21-26`). Its `inode`/`size`/`mtime` changed:
  `54945351 / 2551808` → `54958551 / 1720320`.
  The S0.3→S5.2 comparison **still holds for the task window itself** — both
  captures record the identical triple, so the sandbox did not touch live.
  What is now unavailable is any `agent.db` triple comparison **after** S5.2;
  do not diff the current stat against the S0.3/S5.2 files. `models.db`
  (`inode`/`size` unchanged) and `auth.json` (unchanged) are unaffected.
  Credentials verified byte-identical across the rebuild. Full record,
  including a red-line-1 exception disclosure (the main session read live DB
  contents while diagnosing) and the new baseline:
  `obs-live-db-rebuild-0907.md`.

## Archive integrity

The repo archive is a **reduced summary**, not the cited complete captures:
`bodies/` and `final/` were never archived, `sandbox.env` and sandbox
`config.yml` are absent, and two files are renamed (`logs/handler-seq.log` →
`handler-seq.log`, `home/.omp/acp-omp.json` → `sandbox-acp-omp.json`). Several
v1 citations therefore do not resolve from the repo alone. v2 ships the full
`bodies2/` + `final2/` captures so the S1.6 v2 claim is checkable from the
repository without the live sandbox.

## Credential exposure (closed out locally)

The `hyper` static API key reached: this session's transcript (my `grep`), five
`pid4102443` bodies (the sandbox model read its own `models.yml` as a tool
call — location `probe-seq-4102443-0011.json` models.yml tool-result, content
not reproduced), and one sandbox session jsonl. All six on-disk occurrences
replaced with `<redacted-apikey>`; the repo archive had zero hits. Rotation is
still advised: transcript copies are outside my reach.

**Scope correction (2026-09-07)**: the original wording here claimed no live
`agent.db`/`models.db`/`auth.json` was ever read or written. That claim is
**true only within the ACP sandbox execution window** (S0 → S5.2) and is
restated as such. Outside that window, a separate main session **read live
`agent.db` contents** (`auth_credentials` including token values, `cache`,
`usage_history`) and **replaced the live `agent.db` file** while repairing an
`integrity_check` failure. Live `auth.json` was never read or written at any
point — its byte-metadata is identical at all three checkpoints. No Anthropic
credential value was written; credentials were verified byte-identical across
the rebuild. Full record: `obs-live-db-rebuild-0907.md`.
