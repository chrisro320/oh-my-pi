# 0038 — date/cwd reminder rides upstream's session journal: consumer proof

Durable evidence for the 18.18.6 manifest row
(`patches/.18.18.6-families/manifest.json`, `upstream_adoptions` capability
`0038`). Paths are relative to `patches/` unless they start with `.trellis/`
(repository-relative). This record moves with the plan when its task is
archived.

## Contract

0038 (`date/cwd reminder provider tail`) is upstream behaviour from 18.16.0 on:
the date/cwd reminder is a *journaled placement* on the message chain, so the
provider-facing `messages[0]` stays byte-identical across resume, branch, fork,
transfer and subagent revival even when the clock moved one day. The system
prompt stays date-free.

Because upstream owns the placement, the local capability has no patch code —
`family-persistent-prefix-resume-v18.18.0.patch` contains no `providerOnly`,
`applyDateCwdAnchors` or `dateCwdAnchorKey` line (checked 2026-11-09,
`grep -c` = 0 for each). The bookkeeping moved in the 18.18.6 plan: the
capability leaves `family-persistent-prefix-resume` (its `plan.tsv` capability
row drops `0038`) and enters the manifest's `upstream_adoptions`; the
capability stays in the plan's capability set, so its gate is still selected.

## Upstream presence in 18.18.6 (static, pristine)

Extracted from the pinned 18.18.6 archives (`pristine_tree_sha256`
`5ebdf4f495826c380c9e7fc46ce4f059f460afdac3bcdccff34a1c46d7b9f4da`):

- `pi-coding-agent/src/session/date-cwd-reminder.ts` exports
  `renderDateCwdReminder` and `createSessionDateCwdReminderJournal`;
  `dist/types/session/date-cwd-reminder.d.ts` declares both.
- `pi-coding-agent/src/sdk.ts` wires it as
  `createTransformProviderContext(createSessionDateCwdReminderJournal(...))`.
- The removed local anchor API is absent upstream: no `applyDateCwdAnchors`
  and no `dateCwdAnchorKey` in any 18.18.6 `*.ts`.

## Consumer proof

`patches/verify-date-cwd-journal-prefix.ts` is the gate. It is selected for
every registered release through capability 0047 (CAPS) and covers 0038
(COVERS), so the adoption is never silently ungated. The Q1 proof behind this
adoption (2026-11-07, recorded in the 18.16.0 task) ran the journal placement
on the patched tree with the clock moved one day and required the
provider-facing tail to be byte-identical across resume, branch, fork, transfer
and subagent revival; its two negative controls (date inside the system prompt;
journal-less injector) both failed as expected.

M8 re-runs `verify-date-cwd-journal-prefix.ts` on the assembled 18.18.6
candidate inside `bwrap --unshare-net` with a private HOME; the run receipt is
the durable acceptance record for this adoption row.
