# Implement

## Preconditions for any dispatch
Embed verbatim in every work order: `/home/chris/orca/projects/omp-move/AGENTS.md` and `.trellis/spec/backend/index.md` (Trellis rule, handbook section 5). Sub-agents skip formatters and full test runs; the main session runs them once at the end. Reviewer of record edits formatting, not the auditor.

## Checklist
- [ ] A1 red: add interleaved-model fixture to `patches/verify-cache-prefix-audit.ts`; run it on current code, expect failure.
- [ ] A2 fix `prev` selection in `patches/cache-prefix-audit-extension.ts`; gate green including the interloper case.
- [ ] B1 build fixture from archived payloads of session 01a0f047 (previous request and `…0780…`); store only the block/breakpoint structure, not message text.
- [ ] B2 red on the current extension; add the growth trigger; green; existing `verify-resume-cache-breakpoint.ts` green.
- [ ] C1 read `main.ts:445-468`, `interactive-mode.ts:3229-3246` in the 18.4.4 tree; write the two failing behavior gates.
- [ ] C2 new layer `0085` in `.18.4.4-candidates/`, register in the `18.4.4)` plan, ledger, rollup verifier `EXPECTED_PLAN_1844`.
- [ ] Sandbox: full apply / second apply / check / revert; rollup verifier.
- [ ] Independent review (`trellis-check`), then fixes.
- [ ] Phase 3.3 `trellis-update-spec`.
- [ ] Deploy A/B (copy + `cmp` parity); deploy C in an idle window; post-deploy verification.

## Verification commands
- `bun patches/verify-cache-prefix-audit.ts`
- `bun patches/verify-resume-cache-breakpoint.ts`
- `OMP_PATCH_VERSION=18.4.4 bash patches/apply.sh --check`
- `bash patches/verify-patch-family-rollups.sh`
- Parity: `cmp patches/<ext>.ts ~/.omp/agent/extensions/<name>.ts` (exit 0) for the three copies.

## Rollback
A/B: restore the previous extension file from git. C: `deploy` tooling's `rollback.py --execute`.

## Execution log

### 2026-09-30 — Round 1 and round 2 of independent review

Three diagnosed items landed (A: per-model audit baseline; B: in-session growth anchor and resume continuity; C: layer 0085 restoring rejected prepared drafts). Two independent review rounds then examined them; every finding was fixed or explicitly accepted as a residual, and the round-2 fixes landed in commit `afad33343`.

**Round 1 — 13 findings** (10 major, 2 minor, 1 nit). The 0085 dispatch-catch (1) restored a draft the session's own prompt-dropped callback had already handed back and (2) restored after a turn had admitted the message; (3) `submitInteractiveInput`'s declared mode Pick lacked the restore-runtime members its new call needed; the growth anchor could (4) mark a generated-thinking block Anthropic refuses and (5) place a 5m marker before a 1h one under mixed TTLs; (6) its conversation key (model + first message) could collide or drift; (7) nine side requests could evict the main predecessor (the gate only inserted one); (8) the audit window deduped by ISO-millisecond `at`, so two models in one millisecond deleted each other's baseline; (9) the audit still kept one diff slot per model. Minor/nit: (10) the usage row read headers from `st.last`; (11) the image-paste gate leg bypassed the real controller cancel path; (12) AC6's spec update was pending; (13) the ledger plan row read 50 where the plan is 51. Round-1 fixes landed in commit `3a0d27839`.

**Round 2 — 8 findings** (6 major, 2 minor; re-review of the round-1 fixes). (1) Equal last-message content did not prove prefix continuity, and the "the hook exposes no session identity" comment was wrong; (2) recursive `cache_control` stripping also erased genuine `tool_use.input` arguments; (3) eviction protected short side requests only — eight side histories at least as long as the main one still evicted it; (4) transcript length was not an admission signal in either direction; (5) content equality was wrongly treated as proof that another owner had restored the submission; (6) the widened runtime contract and new exports were absent from the shipped `dist/types` declarations; (7) unchanged captured attachments were misclassified as a newer draft on Enter cancellation; (8) gate depth (Ctrl+Enter / dequeue / chip rendering) remained partial.

**Round-2 fixes** (commit `afad33343`):
- Anchor: continuity is now session id (from `ctx.sessionManager.getSessionId()`, with one constant fallback) plus a hash of the last TWO messages, replacing the first-message key; the hash strips `cache_control` only at the top level of each content block. The tracker comment was narrowed to the guarantee it actually delivers.
- 0085: ownership is the explicit rule "skip only when the caught error is `AgentStartPolicyChangedError`", duck-typed through `error.name` because that class is not exported; restore happens on every other throw. Attachment newness is by reference to the draft's own images. The patch now also carries `dist/types` hunks for `main.d.ts` and `draft.d.ts`, and the gate grew to nine legs driving the real `submitInteractiveInput` and the real `InputController` cancel path.

**Accepted residuals** (documented in spec, ledger and gate headers):
- Anchor: a whole-prefix rewrite that leaves the last two messages equal is still taken as the predecessor; a short side request cannot evict the main predecessor, but eight or more side requests at least as long as the main history can spend `TRACKER_CAP = 8` and push it out (that growth event then gets no anchor). The growth threshold is unproven against the live API.
- 0085: any throw that is not `AgentStartPolicyChangedError` restores, so a rare throw after admission may offer already-sent text back as a restorable draft (a possible duplicate beats losing the input). When the editor already holds text, the session's callback declines and nothing is offered — the same gap the pre-0085 baseline had. `#restoreDroppedPrompt` (`interactive-mode.ts`) keeps the same attachment-overwrite shape and was left untouched. Ctrl+Enter / follow-up entry, dequeue restoration and composer chip rendering are not covered.
- Typecheck: the sandbox tree has no in-tree typecheck (no `tsgo`, no `tsconfig.json`). The two shipped-declaration hunks were proved with a `tsc` 6.0.3 consumer probe (`/home/chris/.local/bin/tsc`) against `package.json`'s `types` condition plus a per-field grep of each declaration against its source; Bun does not typecheck.
- Audit (pre-existing, untouched): one diff slot per model, and the usage row's `headers`/`responseHeaders` still read `st.last`.

**Spec/ledger sync:** the anchor scenario, the 0085 repair scenario and the gate-writing lessons in `.trellis/spec/backend/` were corrected to the final behavior in this change, as were the 0085 section and the anchor note in `patches/PATCHES.md`.

### 2026-09-30 — Round 3 of independent review

The round-2 fixes were re-reviewed (`ReviewRound2`) and returned **2 findings, both fixed** with a red/green pair each. Both were in code the round-2 fixes introduced.

**Finding 1 (major, anchor) — a bare-string message hashed differently from the provider's text-block rewrite.** `stripCacheControl` stripped the top-level marker but hashed the raw shape, so an unchanged penultimate message that arrived as a bare string in one request and as the provider-decorated single text block in the other (`applyCacheControlToMessage` rewrites `content: "x"` into `[{ type: "text", text: "x", cache_control }]`) hashed unequal. The predecessor match then failed and the growth anchor was lost. Reported by driving the real provider builder.
- Fix (`patches/resume-cache-breakpoint-extension.ts`): `stripCacheControl` now canonicalizes a bare-string `content` to the provider's own single text block (`[{ type: "text", text }]`) before hashing; non-recursive top-level stripping is unchanged. A `text?` field was added to the `ContentBlock` shape for the canonical block; the doc comment states WHY.
- Regression (`patches/verify-resume-cache-breakpoint.ts`, continuity case #1(c)): an append-only history of 20 then 40 messages (growth 20 > trigger 16); index 18 is presented as a decorated block array in one request and a bare string in the other, both directions (`decorated array -> string`, `string -> text block`), asserting the anchor still lands on 19. Red on the `git show HEAD` copy (`AssertionError: decorated array -> string ...`); green after; every pre-existing case stays green.

**Finding 2 (minor, 0085) — an input-transform replacement was misread as a newer editor draft.** A registered `input` handler may hand back rebuilt-but-equal replacement image objects (`event.images.map(image => ({ ...image }))`); reference-only ownership read those as a newer draft and deferred a phantom capture instead of returning the text.
- Fix (`patches/.18.4.4-candidates/0085-...-candidate.patch`, inside `editorHoldsNewerDraft`): new module-private `isDraftOwnedImage(draft, image)` — an editor image belongs to the draft when it is the SAME reference OR has the same `data` and `mimeType` as a captured image. Signatures unchanged, so both `.d.ts` hunks and `dist/types` are untouched. The patch was regenerated and `cmp`-verified byte-identical except the one `draft.ts` hunk.
- Regression (`patches/verify-rejected-prepared-draft-restore.ts`): the gate now has **10 legs**. Leg 9 is the input-transform case (controller level, equal replacement objects: the cancelled preparation returns its text directly, restores the equal attachments, defers nothing); the old control leg was renumbered 10. Red on the current root, green on the fixed and patch-applied trees.

**Remaining accepted residuals (single list, after round 3):**
- Anchor: a whole-prefix rewrite that leaves the last two messages equal is still taken as the predecessor; short side requests cannot evict the main predecessor, but eight or more side requests at least as long as the main history can spend `TRACKER_CAP = 8` and push it out (that growth event then gets no anchor); the growth threshold is unproven against the live API.
- 0085: any throw that is not `AgentStartPolicyChangedError` restores, so a rare post-admission throw may offer already-sent text back as a restorable draft (a possible duplicate beats losing the input); when the editor already holds text, the session's callback declines and nothing is offered — the same gap the pre-0085 baseline had; attachment ownership is value equality, so an image re-pasted with the same bytes and mime as a captured one reads as the draft's own; `#restoreDroppedPrompt` (`interactive-mode.ts`) keeps the same attachment-overwrite shape and was left untouched; Ctrl+Enter / follow-up entry, dequeue restoration and composer chip rendering are not covered.
- Typecheck: the sandbox tree has no in-tree typecheck (no `tsgo`, no `tsconfig.json`); the two shipped-declaration hunks were proved with a `tsc` 6.0.3 consumer probe (`/home/chris/.local/bin/tsc`) against `package.json`'s `types` condition plus a per-field grep; Bun does not typecheck.
- Audit (pre-existing, untouched): one diff slot per model, and the usage row's `headers`/`responseHeaders` still read `st.last`.

**Round-3 spec/ledger sync:** the anchor scenario in `.trellis/spec/backend/extension-runtime-contracts.md` now states the string canonicalization in §3, its matrix row and both test directions; the 0085 repair scenario in `.trellis/spec/backend/patch-rollup-contracts.md` names `isDraftOwnedImage` (reference OR value), adds the input-transform matrix row and moves to ten legs; the gate-lessons scenario in `.trellis/spec/backend/verification-gate-contracts.md` renumbers the controller legs 7-9 and control 10; `patches/PATCHES.md` carries the canonicalization in the growth note and the ten-leg 0085 section.

### 2026-09-30 — Deploy state
Integration (final-1844.sh, pristine replay): 51 layers APPLIED, apply#2 SKIP=52, `--check` 51, rollups ALL PASS, gate `verify-rejected-prepared-draft-restore: PASS (18.4.4)`; 18.4.1 plan md5 unchanged; 18.4.5 exits 2. Delta deploy tooling `research/deploy-delta-1844.py` rehearsed (happy path, rollback, four fault injections). Live prepared (`global-18.4.4-51layers-staged`) and idle watcher `omp-deploy-delta-1844` started 03:14; deploy runs once every omp process has exited. AC5 (live deploy verified, one real audit row observed) stays open until then.

### 2026-09-30 03:41 — Live deploy verified
Watcher `omp-deploy-delta-1844` deployed 18.4.4-51layers: fresh omp/18.4.4, 51/51 APPLIED, digests match, both extensions cmp-equal to repo + ledger. Independent post-check: `--check` 51 layers + bin APPLIED; repo `patches/` equals `~/.omp/patches` (except backups/); live extensions cmp-ok; draft.ts carries restoreRejectedDraft. First real audit rows (07:42Z): luna `IDENTICAL / no baseline`, claude `APPEND_ONLY` (per-model baseline observed live). Resume request 07:42:26 read 14257 / wrote 30072 (first request of a new process, upstream prefix change expected); next request 44329 read, 95.7% hit. Growth-anchor API-side hit still unobserved (no >16-block batch yet). Rollback: ~/.omp/backups/upgrade-18.4.4-51layers-20260930-034054/rollback.py --execute.
