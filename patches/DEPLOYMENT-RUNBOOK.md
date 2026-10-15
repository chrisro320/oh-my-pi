# omp 部署與更新 Runbook

## 目標

安全更新 omp、重套補丁、驗證回退，且不共用或破壞 `agent.db`、`models.db`、OAuth 憑證。

## Current18.10.1 immutable installation

The sections below this procedure retain historical direct-global deployment and offline database guidance. Do not apply their `bun add -g`, global directory exchange, watcher or mutable-ledger commands to the current immutable release.

1. Pin official archives/commit, rebase the family registry and run the complete representation oracle.18.10.1 retains58 capabilities in23 physical families and adds post-cutover families 0098, 0099 and 0100 (26 /61, declared in `verify-release-family-plan.py` `ADDED_FAMILIES`);0097 is not selected. Use existing changed-consumer gates, not repeated broad suites.
2. Assemble the full dependency/native closure under private HOME/cache. All13 OMP packages must match18.10.1. Independent copies must have no external aliases or shared regular-file inodes. Never source pristine packages from the live Bun cache.
   Native overlay: rebuild with `bash patches/native/build-natives.sh <work> <out>`, install both `.node` files into the runtime's `pi-natives-linux-x64/`, then `python3 patches/verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi` must PASS. A rebuilt hash differing from `overlay.json` means the recipe or toolchain drifted: record the new hashes only after re-running the live Escape checks.
   The current native overlay also bounds AT-SPI initialization to two seconds and accepts Chrome profile-decorated AX frame titles while retaining PID ownership and ambiguity rejection. For the 2026-10-15 AX-only release, the user explicitly accepted publication on completed automated/native/runtime evidence without repeating physical Escape validation; this is a one-release exception, documented in `DECISIONS.md`, not a passing physical check or a change to the general gate.
3. Prepare permanent code with:
   `python3 -I patches/publish-release.py prepare --home "$HOME" --runtime <verified-private-runtime> --ledger <repository-patches> --version 18.10.1`.
   The receipt names the physical `~/.bun/install/omp-releases/<version-digests>` directory. Old global paths remain unchanged.
4. Against that installed physical runtime, run source `--version`, actual read-tool CLI, native IPC and gallery smoke under a freshly allowlisted private HOME/XDG/agent (`.trellis/tasks/archive/2026-10/10-12-omp-18101-footer-release/research/smoke/run-installed-smoke.py --release <physical-release> --out <json>`). Block fetch in the source CLI fixture. Run the bound ledger `--check` and native lifecycle gate. Collect the six results as `checks.version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog` with `exit:0`, plus the exact `release` and `status:"PASS"`. Re-run `verify-native-overlay.py` against the installed runtime.
5. Run `python3 -I patches/publish-release.py publish --release <physical-release> --smoke <installed-private-smoke.json>` only after final review. This serializes with first production admission, records old boot/PID/start-time identities, preserves the exact old launcher and ledger, and publishes launcher/ledger under a durable fail-closed receipt. A failed partial publication restores code pointers only.
6. Observe public `omp --version` and a blocked normal launch while old owners remain. The safe version wrapper reports installed code/admission, not actual source execution; step4 is the source proof. No production CLI/provider/usage request is needed.

Terminal installation receipt: `code_installation:"complete"`, `current_session_upgrade:false`, `production_activation:false`. Old18.7.0 processes stay on their old code. Close old sessions and detached brokers normally; the next `omp` starts18.10.1 only after the ownership gate clears. No watcher, auto-kill, force bypass or hot upgrade is installed. Replacing the public launcher can also make an old session's later worker respawn fail closed; it must not silently create a mixed-version worker.

The installed `ledger/.runtime-root` is an installer-owned physical binding. Bound `apply.sh` / `--revert` reject mutation; `--check` checks the release-local `bin/source-omp` and family state, not the public Python wrapper. Missing binding never falls back to the old global tree. Read-only plan/capability queries remain available.

Before any production source exec, the launcher durably sets `production_admission_started:true`. A code-only rollback is allowed **only before that flag**:
`python3 -I patches/publish-release.py rollback --release <physical-release>`.
After possible admission, older OAuth code cannot safely consume the new exchange journal; do not reset the receipt or restore old token state to bypass the barrier. Code backups retain the old global closure and ledger, never `~/.omp/agent`.

Synthetic rollback/admission proof:
`python3 -I patches/verify-release-publication.py`.
Its fixture cannot prove provider idempotency, credential validity, real cache hits or production activation.


## 0. 更新前禁止事項

- 不在 live runtime 運行時對 live DB 開新連線。
- 不用 `cp` 複製 `agent.db`、`models.db`、`*.db-wal` 或 `*.db-shm`。
- 不讓新舊 omp 共用 `HOME`、agent 目錄、`agent.db`、`models.db`、cache 或 OAuth 憑證。
- 不把 `apply.sh --check` 的假綠當成 pristine replay 或語義驗證。
- 不用真實 Anthropic auth 做新版 smoke、usage 或 channel 測試。
- 不把版本 fallback、帳號切換或 provider 切換誤判成 resume 本身造成的 cache miss。

## 1. 準備版本與補丁

確認目前版本與補丁來源：

```sh
~/.bun/bin/omp --version
OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash patches/apply.sh --print-plan
```

版本選擇規則：

```text
未設定 OMP_PATCH_VERSION       依 installed pi-coding-agent 版本自動路由（精確匹配，非就近 fallback）
OMP_PATCH_VERSION=<supported-version> 選擇同版本精確計畫；存活版本見 apply.sh
18.7.0                       六個官方套件版本必須全為18.7.0；層數由 selected resolved plan 決定
其他值／顯式值與安裝版不符      exit 2，禁止猜測套用
```

The canonical `PATCHES` array serves retained historical plans; it is not a deployable chain. The18.7.0 family plan comes from `.18.7.0-families/plan.tsv`. Always consume `apply.sh --print-plan`, not the array or a glob of patch files.

For18.7.0, `OMP_PATCH_PLAN=deployed` (also the default) selects the consolidated deployed baseline. `OMP_PATCH_PLAN=repository` explicitly adds the still-undeployed0097 candidate. Capture the exact selection in staging and transaction evidence; never infer the selection from a missing candidate or activate0097 incidentally. Other selector values fail closed; older versions do not accept this selector.

Same-family maintenance archives the previous immutable revision and replaces the active family revision rather than appending a repair layer. Follow the existing [family contract](../.trellis/spec/backend/patch-rollup-contracts.md); keep historical rollback bytes unchanged. The 0090 unlock revision (2026-10-13) followed exactly that path: `.retired/10-13-18.10.1-0090-pre-unlock/` holds the superseded `0090-omp-oauth-durable-refresh-v18.10.1.patch` with its pinned hash, `baseline.json` and `unlock-api.delta.patch`; `verify-release-family-plan.py` fails if that archive drifts or if the retired bytes are still the active representation. The 2026-10-15 Anthropic-only scope revision followed the same path again: `.retired/10-15-18.10.1-0090-pre-anthropic/` holds the superseded `cb5bbf9c…` bytes with `baseline.json` and `anthropic-scope.delta.patch`, the active family is `32eac750…` (candidate tree `2fc569d9…`), and plan rows, archives pins, `upstream_adoptions` and `pristine_tree_sha256` are unchanged. The installed 18.10.1 release carries the 2026-10-13 unlock revision (`7b7b41c2…`); the scope revision ships only with the next release, so the running installation still journals every provider.

Historical next-update baseline was the verified18.7.0 family registry. The current next-update baseline is the verified18.10.1 registry, ownership manifest and gates; do not revive the retired58-layer chain or lose the retained18.7.0 history. Port each capability against official upstream bytes;0097 remains excluded.

Representation-only repository work is not deployment authorization. Before an authorized cutover, run the selected-version old/new verifier and isolated CLI/tool smoke, then stage the verified controller, family registry, patches and gates as one ledger. Retain the old ledger/controller as the rollback oracle. A repository/live mismatch during approved staging is not permission to overwrite the live ledger early.

18.3.3 使用隔離安裝驗證後整樹切換，不在正式安裝上逐檔修補：

1. 官方六套件 SHA-256 驗證，獨立解壓以避免 Bun cache hardlink。
2. 私有 HOME/XDG/TMP 執行完整候選、行為 gates、模型生命週期與 CLI smoke；print-mode smoke 必須給 stdin EOF。
3. 備份 global 安裝、launcher target、patch ledger；不複製或連線正式 agent DB。
4. 在正式 global 同檔案系統準備 staged global，在 ledger 同檔案系統準備 staged patches；比較已驗證樹的 bytes 與 symlink targets。
5. Linux `renameat2(..., RENAME_EXCHANGE)` 原子交換各目錄；第二次交換失敗時立即反交換 global。舊樹與獨立備份均保留。
6. 新程序使用正式 source CLI、私有 HOME 驗版本與工具呼叫；controller `--check` 必須與 staged `--print-plan` 的實際 entry 數量一致，且無 CONFLICT/MISSING。正式 auth/session 由使用者重啟後沿用。

Historical direct-global watcher constraint: a watcher must be independent of all OMP ancestors, and `active/running` is not deployment evidence. The18.10.1 immutable procedure above does not create a watcher or exchange the live global tree.

Ledger 不再依賴 `../vendor/pi-commandcode-provider`：該外掛已於 2026-09-27 退役（使用者改用官方原版端點），其跨註冊校驗腿已隨之移除。

`bun update -g` 對本專案無效（global `package.json` pin 死確切版本），必須 `bun add -g <pkg>@<version>`。

`bun add -g` 可能清掉 runtime 補丁與 symlink；套件更新後必須重新同步補丁並執行 `apply.sh`。

## 2. 新版 sandbox 驗證

所有新版命令必須顯式覆寫：

```text
HOME
XDG_CONFIG_HOME
XDG_CACHE_HOME
XDG_DATA_HOME
XDG_STATE_HOME
TMPDIR
agent directory
```

並移除：

```text
ANTHROPIC_API_KEY
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_BASE_URL
CLAUDE_CODE_OAUTH_TOKEN
```

驗證順序：

```text
官方 pinned tarball SHA-256
→ pristine sandbox
→ candidate apply
→ regression gates
→ 本機 Ollama smoke
→ revert
→ pristine byte comparison
→ 第二輪 apply/revert
→ unknown/empty/wrong-version fail-closed
```

判定條件：

- active entries 以 `apply.sh --print-plan` 為準，不含 launcher：18.1.14=27、18.1.18=38、18.2.3=39、18.2.10=47、18.3.3=46。0073僅在18.3.3由上游實作接管。
- `.rej` 為 0；`.orig` 必須按既有 patch(1) 行為分類，不得混入生成的 patch。
- revert 後非工具殘留差異為 0。
- 第二輪樹雜湊一致，apply 冪等。
- smoke 只連 `127.0.0.1`；不因模型產生空回覆或 tool drift 就改動補丁。

## 3. DB 安全快照

### 3.1 正確時機

必須先停止 live omp，使 DB 與 sidecar 靜止；再做同一個停機窗口內的完整前後快照。

```text
停止 runtime
→ 記錄 agent.db/models.db 與 WAL/SHM inode、size、mtime、SHA-256
→ sqlite3 -readonly online backup 到新 sandbox
→ 只對 sandbox 執行 PRAGMA integrity_check
→ 再記錄來源 DB 與 WAL/SHM
→ 比對前後狀態
→ 記錄 credential metadata 基線
```

已用零 live omp process 的乾淨窗口驗證過（2026-08-30）：`sqlite3 -readonly … .backup` 這個動作本身就可能改動 WAL-mode 的 sidecar——`agent.db-shm` 內容被重寫（inode/size 不變，mtime/hash 變），先前沒有 `-wal`/`-shm` 的庫（例如 `models.db`）會被建出新的（`-wal` 為 0 位元組空檔）。這是 SQLite reader 驗證/重建 wal-index 的可能行為，但邊界快照本身不能證明因果。新版腳本以 `strace -e trace=%file` 保存 backup 檔案活動；只有 trace 涵蓋每個變動 sidecar 路徑才輸出 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，否則輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY`，sidecar 無差異則輸出 `PASS`。

### 3.2 Backup 命令

```sh
umask 077
D="$(mktemp -d "$HOME/omp-db-backup.XXXXXX")"
chmod 700 "$D"

sqlite3 -readonly "$HOME/.omp/agent/agent.db" \
  ".backup '$D/agent.db'"
sqlite3 -readonly "$HOME/.omp/agent/models.db" \
  ".backup '$D/models.db'"
chmod 600 "$D/agent.db" "$D/models.db"

sqlite3 -readonly "$D/agent.db" 'PRAGMA integrity_check;'
sqlite3 -readonly "$D/models.db" 'PRAGMA integrity_check;'
```

要求：source／target `realpath` 不同；target 不得是 symlink；不可複製 WAL/SHM。

### 3.3 Credential metadata

只記錄並比對：

- credential 類型。
- provider／account 識別欄位。
- expiration timestamp。

禁止輸出或複製：

- credential `data`。
- access token。
- refresh token。
- secret、API key。

若部署前沒有基線，部署後只能記錄「未驗證」，不能宣稱前後一致。

### 3.4 清理

完成後刪除所有含 DB 的 sandbox，包括：

```text
*.db
*.db-wal
*.db-shm
```

若需留審計，只留不含 DB 的 `.stat`、`.sha256` 或摘要紀錄；先確認目錄內沒有 credential-bearing 檔案。

## 4. channel agent 驗證

設定必須分開：

```yaml
provider: codex
model: gpt-5.6-sol
```

`provider` 是 channel adapter，只接受 `claude` 或 `codex`；完整模型由模型解析為：

```text
openai-codex/gpt-5.6-sol
```

不得寫成：

```text
gpt/gpt-5.6-sol:xhigh
```

工具沒有 dry-run 時，不得為了「測試」啟動真實 provider；改做 parser／schema 檢查，並記錄實際未執行。

## 5. Resume 後 cache miss 判讀

先讀取**當次會話的完整 JSONL 路徑**，不要使用工具輸出的截斷路徑。

按時間關聯：

```text
usage_limit_reached
→ auto-retry / credential recovery
→ provider、帳號或模型 fallback
→ input 很大且 cacheRead=0
```

判定：

- `cacheRead=0` 且 `cacheWrite>0`：首次建立前綴的 cold start，不足以判定回歸。
- provider／帳號／模型 fallback 後的大請求 `cacheRead=0`：fallback 是直接主因，因快取命名空間改變。
- 不能只因為 fallback 就嚴格排除 resume 同時造成其他前綴差異；要排除必須比較 payload。
- 不要拿較早會話的 usage 事件解釋最近一次 resume。

## 6. 更新後驗收

```sh
~/.bun/bin/omp --version
OMP_PATCH_VERSION=<部署版本> ~/.omp/patches/apply.sh --check
```

確認：

- 版本為預期版本。
- 部署版本的補丁全部為 `APPLIED`（層數同 §2，**`bin/omp` 狀態行另計**）：18.1.14 為 27 項，18.1.18 為 31 項。
- 版本選擇正確：18.1.14 換 `0004`、`0010`、`0014`、`0017`、`0030`、`0035`、`0038` 並追加 `0047`；18.1.18 再多換 `0033`、`0043`、排除 `0051`、追加 `0047`/`0055`/`0056`/`0058`/`0060`/`0062`。
- `bin/omp` 指向 patched `src/cli.ts`。
- live DB 與 credential 沒有被新版 sandbox 命令接觸。

## 7. 回退

回退前先停止 runtime。回退目標是 18.1.14（唯一留存的舊計畫）；18.0.9 及更早版本已不再受支援，其計畫與候選已退役至 `patches/.retired/09-13-dead-plans/`。

```sh
OMP_PATCH_VERSION=<部署版本> ~/.omp/patches/apply.sh --revert
bun add -g @oh-my-pi/pi-coding-agent@18.1.14
~/.omp/patches/apply.sh
```
回退後重新檢查版本、symlink、補丁狀態與 CLI smoke；不要把版本 candidates 套到不符的版本（18.1.14 candidates 只在 18.1.14 上；18.1.18 candidates 只在 18.1.18 上）。

## 8. 本次事故教訓

- 先完成部署才發現 credential metadata 沒有部署前基線，事後不能補證。
- 主 DB backup/integrity PASS 不等於 sidecar 前後 PASS。
- backup 後獨立 sidecar 觀測 PASS 不等於 backup 當下 sidecar 一致。
- 含 `auth_credentials` 的 DB backup 必須清理，不能當普通日誌保留。
- 已完成的 reviewer／sandbox 驗證不應重複派代理。
- 版本、provider、帳號切換事件必須先於 resume 歸因。
- 研究紀錄必須區分：補丁通過、DB integrity 通過、完整 safety acceptance 通過；三者不可混寫。
- sidecar「前後 byte-identical」在 backup 方法本身之下不可達成：2026-08-30 用零 live process 的乾淨窗口重跑一次，`agent.db-shm` 與先前不存在的 `models.db-wal`/`models.db-shm` 仍在 backup 當下改動／新建，可歸因於 backup 連線本身、非外部寫入；同一次窗口內 DB 本體與既有 `-wal` 維持 byte-identical、兩個 sandbox 副本 integrity_check 皆 `ok`。
