---
title: OMP2 遷移評估：讀原始碼，逐項判定客製化去留
status: paused
created: 2026-11-08
pause_reason: 等 OMP2 正式發布
resume_when: OMP2 正式發布，或使用者要求
---
RESUME: 等 OMP2 正式發布。恢復時先讀 OMP2 原始碼（不只發布說明或設計文），再照「做法」逐項判定，寫定驗收後 `start`。

## 目標
使用者 2026-11-08：OMP2 是重寫，我們的補丁和擴充不能直接搬，但概念可能仍有用；預估多 provider 的 harness 本質上還會有不少怪異的 cache 與憑證問題。OMP2 出來時讀它的原始碼，判定每項客製化的去留，再由使用者做決定。

## 驗收（草稿，恢復時改定）
- [ ] 🎯 `patches/PATCHES.md` §2、§8 每一項能力都有判定：OMP2 已處理／概念仍適用需重新設計／可放掉，並附 OMP2 原始碼位置
- [ ] cache／前綴穩定與憑證（OAuth 更新、帳號輪替、被拒請求重送）先判定，並用現有走公開入口的 gate 情境當行為規格實測
- [ ] 判定清單交使用者決定去留

## 做法
- 依據：每項能力的故障簽名在 `patches/.retired/11-07-PATCHES-history.md` 同號小節；只搬概念與故障簽名，不搬程式碼。
- 背景：omp² 設計文 https://stencil.so/blog/harness-playbook （Rust 核心、Python 擴充、單一由 journal 推導的 session 樹；摘要見 `.tasks/stage/11-08-notes-precompact-branch-subagents/TASK.md`「恢復時先做」）。
- 同時恢復 `.tasks/stage/11-08-notes-precompact-branch-subagents/`（壓縮前存筆記、分支子代理、平行合併鎖），它的恢復條件也是 OMP2。
- 決策：`DECISIONS.md`「OMP2 遷移原則」。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|

## 證據

## 紀錄
- 2026-11-08 建立：原本把這條寫進 `AGENTS.md`（每次對話都佔系統提示），後移到 `patches/PATCHES.md` §9；使用者指出這類「等外部事件再處理」的事沒有合適的地方放，改由暫停中的任務承載，PATCHES.md 只留指向
- 2026-11-08 暫停：等 OMP2 正式發布（恢復條件：OMP2 正式發布，或使用者要求）
