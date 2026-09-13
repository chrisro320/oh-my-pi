# 補丁鏈分析（2026-09-13，merge wave 2 前置研究）

## 口徑

| 口徑 | 18.1.18 計畫 | 備註 |
|---|---|---|
| HEAD（已提交） | 30 補丁＋bin | 鏈尾 `0047 0055 0056 0058 0059`，0059 檔案尚在 |
| 工作樹（未提交，9 變更） | **31 補丁＋bin = 32 行** | 刪 0059、加 0060/0062、apply.sh +28/−3、PATCHES.md +0062 條目 |
| live node_modules | 與工作樹一致 | `OMP_PATCH_VERSION=18.1.18 apply.sh --check` 實測 31 全 APPLIED / 0 CONFLICT |

base `PATCHES` 陣列 28 項；18.1.18 計畫 = 28 − omit:0019/0042/0051 + 鏈尾 0047/0055/0056/0058/0060/0062。

## 補丁→檔案矩陣（多補丁共觸檔）

| 檔案 | 補丁 |
|---|---|
| `snapcompact/src/snapcompact.ts` | 0036(NM)、0044、0052、0057 |
| `status-line/component.ts` | 0037、0041 |
| `status-line/segments.ts` | 0033、0004 |
| `session-maintenance.ts` | 0035(NM)、0036(NM)、0045、0046、0062 |
| `session-advisors.ts` | 0035(NM)、0048 |
| `agent-session.ts` | 0010、0031、0042、0035(NM)、0060(NM) |
| `sdk.ts` | 0032、0038(NM)、0042、0047 |
| `google-gemini-cli.ts` (pi-ai) | 0014、0054 |
| `auth-storage.ts` (pi-ai) | 0026、0030 |
| `devin.ts` (pi-ai) | 0055、0058 |
| `openai-responses.ts` (pi-ai) | 0017、0038(NM) |
| `types.ts` (pi-ai) | 0038(NM)、0060(NM) |

## 負載順序（全部已滿足，重排無收益）

- 0037 < 0041（0041 改寫 0037 引入的常量行）
- 0044 < 0052（0052 hunk3 下文依賴 0044 新增家族鍵行，文件明記「順序不可換」）
- 0019 < 0042；0026 < 0030；0035/0036 < 0045/0046/0062
- 18.1.18 鏈尾：candidate-0038 < 0047；0055 < 0058；0058/0060 < 0062

## 合併判定

### 可併（本批範圍）

- **A：0044+0052+0057 → 併入 0036 族**。三者全在 base 計畫、全觸 `snapcompact.ts`、無版本候選。消掉 0044→0052 硬順序地雷。族鏈 = {0015s,0015a,0020s,0020a,0022,0044,0052,0057}。
- **B：0041 → 併入 0037 族**。0041 是 0037 常量的單行改值（180s→60s），此重疊即兩階段 chain-status 的原始動機。族鏈 = {0005,0007,0029,0041}。
- **C：0045+0046 → 新補丁 0063**。同觸 `session-maintenance.ts`、相鄰、同屬「不誤判/不誤改暖前綴」族。**不可**用 pristine→live 全檔 diff 生成（spec Bad case：會烘入 0035/0036 的改動）——用反向剝離法：全鏈樹反套 0046、0045 得 t_a，`diff(t_a, live)` 即新補丁，位置佔 0045 原槽。

### 技術上可併但緩

- 0055+0058（同檔 devin.ts、0058 a 側即 post-0055）：devin.ts 上游高變動且落地不到兩天，等活過一次版本 bump。
- 0014+0054：0014 有 18.1.14/18.1.18 候選，合併需重生成全部候選。
- 0026+0030：0030 有 5 份版本候選，同上。
- 0019+0042：可併但 ≥18.1.10 已 omit，僅整容 base 計畫。

### 不可併

- 0047↔0038（a 側是 candidate-0038 產出形態，base 計畫無 0047）
- 0062↔0045/0046（0062 是 18.1.18-only，併入 base 補丁會讓 base 失去 0045/0046）
- 0051↔0025（0051 在 18.1.18 被 omit，生命週期不同）
- 0056/0060 入 devin 包（不同檔案、文件明記可獨立套用；穩定檔不綁高變動檔）
- 任何東西入 0010/0035/0038（候選最多的核心層）

## 沙盒/備份要點（advisory 已核）

- ~~bun cache 有全部版本 pristine~~ **已證偽**：`pi-ai@18.1.14` 的 ollama.ts sha256 是官方 18.1.18 值（`a33bd136…`，非 18.1.14 的 `48c9c661…`）、`pi-coding-agent@18.1.14` 的 session-selector.ts 已含 0050 產出；verify-rollups:13-16 亦載 cache 與 live 共享 inode、曾被就地寫穿（auth-storage.ts 帶 0026-core）。**沙盒一律官方 tarball＋SHA-256 pin（npm pack→registry fallback），禁用 cache**
- 已抓取並驗證的官方 tarball（/tmp/official-tgz/）：18.0.9 四包對 verify-rollups pinned SHA-256 全合；18.1.14/18.1.18 各五包 sha256 已記錄待 pin 進沙盒腳本
2. §0 狀態表：「APPLIED 29 行」→ 實為 **32 行**（合併後 27 行）
3. §2 0059 條目：檔案已刪，應標撤回或移 §3
4. §5 18.1.18 節：`PATCHES+=(0047 0055 0056)` 漏 0058/0060/0062
5. §6.1 閘門數：已隨工作樹改為 12 道 ✓（無需再動）

## 沙盒/備份要點（advisory 已核）

- bun cache 有全部版本 pristine：18.0.9/18.0.11/18.1.2/18.1.5/18.1.10/18.1.14/18.1.16/18.1.18/18.1.19（四包齊）
- 0060/0062 `.patch` 與兩個新 `verify-*.ts` 是 **untracked**——`git stash`/`git diff` 備份會漏，必須 `cp -a`/`tar` 或先 `git add -A` 提交
- 沙盒 `--check` 尾行 `bin/omp -> src/cli.ts` 在假 HOME 下必假失敗：沙盒內需預建 `$HOME/.bun/bin/omp` symlink，或把該行視為預期噪音，不得以退出碼當唯一閘
- 備份須含 live 已套用樹：`~/.bun/install/global/node_modules/@oh-my-pi/` 六包 tarball + `bin/omp` symlink 指向（dist/cli.js 是 stock，回不去已套用態）
- 0012/0016 非孤兒：repo `.omp/extensions/trellis/index.ts` 已帶 anchor 實作（:502/:520/:526），是已套用產出的存檔；僅需在 PATCHES.md 標「不進 apply.sh」
