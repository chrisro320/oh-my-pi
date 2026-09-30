# Design

## D1. A: per-model baseline
Choose `prev` = newest entry of `st.recent` whose `model` equals `next.model`, falling back to `st.last` only when the session has never seen that model (then "no baseline"). Rejected: keeping `st.last` and annotating (already done via `altBaseline`; it leaves the verdict wrong). Rejected: per-model state files (breaks state-file compatibility). `recent` already carries `model` and spans BASELINE_HISTORY entries; if a model falls out of that window the honest answer is "no baseline", not a cross-model diff.

## D2. B: extend the existing extension, not core
The extension already owns budget accounting and release of the interior provider marker. Add a second trigger: block growth since the previous request > threshold (start at 18, one below the 20-block lookback; final value settled by the fixture). Reuse the same anchor function. Rejected: patching `applyPromptCaching` (core, higher blast radius, needs a patch layer). Rejected: always adding an anchor (bills a write on every request). Rejected: rewinding the long tail (rewrites history, which is the drift class this work prevents).

## D3. C: new tail patch layer 0085
0082 is deployed; per the patch-governance decision finalized layers are immutable, so the fix is a new layer after 0082 in the 18.4.4 plan, not an edit of 0082. The two Review items are fixed together because both live in the prepared-submission path. Deployment reuses the parameterised deploy tooling (old = current live, new = 18.4.4 + 0085).

## D4. Order
A first (cheap; gives every later miss an honest label), then B (fixture from archived payloads), then C (needs idle deploy window). A and B deploy by copy without stopping omp; C waits for an all-closed window.

## Glossary
- block: an Anthropic content block; the lookback counts blocks, not messages.
- tail breakpoint: the two `cache_control` markers omp places on the last messages.
