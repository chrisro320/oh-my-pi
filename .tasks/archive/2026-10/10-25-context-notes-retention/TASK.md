---
title: Incremental structured notebook retention gate
status: done
created: 2026-10-25
closed: 2026-10-25
---
RESUME: （已完成）

## 目標
Incrementally extend context-notes-save-gate to protect registered constraints, topic pointers and decision supersession without semantic importance claims or compaction freshness vetoes.

## 驗收
- [x] Registered IDs cannot silently disappear; invalid schema and broken supersession are blocked before replacement. Free prose can shrink and completed topics retain source pointers.
- [x] Actual experimental_context_notes entries survive save/reopen/branch/fork/rollover; resets isolate prior notes and failed writes do not create accepted extension state.
- [x] Existing 45% reminder, child isolation, idle deferral and no compaction veto remain intact.
- [x] Independent review complete, DECISIONS/PATCHES updated and installed mirror matches approved source; activation reported separately.

## 做法
- User explicitly approved the proposed design; no new design panel required.
- One fenced context-notes-index JSON block with version, constraints/topics/decisions; free Markdown outside it. Legacy notes remain supported until explicit structured registration.
- Read authoritative notebook revisions from the current branch journal, respecting reset boundaries. No second state store, automatic semantic extraction, database or runtime patch.
- Preserve the original reminder and do not add compaction hooks or system-prefix rewriting. Static instructions explain when to read/grep history.
- Never dispatch HardTask/taskex. No CPA changes, production credentials, provider requests, live DB access or immutable release changes.

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| Integration | Source, schema, instructions, smoke, decisions and deployment | main | All |
| Journal smoke | Actual SDK/journal persistence verifier | task | Persistence and dispatch scenarios |
| Review | Read-only correctness/security review after implementation | reviewer | Findings resolved |

## 證據
- Before edits source and installed mirror SHA256: 2eb85c0215871be91f4e4f6f41b9e34d108fd2271c7f1fecad6b9602a3faa94e.
- `bun patches/verify-context-notes-save-gate.ts`: PASS original reminder scenarios and five rejected mutation controls.
- `bwrap --unshare-net --dev-bind / / --proc /proc -- env OMP_NM=<installed @oh-my-pi root> bun patches/verify-manual-compaction-direct.ts`: PASS 18/18 actual SDK compaction/rollover scenarios, private HOME/synthetic transport only.
- ReviewNotesGate source, documentation and final verifier closure: no outstanding actionable findings. Both verification coverage gaps were corrected and closed after the final 14/14 parent run.
- `bwrap --unshare-net --dev-bind / / --proc /proc -- env OMP_NM=<installed @oh-my-pi root> OMP_CONTEXT_NOTES_RETENTION_RESULT=<task>/retention-result.json bun patches/verify-context-notes-retention.ts`: PASS 14/14 real SDK/journal scenarios. Final assertions exclude hook-wiring and error-wording pins.
- Frozen old addon control with OMP_CONTEXT_NOTES_SAVE_GATE: expected exit1, registered-ID omission failed with two revisions instead of one; full control report retention-before.json. Positive report retention-result.json. Private HOME and OS network namespace throughout.
- Verifier review gaps corrected: nested save now executes through the real JS eval bridge (no inner standalone toolResult), and schema-invalid candidates retain prior IDs so schema checks are independently exercised. Final corrected verifier passes 14/14; source unchanged.
- Installed source/mirror SHA256: d28247b5cbc5ab93858e444c05c265a8c176d575e9f9bcaae81ca36aa323fe3d. APPEND_SYSTEM static protocol installed. No live reload/restart; current-session activation is false and next normal start loads it.

## 紀錄
- 2026-10-25 User approved incremental changes to the existing plugin. Maintained source located under patches; immutable release ledger is not writable scope.
- 2026-10-25 Delegated the independent journal verifier to Task (NotesJournalSmoke); reviewer (ReviewNotesGate) owns read-only review. No HardTask/taskex.
- 2026-10-25 開始實作
- 2026-10-25 RESUME → Integrate real-journal smoke and review findings; run remin…
- 2026-10-25 完成並歸檔
