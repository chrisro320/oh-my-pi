# 遷移設計

## 契約

延續47項舊計畫能力，不直接把文字可套當可部署。新候選置於patches/.18.3.3-candidates，保留patch ID與功能邊界；舊候選immutable。最終清單唯一來源為apply.sh --print-plan。

原生Anthropic摘要遵守safeCut prefix，不把live整段替換切點；Codex先settle connection後建立chain payload，兼容steering/reconnect及fail-closed。0043保留requestControls/tool_removal。0065從KDL重生JSON。

## 並行責任

各實作者使用自己的pristine副本，只寫分配的新版候選與專屬驗證檔；不改apply.sh、共同spec或live。Session處理0010/0034/0032/0038/0043/0047/0060/0075/0076/0077。Compaction處理0035/0036/0044/0052/0057/0045/0046/0062/0065/0066/0067。Codex處理0063/0068/0069/0070。AuthUI處理0037/0026/0030/0031/0048/0050/0072。Main處理其餘候選、controller、驗證整合與部署。

私有副本的跨組patch相依由Main按完整順序重放處理；共享gates由Main持有，實作者提出具體改動建議或新增專屬版本probe，不同時修改共享檔案。

## 部署

先完成隔離全链验证，备份全域安裝入口、套件與補丁台帳（排除agent狀態）；以staged獨立套件樹切換，保留旧樹回滾。預備新程序使用私有HOME冒煙，不重啟使用者其他會話。正式入口指向新版本，新開程序生效。
