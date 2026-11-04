# Hunk audit — AuditG2

Scope: `family-persistent-prefix-resume` (167 hunks), `0046-omp-supersede-warm-prefix-guard` (1), `0048-omp-advisor-quota-rotation-bound` (6) = **174 hunks**.
Inputs: `patches/.18.12.6-families/<family>-v18.12.6.patch` (authoritative), work tree `/tmp/omp-plan-18160/rebase/work`, pristine 18.16.0, `state.json`, fragments. Patch line = line in the family's 18.12.6 patch; every quoted work path is relative to the work tree.

Method: every hunk of the 18.12.6 family patch parsed into added/removed lines; each added non-blank line matched whitespace-stripped against the whole work file (allowing a moved location and re-wrapping), each removed non-blank line required absent. 111/174 hunks matched exactly; the remaining 63 were read individually against work and pristine 18.16.0 (symbol presence, call sites, and use-count across the tree).

## Counts per family

| family | hunks | present | superseded | decided-drop | loss | loss? |
| --- | --- | --- | --- | --- | --- | --- |
| family-persistent-prefix-resume | 167 | 151 | 3 | 11 | 0 | 2 |
| 0046-omp-supersede-warm-prefix-guard | 1 | 1 | 0 | 0 | 0 | 0 |
| 0048-omp-advisor-quota-rotation-bound | 6 | 6 | 0 | 0 | 0 | 0 |

## Rows

| family | patch line | hunk | verdict | evidence | consequence |
| --- | --- | --- | --- | --- | --- |
| family-persistent-prefix-resume | 3 | `pi-ai/dist/types/types.d.ts` #1 `@@ -949,6 +949,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 12 | `pi-ai/dist/types/types.d.ts` #2 `@@ -966,6 +968,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 23 | `pi-ai/src/providers/openai-responses.ts` #1 `@@ -1614,6 +1614,18 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 42 | `pi-ai/src/providers/openai-responses.ts` #2 `@@ -1781,7 +1793,6 @@` | present | declaration moved into the providerOnly counting loop; work pi-ai/src/providers/openai-responses.ts:1575 | — |
| family-persistent-prefix-resume | 50 | `pi-ai/src/providers/openai-responses.ts` #3 `@@ -1789,7 +1800,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 61 | `pi-ai/src/types.ts` #1 `@@ -1190,6 +1190,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 70 | `pi-ai/src/types.ts` #2 `@@ -1208,6 +1210,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 81 | `pi-coding-agent/dist/types/session/agent-session.d.ts` #1 `@@ -612,7 +612,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 92 | `pi-coding-agent/dist/types/session/agent-session.d.ts` #2 `@@ -1305,8 +1307,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 106 | `pi-coding-agent/dist/types/session/date-cwd-reminder.d.ts` #1 `@@ -1,29 +1,29 @@` | superseded | upstream journal module replaces the anchor map: pristine-18.16.0 pi-coding-agent/dist/types/session/date-cwd-reminder.d.ts:1-88 (DATE_CWD_REMINDER_CUSTOM_TYPE, DateCwdReminderJournal) | — |
| family-persistent-prefix-resume | 156 | `pi-coding-agent/dist/types/session/messages.d.ts` #1 `@@ -78,6 +78,18 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 177 | `pi-coding-agent/dist/types/session/session-manager.d.ts` #1 `@@ -28,7 +28,17 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 196 | `pi-coding-agent/dist/types/session/session-manager.d.ts` #2 `@@ -141,8 +151,14 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 213 | `pi-coding-agent/dist/types/session/session-manager.d.ts` #3 `@@ -161,7 +177,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 222 | `pi-coding-agent/dist/types/session/session-manager.d.ts` #4 `@@ -195,7 +211,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 231 | `pi-coding-agent/dist/types/session/session-manager.d.ts` #5 `@@ -565,6 +581,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 240 | `pi-coding-agent/dist/types/session/session-manager.d.ts` #6 `@@ -595,9 +613,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 254 | `pi-coding-agent/dist/types/session/session-storage.d.ts` #1 `@@ -167,8 +167,11 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 267 | `pi-coding-agent/dist/types/session/session-storage.d.ts` #2 `@@ -253,10 +256,12 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 285 | `pi-coding-agent/dist/types/session/session-transfer-marker.d.ts` #1 `@@ -0,0 +1,23 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 311 | `pi-coding-agent/dist/types/session/session-transfer.d.ts` #1 `@@ -1,9 +1,6 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 322 | `pi-coding-agent/dist/types/session/session-transfer.d.ts` #2 `@@ -15,24 +12,6 @@` | present | type moved to session-transfer-marker.d.ts:19 in work; absent here | — |
| family-persistent-prefix-resume | 347 | `pi-coding-agent/dist/types/session/session-transfer.d.ts` #3 `@@ -69,10 +48,6 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 358 | `pi-coding-agent/dist/types/session/session-transfer.d.ts` #4 `@@ -98,10 +73,3 @@` | present | forkIfMovedAway kept as delegating entrypoint; work d.ts:82 | — |
| family-persistent-prefix-resume | 371 | `pi-coding-agent/dist/types/session/turn-recovery.d.ts` #1 `@@ -66,7 +66,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 381 | `pi-coding-agent/dist/types/session/turn-recovery.d.ts` #2 `@@ -209,7 +210,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 392 | `pi-coding-agent/src/collab/guest.ts` #1 `@@ -609,7 +609,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 405 | `pi-coding-agent/src/main.ts` #1 `@@ -117,7 +117,6 @@` | present | shim retained; work main.ts:132 import | — |
| family-persistent-prefix-resume | 413 | `pi-coding-agent/src/main.ts` #2 `@@ -1287,7 +1286,8 @@` | present | work main.ts:1378 | — |
| family-persistent-prefix-resume | 423 | `pi-coding-agent/src/main.ts` #3 `@@ -1302,7 +1302,8 @@` | present | work main.ts:1394 | — |
| family-persistent-prefix-resume | 433 | `pi-coding-agent/src/main.ts` #4 `@@ -1317,16 +1318,21 @@` | present | work main.ts:1399,1402 | — |
| family-persistent-prefix-resume | 458 | `pi-coding-agent/src/main.ts` #5 `@@ -1339,10 +1345,8 @@` | present | work main.ts:1420 | — |
| family-persistent-prefix-resume | 471 | `pi-coding-agent/src/main.ts` #6 `@@ -2209,12 +2213,10 @@` | present | work main.ts:2337-2341 (open without sessionDir; dir defaults to the file dir) | — |
| family-persistent-prefix-resume | 490 | `pi-coding-agent/src/modes/controllers/selector-controller.ts` #1 `@@ -1966,15 +1966,15 @@` | present | work selector-controller.ts:2002,2010 (#getRemovedWorktreeRelocation + relocateTo) | — |
| family-persistent-prefix-resume | 511 | `pi-coding-agent/src/modes/controllers/selector-controller.ts` #2 `@@ -1996,8 +1996,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 522 | `pi-coding-agent/src/modes/controllers/selector-controller.ts` #3 `@@ -2007,31 +2007,21 @@` | present | work selector-controller.ts:2048-2058 | — |
| family-persistent-prefix-resume | 564 | `pi-coding-agent/src/sdk.ts` #1 `@@ -1931,6 +1931,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 574 | `pi-coding-agent/src/sdk.ts` #2 `@@ -2116,11 +2119,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 589 | `pi-coding-agent/src/sdk.ts` #3 `@@ -2137,10 +2138,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 601 | `pi-coding-agent/src/sdk.ts` #4 `@@ -2339,10 +2339,12 @@` | decided-drop | design.md Q11 (13): retire the 0093 selector half; rejected keeping the positional getActiveModelString form. Work sdk.ts:2541-2546 is upstream identity-only | — |
| family-persistent-prefix-resume | 618 | `pi-coding-agent/src/sdk.ts` #5 `@@ -4109,6 +4111,7 @@` | decided-drop | design.md Q11 + DECISIONS.md:690: prompt-label half retired (upstream label already effort-free) | — |
| family-persistent-prefix-resume | 626 | `pi-coding-agent/src/sdk.ts` #6 `@@ -4145,7 +4148,7 @@` | decided-drop | design.md Q11; work sdk.ts:4397 still model: getActiveModelString(), identity-only | — |
| family-persistent-prefix-resume | 635 | `pi-coding-agent/src/sdk.ts` #7 `@@ -4383,7 +4386,11 @@` | decided-drop | Q1 (DECISIONS.md:694): 0047a anchors retire; upstream journal constructor DateCwdReminderInjector(journal) | — |
| family-persistent-prefix-resume | 648 | `pi-coding-agent/src/sdk.ts` #8 `@@ -4420,7 +4427,7 @@` | decided-drop | 0038 providerOnly tail retired (DECISIONS.md:685-701, Q1) | — |
| family-persistent-prefix-resume | 657 | `pi-coding-agent/src/sdk.ts` #9 `@@ -5389,7 +5396,7 @@` | decided-drop | 0047a anchor sessionId injection retired (Q1) | — |
| family-persistent-prefix-resume | 668 | `pi-coding-agent/src/session/agent-session.ts` #1 `@@ -125,6 +125,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 676 | `pi-coding-agent/src/session/agent-session.ts` #2 `@@ -447,7 +448,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 685 | `pi-coding-agent/src/session/agent-session.ts` #3 `@@ -460,7 +461,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 695 | `pi-coding-agent/src/session/agent-session.ts` #4 `@@ -566,6 +569,16 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 712 | `pi-coding-agent/src/session/agent-session.ts` #5 `@@ -1858,19 +1871,10 @@` | present | work agent-session.ts:2070-2072,7660-7681 | — |
| family-persistent-prefix-resume | 734 | `pi-coding-agent/src/session/agent-session.ts` #6 `@@ -2026,7 +2030,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 744 | `pi-coding-agent/src/session/agent-session.ts` #7 `@@ -2562,7 +2567,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 753 | `pi-coding-agent/src/session/agent-session.ts` #8 `@@ -7139,22 +7144,51 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 813 | `pi-coding-agent/src/session/agent-session.ts` #9 `@@ -7162,14 +7196,6 @@` | present | loop removed; work keeps only an unused import (agent-session.ts:148 isEvalStateContext) | — |
| family-persistent-prefix-resume | 828 | `pi-coding-agent/src/session/agent-session.ts` #10 `@@ -11030,6 +11056,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 836 | `pi-coding-agent/src/session/agent-session.ts` #11 `@@ -11048,6 +11075,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 844 | `pi-coding-agent/src/session/agent-session.ts` #12 `@@ -11777,7 +11805,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 853 | `pi-coding-agent/src/session/agent-session.ts` #13 `@@ -11787,6 +11815,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 863 | `pi-coding-agent/src/session/agent-session.ts` #14 `@@ -12505,8 +12536,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 875 | `pi-coding-agent/src/session/agent-session.ts` #15 `@@ -12521,6 +12554,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 885 | `pi-coding-agent/src/session/agent-session.ts` #16 `@@ -12528,7 +12564,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 894 | `pi-coding-agent/src/session/agent-session.ts` #17 `@@ -12544,6 +12580,11 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 906 | `pi-coding-agent/src/session/agent-session.ts` #18 `@@ -12562,7 +12603,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 917 | `pi-coding-agent/src/session/agent-session.ts` #19 `@@ -12615,12 +12658,13 @@` | present | work agent-session.ts:13697-13726,13937-13960 | — |
| family-persistent-prefix-resume | 936 | `pi-coding-agent/src/session/agent-session.ts` #20 `@@ -12630,7 +12674,22 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 960 | `pi-coding-agent/src/session/agent-session.ts` #21 `@@ -12659,7 +12718,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 971 | `pi-coding-agent/src/session/agent-session.ts` #22 `@@ -12730,13 +12791,13 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 987 | `pi-coding-agent/src/session/agent-session.ts` #23 `@@ -12744,7 +12805,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 998 | `pi-coding-agent/src/session/agent-session.ts` #24 `@@ -12825,6 +12888,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1006 | `pi-coding-agent/src/session/agent-session.ts` #25 `@@ -12838,7 +12902,21 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1028 | `pi-coding-agent/src/session/agent-session.ts` #26 `@@ -12922,6 +13000,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1038 | `pi-coding-agent/src/session/agent-session.ts` #27 `@@ -12982,6 +13063,63 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1102 | `pi-coding-agent/src/session/agent-session.ts` #28 `@@ -13040,6 +13178,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1110 | `pi-coding-agent/src/session/agent-session.ts` #29 `@@ -13058,6 +13197,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1118 | `pi-coding-agent/src/session/agent-session.ts` #30 `@@ -13069,8 +13209,12 @@` | present | work agent-session.ts:14266 | — |
| family-persistent-prefix-resume | 1133 | `pi-coding-agent/src/session/agent-session.ts` #31 `@@ -13160,6 +13304,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1141 | `pi-coding-agent/src/session/agent-session.ts` #32 `@@ -13174,6 +13319,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1149 | `pi-coding-agent/src/session/agent-session.ts` #33 `@@ -13512,6 +13658,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1159 | `pi-coding-agent/src/session/agent-session.ts` #34 `@@ -13538,6 +13687,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1169 | `pi-coding-agent/src/session/date-cwd-reminder.ts` #1 `@@ -3,15 +3,50 @@` | superseded | upstream journal: pristine-18.16.0 pi-coding-agent/src/session/date-cwd-reminder.ts:1-16 + placement journal (DATE_CWD_REMINDER_CUSTOM_TYPE); Q1 proof research/q1-prefix-proof-18.16.0.json | — |
| family-persistent-prefix-resume | 1228 | `pi-coding-agent/src/session/date-cwd-reminder.ts` #2 `@@ -19,112 +54,220 @@` | superseded | same; anchor map replaced by per-branch placement journal | — |
| family-persistent-prefix-resume | 1541 | `pi-coding-agent/src/session/messages.ts` #1 `@@ -6,7 +6,6 @@` | present | removal of isUserInterruptAbort use landed (messages.ts:1246-1283); import left unused at :34 | — |
| family-persistent-prefix-resume | 1549 | `pi-coding-agent/src/session/messages.ts` #2 `@@ -475,6 +474,34 @@` | present | work messages.ts:534-560 followedByStreamStallContinueReminder | — |
| family-persistent-prefix-resume | 1584 | `pi-coding-agent/src/session/messages.ts` #3 `@@ -1015,6 +1042,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1592 | `pi-coding-agent/src/session/messages.ts` #4 `@@ -1040,6 +1068,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1600 | `pi-coding-agent/src/session/messages.ts` #5 `@@ -1057,8 +1086,9 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1612 | `pi-coding-agent/src/session/messages.ts` #6 `@@ -1125,6 +1155,12 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1625 | `pi-coding-agent/src/session/messages.ts` #7 `@@ -1152,16 +1188,43 @@` | present | work messages.ts:1246-1283 aborted/error prune + stall/requestControls exemptions | — |
| family-persistent-prefix-resume | 1676 | `pi-coding-agent/src/session/messages.ts` #8 `@@ -1190,12 +1253,14 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1695 | `pi-coding-agent/src/session/messages.ts` #9 `@@ -1241,6 +1306,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1703 | `pi-coding-agent/src/session/messages.ts` #10 `@@ -1250,6 +1316,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1711 | `pi-coding-agent/src/session/messages.ts` #11 `@@ -1261,8 +1328,16 @@` | present | work messages.ts:1445-1460 prunedToolCallIds | — |
| family-persistent-prefix-resume | 1729 | `pi-coding-agent/src/session/messages.ts` #12 `@@ -1275,6 +1350,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1739 | `pi-coding-agent/src/session/model-controls.ts` #1 `@@ -574,15 +574,15 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1763 | `pi-coding-agent/src/session/session-context.ts` #1 `@@ -12,7 +12,7 @@` | loss? | import swap only half done: work session-context.ts:14-15 still imports both followedByStreamStallContinueReminder and INTERRUPTED_THINKING_MESSAGE_TYPE, because the exemption the same hunk deletes is still live at :795. The 18.12.6 hunk is at .18.12.6-families/family-persistent-prefix-resume-v18.12.6.patch:1541 | None observable today: the marker is memory-only (Agent.appendMessage, pi-agent-core/src/agent.ts:1409, only pushes state), so the retained exemption at work session-context.ts:795 can never fire on a rebuilt list, and the live path already prunes in work messages.ts:1246-1283. It becomes a real divergence - a resumed session keeps an interrupted assistant turn the live process dropped, forking the cached prefix at every interrupt - the moment anything persists that marker. |
| family-persistent-prefix-resume | 1772 | `pi-coding-agent/src/session/session-context.ts` #2 `@@ -734,16 +734,30 @@` | loss? | the hunk's replacement comment block and "prune unconditionally" body are absent; the old comment (work session-context.ts:779-781 "Keep the interrupted-thinking continuity pair") and the marker exemption (:794-795) survive, while the hunk's other two exemptions (requestControls :796, stall :797) WERE restored. patch line 1550 | same as #1: no wire difference while the marker is never persisted; contradicts DECISIONS.md:695 ("drop the process-local interrupted-thinking marker"), so the 0043 restore is one hunk short. Covered by verify-interrupt-prune-symmetry.ts (P0) if the marker ever becomes durable. |
| family-persistent-prefix-resume | 1810 | `pi-coding-agent/src/session/session-maintenance.ts` #1 `@@ -3301,21 +3301,13 @@` | present | work session-maintenance.ts:3519 + #appendLengthStopReminder:3663 | — |
| family-persistent-prefix-resume | 1839 | `pi-coding-agent/src/session/session-maintenance.ts` #2 `@@ -3446,6 +3438,25 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1867 | `pi-coding-agent/src/session/session-manager.ts` #1 `@@ -30,6 +30,8 @@` | decided-drop | copyDateCwdAnchors import retired (0047a); the session-transfer-marker import IS present at work session-manager.ts:35 | — |
| family-persistent-prefix-resume | 1876 | `pi-coding-agent/src/session/session-manager.ts` #2 `@@ -313,6 +315,21 @@` | present | work session-manager.ts:326-345 per-entry copy with errorOnExist (amended per DECISIONS.md:698) | — |
| family-persistent-prefix-resume | 1898 | `pi-coding-agent/src/session/session-manager.ts` #3 `@@ -333,7 +350,26 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1926 | `pi-coding-agent/src/session/session-manager.ts` #4 `@@ -761,7 +797,19 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1947 | `pi-coding-agent/src/session/session-manager.ts` #5 `@@ -1281,8 +1329,10 @@` | decided-drop | 0047a copyDateCwdAnchors on new/branch (Q1: anchors retire) | — |
| family-persistent-prefix-resume | 1960 | `pi-coding-agent/src/session/session-manager.ts` #6 `@@ -2276,6 +2326,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 1971 | `pi-coding-agent/src/session/session-manager.ts` #7 `@@ -2337,23 +2391,168 @@` | present | work session-manager.ts:2437-2600 retainWritableOwnership/beginWritableAdoption/#removeUncommittedSession | — |
| family-persistent-prefix-resume | 2147 | `pi-coding-agent/src/session/session-manager.ts` #8 `@@ -2417,6 +2616,11 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2159 | `pi-coding-agent/src/session/session-manager.ts` #9 `@@ -2469,8 +2673,11 @@` | decided-drop | 0047a copyDateCwdAnchors on fork (Q1: anchors retire) | — |
| family-persistent-prefix-resume | 2173 | `pi-coding-agent/src/session/session-manager.ts` #10 `@@ -2502,7 +2709,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2182 | `pi-coding-agent/src/session/session-manager.ts` #11 `@@ -2570,6 +2777,14 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2197 | `pi-coding-agent/src/session/session-manager.ts` #12 `@@ -2599,66 +2814,66 @@` | present | work session-manager.ts:2832-2923 rollbackRelocation/artifactsCopied/requireCompleteArtifacts | — |
| family-persistent-prefix-resume | 2306 | `pi-coding-agent/src/session/session-manager.ts` #13 `@@ -2678,6 +2893,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2314 | `pi-coding-agent/src/session/session-manager.ts` #14 `@@ -2701,8 +2917,35 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2350 | `pi-coding-agent/src/session/session-manager.ts` #15 `@@ -2915,59 +3158,61 @@` | present | work session-manager.ts:3217-3230 finally-release | — |
| family-persistent-prefix-resume | 2457 | `pi-coding-agent/src/session/session-manager.ts` #16 `@@ -3983,6 +4228,9 @@` | decided-drop | 0047a copyDateCwdAnchors in forkFrom (Q1: anchors retire) | — |
| family-persistent-prefix-resume | 2467 | `pi-coding-agent/src/session/session-manager.ts` #17 `@@ -4080,6 +4328,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2476 | `pi-coding-agent/src/session/session-manager.ts` #18 `@@ -4138,11 +4388,40 @@` | present | work session-manager.ts:4560-4590 fork publication claim+cleanup (copyDateCwdAnchors line inside is the retired 0047a half) | — |
| family-persistent-prefix-resume | 2521 | `pi-coding-agent/src/session/session-manager.ts` #19 `@@ -4286,6 +4565,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2529 | `pi-coding-agent/src/session/session-manager.ts` #20 `@@ -4293,16 +4573,27 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2560 | `pi-coding-agent/src/session/session-manager.ts` #21 `@@ -4421,15 +4712,10 @@` | present | work session-manager.ts:4739-4760 openRelocated | — |
| family-persistent-prefix-resume | 2579 | `pi-coding-agent/src/session/session-manager.ts` #22 `@@ -4439,7 +4725,6 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2589 | `pi-coding-agent/src/session/session-storage.ts` #1 `@@ -227,8 +227,11 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2602 | `pi-coding-agent/src/session/session-storage.ts` #2 `@@ -537,7 +540,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2611 | `pi-coding-agent/src/session/session-storage.ts` #3 `@@ -1286,23 +1289,27 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2643 | `pi-coding-agent/src/session/session-storage.ts` #4 `@@ -1347,8 +1354,13 @@` | present | work session-storage.ts:1399 | — |
| family-persistent-prefix-resume | 2661 | `pi-coding-agent/src/session/session-tools.ts` #1 `@@ -22,6 +22,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2669 | `pi-coding-agent/src/session/session-tools.ts` #2 `@@ -274,6 +275,69 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2739 | `pi-coding-agent/src/session/session-tools.ts` #3 `@@ -462,6 +526,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2748 | `pi-coding-agent/src/session/session-tools.ts` #4 `@@ -509,7 +575,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2757 | `pi-coding-agent/src/session/session-tools.ts` #5 `@@ -622,6 +688,63 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2821 | `pi-coding-agent/src/session/session-tools.ts` #6 `@@ -1392,7 +1515,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2830 | `pi-coding-agent/src/session/session-tools.ts` #7 `@@ -2199,7 +2322,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2841 | `pi-coding-agent/src/session/session-transfer-marker.ts` #1 `@@ -0,0 +1,62 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2906 | `pi-coding-agent/src/session/session-transfer.ts` #1 `@@ -9,9 +9,9 @@` | present | marker module extraction; work session-transfer.ts:42-43 | — |
| family-persistent-prefix-resume | 2918 | `pi-coding-agent/src/session/session-transfer.ts` #2 `@@ -21,7 +21,6 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 2926 | `pi-coding-agent/src/session/session-transfer.ts` #3 `@@ -33,23 +32,20 @@` | present | templates/marker removal; work session-transfer-marker.ts:2,50 | — |
| family-persistent-prefix-resume | 2953 | `pi-coding-agent/src/session/session-transfer.ts` #4 `@@ -62,17 +58,6 @@` | present | SessionTransferDetails moved to session-transfer-marker.ts | — |
| family-persistent-prefix-resume | 2971 | `pi-coding-agent/src/session/session-transfer.ts` #5 `@@ -131,53 +116,6 @@` | present | helpers moved to session-transfer-marker.ts:18-60 | — |
| family-persistent-prefix-resume | 3025 | `pi-coding-agent/src/session/session-transfer.ts` #6 `@@ -209,12 +147,11 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3042 | `pi-coding-agent/src/session/session-transfer.ts` #7 `@@ -315,6 +252,12 @@` | decided-drop | 0047a anchors packed into the archive (Q1) | — |
| family-persistent-prefix-resume | 3055 | `pi-coding-agent/src/session/session-transfer.ts` #8 `@@ -497,13 +440,15 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3072 | `pi-coding-agent/src/session/session-transfer.ts` #9 `@@ -541,22 +486,33 @@` | present | work session-transfer.ts:479-505 placeSession with claim + cleanup | — |
| family-persistent-prefix-resume | 3113 | `pi-coding-agent/src/session/session-transfer.ts` #10 `@@ -600,31 +556,55 @@` | present | work session-transfer.ts:547-600 staged claim/requireCompleteArtifacts; anchors line dropped (0047a) | — |
| family-persistent-prefix-resume | 3183 | `pi-coding-agent/src/session/session-transfer.ts` #11 `@@ -632,7 +612,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3192 | `pi-coding-agent/src/session/session-transfer.ts` #12 `@@ -653,9 +633,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3205 | `pi-coding-agent/src/session/session-transfer.ts` #13 `@@ -669,25 +650,3 @@` | present | forkIfMovedAway re-expressed as adoptForWrite delegate (work session-transfer.ts:649-652) | — |
| family-persistent-prefix-resume | 3233 | `pi-coding-agent/src/session/turn-recovery.ts` #1 `@@ -11,6 +11,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3241 | `pi-coding-agent/src/session/turn-recovery.ts` #2 `@@ -267,7 +268,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3251 | `pi-coding-agent/src/session/turn-recovery.ts` #3 `@@ -647,20 +649,12 @@` | present | work turn-recovery.ts:695-760,1136,1227,#appendRetryReminder:3246 | — |
| family-persistent-prefix-resume | 3278 | `pi-coding-agent/src/session/turn-recovery.ts` #4 `@@ -720,20 +714,12 @@` | present | work turn-recovery.ts:695-760,1136,1227,#appendRetryReminder:3246 | — |
| family-persistent-prefix-resume | 3305 | `pi-coding-agent/src/session/turn-recovery.ts` #5 `@@ -761,8 +747,8 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3316 | `pi-coding-agent/src/session/turn-recovery.ts` #6 `@@ -1103,12 +1089,7 @@` | present | work turn-recovery.ts:695-760,1136,1227,#appendRetryReminder:3246 | — |
| family-persistent-prefix-resume | 3330 | `pi-coding-agent/src/session/turn-recovery.ts` #7 `@@ -1199,12 +1180,7 @@` | present | work turn-recovery.ts:695-760,1136,1227,#appendRetryReminder:3246 | — |
| family-persistent-prefix-resume | 3344 | `pi-coding-agent/src/session/turn-recovery.ts` #8 `@@ -1934,6 +1910,11 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3356 | `pi-coding-agent/src/session/turn-recovery.ts` #9 `@@ -1945,7 +1926,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3365 | `pi-coding-agent/src/session/turn-recovery.ts` #10 `@@ -1953,7 +1934,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3374 | `pi-coding-agent/src/session/turn-recovery.ts` #11 `@@ -2013,7 +1994,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3383 | `pi-coding-agent/src/session/turn-recovery.ts` #12 `@@ -2029,18 +2010,18 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3406 | `pi-coding-agent/src/session/turn-recovery.ts` #13 `@@ -2066,18 +2047,14 @@` | present | work turn-recovery.ts:1962-2047 isCurrent | — |
| family-persistent-prefix-resume | 3427 | `pi-coding-agent/src/session/turn-recovery.ts` #14 `@@ -2131,6 +2108,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3438 | `pi-coding-agent/src/session/turn-recovery.ts` #15 `@@ -2139,10 +2120,10 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3450 | `pi-coding-agent/src/session/turn-recovery.ts` #16 `@@ -2156,51 +2137,39 @@` | present | work turn-recovery.ts:2228 setModelWithProviderSessionReset(candidate, commit) | — |
| family-persistent-prefix-resume | 3529 | `pi-coding-agent/src/session/turn-recovery.ts` #17 `@@ -2208,7 +2177,7 @@` | present | work turn-recovery.ts:2259 | — |
| family-persistent-prefix-resume | 3538 | `pi-coding-agent/src/session/turn-recovery.ts` #18 `@@ -2423,19 +2392,26 @@` | present | work turn-recovery.ts:2517-2543 | — |
| family-persistent-prefix-resume | 3571 | `pi-coding-agent/src/session/turn-recovery.ts` #19 `@@ -2443,10 +2419,11 @@` | present | work turn-recovery.ts:2546-2604 admissionCurrent | — |
| family-persistent-prefix-resume | 3585 | `pi-coding-agent/src/session/turn-recovery.ts` #20 `@@ -2487,6 +2464,7 @@` | present | all added lines present, all removed lines absent | — |
| family-persistent-prefix-resume | 3593 | `pi-coding-agent/src/session/turn-recovery.ts` #21 `@@ -2494,16 +2472,15 @@` | present | work turn-recovery.ts:2596-2610 | — |
| family-persistent-prefix-resume | 3618 | `pi-coding-agent/src/session/turn-recovery.ts` #22 `@@ -3080,6 +3057,26 @@` | present | all added lines present, all removed lines absent | — |
| 0046-omp-supersede-warm-prefix-guard | 3 | `src/session/session-maintenance.ts` #1 `@@ -777,8 +777,27 @@` | present | work session-maintenance.ts:848 suffixTokenLimit: 0 (upstream prefixBinding gate replaced; the other prefixBinding site at :778 is cacheWarmSuffixTokens, untouched by 0046) | — |
| 0048-omp-advisor-quota-rotation-bound | 3 | `pi-coding-agent/src/session/session-advisors.ts` #1 `@@ -134,6 +134,13 @@` | present | all added lines present, all removed lines absent | — |
| 0048-omp-advisor-quota-rotation-bound | 17 | `pi-coding-agent/src/session/session-advisors.ts` #2 `@@ -348,6 +355,8 @@` | present | all added lines present, all removed lines absent | — |
| 0048-omp-advisor-quota-rotation-bound | 26 | `pi-coding-agent/src/session/session-advisors.ts` #3 `@@ -1586,6 +1595,9 @@` | present | all added lines present, all removed lines absent | — |
| 0048-omp-advisor-quota-rotation-bound | 36 | `pi-coding-agent/src/session/session-advisors.ts` #4 `@@ -2104,7 +2116,22 @@` | present | work session-advisors.ts:2171-2186 (if/else-if form) | — |
| 0048-omp-advisor-quota-rotation-bound | 62 | `pi-tui/src/overlays/advisor-config.ts` #1 `@@ -708,7 +708,6 @@` | present | all added lines present, all removed lines absent | — |
| 0048-omp-advisor-quota-rotation-bound | 70 | `pi-tui/src/overlays/advisor-config.ts` #2 `@@ -1646,7 +1645,7 @@` | present | work advisor-config.ts:1646 | — |

## Residual notes (not hunk verdicts)

1. **0038 vestige, inert.** `providerOnly?: boolean` still exists at `pi-ai/src/types.ts:1250,1270` and `openai-responses.ts:1573-1579` still counts trailing provider-only users into `trailingScaffoldingItems` (hunks `pi-ai/src/types.ts` #1-#2, `openai-responses.ts` #1-#3 — all `present` above). Nothing in the work tree writes that flag (`grep providerOnly` over `pi-*/src` finds the type, the reader, and no producer), so the count is always 0. Correct while 0038's tail stays retired; it silently becomes live behaviour again if any future code sets `providerOnly`.
2. **Unused imports left by partial restores.** `pi-coding-agent/src/session/messages.ts:34` imports `isUserInterruptAbort` with zero uses (0043 hunk at patch line 1541 removed the use, not the import); `pi-coding-agent/src/session/agent-session.ts:148` imports `isEvalStateContext` with zero uses (hunk #9 removed the only loop). Harmless at runtime, dead weight for a reviewer.
3. **`forkIfMovedAway` kept as a delegating shim.** `pi-coding-agent/src/session/session-transfer.ts:649-652` is now `await manager.adoptForWrite(); return manager;`, and `main.ts` keeps all six 18.12.6 call sites unchanged while `dist/types/session/session-transfer.d.ts:82` still declares it. So the migration hunks in `main.ts` #1-#6 and `session-transfer.d.ts` #4 are unnecessary rather than lost — same behaviour, one extra indirection. One sub-line of `main.ts` #6 has no counterpart: `SessionManager.open(chosen.path)` no longer receives `parsedArgs.sessionDir`; that only changes the `dir` chosen when a session's recorded cwd is unenterable (`session-manager.ts` `open()`), and the site is already gated by `isFromRemovedWorktree`.
4. **Date/cwd reminder is entirely upstream now.** Work `pi-coding-agent/src/session/date-cwd-reminder.{ts,d.ts}` are byte-identical to pristine 18.16.0 (empty `diff -u`): upstream ships the placement journal (`DATE_CWD_REMINDER_CUSTOM_TYPE`, `DateCwdReminderJournal`, `createSessionDateCwdReminderJournal`), i.e. the same capability 0038/0047a reached from the other side. `research/q1-prefix-proof-18.16.0.{ts,json}` is the replacement for `verify-date-cwd-anchor-stability.ts`.
5. **Restored 0043/0077 set is otherwise real and wired** (checked, not just line-present): `messages.ts:1246-1283` prunes aborted/error turns on the convert path with the two exemptions, `:1221` drops the marker, `:533-560` recognises the stall reminder whose text matches `pi-coding-agent/src/prompts/system/stream-stall-continue.md:1`, `:1445-1460` carries `prunedToolCallIds` and skips paired synthetic tool results, and `turn-recovery.ts:3246-3256` `#appendRetryReminder` persists the reminder through `sessionManager.appendMessage` (so the stall exemption is durable, unlike the marker).
6. **Amended session-transfer artifact code behaves as DECISIONS.md:698 states**: `session-manager.ts:326-345` keeps the exclusive `mkdir` and copies per entry with `errorOnExist` (no `fs.cp` on an existing root), `unpackSession` stages the artifacts directory unconditionally (`session-transfer.ts:547-551`), and `forkFrom` refuses an existing output before claiming (`session-manager.ts:4560-4590`).
7. **0046 is a single-site substitution.** Only `session-maintenance.ts:848` (`suffixTokenLimit: 0`) changed; the neighbouring `cacheWarmSuffixTokens` prefix-bound gate at `:778-779` is upstream and outside 0046. The hunk's 21-line deferral rationale (supersede pass defers every rewrite to the idle flush) is present verbatim.
