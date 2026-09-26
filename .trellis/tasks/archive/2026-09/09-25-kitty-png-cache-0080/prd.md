# 收尾 Kitty PNG 共用快取補丁 0080

## Goal
使 OMP 18.2.10 的 Kitty 圖片顯示端共用 PNG 轉換快取可安全重放、可驗收；保留 provider 與原始訊息圖片位元組。

## Confirmed state
- 原候選在 settle 時以 `Promise.resolve(png/null)` 替換 shared Promise；修正版需讓仍在快取中的項目維持原 Promise。舊 live 樹的 verifier 已在「settled conversion retains the original shared promise」斷言重現失敗。
- `patches/apply.sh:411` 只在 18.2.10 計畫尾端追加 0080；初版曾部署，修正版尚未部署。
- 工具與 assistant 的顯示端共用快取；不改模型輸入、不改 Orca、不遷移 18.2.11。

## Requirements
- 相同 MIME＋base64 圖片在快取保留期間的 pending/success/failure 呼叫共用原 Promise；容量淘汰後允許重新轉換，但舊回呼不得覆蓋新結果。成功及失敗的同步繪圖資訊均為容量受限快取項，淘汰中的失敗仍須讓當前訂閱者看見有界原因。
- 工具、assistant tool-result 及 native assistant 圖片均不得因同位置 A→B→A 或晚到回呼繪出過期內容。
- 候選補丁從乾淨的 18.2.10 TUI 與 0079 後狀態重放；只改 0080 相關候選與必要驗證/契約。既有不相關 dirty paths 不動。

## Acceptance Criteria
- [x] 八張 2048² WebP 在 Kitty 元件渲染圖形，resize 與 overlay/tab 返回後保持可見。
- [x] 同格 A→B→A 正確切換；工具、assistant tool-result、native assistant 的晚到回呼不能覆蓋新圖；原圖仍保持 WebP/MIME/data。
- [x] 快取保留期間，相同圖的並行與完成後 success/failure 呼叫保持原 Promise 身分、不重複轉換；壞圖在淘汰競態下仍顯示 bounded 轉換失敗原因。
- [x] 200 張不同圖片可觸發 32 MiB 已完成 PNG 快取淘汰；600 張小圖片證明項數有界，pending 按輸入長度計價。
- [x] 隔離實跑 verifier、版本補丁家族重放及 apply.sh 全部註冊離線 gate 通過；typecheck 缺少發行套件 tsconfig/tsgo，已明確記錄。

## Out of scope
Orca、provider payload、18.2.11 遷移、其他現存未提交修改。
