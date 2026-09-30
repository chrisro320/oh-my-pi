# Calibrating the cache-liveness model against real recorded usage

Scope: does the cache model inside `patches/verify-compaction-cache-liveness.ts`
(the simulator for layer 0086) predict the `cacheRead` / `cacheWrite` that the
provider actually reported for thousands of real requests, and if not, where and
why?

Script: `research/calibrate-cache-model.py` (offline; reads only
`~/.omp/agent/cache-prefix-audit.log{,.1}`, `~/.omp/agent/compaction-trace.log`
and, for one measurement, the archived wire bodies under
`~/.omp/agent/payloads/*/anthropic-wire/`).
Full run output: `research/cache-model-calibration.out`.
Machine-readable summary: `research/calibrate-cache-model.result.json`.

```
python3 research/calibrate-cache-model.py            # LOOKBACK=20, the gate's constant
python3 research/calibrate-cache-model.py <blocks>   # sweep the lookback
```

## 1. The model under test

Mirrors the gate's `recordWrite` / `simulate` / `classify` exactly, with the
message index standing in for "block":

* a request writes cache entries at **each of its own breakpoints**, stamped at
  the request timestamp;
* an entry survives `TTL = 1h`;
* a lookup resolves at `anchor = max(breakpoint index)` to the **highest entry
  index** that is (a) still alive, (b) `<= anchor`, (c) within `LOOKBACK`
  blocks behind the anchor;
* the request then reads blocks `0..hit` and rewrites blocks `hit+1..anchor`.

Predicted verdict per request (the strongest claim the audit data can check
without per-block token sizes): *does the predicted read reach at least the
previous request's tail in the same `(session, model)` chain?*

Ground truth comes **only from the recorded usage numbers**, never from the
audit's own verdict: `real cacheRead >= 80% of the previous request's own
input+cacheRead+cacheWrite`. (The audit's `verdict` field is byte-identity
based, i.e. exactly the thing the incident showed to be insufficient, so using
it as ground truth would be circular. It is reported as a cross-check instead.)

## 2. Data and pairing

* Snapshot: ~8560 audit rows over both rotated files, 2026-09-28T15:41:25 →
  2026-09-30T08:58:42 (the log is live; the numbers below are that snapshot).
* 116 `(sessionId, model)` chains, 5125 replayed turns.
* A request row is paired with a usage row by `diff` signature
  (`kind` + `index` + `detail`), choosing the nearest preceding unmatched
  request within `[-0.02s, 600s]`. Plain FIFO pairing is **wrong**: the corpus
  contains 110+ requests with no usage row at all, and after a compaction the
  message indices restart, so the same `diff` signature recurs in a later
  generation of the same chain. Pairing latency: median 3.8s, p90 13.1s.
* 719 turns carry breakpoints (all are `claude-*`); 606 are paired with a usage
  row, 4 have zero usage (aborted), 2 are the first turn of their chain inside
  the log window, 5 are generation breaks (a compaction/summary restart, where
  "the previous request's tail" is not a prefix of this request and the boolean
  is undefined).
* 113 breakpoint-lane requests have **no** usage row. They are real provider
  calls — all 113 have an archived wire body within ±3s — whose usage row the
  audit never wrote.
  Treating them as writes matters: agreement drops 100.0% → 92.9% if they are
  ignored. That is evidence the cache entry is written when the request is
  sent, not when the response lands.

## 3. Agreement

| slice | agreement |
|---|---|
| breakpoint lanes (the model's domain) | **100.0% (595/595)** |
| all requests | 23.8% (772/3242) |

By gap since the previous request (breakpoint lanes): `<5m` 100.0% (578/578),
`5-60m` 100.0% (17/17), `>60m` **no such turn exists**.
By `diff.kind`: `APPEND_ONLY` 100.0% (434/434), `SYSTEM_DRIFT` 100.0% (161/161).

Same split over *all* requests (where the model is undefined on the
non-breakpoint lanes): `<5m` 23.3% (754/3243), `5-60m` 78.3% (18/23), `>60m`
none. The `>60m` bucket is empty **corpus-wide** — no request in the whole log
window follows another by more than an hour, which is why the TTL cannot be
calibrated from idle gaps (see §6).

**Disagreements: 0.**

The all-requests 23.8% is not a model failure but a scope limit: the model
describes explicit `cache_control` breakpoints, and only the Claude lanes have
them. Per lane:

| lane | breakpoints | agreement |
|---|---|---|
| claude-sonnet-5-5 | yes | 100.0% (444/444) |
| claude-opus-5-5 | yes | 100.0% (151/151) |
| deepseek-v4.1-flash (cline-pass) | no | 7.8% (176/2264) — 2088 real hits via automatic prefix caching |
| gpt-6-sol / gpt-6-astra / gpt-6.1-sol / gpt-6-luna | no | 0% — automatic prefix caching, 100% of turns are real hits |
| step-5-preview | no | 2.6% (1/38) |

So on the lanes the model is defined for, it never made a false hit and never
missed a real hit.

### The discriminating turns (every turn where the model or reality says "miss")

| when | msgs | breakpoints | model | real (read/write) | audit verdict |
|---|---|---|---|---|---|
| 03:07:36.970Z | 1 | `[0:1h]` | no-history → miss | 0 / 23630 | MISS (chain start) |
| 04:19:57.652Z | 457 | `[455:1h,456:1h]` | window → miss (prev marker 417, jump +39) | 14314 / 342867 | MISS CAUSED BY SYSTEM_DRIFT |
| 04:40:09.986Z | 20 | `[18:1h,19:1h]` | expired → miss | 0 / 38272 | MISS CAUSED BY SYSTEM_DRIFT |
| 07:42:21.143Z | 17 | `[15:1h,16:1h]` | expired → miss | 14257 / 30072 | MISS CAUSED BY HISTORY_REWRITE |
| (01a0e75b, 17:08:55.733Z) | 11 | `[9:1h,10:1h]` | no-history → miss | 0 / 33454 | MISS CAUSED BY SYSTEM_DRIFT |

`14257` is this session's head-only (system + tools) read; the same value shows
up on every cold turn, and `14314` is the same head under the neighbouring
system configuration. Those turns are the model's only real misses, and it
predicts all of them.

## 4. The two real compactions through the same model (task 2)

Main chain replayed up to the wire timestamp, then the compaction wire itself
fed in as a request with its own breakpoints.

| wire | messages | breakpoints | model says | real usage |
|---|---|---|---|---|
| 2026-09-30T04:36:35.314Z (pid 2526627) | 481 | `479:1h,480:1h` | **hit** at 480, read 481 blocks, write 1 | read **383514**, write **1573** |
| 2026-09-30T07:21:39.289Z (pid 2749314) | 355 | `353:1h,354:1h` | **miss** (`expired`), read 0, write 355 | read **14257**, write **265136** |

The reason is exactly the one the incident report gives, and it is a *single*
mechanism:

* `479/480` was last written at **04:27:42** (when the chain passed 481
  messages) — age at the wire **8m52s**, still inside the 1h TTL → hit.
* `353/354` was last written at **05:24:25.037** — age at the wire
  **1h57m14s**, past the 1h TTL → miss. (Only two main requests in the whole
  window ever carried a marker at 353/354 — 04:02:47 and 05:24:25 — so 05:24:25
  is the last write to it.)
* Everything the main chain did after 05:24 anchored at `431/432`, never at
  `353/354`; 228 entries were alive at 04:36 versus 44 at 07:21.

So the pre-fix truncated shape is not broken by itself: it hits whenever the
summarize boundary was passed recently (04:36) and misses whenever it was not
(07:21). The fixed shape decouples the hit from the boundary's age.

## 5. The NEW shape for the 07:21 incident (task 3)

Full live chain + instruction, breakpoints `[432,433]`, 434 messages, replayed
against the real entry table at 07:21:39:

* the last live marker pair `431/432` was written at 07:15:04.850 (main request
  `messages=433`), i.e. 6m34s old → alive;
* predicted: **hit at 432, read 433 blocks, write 1 block**.

Token analogue from the same chain: at 07:15:04.850 the main request with those
exact anchors reported `cacheRead=377769, cacheWrite=484`. So the fixed shape
should read ≈378k and write ≈1–2k (the 04:36 hit wrote 1573 for a comparable
shape) where the incident read 14257 and wrote 265136.
`[INFERENCE]` — not yet observable in the logs, this is the unrun AC7 shape.

## 6. What the corpus actually exercises (and therefore what the 100% does *not* buy)

Reach histogram over the 712 matched hits — `reach = anchor - matched entry`:

| reach | turns | | jump per turn | turns |
|---|---|---|---|---|
| 0 | 3 | | +0/+1 (chain start) | 3 / 3 |
| 1 | 3 | | +2 | 620 |
| 2 | **620** | | +3 | 83 |
| 3 | 83 | | +4 | 3 |
| 4 | 3 | | +39 | 1 |

* The provider never had to reach back more than **4** message-blocks, and in
  every single turn the matched entry was the **immediately preceding request's
  own marker**. 620 of 712 hits are the same two-messages-per-turn APPEND_ONLY
  step.
* Consequently the headline 100% is mostly the statement "the entry the
  previous turn just stamped, 2 blocks behind, is still alive seconds later".
  Breakpoint-lane gap since the previous request: median 9s, p90 69s, max
  1636s, and **no** turn over 1h. It is a real regression test of the
  layout rule — a model that stamped entries anywhere else, or reached forward,
  or failed to stamp unpaired requests, fails loudly (lookback=0 → 0.2%
  agreement; unpaired writes off → 92.9%) — but it is *not* a test of the TTL
  or the lookback width.

Bounds the data does supply:

* **Lookback, lower bound**: 3–4 message-blocks. `lookback=2` → 89.9%
  (the 83 turns that advanced by +3 and the 3 that advanced by +4 fail),
  `lookback=4` → 100.0%, and it stays 100.0% through `lookback=30`.
* **Lookback, upper bound**: 39 message-blocks, from exactly one turn
  (04:19:57.652): the previous marker was at 417, the anchor at 456, the
  previous entry was 4 minutes old and alive, and reality was a full rewrite
  (read 14314, write 342867). A window of >= 40 message-blocks would have
  predicted a hit and been wrong. This is one turn in a region where the
  session alternates two `system[0]` variants, so it is weak but non-zero
  evidence that the lookback is finite.
* **TTL, upper bound**: 1h57m — the 07:21 compaction missed with the boundary
  entry at that age.
* **TTL, lower bound**: 23 minutes — the largest gap that still produced a real
  hit is 1394s. No breakpoint-lane turn in the corpus has a gap over 1h at all,
  so idle-driven expiry is **never exercised**; the only TTL-relevant evidence
  in the whole dataset is the compaction replay above.

**Block proxy**: measured on 283 sampled archived wire bodies, content blocks
per message is median **1.448** (whole body) / **1.458** (last 24 messages),
p10–p90 1.33–1.87. A lookback of 20 *content blocks* is therefore about **13.8
messages**, and the gate's `LOOKBACK_BLOCKS = 20` applied to message indices is
roughly 45% too permissive. Inside the band the data supports (>= 4, < 39) that
constant is still fine, and the fixture's verdicts do not depend on it (its red
leg anchors 78 messages behind the live tail, far outside any plausible
window), but the constant is not the real window.

## 7. Does the data discriminate "shallower entries are refreshed by deeper hits"?

**Yes, once, and it says "not refreshed".**

The 07:21 compaction anchored **exactly on** `353/354` (distance 0, inside any
plausible window). If a deeper hit refreshed the shallower checkpoints, then the
main chain's hit at 07:15:04.850 (anchor `431/432`, `cacheRead=377769`) would
have re-stamped `353/354` 6m34s before the compaction, and the compaction would
have read the ~378k-token prefix. It read **14257** — this session's head-only
value, the same number every cold turn reports. So the deeper activity did not
keep the boundary checkpoints alive.

The same conclusion is expressed positively by the 04:36 compaction: it hit
because **its own** boundary entry was 8m52s old, not because the main chain
had been busy. The rule the model encodes — *a marker is (re)stamped only by a
request that carries a marker at that position* — is what the two real
compactions show.

Caveats, stated plainly: this is one observation, and it leans on the 1h TTL
(a single 1h TTL with no refresh explains both compactions and all 5125 turns;
a TTL far above ~2h would leave the 07:21 miss unexplained). The corpus cannot
add a second observation, because in every one of the 712 hits the matched entry
was the previous turn's own fresh marker — the "older checkpoint" case is simply
never needed on a tail-advancing chain.

One more structural point that falls out of the numbers: the audit log **never**
recorded the incident's signature (byte-identical prefix, cold cache). Across
all 602 paired breakpoint-lane turns there are exactly 4 real misses, and every
one of those 4 is already flagged as a miss by the byte-identity verdict too.
The incident lived in the compaction lane, which the audit does not instrument.
So no amount of replaying the audit log could have caught it; the model has to
be applied to the compaction wires explicitly, which is what §4/§5 do.

## 8. Honest summary

Proven by this calibration:

1. On the Anthropic lane, the gate's layout rule — stamp the request's own
   breakpoints, read back the highest alive entry at or before the anchor —
   reproduces **every** observed hit and miss (595/595 scored turns, 0
   disagreements; all 4 real misses predicted — 1 scored, 2 generation breaks,
   1 chain start — on two different Claude models and 116 chains).
2. The read/write split the gate asserts for green and red is the real
   behaviour: two compactions of the same session and chain, differing only in
   the age of the boundary entry, produced read 383514/write 1573 (hit) versus
   read 14257/write 265136 (miss).
3. The boundary-entry liveness explanation of the 07:21 incident is correct, and
   the new shape (`msgs = live chain + 1`, breakpoints `[n-1, n]`) turns it into
   a predicted 433-block read and a 1-block write.
4. Deeper hits do not keep shallower checkpoints alive (one clean observation).

Not proven, and worth stating in the gate's own comments:

1. **The lookback width.** The corpus only ever needed 4 blocks of reach and
   supplies a single, confounded upper bound of < 39. `20` is consistent; it is
   not measured. In block units the gate's constant is ~45% too generous.
2. **The TTL under idle.** No breakpoint-lane turn has a gap over 1h, so the
   1h TTL is only ever exercised through the compaction boundary entries.
3. **Refresh semantics in general.** Only the compaction case discriminates it
   (see §7); a fresh-marker-always-available chain cannot.
4. **System/tools content.** The model keys entries on message index only; the
   real cache is content-addressed over the whole prefix (including 6 system
   parts and the tool list). 161 `SYSTEM_DRIFT` turns happened to agree anyway
   (this session alternates two system variants that are both cached), and one
   turn (04:19:57) was a real miss for reasons the model reaches by coincidence
   (its window) rather than by modelling the drift. A drift that the model
   cannot see could produce a false hit in a future fixture; nothing in the
   corpus tests that.
5. **Cross-chain sharing.** Entries are per `(session, model)` in the replay and
   the provider cache is content-addressed, so two chains with a common prefix
   can share entries. Not modelled; not needed here.
6. **Token magnitudes.** The boolean is validated; `cacheRead / predicted read
   blocks` has a median of 878 (p10 792, p90 1360) on the incident chain, so
   block counts are proportional to tokens but not a token model. The gate's
   `BLOCK_TOKENS = 100` and `HEAD_TOKENS = 50` are fixture constants and are not
   calibrated by anything here.
7. **Chain-cold starts.** 2 breakpoint-lane chains begin inside the log window
   and are excluded from the headline; the model starts cold for them by
   construction.
