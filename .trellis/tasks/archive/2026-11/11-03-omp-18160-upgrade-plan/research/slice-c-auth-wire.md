# Slice C — OAuth/credential durability and provider-wire families (18.12.6 → 18.16.0)

Scope: `0090-omp-oauth-durable-refresh` (30 paths, 128 hunks), `family-antigravity-wire` (0014, 0054),
`family-devin-wire` (0055, 0071, 0056, 0058, 0060), `0098`, `0099`, `0048`, `0072`, `0065`, `0100`.
14 capability IDs. Research only; no patches, no installs, no credentials touched.

## Method and evidence base

- Pristine trees: `/tmp/omp-plan-18160/pristine-{18.12.6,18.16.0}/<pkg>` (pi-ai, pi-catalog, pi-coding-agent,
  pi-tui, pi-utils). Paths in this document are relative to the package root.
- Per-family isolation: every failing hunk below was produced by
  `patch -p1 --fuzz=0 --batch -i patches/.18.12.6-families/<family>.patch` in a **fresh copy of the
  18.16.0 tree containing only that family** (`/tmp/omp-plan-18160/scratch-sliceC/…`), then read back from the
  generated `.rej` files. Cascade failures from sibling families are therefore excluded — except where a hunk
  is explicitly marked as depending on another family (0060 does).
- Cross-checks against `research/replay-measure-v1.json` (family-level fuzz0 results agree with this slice:
  22/27 fail remains the case).

Fuzz-0 totals for this slice, isolated:

| family | root | hunks | fuzz0 | failing hunks |
|---|---|---|---|---|
| `family-antigravity-wire` | AI | 5 | fail | #4 `@@ -1230`, #5 `@@ -1379` |
| `family-devin-wire` | NM | 28 | fail | devin.ts #7 `@@ -264`; agent-session.ts #1 `@@ -12237` |
| `0048-…-advisor-quota-rotation-bound` | NM | 6 | fail | session-advisors #1/#2/#3/#4 (4 of 4); advisor-config 2/2 clean |
| `0065-…-model-record-parity` | NM | 2 | fail | `rules.json` #1 `@@ -1` |
| `0072-…-session-pin-static-auth-ui` | AGENT | 8 | fail | 8 of 8 |
| `0090-…-oauth-durable-refresh` | NM | 128 | fail | 13 files / 44 hunks (enumerated in §4) |
| `0098-…-tls-verify-transient-retry` | AI | 2 | fail | #1 `@@ -562`, #2 `@@ -569` |
| `0099-…-retry-slow-schedule` | AGENT | 1 | **ok** | none (offset +5) |
| `0100-…-stepfun-step-plan` | NM | 7 | fail | `rules.json` #1 `@@ -1`, `models.json` #1 `@@ -1` |

---

## 1. Summary table

| capability ID | family | classification | one-line reason | proof required |
|---|---|---|---|---|
| `0014` | family-antigravity-wire | KEEP-REBASE-SEMANTIC | Both hunks fail: upstream rewrote `buildAntigravityRequestEnvelope` (signature `(model, context, profile, state)`, `step = Math.max(contextSteps, (stepIndex ?? 0) + 1)`, new `cascade_id`/`root_cascade_id`/`request_id` labels) and kept `randomUUID()` defaults, so the deterministic-id seam survives but the step hunk contradicts upstream. | `verify-antigravity-envelope.ts` must gain a **restart** leg (two fresh `providerSessionState` maps must yield identical `agentId`/`trajectoryId`/`sessionId`) and must fail on the unpatched 18.16.0 tree; plus a retained-import check for `createHash`. |
| `0054` | family-antigravity-wire | ADOPT-CANDIDATE | Upstream already removed `requestType: "agent"` from the antigravity envelope: `requestType` occurrences in `providers/google-gemini-cli.ts` are 2 at v18.1.18 and v18.10.1, 1 at v18.12.6 and v18.16.0 (type field only). The 18.12.6 family patch carries **no** `requestType` hunk — the capability has zero delta. | `verify-antigravity-envelope.ts` assertion 1 (`req1.requestType === undefined`) green on unpatched 18.16.0; negative control by re-adding `requestType: "agent"` must flip that assertion. |
| `0055` | family-devin-wire | KEEP-REBASE-MECHANICAL | devin.ts hunks #1–#6 (in-process JWT hold, per-turn `authMs`/`headersMs`) apply at offsets 1–5; the auth-cache seam is untouched by 18.13.2's compression change. | `verify-devin-auth-cache.ts` on a rebased 18.16.0 tree: zero `GetUserJwt` on turn 2, and red on a tree with the cache removed. |
| `0071` | family-devin-wire | KEEP-REBASE-SEMANTIC | Same failed hunk #7: the 401/403 cached-auth invalidation retry loop must be re-authored around 18.13.2's async `gzipAsync` + `MIN_COMPRESSED_BODY_BYTES` body build, and `OMP_DEVIN_DUMP` must capture the new `builtGz`/`chatBody`. | Behavioural: assignment 401 and chat 401 each invalidate the cached JWT and retry exactly once; a second 401 on the final attempt must still invalidate but not retry. |
| `0056` | family-devin-wire | KEEP-REBASE-MECHANICAL | Upstream bumped `DEVIN_CLI_METADATA` in `pi-catalog/src/wire/devin.ts:22-29` from `3000.11.3` to `3000.11.205` (both fields together), which does **not** collide with the family: the family's delta is only the per-process `devinSessionId` + incrementing `devinRequestId` (`wire/devin.ts:30-39`, `:69-71`) and applies exactly. `Metadata` field 9/10 wire numbers unchanged (`discovery/devin-proto.ts:1888`). | `verify-devin-metadata.ts` green; it already asserts the tuple's **shape + field equality**, not a literal version (`:96-99`), so it is version-agnostic. Note the `3000.10.23` value in `PATCHES.md:610-612` is stale documentation — do not "restore" it. |
| `0058` | family-devin-wire | KEEP-REBASE-MECHANICAL | devin.ts hunks #9–#15 (thinking-signature capture/replay) apply at offset +9; no upstream change in that region. | `verify-devin-thinking-signature.ts` green; dropping the trailing-frame signature capture must fail it. |
| `0060` | family-devin-wire | KEEP-REBASE-SEMANTIC | The target line (`runIdleEphemeralTurn`'s `runEphemeralTurn({ promptText, signal })`) is **not in either pristine tree** — it is created by family `0010`, so 0060 can never apply alone; additionally 18.16.0 moved the idle recap turn to `pi-coding-agent/src/session/idle-maintenance.ts:345`. | `verify-devin-idle-cascade-pin.ts` (needs 0010 landed first) green; the `mapOptionsForApi` leg requires the 0060 re-export at `pi-ai/src/stream.ts:1770`. |
| `0048` | 0048-omp-advisor-quota-rotation-bound | ADOPT-CANDIDATE | Upstream 18.14.1 (#17439) added `#spendCredentialSwitch` (`session-advisors.ts:2269-2274`), bounding same-provider credential switching by `credentials.list(provider).length - 1` for **both** `AccountPolicy` and usage-limit denials, reset on turn success (`:2279`). Stronger than the local fixed grace of 1. | New consumer test: two codex credentials both returning `usage_limit_reached` must produce at most `N-1` same-provider recoveries and then walk the cross-provider chain; negative control by neutering `#spendCredentialSwitch` to `return true`. |
| `0072` | 0072-omp-session-pin-static-auth-ui | ADOPT-CANDIDATE | Upstream 18.14.0 (commit `6693ddbfd5`, "Deferred non-essential provider and UI module loading to first-use") converted `loadProviderAuthUi()` from sync `require()` to `await Promise.all([import(…)])` at `selector-controller.ts:154-176`, with all 5 call sites awaiting (`:270`, `:2129`, `:2274`, `:2313`, `:2382`). No sync `require()` of a pi-ai/pi-tui subpath remains. | Run the existing repro **unpatched**: install `installLegacyPiSpecifierShim()` then open `/session pin`, `/login`, `/logout`, `/usage reset` — must not throw `BuildMessage: NameTooLong`. Negative control: restore a sync `require("@oh-my-pi/pi-ai/index.js")` and reproduce the crash. Verifier's version allowlist must add `18.16.0`. |
| `0065` | 0065-omp-commandcode-deepseek-model-record-parity | KEEP-REBASE-MECHANICAL | The behaviour-bearing delta is `compat/rules/providers/commandcode.kdl:147` (`supports-strict-mode`, `supports-multiple-system-messages`), which applies at offset −1. `compat/rules.json` is a **compiled artifact** (`{"version":1,"files":[…]}` with per-file compiled rules) and cannot be hand-edited; 18.16.0 ships 496,742 B vs 472,489 B. | `verify-commandcode-model-record-parity.ts` green after `bun run gen:compat`; sibling `deepseek/deepseek-v4-flash` must keep the lineage image strip (it does today). |
| `0098` | 0098-omp-tls-verify-transient-retry | KEEP-REBASE-MECHANICAL | Both hunks fail only on context: 18.16.0 refactored the inline `TRANSIENT_ENVELOPE_PATTERN && …TRUNCATION_PATTERN` expression out of `isTransientErrorText` into `isStreamEnvelopeTruncationText()` (`error/flags.ts:582-595`). The insertion point and the `TRANSIENT_TRANSPORT_PATTERN` clause both survive. | `verify-tls-verify-transient-retry.ts` green; must fail when the pattern is removed. Note the gate depends on `TurnRecovery.isRetryableError` (`session/turn-recovery.ts:1562`) and `Settings.isolated` (`config/settings.ts:764`), both present. |
| `0099` | 0099-omp-retry-slow-schedule | KEEP-REBASE-MECHANICAL | `calculateRetryBackoffDelayMs` and its two constants are byte-identical between versions (`session/retry-fallback-chains.ts:89-97` in both trees) and the hunk applies at offset +5. The rest of the file *did* change upstream (`AUTO_THINKING` handling in `parseRetryFallbackSelector`/`retryFallbackChainKeys`, `:22-34`, `:113`, `:414-425`) but not inside the hunk's context. | `verify-retry-slow-schedule.ts` green (9 delays = 3,3,5,5,10,10,15,15,15 s), and red when the schedule is reverted. |
| `0100` | 0100-omp-stepfun-step-plan | KEEP-REBASE-MECHANICAL | All source/KDL hunks apply (`rules/auth/stepfun.kdl`, `rules/providers/stepfun.kdl`, `provider-models/openai-compat.ts:5438/5450`, `.d.ts` comment). Only the **generated** `rules.json` and `models.json` fail; 18.16.0's `models.json` is no longer a `{provider: {id: Model}}` map but the encoded catalog `{version, keys, booleanShapes, nodes, compat, providers}` (12.47 MB → 1.16 MB). | Regenerate both artifacts (`gen:compat`, `gen:models`), then re-run the synthetic-fetch smoke: `/step_plan/v1/chat/completions`, `/step_plan/v1/models`, and preservation of an explicit custom base URL. |
| `0090` | 0090-omp-oauth-durable-refresh | CONFLICT-REDESIGN | The **durability** half is upstream-adopted (see §4.2: five of eight sub-contracts have a 1:1 upstream equivalent), but the **journal + unlock** half has no upstream equivalent and the seam it hooks (`#refreshStored` body, `#persistExchanged`) was replaced by `OAuthRefresher.#exchangeLeased`/`#persistExchangedCredential`. Re-authoring is a design decision, not a context rebase. | Journal/unlock: the full (a)–(x) scenario set of `verify-oauth-durable-refresh.ts` must be re-derived against `#exchangeLeased`, and must be red on unpatched 18.16.0. Durability: see the per-sub-contract proofs in §4.3. |

---

## 2. `family-antigravity-wire` — 0014, 0054

Root `AI`. Owned path: `pi-ai/src/providers/google-gemini-cli.ts` (854 → 1,096 lines).

### 2.1 Failing hunks

- **#4 `@@ -1230,17 +1238,29 @@`** — targets `buildAntigravityRequestEnvelope`: adds a 5th parameter
  `sessionKeyOverride`, derives `agentId`/`trajectoryId` via `deriveDeterministicUuid(seed, namespace)` and
  `sessionId` via `deriveSignedDecimalFromHash`, and rewrites the step counter.
  Cause: upstream changed the signature (`wireModelId` → `profile`) and the step formula.
- **#5 `@@ -1379,7 +1399,7 @@`** — passes `options.sessionId` as the 5th argument at the `buildRequest` call site.
  Cause: the call site is now `buildAntigravityRequestEnvelope(model, context, profile, state)`
  (18.16.0 `google-gemini-cli.ts:1448`).
- Hunks #1 (`createHash` import), #2 (`@@ -1082`, ephemeral `lastExecutionId` guard) and #3
  (`deriveDeterministicUuid` helper) apply (`#2`/`#3` at offset +23).

### 2.2 Upstream changes to the owned path

| 18.16.0 site | Change |
|---|---|
| `google-gemini-cli.ts:1257-1262` | `buildAntigravityRequestEnvelope(model, context, profile: AntigravityModelWireProfile \| undefined, state)` — third parameter is now the resolved wire profile, not the raw model id. |
| `google-gemini-cli.ts:1265-1272` | `state.agentId ??= randomUUID()`, `state.trajectoryId ??= randomUUID()`, `state.sessionId ??= randomSignedDecimalSessionId()`, `state.stepIndex = Math.max(contextSteps, (state.stepIndex ?? 0) + 1)`, plus `state.requestCount`. |
| `google-gemini-cli.ts:1279-1291` | Labels now include `cascade_id = agentId`, `root_cascade_id = agentId`, `request_id = ${trajectoryId}-${requestIndex}`, `last_step_index`, `model_enum`, `used_non_gemini_model`. |
| `google-gemini-cli.ts:1448` | Call site passes `profile`; `options.sessionId` is **not** threaded. |
| `google-gemini-cli.ts:411-420`, `:1294-1302` | `buildRequest` gained an optional 6th parameter `accountKey`; the 5-argument form the verifier uses is still valid. |
| `pi-ai/CHANGELOG.md:148-150` (18.13.0, #17012) | "…now carry the same request labels as the official 2.26.0 client (`cascade_id`, `root_cascade_id`, `request_id`, `used_non_gemini_model`)"; "…now number conversation steps like the official client (the first request is step 1, and each model turn and tool result adds one)". The step sentence is the same numbering decision 0014 encodes. |

### 2.3 Rebase notes

- 0014 is **not** an adoption: `agentId`/`trajectoryId`/`sessionId` are still `randomUUID()` on a cold
  provider-session map, i.e. the 320k-token restart cache miss is still reachable. Keep the capability.
- Per `.trellis/spec/backend/patch-rollup-contracts.md:561` ("when upstream ships an overlapping mechanism,
  keep the upstream structure and re-insert the local boundary inside it"), do **not** restore the old
  `state.stepIndex = (state.stepIndex ?? 1) + 1` line. Keep upstream's `Math.max(contextSteps, …)` and add only
  the ephemeral-no-advance guard (`isEphemeral`) beside it.
- New insertion points: deterministic derivation immediately after `:1276` (`const sessionId = …`), the
  5th parameter on `buildAntigravityRequestEnvelope` (`:1257-1262`), and the argument at `:1448`.
- **Deletion to re-verify:** 0014's delta deletes `state.agentId ??= randomUUID()` /
  `trajectoryId` / `deriveAntigravitySessionId(context)` fallbacks. `patch-rollup-contracts.md:81` requires
  re-verifying owned deletions, not only additions.
- **Retained-import check (mandatory):** `patch-rollup-contracts.md:87-90` records that unchanged 0014 applied
  at zero fuzz in 18.3.3 and then died at runtime with `ReferenceError: createHash is not defined`. In 18.16.0
  `createHash` is absent from pristine `google-gemini-cli.ts` (count 0) and is added only by hunk #1; any rebase
  that keeps `deriveDeterministicUuid` **must** keep the `createHash` import at `google-gemini-cli.ts:6`.

### 2.4 Verifiers

- `patches/verify-antigravity-envelope.ts` — imports `buildRequest` from
  `${OMP_PATCH_VERIFY_AI_ROOT}/src/providers/google-gemini-cli.ts`; signature still valid.
- Verifier weaknesses found (must be repaired as part of the gate, per
  `verification-gate-contracts.md:659` "a version that should have [the producer] fails closed if it is
  missing"):
  1. Assertion 2 (`same sessionKey must yield identical deterministic sessionId`) and assertion 3
     (`side-channel must share the base session identity`) pass on **unpatched 18.16.0** because both go
     through `deriveAntigravitySessionId(context)` with no provider-session state. They do not discriminate.
  2. There is no restart-equivalence leg: the actual 0014 contract (fresh process ⇒ identical
     `agentId`/`trajectoryId`/`sessionId`) is untested.
  3. No `createHash` import assertion.
  4. The `0054` assertion (`requestType === undefined`) is already true upstream — it is a regression guard,
     not a discriminator for this upgrade.
- 0054's contract needs **no** rebase action; retire-or-keep is a bookkeeping decision for the plan owner.
  Recommendation: keep the ID registered (it pins a measured wire fact, exactly like 0065 after its plugin was
  retired) but record that its patch delta is empty.

---

## 3. `family-devin-wire` — 0055, 0071, 0056, 0058, 0060

Root `NM`. Owned paths (10). `pi-catalog/src/wire/devin.ts` changed upstream in one place only:
`DEVIN_CLI_METADATA.ideVersion`/`extensionVersion` `3000.11.3` → `3000.11.205` (`wire/devin.ts:22-29`).
That is release data, not the family's pinned delta — see §3.2/§3.4.

### 3.1 Failing hunks

- **`pi-ai/src/providers/devin.ts` #7 `@@ -264,41 +273,119 @@`** — replaces the single request build+POST with a
  2-attempt auth-recovery loop (assignment 401/403 → `invalidateDevinAuth` → retry once; chat 401/403 →
  same) and adds the `OMP_DEVIN_DUMP` byte/JSON forensics dump.
  Cause: 18.13.2 replaced `gzipSync(reqBytes)` with
  `compress = reqBytes.byteLength >= MIN_COMPRESSED_BODY_BYTES`, `chatBody = compress ? await gzipAsync(reqBytes) : reqBytes`,
  `frameConnectMessage(chatBody, compress ? CONNECT_COMPRESSED_FLAG : 0)` and a conditional
  `connect-content-encoding` header (`devin.ts:272-300`), and changed `compressedBytes` to
  `compressedBytes` (possibly `undefined`) at `:344` and `:389`. The whole block the hunk rewrites is gone.
- **`pi-coding-agent/src/session/agent-session.ts` #1 `@@ -12237,7 +12237,16 @@`** — adds
  `conversationId: this.model?.provider === "devin" ? this.sessionId : undefined` to the idle turn.
  Cause (two, independent):
  1. The context (`const reservation = { abort, settled }; this.#idleEphemeralReservation = reservation;`) is
     **not in either pristine tree** — family `0010` creates it
     (`patches/.18.12.6-families/0010-…patch:796-799`). 0060 cannot apply without 0010 landed first; the
     isolated fuzz-0 failure is partly a cascade artifact, not upstream drift.
  2. 18.16.0 moved the idle recap turn out of `agent-session.ts` into
     `pi-coding-agent/src/session/idle-maintenance.ts:345`
     (`await session.runEphemeralTurn({ promptText, signal: run.signal })`), and `runEphemeralTurn` now lives
     at `agent-session.ts:12769`.
- Hunk #2 (`conversationId: args.conversationId` after `promptCacheKey:` in `prepareSimpleStreamOptions`)
  applies at offset +510 → `agent-session.ts:12867-12871` region.
- `pi-ai/src/stream.ts` #1/#2 apply (offset +17/+18) and carry the `export` on `mapOptionsForApi`
  (`stream.ts:1770`) plus `conversationId: options?.conversationId`.
- `pi-ai/src/types.ts` #1 applies (offset +6); `pi-coding-agent/src/session/agent-session-types.ts` #1 applies
  (offset +43) adding `EphemeralTurnOptions.conversationId`.

### 3.2 Upstream changes to owned paths

| 18.16.0 site | Change |
|---|---|
| `pi-ai/src/providers/devin.ts:1-2`, `:88-89` | `gzip` + `promisify`, `gzipAsync`; "a synchronous gzip stalls the TUI on a multi-MB transcript". |
| `pi-ai/src/providers/devin.ts:272-300` | Small-body bypass below `MIN_COMPRESSED_BODY_BYTES` (1 KiB), conditional `connect-content-encoding`. |
| `pi-ai/src/providers/devin.ts:344`, `:389` | `compressedBytes` may be `undefined` in trailer-error and request diagnostics. |
| `pi-coding-agent/src/session/idle-maintenance.ts:330-360` | `#runRecap` is the idle ephemeral turn; it calls `session.runEphemeralTurn` and never carried a Devin pin. |
| `pi-coding-agent/src/session/agent-session.ts:12769-12871` | `runEphemeralTurn` derives `sideSessionId` from `args.conversationKey` (`:12855-12857`) and forwards `sessionId`/`parentSessionId`/`promptCacheKey`. |
| `pi-catalog/src/wire/devin.ts:22-29` | `DEVIN_CLI_METADATA.ideVersion`/`extensionVersion` `3000.11.3` → `3000.11.205`. Not touched by the family (the family adds `sessionId`/`requestId` only); `verify-devin-metadata.ts:96-99` deliberately asserts shape + cross-field equality, not a literal tuple, so it stays green. |
| `pi-ai/CHANGELOG.md` (18.13.2) | "Fixed Devin requests compressing the request body on the UI thread … requests under 1 KiB are now sent uncompressed". |

### 3.3 Rebase notes

- **0055 / 0056 / 0058**: context-only. Re-emit the hunks against the current offsets; nothing semantic moved.
- **0071**: re-author hunk #7 as a loop *around* the new body build. Required properties preserved: (a) one
  forced auth refresh per turn maximum, (b) the rejected JWT is invalidated even on the final attempt,
  (c) `onPayload` runs once per wire attempt (so the payload hook sees `turn.apiKey`/`userJwt` for that
  attempt), (d) the dump captures `builtReqBytes` and the JSON form, not the compressed frame.
  `gzipAsync` is awaited inside the loop → the loop body is `async`; `output.upstreamModel`, `authMs`,
  `headersMs` keep their existing lifetimes.
- **0060**: two landing sites are needed and they are **different**:
  1. `pi-coding-agent/src/session/idle-maintenance.ts:345` — the real idle recap/keepalive turn. This is the
     new home of the 0060 contract and it is currently unpinned.
  2. `runIdleEphemeralTurn` as created by family `0010` (whatever its rebased landing point) — the
     extension-facing wrapper.
  Add `conversationId?: string` to `EphemeralTurnOptions` (`agent-session-types.ts:636-658`) either way.
  Cross-slice dependency: the 0010 rebase is owned by another slice; 0060 must be sequenced **after** it, or
  its `conversationId` plumbing must be folded into 0010's revision.
- `0060`'s verifier `patches/verify-devin-idle-cascade-pin.ts` itself depends on the 0010 API
  (`session.runIdleEphemeralTurn`, `:95`/`:137`) and on `mapOptionsForApi` being exported
  (`:155`), which the family supplies at `stream.ts:1770`. Both survive.

### 3.4 Verifiers

| capability | gate | seam status on 18.16.0 |
|---|---|---|
| 0055 | `verify-devin-auth-cache.ts` | OK — `streamDevin` from `src/providers/devin.ts`, `devin-proto.ts`, `protobuf.ts`, `pi-utils` all present; `vi` uses only `GetUserJwt`/`AssignModel`/`GetChatMessage` codecs. |
| 0056 | `verify-devin-metadata.ts` | OK — `devinCliMetadata`/`devinDiscoveryMetadata` at `pi-catalog/src/wire/devin.ts:58`/`:67`, `MetadataSchema` at `discovery/devin-proto.ts:1888`. |
| 0058 | `verify-devin-thinking-signature.ts` | OK — same `streamDevin` entry point. |
| 0060 | `verify-devin-idle-cascade-pin.ts` | **blocked** until 0010 is rebased; also depends on the 0060 `export` of `mapOptionsForApi`. |
| 0071 | (none registered) | no gate covers the auth-recovery loop; recommend a permanent leg inside `verify-devin-auth-cache.ts`. |

---

## 4. `0090-omp-oauth-durable-refresh`

Root `NM`. 30 owned paths, 128 hunks, 13 `.rej` files. Highest credential-safety risk in the plan.

### 4.1 Failing hunks, per file

Isolated fuzz-0 result (each line = one `.rej`):

| file | failing hunks | cause |
|---|---|---|
| `pi-ai/src/auth/refresh.ts` | **21 of 24** (#1,2,3,5,6,7,9–23) | Upstream rewrote the class body: `refreshStored` → `#track(#refreshStored)`, `#exchangeLeased`, `#persistExchangedCredential`, `#handBackLease`, `#leaveLease`, `#stalledRefreshes`, `close()`. Our `#refreshStoredOwned` split, `#trackRefresh`, `#performStoredRefresh` rename, unlock API and journal hooks have no anchor. |
| `pi-ai/src/auth/select.ts` | 1 of 4 (#2 `@@ -785`) | Upstream added a 6th argument `rejectedAccess` to `refresher.refresh(...)` (`select.ts:839-846`); the hunk's trailing context line `force ? options?.refreshReason : undefined,` is now followed by `rejectedAccess,`. Pure mechanical. |
| `pi-ai/src/auth/sqlite-credential-store.ts` | 1 of 11 (#2 `@@ -19`) | Import line became `import type { AuthCredentialStore, CredentialRefreshLeaseFence, CredentialRefreshLeaseHolder } from "./store";` (`:21`). The journal table DDL (`auth_credential_refresh_exchanges`), prepared statements and all six methods **apply cleanly** — additive, no schema conflict. |
| `pi-ai/src/auth/store.ts` | 1 of 7 (#3 `@@ -131`) | `CredentialRefreshLeaseStore` gained `getCredentialRefreshLeaseHolder?`/`handBackCredentialRefreshLease?` and a new `CredentialRefreshLeaseHolder` interface (`store.ts:127-141`); the journal interfaces must be inserted after `:141` (or after `hasRefreshLeases`, `:257`). |
| `pi-ai/src/auth/types.ts` | 2 of 5 (#2 `@@ -636`, #4 `@@ -1059`) | `StoredOAuthRefreshOptions` gained `rejectedAccess` (`:637-643`) and a `refreshTimeoutMs` doc line; `OAuthRefreshReason` gained `"usage-probe"` (`:332-338`) and `AuthApiKeyOptions` gained `waitForSibling` (`:783-785`) and `prefetchUsage` (`:957-965`). The unlock types are additive and can be re-inserted. |
| `pi-ai/src/auth/usage.ts` | 1 of 5 (#5 `@@ -181`) | The hunk replaces `mergeRefreshedUsageCredential` + `persistRefreshedCredential` with a store re-read. Upstream **kept** the persist (`usage.ts:238-243`) but added the 5th refresh argument `"usage-probe"` (`:235`). Semantic, not context-only. |
| `pi-ai/src/registry/oauth/factory-droid.ts` | 1 of 2 (#2 `@@ -67`) | Upstream split the whoami path into `lookupWorkOSOrganization` + `readWhoami`, moving the "login did not resolve an organization" check into a local `unresolved()` (`:66-71`). The two `context.signal?.aborted` guards the hunk narrows still exist at `:83` and `:87`; the third guard no longer exists (already login-scoped via `unresolved()`, `:79`/`:88`). |
| `pi-catalog/src/provider-models/google.ts` | 1 of 5 (#4 `@@ -155`) | `: models,` at `google.ts:155` is still the fallthrough branch, but the `tagAccess` branch above it now builds `accountAccess[accountKey] = { antigravityWireProfiles }` (`:146-154`). Mechanical. |
| `pi-catalog/src/provider-models/special.ts` | 1 of 4 (#3 `@@ -91`) | `unionCodexModels(results)` doc + log text changed ("A definitive account denial (401/403 auth or 402 payment) contributes nothing and is skipped instead", `:92-118`); the `previous` parameter must be added at `:102-104`. Mechanical. |
| `pi-coding-agent/src/session/agent-session.ts` | 1 of 1 (#1 `@@ -8717`) | The throw moved to `:8882-8885` and is now `new PromptPreflightError(...)`, guarded by `if (!apiKey && !(await this.#recovery.applyMissingCredentialFallback(setupAbort.signal)))` (`:8880`). |
| `pi-coding-agent/src/cli/auth-broker-cli.ts` | **reversed → already applied** | `refreshOAuthToken(provider as OAuthProvider, credential, signal)` is already at `auth-broker-cli.ts:127`. Upstream adoption of 0090's broker-deadline contract (18.13.0 #16291). |
| `pi-ai/dist/types/auth/{sqlite-credential-store,store,types}.d.ts` | 2+1+2 of 10 | Declaration mirrors of the above; must be regenerated from the rebased sources. |
| `pi-tui/src/overlays/mcp-add-wizard.ts` | **0 of 15** (offset +5) | Fully applies. |
| applied clean | `auth/health.ts` (unchanged upstream), `auth/pool.ts` (**byte-identical**), `auth/oauth.ts` (+1 line), `registry/oauth/anthropic.ts` (**identical**), `registry/oauth/snowflake.ts` (**identical**), `auth-broker/remote-store.ts` (offset −1), `auth/types.ts` #1/#3/#5, `usage.ts` #1–#4, `model-manager.ts` 3/3, `catalog/model-manager.d.ts` | — |

### 4.2 Upstream changes in the OAuth / auth-storage call graph (both versions' full extent)

`pi-ai/CHANGELOG.md` and `pi-coding-agent/CHANGELOG.md` entries in the 18.13.0 → 18.16.0 window, with the code
that carries them:

| # | Release / issue | Code site in 18.16.0 |
|---|---|---|
| 1 | **18.13.0 #16291** — "OAuth logins failing with `invalid_grant` after a token refresh took longer than 10 seconds: the refresh now finishes in the background and saves the provider's new refresh token" | `auth/refresh.ts:56-64` (`OAUTH_REFRESH_EXCHANGE_BACKSTOP_MS = 60_000`, docstring "callers stop waiting … the exchange itself runs on"), `:559-598` (budget race that stops only the caller's wait), `cli/auth-broker-cli.ts:127` (`refreshOAuthToken(..., signal)`) |
| 2 | **18.13.2 #17128** — "OAuth logins shared by several processes being disabled with `invalid_grant` when they refreshed at the same time or one of them quit mid-refresh" | `auth/refresh.ts:72-76` (`OAUTH_REFRESH_STALLED_OWNER_MS`), `:150-155` (`#stalledRefreshes`), `:222-269` (`#handBackLease`/`#leaveLease`), `:489-504` (prior-holder takeover), `:716-736` (hand back instead of disable); `auth/store.ts:127-141`; `auth/sqlite-credential-store.ts:552-566`, `:1793-1811` |
| 3 | **18.14.0** — "Fixed cancelled OAuth refresh requests aborting the entire session, and ensured requests joining an existing refresh can still use the refreshed credential when the original request is cancelled" | `auth/refresh.ts:354-360` (`#track` the owner, not the caller), `:479-484`/`:514-518` (`raceSignal` on the caller only, inside the wait), `:945-985`/`:1125-1164` (`#oauthCredentialRefreshInFlight` tracked apart, caller raced separately) |
| 4 | **18.14.0** — "Credential usage is now prefetched during session setup without selecting, pinning, or advancing the OAuth account rotation" | `auth/types.ts:957-965` (`prefetchUsage`) |
| 5 | **18.14.1 #17439** — account-policy rotation bound + `waitForSibling` | `auth/types.ts:783-785`; `auth/rotation.ts` (+10/−5); `pi-coding-agent/src/session/session-advisors.ts:2269-2280` |
| 6 | **18.14.2 #17518** — "`AuthStorage.close()` and `replaceStore()` losing a rotated OAuth refresh token when a refresh was still in flight … the store now stays open until that token is saved, and new refreshes are refused" | `auth/refresh.ts:395-405` (`#drainRefreshes`, `close(closeStore)`); `auth-storage.ts:281-283` (`close() → retire`), `:303-305` (`retire = refresher.close(() => pool.close())`), `:163-175` (`replaceStore` retires the previous modules) |
| 7 | **18.15.0 #17468** — "Anthropic (and other rotating-token) OAuth accounts being signed out automatically when a background usage poll's token refresh got `invalid_grant` … usage polling no longer disables credentials" | `auth/types.ts:332-338` (`OAuthRefreshReason = "auth-recovery" \| "usage-probe"`), `auth/usage.ts:233-236` (passes `"usage-probe"`) |
| 8 | **18.14.0** — single-use refresh tokens: adopt a stored token that differs from the rejected one instead of re-exchanging | `auth/types.ts:502-509` (`rejectedAccessToken`), `:637-643` (`rejectedAccess`), `auth/select.ts:839-846`, `auth/refresh.ts:540-545` (post-lease freshness re-check) |
| 9 | **18.15.0 #17559** — "A prompt on a model whose provider has no usable credential … now switches to the first `retry.fallbackChains` candidate" | `pi-coding-agent/src/session/agent-session.ts:8880` (`applyMissingCredentialFallback`) |
| 10 | **18.13.0 #16655** — "non-streaming requests reporting a missing API key when the credential resolver actually failed" | `auth-retry.ts:341-355` (resolver throw → `ConfigurationError`, not `MissingApiKeyError`) |
| 11 | **18.13.0** — `createOAuthProvenance()` so a 401 names the token actually rejected | `auth-retry.ts:84-114`; `ResolvedApiKey.oauthAccess` |
| 12 | **18.16.0** — `/login mistral` Vibe OAuth (a **new rotating-token provider**) | `pi-ai/src/registry/oauth/mistral-vibe.ts` (**new file**) |
| 13 | **18.16.0 #15586** — "`~/.omp/agent/agent.db` getting corrupted (wiping stored logins) on Linux when grep, read, the bash tool, extensions or eval read it while omp has it open" | `pi-utils/src/held-file.ts` (**new**), `pi-utils/src/fs-open.ts` → removed |
| 14 | **18.13.0** — Google RPC quota classification (`QuotaFailure`, `RetryInfo`, daily caps, zero-entitlement) | `pi-ai/src/error/rate-limit.ts:133-134`, `:166-255` (see §6) |

Also changed in the call graph but with no credential-safety bearing observed:
`auth-broker/{client,server,snapshot-cache}.ts` (provider-scoped usage caches),
`auth-gateway/*` (gateway rework, not in any family), `auth/{abort,cascade,rank,rotation}.ts`,
`registry/{api-key-validation,engine/api-key,hooks/custom}.ts`, `registry/oauth/{cursor,device-code,muse-code,xiaomi,google-antigravity}.ts`,
`usage/*.ts`, `pi-coding-agent/src/config/model-registry.ts` (catalog cache + `retainModelCacheConnection`),
`pi-coding-agent/src/mcp/oauth-{credentials,reauth}.ts`.

**Credential storage schema: unchanged.** No new table, no new column, no `auth_schema_version` bump. The only
DDL change is two new statements on the existing `auth_credential_refresh_leases` table
(`sqlite-credential-store.ts:552-566`). 0090's own journal table `auth_credential_refresh_exchanges` is a
purely additive `CREATE TABLE IF NOT EXISTS` and applies without conflict.

### 4.3 Sub-contract classification for 0090

The family bundles eight sub-contracts. Five have a 1:1 upstream equivalent; three do not.

| sub-contract (from `patches/PATCHES.md:927-946` and the 10-13 unlock revision) | upstream 18.16.0 equivalent | verdict |
|---|---|---|
| R1 `refresh` must not wait on the identity-bootstrap hook; a token response without identity still saves | `auth/registry/oauth/anthropic.ts` drop-in hook; `refresh.ts:788-843` saves the merged credential without an identity round trip | **ADOPT-CANDIDATE** (proof: refresh against a token response omitting `account`/`email` must persist the rotated bytes — leg (a) of the existing gate) |
| R2 caller cancellation owns only its wait; the owner keeps a bounded signal; a cancelled pre-ownership call sends no POST | `refresh.ts:437-439` (pre-ownership abort check), `:559-598` (owner exchange survives the caller budget), `:354-360` | **ADOPT-CANDIDATE** (proof: `raceSignal(ownerWork, callerSignal)` must **not** be the shared promise — assert a surviving waiter plus an owner save; legs (b)/(c)) |
| R3 lease renewal before the CAS; never renew a peer's lease; a taken-over lease hands back instead of disabling | `refresh.ts:300-320` (renew-then-re-acquire), `:650-693` (renewal loop, same-owner only), `:222-269`/`:716-736` (hand back) | **ADOPT-CANDIDATE** (proof: >15 s synchronous stall keeps the token; peer takeover + `handBackCredentialRefreshLease` keeps the login; legs (d)/(e)) |
| R4 genuine `invalid_grant` disables exactly the attempted row; transient failures keep it active | `refresh.ts:755-782` (`disabledCause` under lease); `usage-probe` never disables | **ADOPT-CANDIDATE** (proof: exactly one disabled row; a 503 leaves the row active and the next refresh uses the saved token) |
| shutdown / `replaceStore` must not lose an in-flight rotation | `refresh.ts:395-405`, `auth-storage.ts:281-283`, `:163-175` | **ADOPT-CANDIDATE** (proof: `AuthStorage.close()` mid-exchange, then reopen the private SQLite file in a new process and require the rotated grant) |
| **durable exchange journal** (`reserve`/`stage`/`commit`/`inspect`/`readStaged`/`release`, fence over immutable exchange identity, journal scoped to `DURABLE_EXCHANGE_PROVIDER = "anthropic"`) | **none** — upstream's unknown-outcome memory is in-process only (`#stalledRefreshes`, `OAUTH_REFRESH_STALLED_OWNER_MS`, `refresh.ts:150-155`), and `#persistExchangedCredential` (`:281-349`) retries a busy store for `OAUTH_REFRESH_PERSIST_TIMEOUT_MS` | **CONFLICT-REDESIGN** |
| **unlock surface** (`oauth.inspectUnresolvedRefresh`, `oauth.unlockAndRefreshStored`, `OAuthRefreshUnlock*` types) + `/auth-unlock` companion extension | none | **CONFLICT-REDESIGN** |
| **Codex / google-antigravity discovery-403 eligibility retention** (`retainedAccountCatalog`, `unionCodexModels(previous)`, account-access stripping) | none (18.16.0's `unionCodexModels` skips every denied account, including 403: `special.ts:108-114`) | **KEEP-REBASE-MECHANICAL** (contract intact; drift is comment/log text plus the new `antigravityWireProfiles` account map) |

### 4.4 Rebase notes

- **Do not restore the old local refresh variant beside upstream's.** `patch-rollup-contracts.md:561`
  ("when upstream ships an overlapping mechanism, keep the upstream structure and re-insert the local boundary
  inside it; do not restore the old local variant beside it"). The concrete consequence: the family's
  `#trackRefresh` + `raceSignal(#refreshStoredOwned(...), options.signal)` split at `refresh.ts:157-203`
  must **not** be carried; upstream's `#track` + in-loop `options.signal` check + budget race is the boundary,
  and the journal must be inserted *inside* it.
- New insertion points for the journal (`refresh.ts`):
  1. `#exchangeLeased` (`:636-849`) is the only place a token is POSTed → `reserveCredentialRefreshExchange`
     immediately before `options.refresh(...)` and `stageCredentialRefreshResult` immediately after the
     provider returns, before `#persistExchangedCredential`.
  2. `#persistExchangedCredential` (`:281-349`, called from `#exchangeLeased` `:808`) is the owner → for a protected
     exchange `commitCredentialRefreshResult` **replaces the `tryUpdateAuthCredentialIfMatches` CAS expression itself**
     (`:317-323`), so "publish + retire marker" is one transaction; `if (saved) return true` (`:324`) stays as the success
     branch. Never commit after a successful CAS (commit requires `row.data === expectedData`). The enclosing
     busy-store/refused-save retry loop keeps its lease renew-then-re-acquire (`:300-316`) and its `refused` peer-hand-back
     semantics (`:325-346`) untouched.
  3. `#leaveLease` (`:253-269`) is the failure exit → the reservation must be retired/replaced there so a
     definitive failure never leaves a bare marker.
  4. The unlock API block goes after `close()` (`:405`) and before `#refreshStored` (`:426`).
  5. `inspectUnresolvedRefresh` must return `not-applicable` for non-`anthropic` providers **before** any
     store read — unchanged from the 10-15 revision.
- `agent-session.ts` diagnostic: insertion at `:8880-8885`, **inside** the
  `if (!apiKey && !(await this.#recovery.applyMissingCredentialFallback(...)))` branch and before
  `throw new PromptPreflightError(...)`. Also change `throw new Error(...)` → `new PromptPreflightError(...)`
  to match 18.16.0.
- `usage.ts` hunk #5 must keep the new 5th argument `"usage-probe"` and must be re-decided: upstream still
  performs `mergeRefreshedUsageCredential` + `persistRefreshedCredential` (`:238-243`). If the family keeps the
  "single persistence owner" contract, the re-read must be written against that call, not against the removed
  one; if it is dropped, record the delta explicitly (a `usage-probe` refresh already cannot disable).
- `factory-droid.ts`: only two sites need the login-phase narrowing (`:83`, `:87`); the third edit target is
  already login-scoped through `unresolved()`.
- `.d.ts` mirrors must be regenerated from the rebased sources, not hand-patched.
- `pi-tui/src/overlays/mcp-add-wizard.ts` needs no rebase (15/15 clean).

### 4.5 Verifiers, and whether their seams survive

| verifier | status on 18.16.0 |
|---|---|
| `patches/verify-oauth-durable-refresh.ts` (3,284 lines) | **Seams intact, surface missing.** Loads `${AI_ROOT}/src/auth-storage.ts` (`AuthStorage`, `SqliteAuthCredentialStore` — still exported, `auth-storage.ts:55-64`), `registry/oauth/anthropic.ts` (`anthropicIdentityHook`, `:95`), `auth/usage-cache.ts` (`buildUsageCredential` `:69`, `usageCacheIdentity` `:95`), `auth-broker/{server,client,remote-store}.ts`, `registry/oauth/index.ts` (`refreshOAuthToken`), `mcp/oauth-credentials.ts` (`refreshStoredManagedMcpOAuthCredential` `:159`, `refreshManagedMcpOAuthCredential` `:105`), `mcp/oauth-flow.ts` (`mcpOAuthCredentialId` `:32`), `error/classes.ts`, `dist/types/index.d.ts`. `requireUnlockSurface()` (`:580-608`) **fails closed** when the unlock API is absent, so on a clean 18.16.0 tree the gate is red — correct per `verification-gate-contracts.md:659`. What must change: (a) every `store.stageCredentialRefreshResult` fault-injection site (`:959`, `:989`, `:1919`, `:2809`, `:2879`) still binds a method the rebase must keep; (b) `:2982-3012` (the session-level diagnostic leg) now runs through `applyMissingCredentialFallback` — see open question Q1; (c) the gate must add a leg that the *upstream durability half alone* is green (the five ADOPT proofs of §4.3), otherwise retiring those hunks is unproven. |
| `patches/verify-oauth-unlock-fence-faults.sh` (237 lines) | Shell fault controls (p)/(q)/(s); needs re-pin to the new refresh.ts line anchors — it mutates source text. |
| `patches/verify-auth-unlock-extension.ts` (161 lines) | Drives `PROTECTED_PROVIDERS`/`/auth-unlock`; unchanged contract, but its `pi-catalog/src/compat/rules/auth/anthropic.kdl` token-URL read must be re-checked (that file changed in 18.16.0 — `auth/_order.kdl`, `auth/anthropic.kdl` not listed as changed, but `rules/auth/mistral.kdl` is new and `_order.kdl` changed, so the completion list must stay `anthropic` only). |
| `patches/verify-codex-account-eligibility-retention.ts` (189) | Seams intact: `resolveProviderModels` (`model-manager.ts:241`), `openaiCodexModelManagerOptions` (`special.ts`), `resolveModelCacheProviderId` (`provider-models/cache-provider-id.ts:97`), `readModelCache` (`model-cache.ts:499`), `getBundledModels`. Note `resolveProviderModels`'s signature gained no `previous` parameter upstream; the `previous` plumbing is 0090-local (`model-manager.ts` hunks 1-3, clean). |
| `patches/verify-google-account-eligibility-retention.ts` (280) | Same seams; the `accountAccess[accountKey] = { antigravityWireProfiles }` change at `google.ts:146-154` must be reflected in the fixture's expected rows. |
| `patches/verify-db-safety.sh` | Also relevant to #13 in §4.2 (agent.db held-file guard). |

---

## 5. `0048-omp-advisor-quota-rotation-bound`

### 5.1 Failing hunks

All four `pi-coding-agent/src/session/session-advisors.ts` hunks fail:

| hunk | target | cause |
|---|---|---|
| #1 `@@ -134` | insert `ADVISOR_USAGE_LIMIT_ROTATION_GRACE = 1` after `ADVISOR_CODEX_SSE_MAX_ATTEMPTS` | `:136` is still `const ADVISOR_CODEX_SSE_MAX_ATTEMPTS = 1;` but the following doc block for the sibling-buffer constant moved/expanded (`:138-…`). |
| #2 `@@ -348` | add `usageLimitRotations?: { provider; count }` to the runtime-state interface | the interface now has `credentialSwitches` (`:368`) and a `providerWaitRetries` doc block (`:353-367`); upstream added its own counter at the same place. |
| #3 `@@ -1586` | clear the counter on a successful turn (`advisorRef.recorder.commitTurn()`) | the success block moved (`retryFallbackPendingSuccess` handling at `:1627-1633`, state init `:1687-1692`). |
| #4 `@@ -2104` | replace `if (outcome.switched) return true;` | replaced by `if (outcome.switched && this.#spendCredentialSwitch(advisor, currentModel.provider)) return true;` — first at `:2127` (account-policy rotation) and then at `:2152` (usage-limit rotation). |

`pi-tui/src/overlays/advisor-config.ts` hunks 1-2 apply (offset +4 / −2) — the `TOOLS_DONE` handling in the
native picker catalogue is unaffected.

### 5.2 Upstream change

`session-advisors.ts:2269-2274`:
```ts
#spendCredentialSwitch(advisor: ActiveAdvisor, provider: string): boolean {
    const spent = advisor.credentialSwitches?.provider === provider ? advisor.credentialSwitches.count : 0;
    if (spent >= this.#host.modelRegistry.authStorage.credentials.list(provider).length - 1) return false;
    advisor.credentialSwitches = { provider, count: spent + 1 };
    return true;
}
```
plus `advisor.credentialSwitches = undefined` on turn success (`:2279`) and on abandonment/rotation reset
(`:2042-2050`, `:2077-2078`); `waitForSibling` on `RotateCredentialOptions` (`auth/types.ts:783-785`).

Contract comparison: local = *one* same-provider rotation per advisor before the cross-provider chain;
upstream = *every distinct sibling exactly once*, applied to **both** `AccountPolicy` and usage-limit denials.
Upstream is strictly stronger (no ping-pong possible, no repeated bearer) and covers the account-policy case
0048 did not.

### 5.3 Rebase notes

- Recommended: **retire 0048's delta** and adopt `#spendCredentialSwitch`. Keep `advisor-config.ts`'s two
  hunks if they still serve a native-picker purpose (they are unrelated to the rotation bound).
- If the plan insists on the fixed grace of 1, it can be expressed as a `#spendCredentialSwitch` cap — do
  **not** add a second counter field beside `credentialSwitches` (two overlapping mechanisms is the exact
  failure mode `patch-rollup-contracts.md:561` forbids).
- No verifier exists for 0048 today; a gate is required either way.

---

## 6. `0072-omp-session-pin-static-auth-ui`

### 6.1 Failing hunks

8 of 8 fail. Causes, hunk by hunk:

| hunk | target | cause |
|---|---|---|
| #1 `@@ -1` | replace the pi-ai alias-type imports with value imports | upstream dropped `PASTE_CODE_LOGIN_PROVIDERS`/`getOAuthProviders`/`getOAuthCredentialProvider` from the static imports entirely (`:3-4`). |
| #2 `@@ -118` | replace the pi-tui `LoginDialogComponentType`/`LogoutAccountSelectorComponentType`/`OAuthSelectorComponentType` type imports with value imports | those import lines are gone (`:117`); `HookEditorComponent` and `formatSessionContinuationNotice` were added. |
| #3 `@@ -156` | delete the `ProviderAuthUiModules` interface **and** the sync `loadProviderAuthUi()` with its six `require(... | )` calls | upstream kept the function but made it `async function loadProviderAuthUi()` returning `await Promise.all([import("@oh-my-pi/pi-ai"), import("@oh-my-pi/pi-ai/oauth"), import(…login-dialog), import(…logout-account-selector), import(…oauth-selector)])` (`:154-176`). |
| #4 `@@ -275` | drop `const { getOAuthProviders } = loadProviderAuthUi();` | now `const { getOAuthProviders } = await loadProviderAuthUi();` (`:270`). |
| #5 `@@ -2073` | drop the destructure in `#handleOAuthLogin` | `await loadProviderAuthUi()` at `:2129-2130`. |
| #6 `@@ -2217` | drop the destructure in the logout path | `:2274`. |
| #7 `@@ -2256` | drop the destructure in the login/logout mode switch | `:2313`. |
| #8 `@@ -2325` | drop the destructure in `#showSessionPin…` | `:2382`. |

### 6.2 Upstream change and attribution

Commit `6693ddbfd5` (2026-10-29, released in **18.14.0**), body: "Deferred non-essential provider and UI module
loading to first-use, reducing startup overhead." Diff on this file: `+22 −31`; the sync
`require("@oh-my-pi/pi-ai/index.js")` boundary became five `import()` calls inside `Promise.all`. Bisected by
fetching the file at tags `v18.13.0` / `v18.13.3` (both still contain "Synchronous first-use boundary") and
`v18.14.0` (no longer).

The `omp:legacy-pi-shim` plugin still exists in 18.16.0 (`pi-coding-agent/src/extensibility/plugins/legacy-pi-compat.ts`,
`installLegacyPiSpecifierShim` at `:37` of `extensions/loader.ts`), so the *environment* that produced
`NameTooLong` is unchanged — only the loader mechanism is.

### 6.3 Rebase notes / adoption conditions

- Contract is equivalent in kind (no synchronous `require()` of a pi-ai/pi-tui subpath from the auth-UI path),
  not in mechanism (upstream keeps laziness, made it ESM). Retirement is a **candidate** until the repro is
  demonstrated green on unpatched 18.16.0 and red with a sync `require` reinstated.
- If adopting: the local static-import hunks #1/#2/#3's import restructure must **not** be re-applied — that is
  the "restore the old local variant beside it" mistake.
- `patches/verify-session-pin-static-auth-ui.ts` needs work either way:
  - the version allowlist `["18.2.10","18.3.3","18.4.1","18.4.4","18.7.0","18.10.0","18.10.1","18.12.6"]`
    hard-fails on `18.16.0` and must be extended;
  - it imports `SelectorController`, `Settings`, `installLegacyPiSpecifierShim`, `initThemeSync` and drives
    `showModelSelector({ temporaryOnly })` (`selector-controller.ts:721`) and `showSessionPinSelector()`
    (`:2362`) — all present — but the hand-built `context` object must be re-checked because the controller now
    imports `ResumeSessionOptions`, `setSessionPinned`, `findSessionContinuation`,
    `formatSessionContinuationNotice`, `cfgSessionWorktreeScope` and `HookEditorComponent`;
  - it is the strongest available discriminator for this capability (it installs the real shim and opens the
    real pin selector), so keep it.

---

## 7. `0065` and `0100` — compiled catalog artifacts

Both families fail **only** on generated files, and the failure is structural, not contextual.

- `pi-catalog/src/compat/rules.json` is a compiled artifact: a single minified line
  `{"version":1,"files":[…], …}` carrying per-file compiled rules, 472,489 B → 496,742 B. A one-line
  replacement hunk can never apply across a release; it must be produced by `bun run gen:compat`
  (`pi-catalog/package.json: "gen:compat": "bun scripts/compile-compat.ts"`). `rules/README.md:26` states the
  invariant: "`compat-compile.test.ts` fails when `rules.json` drifts from the KDL sources … Commit `rules.json`
  together with the KDL change."
- `pi-catalog/src/models.json` changed **shape** in 18.16.0: 18.12.6 is `{provider: {modelId: Model}}`;
  18.16.0 is the encoded catalog `{version, keys, booleanShapes, nodes, compat, providers}` produced by
  `model-catalog-format.ts:51` `encodeModelCatalog` (12,471,845 B → 1,156,924 B). `models.ts:3` still imports it
  as `./models.json` with `{type:"json"}`, so the file must be regenerated (`"gen:models": "bun scripts/generate-models.ts"`),
  never hand-edited.
- 0065's behaviour-bearing edit is `compat/rules/providers/commandcode.kdl:147-151` (applies, offset −1).
  0100's are `rules/auth/stepfun.kdl`, `rules/providers/stepfun.kdl`, `provider-models/openai-compat.ts:5438/5450`
  (all apply) plus a `.d.ts` comment (`apply`, offset +8).
- Consequence for the plan: neither family's `rules.json`/`models.json` hunk may be re-emitted as text. Rebase
  procedure = apply KDL/TS edits → run the two generators → re-derive the family diff from the regenerated
  files, and record the regenerated bytes so the replay oracle compares generated-vs-generated.
- Gate status: `verify-commandcode-model-record-parity.ts` reads `resolveModelPolicy`
  (`compat/resolve.ts:1350`), `resolved.compat.supportsStrictMode`, `supportsMultipleSystemMessages`,
  `stripImageInput`, `catalog.inputModalities`, `catalog.costPatch` (`compat/axes.ts:423`), and a sibling
  negative control — all present. 0100 has **no** TypeScript gate (PATCHES.md:38 relies on a synthetic-fetch
  smoke + a negative control); a permanent gate should be added per `verification-gate-contracts.md:264`.

---

## 8. Upstream-new risk (slice E obligations from this domain)

Changes observed between 18.12.6 and 18.16.0 that no family covers and that touch the listed invariants:

| risk | evidence | invariant threatened | suggested action |
|---|---|---|---|
| **R1 — missing-credential model fallback fires before the unlock diagnostic** | `agent-session.ts:8880`; `pi-coding-agent/CHANGELOG.md:69` (18.15.0 #17559) | prompt serialization / resume continuity: a session silently switches model when `getApiKey` returns undefined, which is exactly the state an unresolved refresh exchange produces. The `/auth-unlock` message would be swallowed. | Open question Q1. |
| **R2 — Google RPC quota reclassification** | `pi-ai/src/error/rate-limit.ts:133-134` (`QuotaFailure`, `RetryInfo`), `:166-255` (daily-cap and zero-entitlement violations beat a generic `RATE_LIMIT_EXCEEDED`; `MODEL_CAPACITY_EXHAUSTED` added) | retry scheduling: more errors become `QUOTA_EXHAUSTED` (→ long backoff / credential rotation) and fewer become short-window `RATE_LIMIT_EXCEEDED`, interacting with 0099's 3-3-5-5-10-10-15-15 schedule and 0048's rotation bound. | Add a table-driven leg to `verify-retry-slow-schedule.ts` or a new classifier gate over the 5 Google detail shapes. |
| **R3 — `pi-utils/src/held-file.ts` (new) and removal of `fs-open.ts`** | `pi-utils/src/held-file.ts:3-6` ("Writing over a live `agent.db` or its `-shm` destroys the store"); `pi-utils/src/fs-open.ts` removed | Anthropic OAuth credential loss: the 18.16.0 changelog attributes a login-wiping corruption to tools reading `agent.db`. Our `verify-db-safety.sh` must cover the new guard. | Extend `verify-db-safety.sh`; confirm the guard is on every write path (`write`, `tts`). |
| **R4 — binary model catalog** | `model-manager.ts` (+85/−143), `model-catalog-format.ts:51`, `models.json` 12.47 MB → 1.16 MB; commit `6693ddbfd5` | model-catalog records / cache fingerprints: `fingerprintStaticModels` signature changed (`config/model-registry.ts:1420-1427`), cache rows from 18.12.6 are invalid. | Record that a downgrade cannot reuse the model cache; no family change needed. |
| **R5 — Mistral Vibe OAuth is a new rotating-token provider** | `pi-ai/src/registry/oauth/mistral-vibe.ts` (new); `pi-ai/CHANGELOG.md` 18.16.0 first entry | same loss class as 0090, but outside `DURABLE_EXCHANGE_PROVIDER`; `/auth-unlock` will report `not-applicable`, correctly. | Decide whether the journal stays anthropic-only (recommended: yes, and document Mistral as an accepted residual). |
| **R6 — tool-schema normalization no longer mutates the caller's schema** | `pi-ai/CHANGELOG.md:146-147` (18.13.0 #16780) | byte-stable tool schemas: this is a *fix* in the direction of our invariant, but it changes the emitted schema for tools whose `enum` contained a folded `const`. | Cross-slice: prompt-prefix slice must re-baseline any tool-schema fixture. |
| **R7 — `AUTH_RETRY_MAX_ATTEMPTS = 64` and repeatable sibling rotation** | `auth-retry.ts:175-177` ("Current drivers may repeat sibling rotation until a termination guard fires") | no blind-retry invariant: with 0048's bound removed and `#spendCredentialSwitch` in place the guard is `credentials.length - 1`; without it, repeated rotation is possible. | Covered by the 0048 adoption proof. |
| **R8 — auth-gateway surface grew** (`auth-gateway/{dispatch,http,server}.ts`, +145/−41 combined) | `pi-ai/src/auth-gateway/*` | not a main-session prefix concern, but it is a second credential-consuming process; no family covers it. | Note only; no family action (the live deployment runs the broker, not the gateway). |
| **R9 — `:auto` on a retry fallback entry now really switches thinking** | `pi-coding-agent/CHANGELOG.md:304` (18.13.2, #17100); code at `session/retry-fallback-chains.ts:22-34` (keeps the `AUTO_THINKING` sentinel in `thinkingLevel`), `:113` (no `concreteThinkingLevel(...)` collapse), `:414-425` (`auto` keys the `"base"` chain). | resume / prompt-prefix continuity: a fallback entry with `:auto` used to inherit the failing turn's effort (so the next request's reasoning config stayed constant); it now switches to auto thinking, which changes the request's reasoning block. If a configured fallback chain carries `:auto`, the first post-fallback request is a different prefix than before, on a *new* model — which is a fresh cache chain by construction, but the effort ladder the session resumes with may differ. | Cross-slice: the resume/prefix slice must re-baseline any fallback-chain fixture that assumed effort inheritance. Ops: audit `retry.fallbackChains` in the live config for `:auto` suffixes, since their resolved effort changes after this upgrade. |

---

## 9. Open design questions

**Q1 — Should the `/auth-unlock` diagnostic outrank 18.15.0's missing-credential model fallback?**
Options:
(a) Emit the unresolved-refresh error *before* `applyMissingCredentialFallback` — blocks a session that has a
perfectly good fallback candidate; rejected.
(b) Keep the fallback, and raise the diagnostic only when it returns `false` (new insertion point:
`agent-session.ts:8880-8885`). *Recommended* — the user still gets a working model, and the actionable message
appears exactly when nothing else can serve the turn.
(c) Keep the fallback and additionally emit a non-blocking notice when `inspectUnresolvedRefresh` is eligible.
Recommended as an addition to (b) if the notice is cheap, but not required.
Note the existing gate leg (`verify-oauth-durable-refresh.ts:2982-3012`) must be rewritten to pin which branch
it takes, with a fixture that has a fallback chain and one that does not.

**Q2 — Journal scope after adoption: keep only the unknown-outcome marker, or keep the full fence/unlock
machinery?**
Once upstream's exchange backstop, lease hand-back and shutdown drain exist, the only state the journal still
buys is *process death during the POST* (the provider may have consumed the refresh token and the successor
never landed). Options:
(a) Keep the full journal + `/auth-unlock` for `anthropic` only (status quo scope). *Recommended* — it is the
only durable answer to the last unknown-outcome case, and the gate already exists.
(b) Reduce the journal to a "reserved" marker plus inspect/release (drop `stage`/`commit`/`readStaged`), since
upstream's `#persistExchangedCredential` retries the save for 60 s and a synced process no longer loses a minted token.
   Smaller surface, but loses the "publish the staged replacement without a second POST" recovery (scenario (i)/(k))
   which is the case with the real cost: one extra refresh-token exchange revokes the grant.
(c) Retire the journal entirely and accept that a killed process during the POST leaves the row needing
`/login`. Cheapest, and the highest credential-loss risk of the three.
The evidence favours (a); (b) is defensible only if the plan also accepts scenario (i)'s extra POST.

**Q3 — 0014: does the deterministic identity still need to cover `trajectoryId` *and* `agentId`?**
Since 18.13.0, `labels.cascade_id`/`root_cascade_id` are both `agentId` (`google-gemini-cli.ts:1280-1286`), so
`agentId` now carries the backend routing identity that 0014 was fixing. Options:
(a) Derive all three deterministically from the session key (the current delta). *Recommended* — smallest change,
   preserves the measured 320k-token restart behaviour.
(b) Derive only `agentId`/`trajectoryId` and leave `sessionId` to `deriveAntigravitySessionId(context)`, which is
   already context-derived and therefore already stable across a restart inside the same conversation.
   Worth measuring first: if `deriveAntigravitySessionId` is stable, one third of the delta disappears.

**Q4 — 0072 adoption vs. keeping static imports.**
Adopting upstream's async loader is the low-maintenance choice, but it keeps a first-use `import()` on the
`/login`/`/session pin` path (a latency the local static imports avoid, at the cost of startup cost for every
process). Options:
(a) Adopt upstream; prove the repro green; delete the local hunks. *Recommended.*
(b) Keep the local static imports and re-author them against the new file — this re-introduces eager loading
   of `pi-tui` overlays that 18.14.0 deliberately deferred, which is a measurable startup regression.

---

## 10. Stale facts in the existing documentation (do not re-import them into the plan)

Found while gathering the evidence above; each would corrupt a rebase if copied forward.

| Documented | Reality on 18.12.6 → 18.16.0 |
|---|---|
| `PATCHES.md:610-612` — 0056 "version tuple 升 `3000.10.23`" | The 18.12.6 family patch does not touch `DEVIN_CLI_METADATA` at all; pristine 18.12.6 already carries `3000.11.3` and pristine 18.16.0 carries `3000.11.205`. 0056's live delta is `sessionId`/`requestId` only. |
| `PATCHES.md:589-598` — 0054 removes `requestType: "agent"` | Already absent from pristine 18.12.6 (`providers/google-gemini-cli.ts` has only the optional type field). The 18.12.6 family patch has no `requestType` hunk; the capability already has zero delta. |
| `PATCHES.md:927-946` — 0090 "受影響檔案 … `{refresh,select,usage}.ts`, `registry/oauth/anthropic.ts`, `*.d.ts`" (5 paths, written for 18.4.4) | The 18.12.6 family owns **30** paths, including the auth-broker store, the SQLite store, six registry/catalog paths and the pi-tui MCP wizard. |
| `PATCHES.md:19/105` — 0090 spans `NM` | Confirmed, but the family also carries the Codex/google-antigravity discovery-403 retention, which is a *pi-catalog* concern and the reason `verify-codex-account-eligibility-retention.ts` / `verify-google-account-eligibility-retention.ts` belong to it. Retiring the durable-refresh hunks must not silently drop those two gates. |
| Assumption that `rules.json` / `models.json` can be re-emitted as a one-line patch | They are generated (`gen:compat`, `gen:models`) and `models.json` changed shape in 18.16.0 (encoded catalog). Both must be regenerated and the family diff re-derived from the regenerated bytes. |
| Assumption that 0090's `verify-oauth-durable-refresh.ts` is a pure gain to reuse | It fails closed on a clean 18.16.0 tree (missing unlock API) — correct per `verification-gate-contracts.md:659`, but it means the durability half's adoption has **no** currently-passing gate of its own. A dedicated adoption gate is required before those hunks are retired. |

Machine check (run at delivery):
`awk '/^\| /{n++} END{print n}' <this file>` → 123 table rows (≥ 14 capabilities + 1); every capability ID of
this slice (`0014 0054 0055 0056 0058 0060 0071 0048 0065 0072 0090 0098 0099 0100`) appears.
