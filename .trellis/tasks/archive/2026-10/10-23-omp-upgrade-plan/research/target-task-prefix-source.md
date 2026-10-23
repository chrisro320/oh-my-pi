# Pinned target source: task, prefix, effort and media

Read-only source research by TaskPrefixSource at commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. No target source or gate was executed; predicted failures and patch applicability remain inferences. Source paths below use the pinned repository layout, not installed package names.

Base URL: `https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/`.

## Source observations and migration decisions

| Boundary | Pinned source anchor | Observation and conservative decision |
| --- | --- | --- |
| 0101 warm revival | `packages/coding-agent/src/task/executor.ts:3935-3973,4064-4131` | Warm creation still uses `buildSubagentSessionOptions` and its rendered prompt; no persisted `systemPrompt` override or warm `setWorkPoolYieldItems` restore was found in the inspected path. Retain/adapt0101; changelog cache fixes do not establish adoption. |
| Cold revival and persisted items | `packages/coding-agent/src/task/persisted-revive.ts:270,305`; `session/session-manager.ts:4520-4548` | Cold path already supplies `systemPrompt: () => [...init.systemPrompt]` and restores persisted yield items. `extractSessionInit` still exposes those fields. This is the existing cold/warm distinction, not proof upstream adopted the warm repair. |
| Prompt rebuild/persistence | `packages/coding-agent/src/session/agent-session.ts:6640-6655,10136-10186` | `setWorkPoolYieldItems` rebuilds the base prompt and can persist a new `session_init`. Revival proof must observe prompt/tool bytes and transcript transitions, not only the final field. |
| Model-default versus inherited auto | `packages/coding-agent/src/session/model-controls.ts:581-587` and calls at270/309; `packages/tui/src/thinking.ts:139-141` | Target still chooses AUTO first; `automaticThinkingLevel` additionally handles unverified models. Preserve the already user-approved target-default precedence while retaining target unverified-model handling and explicit temporary-effort precedence. No new user choice or blanket copy of the old expression is needed. |
| Removed eval MIME module | `packages/coding-agent/src/eval/py/` contents API; `eval/types.ts:43-46`; `eval/kernel-base.ts:645-673`; `eval/py/runner.py:1759-1782` | Old `display.ts`/`renderKernelDisplay` path is absent (contents listing corroborates404). Typed image/view/status frames replace that layer. Python `_value_image` tries matplotlib PNG then `_repr_png_` before `_repr_jpeg_`. Treat0078 as a proposed different-layer upstream adoption ONLY after actual preferred-MIME/single-output/fallback consumer proof; do not recreate removed display API or silently drop coverage. |
| Kitty0079/0080 | `packages/tui/src/chat/image-loading.ts:105,117-190`; `chat/assistant-message.ts:1593-1648`; `chat/tool-execution.ts:700-717,1755-1779`; `components/image.ts:159,256,277,692` | Inspected regions retain shared conversion/cache and ImageBudget APIs, but do not include all custom fingerprint/retirement behavior. Retain/adapt both capabilities. Similar regions are not whole-file equality, zero-fuzz or runtime proof. |
| Approval API | `packages/coding-agent/src/extensibility/extensions/types.ts:287-292,334-337` | Answer is `once | session | deny | {grant,always}`. No repository companion call was found by this research; live-only extensions remain to be audited before assuming compatibility. Adapt only actual affected consumers. |
| Structured subagents | `packages/coding-agent/src/task/settings.ts:255-264`; `task/index.ts:777-788` | `task.structured` defaults false; description preserves structured eval agent/workpool spawning. Yield-dependent fixtures must opt in explicitly; do not change production defaults merely to satisfy an old fixture. |
| Provider-prefix persistence | `packages/ai/src/types.ts:1191-1200`; `providers/openai-responses.ts:1598-1599,1784-1795`; `packages/coding-agent/src/session/date-cwd-reminder.ts:1-108` | Target inspected paths lack custom `providerOnly` and use the original in-memory date/CWD injector rather than the custom durable anchor map. Rebase the existing family through actual serialization/persistence boundaries; assess old-transcript handling before retaining or deleting compatibility-facing paths. |

## Required consumer proof

- Adapt `verify-subagent-warm-revival-prompt.ts` to target structured-fixture semantics; compare persisted prompt blocks, yield schema, actual first post-revival request and session-init count, including legacy transcript and wake/message paths.
- Extend version routing in `verify-model-selection-resume.ts` and `verify-prompt-effort-resume.ts` so18.12.6 executes assertions rather than skipping. Cover target default versus inherited auto, explicit temporary effort, no-default and unverified-model paths, persistence/fresh-process restoration.
- Replace the obsolete target import path in `verify-python-display-mime-preference.ts` with a consumer-level target Python image-output scenario if upstream adoption is pursued. Observe exactly one preferred image, PNG priority and JPEG fallback; do not replace behavior with source grep or a missing-module SKIP. Preserve historical version coverage as applicable.
- Rebase/run Kitty finalization/shared-cache/image-budget gates on the actual target closure; actual Tern rendering is separate acceptance.
- Run date/CWD anchor, eval persistence and prompt-effort gates through actual target serialization and restoration. No claim of real provider cache hits follows from synthetic bytes.

## Source links

- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/task/executor.ts#L4064
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/task/persisted-revive.ts#L270
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/session/model-controls.ts#L581
- https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/eval/py/runner.py#L1759
- https://api.github.com/repos/can1357/oh-my-pi/contents/packages/coding-agent/src/eval/py?ref=45c35e40c46166dc726ccc52f5d27f40f2449f99

## Unverified boundaries

No target SDK, Python runner, transport or TUI path was run. No exact patch applicability was established. Full live-only extension API audit and artifact provenance remain execution prerequisites. None of the above authorizes capability removal or product behavior change.
