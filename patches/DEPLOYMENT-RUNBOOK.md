# omp 部署與更新 Runbook

## 目標

安全更新 omp、重套補丁、驗證回退，且不共用或破壞 `agent.db`、`models.db`、OAuth 憑證。

## 18.12.6 migration and installation (superseded by 18.16.0 on 2026-11-03)

The upgrade task targets exact18.12.6/commit `45c35e40c46166dc726ccc52f5d27f40f2449f99`. Installation was authorized by the user on 2026-10-23 after candidate acceptance: `prepare --version 18.12.6`, then the installed smoke `.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/smoke/run-sandbox-smoke.py --release <staged-release> --out <json>`, then `publish`. Unlike the18.10.1 in-place smoke, the18.12.6 release smoke checks the staged runtime/ledger digests against the receipt before and after, and executes byte-identical private copies, because its probes must live inside the runtime. It proves installed bytes, not installed-path permissions, bindings or launcher admission; those are covered by the receipt/launcher review and the post-publish blocked-launch observation. Release `18.12.6-87abd557af5b-693348fb-09428d79` became active on 2026-10-23 after old owners exited (`production_admission_started:true`); code-only rollback is now refused.

Selected acquisition uses the already-audited independent npm closure with a pinned package-lock (145instances,13OMPexact18.12.6,zero dependency errors/lock mismatches/external or hardlink aliases). Reusing the successful signature audit does not authorize new provider or credential checks. The retired target native recipe now lives at `patches/.retired/11-07-pre-18.16-plans/native/18.12.6/overlay.json`; the overlay argument is required (there is no default recipe), so pass it explicitly as the third build argument and as `verify-native-overlay.py --overlay`. Both target outputs already exist and have passed identity/hash checks; do not rebuild merely to recover context.

After source/ledger integration, run the target oracle and selected gates, actual private sandbox smoke, declaration consumer and applicable human-approved Tern/native checks. The sandbox entry point is `.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/smoke/run-sandbox-smoke.py --runtime <candidate> --ledger <repository-patches> --out <fresh-json>`; its harness runs every command in a loopback-only network namespace (`bwrap --unshare-net`), because native Anthropic's `node:https` transport bypasses fetch stubs. Repository/sandbox acceptance for candidate `87abd557af5b7c166dd3fadfc1bd68c5eb7cad641af41dac8424cfd7ca55a4bf` is complete (oracle, 57/57 gates in one run, smoke, OAuth controller controls, companions, physical native checks, Tern queue/steer/image/resume; `/compact` and parked-agent wake accepted via their gates by user decision). Synthetic `verify-release-publication.py --version 18.12.6` passes only its temporary HOME fault/admission fixture; it does not install or publish a real release.

## 18.18.6 + 0104 installation (published 2026-11-10; activates on next start)

Release `18.18.6-cf759d13f662-dbfc6005-4749ab1c` (candidate tree `cf759d13…`) adds `0104-omp-rollover-answered-request` to the 18.18.6 plan. Runtime: an ovnfs checkout of the previous release runtime with the 0104 files (new prompt file mode 0644 so the digest matches the candidate). Installed with `prepare` → installed-path smoke (same script, 6/6, receipt `/var/tmp/omp-0104/install-smoke-cf759d13.json`) → `verify-native-overlay.py` PASS → `verify-rollover-answered-request.ts` 11/11 on the installed runtime → `publish` (rollback target: release `18.18.6-2f8258e8a984-677bb127-9391d3a2`). Running sessions stay on the previous release; close them and their brokers, then start omp. Code-only rollback is allowed only before that first start.

## 18.18.6 installation (published 2026-11-10; activates on first start)

Release `18.18.6-2f8258e8a984-677bb127-9391d3a2` (candidate tree `2f8258e8…`) was installed with `prepare` → installed-path smoke (`.tasks/stage/11-09-omp-18186-upgrade/research/m8-smoke/run-sandbox-smoke.py --release <release>`, 6/6, receipt `.tasks/stage/11-09-omp-18186-upgrade/research/install-smoke-18.18.6.json`) → `verify-native-overlay.py` PASS → `publish`. The private runtime copy needed permissions normalized to 0644/0755 before its digest matched the candidate, and the rebuilt native pair was installed into it. No companion change was required. Before the first start: close every omp session and its broker, run `/var/tmp/omp-18186-install/backup-before-first-start.sh`, then start omp. After that start `production_admission_started` is true and a code-only rollback to 18.18.0 is refused.

## 18.18.0 installation (published 2026-11-08; activates on first start)

Release `18.18.0-f74e59923d16-3b2faede-9ac28b0e` (candidate tree `f74e5992…`) was installed with `prepare` → installed-path smoke (`.tasks/stage/11-07-omp-18180-implement/research/m8-smoke/run-sandbox-smoke.py --release <release>`, 6/6, receipt `.tasks/stage/11-07-omp-version-agnostic-gates/research/install-smoke-18.18.0.json`) → `verify-native-overlay.py` PASS → `publish`. The live `payload-archive.ts` companion was replaced first (apply-mode prerequisite). M9 physical Escape acceptance was skipped by the user as a one-release exception (`DECISIONS.md`, 2026-11-08). Before the first start: close every omp session and its broker, run `/var/tmp/omp-18180-install/backup-before-first-start.sh` (sqlite `.backup` of `agent.db` and `models.db` plus `integrity_check`), then start omp. After that start `production_admission_started` is true and a code-only rollback to 18.16.0 is refused.

## 18.16.0 installation (retired 2026-11-09; historical)

18.16.0 is no longer a registered release: `patches/.18.16.0-families/` and `patches/verify-extensions-load-18160.ts` now live under `patches/.retired/11-09-pre-18.18.6-plans/`, and any `OMP_PATCH_VERSION=18.16.0` invocation is refused (exit 2, "retired"). The facts below stay as installation history; the read-only chain queries point at the stable release, 18.18.0.

Exact `18.16.0` / commit `650f3a108229ee11bf68ba3377f4e8c3391cd424` was installed as release `18.16.0-35567dd8cf1a-d5545df9-9bf60a81` and was active from 2026-11-03 until 2026-11-08; the installed and active release today is `18.18.0-f74e59923d16-3b2faede-9ac28b0e` (`omp --version` → `omp/18.18.0 (installed; ready for a new process)`), so code-only rollback is decided against that release, not against 18.16.0. The 18.16.0 release directory stays on disk as a historical immutable release. It was installed with the same three-step `prepare` → installed-path smoke → `publish` sequence as 18.12.6 (`$TASK/research/m15-installed-smoke-18.16.0.json`).

Read-only chain queries (`patches/versions.json` is the only place a supported version is declared; the plan is the selected release's `.<version>-families/plan.tsv`). `TASK=.trellis/tasks/11-03-omp-18160-upgrade-plan` holds this upgrade's research scripts and receipts; the 18.18.0 receipts are in the archived 11-07 tasks:

```sh
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --print-plan           # 24 rows
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --print-capabilities   # 59 capabilities
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --print-gates          # 70 gates
OMP_PATCH_TGZ_CACHE=<archives> OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --verify-rollups
OMP_PATCH_VERSION=18.18.6 bash patches/apply.sh --print-plan           # 23 rows (repo candidate b261966f…, not installed)
```

`--check` is not acceptance — it peels the final tree. Acceptance is the zero-fuzz replay, reverse-to-pristine and an identical second replay against pinned archives (`$TASK/research/m9-oracle-18.16.0.json`, candidate tree `35567dd8…`, pristine `9f88de1a…`).

Gate batch: see "Running the gates" below (`patches/run-gates.py`, parallel, one offline bwrap per gate). Every controller-selected gate must be `PASS` and the runtime digest must be unchanged before and after (`$TASK/research/m10-full-batch-18.16.0.json` is the historical serial receipt). Freeze the ledger bytes first; a batch with a moving gate proves nothing.

Native overlay: the 18.16.0 recipe is `patches/.retired/11-09-pre-18.18.6-plans/native/18.16.0/overlay.json` (retired with the release in the 18.18.6 rotation; still one Rust patch, `cargo --release --locked`, both target CPUs). Build with `bash patches/native/build-natives.sh <work> <out> patches/.retired/11-09-pre-18.18.6-plans/native/18.16.0/overlay.json`, install both `.node` files into the runtime's `pi-natives-linux-x64/`, then `python3 patches/verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi --overlay patches/.retired/11-09-pre-18.18.6-plans/native/18.16.0/overlay.json` must PASS. Never overwrite the 18.12.6 recipe.

Smoke (repository/sandbox only, synthetic model, no provider proof):

```sh
python3 "$TASK/research/smoke/run-sandbox-smoke.py" --runtime <runtime> --ledger <repo>/patches --out <fresh-json>
```

It must be `PASS` with six checks at exit 0 plus four offline controls, digests equal before and after, and the exact-version check failing closed on an 18.16.1 tree (`$TASK/research/m11-smoke-18.16.0.json`).

Physical Tern acceptance and the live double `/compact snapcompact` ran on the staged release before `publish`, under a private HOME with a scripted offline model (`$TASK/research/m12-physical-18.16.0.md`, 9/9 PASS). A surface that needs no foreground control (window ambiguity, AT-SPI read, compaction) runs without a user step; only the approved acquire and physical Escape need the user.

## Running the gates (all releases; `patches/run-gates.py`)

`apply.sh` runs its regression suite through this runner, and upgrade/fix work uses the same command, so installs and acceptance evidence come from one code path. The gate list is never copied: it is `apply.sh --print-gates` for the runtime's version (the runner reads the version from the tree and refuses an unregistered one); each gate runs in its own `bwrap --unshare-net` with a private HOME/`/tmp`, a read-only host filesystem and the runtime mounted read-only (a gate registered `tree` in `apply.sh` gets a private copy instead), in parallel (`-j`, default CPUs/2). The source runtime is hashed before and after and must not change. Failure, timeout or a gate that did not run exits non-zero and the summary names the gate.

```sh
# Fix rounds: only the gates affected by the change (same capability -> gate mapping apply.sh uses)
python3 patches/run-gates.py --node-modules <runtime>/node_modules --companions <fixture> --capabilities 0090,0092
python3 patches/run-gates.py --node-modules <runtime>/node_modules --companions <fixture> --families family-compaction
python3 patches/run-gates.py --node-modules <runtime>/node_modules --gates verify-devin-wire,verify-tools-wire
python3 patches/run-gates.py --node-modules <runtime>/node_modules --capabilities 0090 --list     # show the selection only
# Final acceptance: the full menu, once (add --json <receipt>)
python3 patches/run-gates.py --node-modules <runtime>/node_modules --companions <fixture> --json <receipt>
```

Work on a copy of the candidate runtime, never on the live install; `--companions` is the staged companion fixture for `verify-extensions-load-<v>` (private copy, never the live `~/.omp/agent/extensions`). A capability selects every gate that verifies it — the gates registered with it as guard plus those listing it as `COVERS` in `apply.sh` (e.g. `--capabilities 0033` includes `verify-main-cache-hit`; `--families family-persistent-prefix-resume` includes `verify-interrupt-prune-symmetry`); `python3 patches/verify-gate-coverage.py` keeps that mapping equal to the capability → gate table of `PATCHES.md` §2, and `apply.sh` refuses a plan capability that has neither a gate nor an `_omp_no_gate` declaration. A subset skips gates that belong to no capability unless `--with-unscoped`; the full run covers them; an empty selector (`--gates ""`) is an error, never the full menu. During an upgrade the full batch runs once on the first assembled candidate and once as final acceptance (AGENTS.md "Gate runs"); a fix round, or a reviewer finding, reruns only the gates that cover the touched files. A new gate that writes into the runtime tree must be registered `tree` (otherwise it fails with `EROFS`). A real `apply.sh` validates everything the runner needs (`run-gates.py --validate-only`: bwrap, bun, runtime symlink policy, a writable output directory under `OMP_GATES_WORK_DIR`, default `/var/tmp`, menu and coverage) before the first patch lands, so a failure there leaves the tree untouched; SIGINT/SIGTERM kill the running gates and make the batch non-zero. The flag vocabulary, hazard classification and controls are in `.tasks/11-07-omp-version-agnostic-gates/research/contract.md` §5b.

## Immutable installation procedure (introduced with 18.10.1)

The sections below this procedure retain historical direct-global deployment and offline database guidance. Do not apply their `bun add -g`, global directory exchange, watcher or mutable-ledger commands to the current immutable release.

1. Pin official archives/commit, rebase the family registry and run the complete representation oracle. The baseline this procedure was written against (18.10.1) owned27physical families/61local capabilities plus upstream0017=62capabilities and179unique source/declaration/data paths;0097is excluded. Current totals belong to the release being installed, not to this paragraph: 18.12.6 is27families/62capabilities and the repository 18.16.0 candidate is26families/62capabilities (its own count of 71 controller-selected gates). Use `--print-plan`/`--print-capabilities`/`--print-gates` and the manifest as authority, and existing changed-consumer gates, not repeated broad suites.
2. Assemble the full dependency/native closure under private HOME/cache. All13 OMP packages must match the target version. Independent copies must have no external aliases or shared regular-file inodes. Never source pristine packages from the live Bun cache.
   Native overlay: rebuild with `bash patches/native/build-natives.sh <work> <out> patches/native/<version>/overlay.json` (the overlay argument is required), install both `.node` files into the runtime's `pi-natives-linux-x64/`, then `python3 patches/verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi --overlay patches/native/<version>/overlay.json` must PASS. A rebuilt hash differing from `overlay.json` means the recipe or toolchain drifted: record the new hashes only after re-running the live Escape checks.
   The current native overlay also bounds AT-SPI initialization to two seconds and accepts Chrome profile-decorated AX frame titles while retaining PID ownership and ambiguity rejection. For the 2026-10-15 AX-only release, the user explicitly accepted publication on completed automated/native/runtime evidence without repeating physical Escape validation; this is a one-release exception, documented in `DECISIONS.md`, not a passing physical check or a change to the general gate.
3. Prepare permanent code with:
   `python3 -I patches/publish-release.py prepare --version <version> --home "$HOME" --runtime <verified-private-runtime> --ledger <repository-patches>`.
   The receipt names the physical `~/.bun/install/omp-releases/<version-digests>` directory. Old global paths remain unchanged.
4. Against that installed physical runtime, run source `--version`, actual read-tool CLI, native IPC and gallery smoke under a freshly allowlisted private HOME/XDG/agent (`python3 patches/smoke/run-sandbox-smoke.py --release <physical-release> --out <json>`). Block fetch in the source CLI fixture. Run the bound ledger `--check` and native lifecycle gate. Collect the six results as `checks.version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog` with `exit:0`, plus the exact `release` and `status:"PASS"`. Re-run `verify-native-overlay.py` against the installed runtime.
5. Run `python3 -I patches/publish-release.py publish --release <physical-release> --smoke <installed-private-smoke.json>` only after final review. This serializes with first production admission, records old boot/PID/start-time identities, preserves the exact old launcher and ledger, and publishes launcher/ledger under a durable fail-closed receipt. A failed partial publication restores code pointers only.
6. Observe public `omp --version` and a blocked normal launch while old owners remain. The safe version wrapper reports installed code/admission, not actual source execution; step4 is the source proof. No production CLI/provider/usage request is needed.

Terminal installation receipt: `code_installation:"complete"`, `current_session_upgrade:false`, `production_activation:false`. Existing owners stay on their own immutable version paths. Close old sessions and detached brokers normally; a new `omp` starts the selected installed release only after the ownership gate clears. No watcher, auto-kill, force bypass or hot upgrade is installed. Replacing the public launcher can also make an old session's later worker respawn fail closed; it must not silently create a mixed-version worker.

The installed `ledger/.runtime-root` is an installer-owned physical binding. Bound `apply.sh` / `--revert` reject mutation; `--check` checks the release-local `bin/source-omp` and family state, not the public Python wrapper. Missing binding never falls back to the old global tree. Read-only plan/capability queries remain available.

Before any production source exec, the launcher durably sets `production_admission_started:true`. A code-only rollback is allowed **only before that flag**:
`python3 -I patches/publish-release.py rollback --release <physical-release>`.
After possible admission, older OAuth code cannot safely consume the new exchange journal; do not reset the receipt or restore old token state to bypass the barrier. Code backups retain the old global closure and ledger, never `~/.omp/agent`.

Synthetic rollback/admission proof:
`python3 -I patches/verify-release-publication.py --version <registered-version>`.
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
OMP_PATCH_VERSION=<supported-version> bash patches/apply.sh --print-plan
```

版本選擇規則：

```text
未設定 OMP_PATCH_VERSION       依 installed pi-coding-agent 版本自動路由（精確匹配，非就近 fallback）
OMP_PATCH_VERSION=<supported-version> 選擇同版本精確計畫；支援版本只在 patches/versions.json 登記（恰好兩版：現行穩定版與其接班版）
六個官方套件版本                  必須全等於所選版本；層數由 selected resolved plan 決定
其他值／已退役或未登記的版本／顯式值與安裝版不符      exit 2，禁止猜測套用
```

Upgrade procedure: add the new release to `patches/versions.json` (appended, ascending) together with its `.<version>-families/` directory (`plan.tsv`, `manifest.json`, `approvals.json`, patches), and drop the oldest release from the registry in the same change; the dropped release's plan directory moves under `.retired/`. The registry always holds exactly two versions; `apply.sh` and every gate fail closed on anything else. `apply.sh` refuses a manifest whose `upstream_adoptions` differ from `approvals.json`, and an `approvals.json` whose `snapshot` is not strictly older than the release (the newest registered release must derive from the oldest registered one; the oldest from a frozen manifest under `.retired/`). After the change run `python3 patches/verify-no-version-literals.py` and follow its `note:` lines: each note judges one `since` term only (an always-true term is dropped while every other predicate in the condition stays, e.g. `omp_since V X && [[ "$MODE" == "apply" ]]` becomes `[[ "$MODE" == "apply" ]]`; an always-false term means its arm is dead: delete it and retire the gate it alone selected). Always consume `apply.sh --print-plan`, never a glob of patch files.

`OMP_PATCH_PLAN` accepts only `deployed` (also the default). `repository` fails closed: the 0097 computeruse overlay retired together with its 18.7.0 plan (see `.retired/11-07-pre-18.16-plans/`). Other selector values fail closed too.

Same-family maintenance archives the previous immutable revision and replaces the active family revision rather than appending a repair layer. Keep historical rollback bytes unchanged. The 0090 unlock revision (2026-10-13) followed exactly that path: `.retired/10-13-18.10.1-0090-pre-unlock/` holds the superseded `0090-omp-oauth-durable-refresh-v18.10.1.patch` with its pinned hash, `baseline.json` and `unlock-api.delta.patch`; `verify-release-family-plan.py` fails if that archive drifts or if the retired bytes are still the active representation. The 2026-10-15 Anthropic-only scope revision followed the same path again: `.retired/10-15-18.10.1-0090-pre-anthropic/` holds the superseded `cb5bbf9c…` bytes with `baseline.json` and `anthropic-scope.delta.patch`, the active family is `32eac750…` (candidate tree `2fc569d9…`), and plan rows, archives pins, `upstream_adoptions` and `pristine_tree_sha256` are unchanged. The installed 18.10.1 release carries the 2026-10-13 unlock revision (`7b7b41c2…`); the scope revision ships only with the next release, so the running installation still journals every provider.

Historical next-update baselines (the 18.7.0, 18.10.x and 18.12.6 family registries, the non-family `PATCHES` chain and the 0097 native overlay) were retired on 2026-11-07 into `.retired/11-07-pre-18.16-plans/`; only the two registered releases are applied or verified. Port each capability against official upstream bytes; 0097 remains excluded.

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

## 6. 更新後驗收（歷史 direct-global 18.1.x 流程；當前 immutable release 見文首安裝程序）

```sh
~/.bun/bin/omp --version
OMP_PATCH_VERSION=<部署版本> ~/.omp/patches/apply.sh --check
```

確認：

- 版本為預期版本。
- 部署版本的補丁全部為 `APPLIED`（層數同 §2，**`bin/omp` 狀態行另計**）：下列歷史層數只適用於各自的 direct-global 計畫——18.1.14 為 27 項、18.1.18 為 31 項；18.12.6 的 bound `--check` 為 28 行（27 補丁 + `bin`），18.16.0 計畫為 26 層。任何層數一律以 `--print-plan` 為準，不以本文數字推算。
- 版本選擇正確：18.1.14 換 `0004`、`0010`、`0014`、`0017`、`0030`、`0035`、`0038` 並追加 `0047`；18.1.18 再多換 `0033`、`0043`、排除 `0051`、追加 `0047`/`0055`/`0056`/`0058`/`0060`/`0062`。
- `bin/omp` 指向 patched `src/cli.ts`。
- live DB 與 credential 沒有被新版 sandbox 命令接觸。

## 7. 回退（歷史 direct-global 流程）

本節的 `bun add -g` 流程只適用於 historical direct-global 安裝。當前 immutable installation 為 18.18.0（release `18.18.0-f74e59923d16-3b2faede-9ac28b0e`，2026-11-08 publish），因此 code-only rollback（`publish-release.py rollback --release <physical-release>`）已被拒絕；18.16.0（已於 2026-11-09 隨版本輪替退役，計畫移至 `patches/.retired/11-09-pre-18.18.6-plans/`）與 18.12.6 的凍結 release 僅作歷史保存。18.0.9 及更早版本已不再受支援，其計畫與候選已退役至 `patches/.retired/09-13-dead-plans/`。

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
