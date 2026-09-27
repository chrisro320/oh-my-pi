# 0073 會話生命週期驗證

使用者於2026-09-26批准開始補做0073會話級驗證。本任務是父任務18.3.3隔離預檢的追加實驗，不是產品實作或部署。

## 範圍與驗收

- 使用六個官方18.3.3 pristine套件副本、私有HOME及人工session；不讀live憑證或會話。
- 真實SDK建立會話，真實registry註冊人工模型，經setModelTemporary與setModel切換；adapter攔截請求，不呼叫真實provider。
- 比較同一有效模型下system及tools的完整序列化值，記錄input/compat/edit mode，不能用getter相等代替會話一致性。
- 磁碟session保存後，以不同程序resume，不傳顯式model覆蓋恢復邏輯；區分一般temporary與ephemeral。
- 差異須記錄首個不同位置與來源；不把兩個同錯值判為正確。人工catalog只能驗證生命週期，不能證明正式provider metadata正確。
- 更新父任務0073判定；不退役或改寫任何補丁，不改live、不提交。

## 實驗設計與順序

既有sandbox內新建model-lifecycle，六個OMP根目錄重新複製pristine，其餘依賴重用。腳本位於父任務research/probe-model-lifecycle.ts。僅此腳本、實驗JSON、父任務判定和必要spec屬修改邊界。

1. registry模型A為gpt-4.1、text/image、hashline；B為deepseek-v4.1-flash、text、預期replace。先核對觀測值符合fixture宣告與上游edit-mode政策。
2. 分別執行temporary、default、roundtrip、ephemeral；在實際adapter入口保存system/tools快照。
3. 每條路徑結束後flush磁碟，獨立程序SessionManager.open後由SDK恢復模型並再次請求。比對相同最終模型前綴。
4. 記錄差異、範圍限制、首次失敗及fixture修正；執行規範機檢。未覆蓋真實provider payload、完整補丁鏈或服務端命中率，不得宣稱已驗收。

這是有界離線調查，PRD整合實驗步驟；不需要產品設計或派工。沿用父任務的spec契約與授權，使用者「可以開始」即本實驗的執行批准。

## 結果

2026-09-26完成上述限定實驗：9程序、14個離線adapter請求、7組前綴相等；模型能力及edit-mode的獨立oracle通過。設定用loadIsolated持久化，resume不重新指定model或default。比較使用adapter入口保存的raw字串UTF-8 bytes（system及pi-ai完整Tool介面欄位），非重建物件或真正HTTP bytes。

執行：`python3 .trellis/tasks/09-26-omp-1833-upgrade/research/run-model-lifecycle.py`。結果與完整快照：父任務research/model-lifecycle-results.json；fixture修正歷程：model-lifecycle-fixture-corrections.json。spec交付/覆核機檢各6/6通過。未驗正式plugin/catalog、全部工具或全補丁鏈；父矩陣0073仍不授權退役。本子任務驗證已完成，不等於升級完成；不commit或歸檔。
