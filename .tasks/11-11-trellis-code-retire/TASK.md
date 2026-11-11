---
title: 移除 Trellis 專屬程式
status: planning
created: 2026-11-11
from: 11-11-trellis-detach
---
RESUME: 尚未規劃；本人要求另開。下一步：盤點下列四項的部署與使用情況，寫 驗收／做法 後呈現計畫並停下。

- [ ] 暫停

## 目標
本人永久不再使用 Trellis。移除只為 Trellis 存在的程式與設定：`patches/context-persist-audit-extension.ts` 的 Trellis 錨點豁免（正式部署中的 companion，改了要重新部署）、未列入 gate 清單的 `patches/verify-trellis-context-refill.ts` 與其載入的 `.trellis/legacy-omp/extensions/trellis/`、本專案 `.omp/extensions/trellis`、全域 `~/.omp/agent/commands/trellis-init.md`（影響其他專案）。

## 驗收
- [ ] 

## 做法

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|

## 證據

## 紀錄
- 2026-11-11 建立
