# M5 (S1) adoption and retirement evidence — 18.16.0

All runs: `bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc`, `env -i`, private HOME/XDG/TMPDIR,
tmpfs masks over `~/.omp`, `~/.bun/install/global`, `~/.config`, `~/.cache`, `~/.local/share`, `~/.local/state`,
`OMP_PATCH_VERSION=18.16.0` plus the `gate-runtime-18.16.0.sh` env block. Runtimes are built with
`gate-runtime-18.16.0.sh`; negative controls are single-fault copies of **pristine 18.16.0** (18.12.6 is frozen and not
assemblable here, D24). Scratch runners/logs: `/tmp/omp-plan-18160/s1/{S1WholeIdAdopt,S1SmokesGates}/` (not committed).

## Whole-ID adoptions (moved to `upstream_adoptions`)

| ID | Pristine 18.16.0 consumer proof | Negative control (fault copy) | Chain change |
|---|---|---|---|
| 0072 | `verify-session-pin-static-auth-ui.ts` → `PASS session pin: render and Escape` / `ALL VERIFICATIONS PASSED SUCCESSFULLY!` | auth-UI loader reverted to a synchronous bare-specifier `require` → `error: Cannot find module '@oh-my-pi/pi-ai' from '…/selector-controller.ts'` | 8 hunks deleted (`0072-retire-hunks.patch` sha256 `e47020ef…aaaa7a`); family `0072-omp-session-pin-static-auth-ui` leaves the chain; `selector-controller.ts` now equals `0050`'s accepted after |
| 0079 | `verify-kitty-conversion-finalization.ts` (re-expressed on upstream `isTranscriptBlockPending`) → `kitty conversion finalization: ALL PASS` | upstream barrier removed from `isTranscriptBlockPending` → `AssertionError: sealed results must wait for image conversion` (`true !== false`) | 5 hunks deleted from `family-image-display` `pi-tui/src/chat/tool-execution.ts` (`0079-retire-hunks.patch` sha256 `0bc28155…e410`); 0080 keeps its hunks |
| 0062 | `snapcompact-standing-summary-replay.ts --fixture fixtures/0062-boundary.json` on pristine → `PASS leg=shape … outcome=accept` + `PASS leg=ceiling … outcome=reject` | (a) `carriesStandingSummary = false` and (b) `standingSummary` term deleted from the baseline → both `FAIL leg=shape expected=accept outcome=reject … would not reduce context`; ceiling leg stays rejected | `#projectPreviousArchiveTokens` + its call and doc deleted from `family-image-budget-snapcompact` (`0062-retire.diff`), propagated through the three later owners of `session-maintenance.ts`. The full chain *before* retirement failed the ceiling leg (`outcome=accept projected=112380`): the local credit stacked on upstream's, admitting a successor pristine rejects |
| 0066 | `verify-anthropic-native-compaction-live-context.ts` (accepts either seam) → `PASS … scopes= messages=4 tools=1 fallback=undefined` | native lane's `buildProviderContext` branch deleted → `AssertionError: native lane must obtain the live context once (scopes: <none>; provider-context calls: 0)` | bookkeeping only: the residual local `live` scope is consumed by 0088/0089 and stays in `family-compaction` |

Candidate checks with the deletions applied: 0072 gate green on `snapshot --through 0072-…`; `verify-kitty-conversion-finalization.ts`,
`verify-kitty-shared-png-cache.ts`, `verify-python-display-mime-preference.ts` green through `family-image-display`;
0066 gate `PASS … scopes=live … fallback=native-no-live-chain` through `family-compaction`.

0072 control scope: Bun 1.4.4 no longer reproduces the historic `NameTooLong`; the control proves the remaining failure
mode of a synchronous load (unresolvable bare specifier from the source tree), which upstream's async loaders avoid.

## Kept (no retirement)

- **0054** — zero-delta pinned wire fact. Pristine `verify-antigravity-envelope` PASS; control `requestType: "agent"` → `AssertionError: 0054: requestType must be absent`. Stays a member of `family-antigravity-wire` so the gate stays selected.
- **0048** — consumer harness on the real `SessionAdvisors` produced `1080` recoveries on pristine, but the model-fallback leg was not pinned, so the red is not attributable to the target's bound. No proof → hunks stay.
- **0078** — recorded adoption re-validated: `python display MIME preference … ALL PASS` with both mutation controls rejected.
- **0017** — recorded adoption with no consumer gate; stands on M4/T10 evidence only, not re-proven.

## Retirement smokes (Q10/Q11) and Q5

- **0082** (Q10): throwaway consumer smoke on the full chain, legs A (resume `content`/`displayText`), B (queue identity), C (abort drain, child deadline), D (real `setupEditorSubmitHandler` submit path) all PASS; one fault per leg turns it red (5 controls). Permanent gate stays deselected by design.
- **0093** (Q11): prompt label is effort-free natively — `verify-prompt-effort-resume.ts` PASS on pristine; control folding the thinking level into the frozen label fails at `:329`. Selector half absent from the chain (`getActiveModelString` byte-identical to pristine); selector smoke `@task -> fixture/luna:medium`, `@default -> fixture/astra:high`; control (parent pattern outranks role defaults) red. 0093 keeps its commit-ordering half.
- **0074a/0074b** (Q5): fail on pristine for different reasons — 0074a `extension-injected first user message must populate the conversation cache` (`[]` vs `[0]`), 0074b `adding the 21st image must not rewrite earlier user or tool-result images`. Both green on the chain. No retirement.

## Gate repairs (18.16.0 arms)

- `verify-devin-thinking-signature.ts`: decode Connect frames per flag (gzip only for `0x01`); control (standalone `deltaSignature` attach deleted) red. 18.12.6 always compresses, so its arm is unchanged in behaviour (static).
- `verify-manual-compaction-direct.ts`: `classic-automatic-tools-absent` fixture grows a real working turn so `#compactionReducesContext` admits it; contract unchanged; control (`hasExperimentalContextRolloverTools: () => true`) red.
- `verify-stepfun-step-plan.ts` (new, 18.16.0-only in `apply.sh`): 0100 `step_plan` routing, seeds, selectors, auth descriptor; pristine control red on the models URL.
