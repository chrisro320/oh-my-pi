# 外掛式上下文工具評估紅線（Magic Context 案例）

> 來源: 08-31-mc-sandbox-eval（對 @cortexkit/magic-context 接入 omp 的評估）。復用場景: 未來任何要裝進 omp 的「接管上下文/compaction/記憶」型外掛。

## Scenario: 接管型上下文外掛接入評估

### 1. Scope / Trigger
- 外掛會修改 context wire、接管 compaction、寫 config 或 plugin 註冊 → 必須全程沙盒隔離評估,紅線: live agent.db/models.db/auth.json 零觸碰（**事後驗證同樣受約: integrity_check/只讀 SELECT/online backup 全算觸碰,違反即評估失效**）、Anthropic 憑證零複製。

### 2. 沙盒拓撲簽名（簽名級契約）
```bash
# 隔離入口: mount-ns + PID-ns + 降權 + strace 全程
sudo -n unshare -m -p -f --mount-proc bash -c '
  mount --make-rprivate /            # 先斷 shared propagation(宿主 / 是 shared:1)
  mount -t tmpfs none /home/chris/.omp
  mount -t tmpfs none /home/chris/.local/share/<target>
  mount -t tmpfs none /home/chris/.claude   # ambient 掃描會偷讀!必遮
  mount -t tmpfs none /home/chris/.agents   # 同上
  exec setpriv --reuid 1000 --regid 1000 --init-groups <cmd>'
```
- 環境鍵: `HOME/XDG_DATA_HOME/XDG_CACHE_HOME/BUN_INSTALL_CACHE_DIR/TMPDIR` 全導沙盒;`MAGIC_CONTEXT_STORAGE_DIR=<sandbox>/mc-db` 強制 MC 落點;`CLAUDE_CONFIG_DIR` **必須 export 在 exec 之前**（放 exec 後永遠不生效——踩過的坑）
- Ubuntu AppArmor: ns 內 root 讀不了 chris 的 700 檔 → 一律 setpriv 降 chris，root 只做 mount
- 判定遮蔽是否成立: `test -e <live掛載點>` 恆真（掛載點目錄本身存在）——**必須驗內容子路徑**（如 `<點>/agent/agent.db`、`<點>/magic-context`），任一可見=LEAK=fail-closed

### 3. Contracts
- 評估外掛 wire 行為時,優先**源碼倉庫內 bun test 基建 + 自寫探針**（無需 LLM key）: `bun test` 自帶 XDG 隔離 preload
- 每輪 wire 語義: omp context hook 每輪由 provider **重建 messages 陣列**——判「前綴污染」不可只看內部 transform 的 unshift,要驗跨輪 byte-stable
- cache 塌陷判定: 頭部注入(m[0]/m[1]) + `cache_ttl` idle 過期 + HARD fold 條件清單,逐項對照 omp 現狀（0018 前綴解耦）

### 4. Validation & Error Matrix
- 掛載點測試用 `test -e` → 假通過（掛載點恆存在）→ 改驗內容子路徑
- 沙盒內 root 執行 node/npm → 檔案 root 汙染 → EACCES 連環炸 → 只 mount,其餘降權,事後 chown 沙盒（宿主路徑禁止）
- `omp config get` 在 agent.db 未初始化時 throw → 外掛讀 null → 拒裝: 沙盒先跑一次 `omp --version` 初始化 DB
- `omp plugin install` 需要 bun 在 PATH 且 bun 緩存拒寫 live `~/.bun` → `BUN_INSTALL_CACHE_DIR` 沙盒化
- 以「live 認證庫自身會話寫入」豁免 size/mtime 差異 → 實為歸因未證明的污染 → 判失敗（本評估踩過: 1.83MB→1.84MB 差異無法歸因）

### 5. Good/Base/Bad Cases
- Good: 實驗窗口內宿主 OMP 進程全停（quiescence gate）,哨兵只做宿主 stat;before→after live DB 內容與 metadata 零變動;strace 零 live open
- Base: 探針/測試無 compartment 時壓力場景退化 no-op——結論必須如實標「部分」,不得升格為 OMP wire 裁決
- Bad: 用 `test -e 掛載點` 判隔離成立;CLAUDE_CONFIG_DIR export 放 exec 後;把 MC 內部 createTransform 結論寫成 OMP wire 結論

### 6. Tests Required
- `sentinel.sh before/after` diff: live DB 任何 size/mtime/inode 變動 = 失敗——不允許以「live 自身會話寫入」豁免（歸因未證明即視同污染;宿主未停寫則窗口無效,停寫重跑）
- `mask-check` 負向測試: 故意少掛一個目標,斷言非零退出
- 外掛自帶測試套件全綠後才做自寫探針
- 探針報告必須標注 hook 路徑(OpenCode/OMP)與 fixture 空洞

### 7. Wrong vs Correct
#### Wrong
```bash
unshare -m --map-root-user bash -c 'mount -t tmpfs none $X; test -e $X/agent.db'   # test -e 對掛載點恆真→假通過
```
#### Correct
```bash
unshare -m --map-root-user bash -c 'mount -t tmpfs none /home/chris/.omp
  test -e /home/chris/.omp/agent/agent.db && echo LEAK || echo MASKED'  # 驗內容子路徑
```

### 8. 派工紀律（本評估實證的教訓）
- 派子代理**必須顯式傳 `agent` 欄位**並核對回執——省略即落內建 task 卡（`@task` 角色模型），綁定卡上的模型聲明不會生效
- 回執顯示 "generic task workers" 等字樣 = 派工錯誤的信號，當場攔截
- 弱模型產出的報告只能作素材；引用前須強模型覆核或主會話逐行核實，並在結論旁標注來源與覆核狀態