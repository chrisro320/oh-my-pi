# 0080 最小修正設計

- 邊界：只在 18.2.10 `pi-tui/src/chat/{image-loading,tool-execution,assistant-message}.ts` 的顯示副本工作，生成一份 0080 候選 patch；不寫 live node_modules。
- 共享狀態：同一指紋的 `ensurePng` pending/success/failure 均回傳同一 Promise；完成時把同一 entry 更新為 `{png,reason,bytes}`，並由現有 LRU 計算尺寸。快取未命中最多轉兩次；錯誤以 null 決議。
- 容量：依 `pi-utils/src/lru.ts`，`set` 才重新計價，不能只 mutate bytes；pending 同樣要受 `max` 或有界容量約束，不可留下無界失敗原因 Map。轉換本身跨淘汰仍須保持 in-flight 去重和 callback identity guard。
- 顯示：保留既有 tool/assistant digest 校驗；必要時只補 native 換圖 callback 防護和理由文字，不改 provider 原圖或其它圖像協定。
- 原始來源：以官方 pristine 18.2.10 與先套 0079 的樹作 a 側，改完後由 diff 生成單一 0080 候選；正式檔與 runtime ledger 同步後才做部署。舊候選如可小幅改寫，不重整無關 hunk。
- 回滾：候選檔及同步前備份；新 candidate 先乾跑、獨立重放及 gate。正式 apply 僅在 verifier 通過後，進程完全重啟才視作 live 生效。
