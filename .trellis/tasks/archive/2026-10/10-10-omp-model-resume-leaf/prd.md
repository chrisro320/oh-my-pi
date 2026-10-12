# Preserve model selection across session resume

## Goal
Switching a session from Astra to Sol must keep Sol selected after the next ordinary prompt and after resume. Fix OMP in the maintained omp-move patch stack; do not change Orca, live session history, or live databases.

## Acceptance
- Fix the reproduced `navigateTree` path that moves persisted ancestry behind retained live model/thinking settings.
- Keep the live selection recorded on the destination before the next ordinary input.
- Resume in a fresh process restores that destination's selected model.
- Do not scan abandoned branches or change navigation's existing live-model policy.
- Keep one focused switch/navigation/fresh-process-resume regression.
- Preserve historical patch bytes; integrate the change using the maintained 18.7.0 family conventions.
- Exercise real source behavior in a private HOME/XDG/package sandbox; do not touch live node_modules.

## Evidence already observed
The affected session records Sol model_change `7bf4fd18` and thinking_level_change `a4a6cfab`, but the next ordinary input's `omp-translator` entry `19268b74` has parent `72c6c3dd`, bypassing those settings. Its live assistant used Sol; later resume used Astra. This task must fix the disconnection rather than scanning abandoned branches for the newest model.

The isolated real SDK reproduces the defect with `setModelTemporary(sol, high)` followed by `navigateTree(previousAssistant)`: the next provider request uses Sol while a fresh-process resume uses Astra. Ordinary switching without navigation restores Sol correctly. The exact navigation caller in the original incident is not recorded; this repair addresses the reproduced OMP persistence mismatch, without claiming an unobserved user action.

## Scope
Maintained checkout: `/home/chris/orca/projects/omp-move`. `/mnt/data/Projects/omp-move/master` is an older worktree. Pre-existing modified files and the `10-07-omp-prompt-model-identity` research directory are not owned by this task.
