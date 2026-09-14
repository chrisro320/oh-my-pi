# 補丁鏈分析（2026-09-13，merge wave 2 前置研究）

> 前段是 Phase A 前的歷史調查，層數／合併候選不可直接當現況。以本文末尾「A2 審計定案」及 prd.md 的當前範圍為準。

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

## 歷史備份備註（cache pristine 說法已撤回）

- bun cache 曾列出多個版本，但目錄存在不代表 pristine；內容污染已實證，禁止以它生成或驗收補丁（見前節）。
- 0060/0062 `.patch` 與兩個新 `verify-*.ts` 是 **untracked**——`git stash`/`git diff` 備份會漏，必須 `cp -a`/`tar` 或先 `git add -A` 提交
- 沙盒 `--check` 尾行 `bin/omp -> src/cli.ts` 在假 HOME 下必假失敗：沙盒內需預建 `$HOME/.bun/bin/omp` symlink，或把該行視為預期噪音，不得以退出碼當唯一閘
- 備份須含 live 已套用樹：`~/.bun/install/global/node_modules/@oh-my-pi/` 六包 tarball + `bin/omp` symlink 指向（dist/cli.js 是 stock，回不去已套用態）
- 0012/0016 非孤兒：repo `.omp/extensions/trellis/index.ts` 已帶 anchor 實作（:502/:520/:526），是已套用產出的存檔；僅需在 PATCHES.md 標「不進 apply.sh」

## A2 審計定案（2026-09-13）

### 可重現證據

- live 31 patch＋bin=32 APPLIED；repo/ledger `diff -rq` 零輸出；現役 14 個離線 gate 與 4 個補充 gate 都 exit 0，未呼叫 provider。
- 官方 18.1.18 五包先比 registry SHA-512 integrity，再零 fuzz 正套 31 層；2,354 個 src 檔與 live 相同，反套後 4,106 個套件檔回 pristine、無 orig/rej。18.0.9 五族、18.1.14 27 層逆剝、gate #10/#11/#12 與 `--selftest` 通過。自建審計沙盒已刪，不依賴易失路徑作 fixture。
- controller 負對照：未改鏡像 32 APPLIED/exit 0；破壞 statusline 源碼後 2 CONFLICT 仍 exit 0；移除 sandbox bin 後 PENDING/exit 0。後者保留為有效查詢，前者須修。位置 `patches/apply.sh:452-458,499-510`。
- 0043 負對照：實際 `convertToLlm([user, assistant aborted/error with toolCall, toolResult, user])` 留下中間 toolResult，`buildSessionContext` 重建只剩兩個 user；正常 toolUse 對照一致。placeholder 的真實生產點在 `pi-agent-core/src/agent-loop.ts:1318-1342`。既有 gate 的 aborted fixture 無 toolCall，故它的綠燈漏掉此缺口。
- 隔離負對照：antigravity-envelope、provider-image-budget、devin-auth-cache 指定 ROOT 到未打補丁的官方 18.1.18 樹仍 exit 0，因 runtime import 硬編 live 路徑。
- spec 回聲負對照：隔離副本不改→0；只把 reprice assertion 的診斷文字換字→1；把整個 reprice 腳本改成只有訊息字串＋RECORDED_BOUNDARY＋nextCompactionAfter 的註解、無執行斷言→0。刪除目標是 `verify-spec-contracts.sh:79-92` 的回聲，不是整支腳本。

### 延後、保留與撤回

- 兩版 patched package 與 active extensions 均無 `providerOnly` producer；0038／0047 的型別、consumer 與 legacy-tail 測試應成組清理，不能只刪 pi-ai 型別。這是源碼行為面清理，留到 A2 後，不與 gate 修復混批。
- 大幀條件風險已量到：`resolveShape({api:"openai-responses",id:"gpt-5.6-sol"},"5x8-bw")` 給 2576px／7874 tokens，超過 FRAME_TOKEN_ESTIMATE=5024；尚未實測 provider overflow。另行處理 window-fit 與 frame-cap 的共同契約，不只改註解消音。
- 0026 override 風險已量到：in-memory AuthStorage override 回兩家 report，`providers:["anthropic"]` 乃至 `providers:[]` 仍回兩家。只聲稱 override 路徑缺口，不聲稱本機使用 broker；此次不動 remote API。
- 0037 消費 turn key／不強制重繪屬既定 event-only idle-silence 政策；不加延遲重刷。0036 平面 cap=17 對 default shape cap=150 的 rescue 差異已在 PATCHES.md:190 明記「未修，有意」，不是新缺陷。
- 0062 double-baseline 推測撤回：`session-maintenance.ts:2113-2117` 唯一 preparedContextTokens 生產者同時提供 triggerContextTokens，原推論分支在現有呼叫者不可達。0017 自動 400 retry 亦無實證，不藉審查增加 fallback。
- 0051 在官方 18.1.18 已逐字吸收、18.1.14 尚未吸收；維持計畫限定 omit。retired SHA-256／歷史族等價仍有價值。
- Reviewer 對 Phase B 家族邊界提出重切建議，但未採為已定方案；A2 後再核定，不把文件同檔當成合併充分理由。

### 18.1.18 官方 tarball SHA-256

| package | SHA-256 |
|---|---|
| pi-coding-agent | `edb4fec4544c28e709923e6ae4861dcd3aa546228acb4e7d10790a7e80c7b02b` |
| pi-agent-core | `69d5e67817cc37553a617fe3bcae71d6e9b779571b7f7731d9394fcb77b2a949` |
| pi-ai | `4dc5d99a9e72c35673dd9ddfb6b5cf47750070d91bd0970971e1ac594ba31eba` |
| snapcompact | `cefe90e55a6555a2146ef207da17db8a6621f702dd9fc4335df4ed9dd319fb9c` |
| pi-catalog | `e025273930d23468e5d682a8bba6f6c2720c7d97880cc55ba9e6cb9b61728dd1` |

### 頂層 23 個 TS verifier 機械分類（不是全量行為驗收）

以 `glob patches/verify-*.ts` 得到的頂層清單為準；grep 的同名 glob 會意外涵蓋 `.retired/`，已排除該噪音。逐項檢查 runtime import、source read 及 root env；type-only import 不當作執行。下表「舊版負對照」只指本次審計實際跑過的命令，未跑的不寫已通過。

| verify-*.ts（省略共同前後綴） | apply suite | 根解析現況／證據行 | 舊版負對照／A2 處置 |
|---|---|---|---|
| antigravity-envelope | 是 | live AI import:2 | pristine ROOT 仍 0，已實證；遷移 |
| prefix-cache-compaction | 是 | live CATALOG/CORE/AI/AGENT imports:4-21；source reads:413-419 | 未跑 pristine 負對照；遷移 |
| provider-image-budget | 是 | live SNAP/AGENT imports:17-18 | pristine ROOT 仍 0，已實證；遷移 |
| snapcompact-model-billing | 是 | SNAP_ROOT read:66／import:113 一致；:111 是 type-only | 同根現況已核；須納入負對照矩陣 |
| devin-auth-cache | 是，18.1.18 | live AI import:3；catalog 裸包 imports:4-9 | pristine ROOT 仍 0，已實證；遷移 |
| hindsight-recall-snapshot | 是 | live AGENT import:3-6／source:10-11 | 未跑 pristine 負對照；遷移 |
| interrupt-prune-symmetry | 是 | AGENT_ROOT imports:24-25／reads:149,155 一致 | tool-call abort 缺口已重現；修 fixture 與行為 |
| devin-metadata | 是，18.1.18 | CATALOG root:12／imports:17-19 一致 | 同根現況已核；須納入負對照矩陣 |
| supersede-warm-prefix-guard | 是 | NM/AGENT/CORE roots:24-26；CORE imports:33-36／AGENT read:164 | 同根現況已核；須納入負對照矩陣 |
| devin-thinking-signature | 是，18.1.18 | live AI import:3；catalog 裸包 imports:4-9 | 未跑 pristine 負對照；遷移 |
| devin-idle-cascade-pin | 是，18.1.18 | live AI/AGENT imports:8-13 | 未跑 pristine 負對照；遷移 |
| snapcompact-reduction-baseline | 是，18.1.18 | AGENT_ROOT read:31，但 live SNAP 常數 import:27 | 混合樹；遷移，不改 0062 算式 |
| resume-cache-breakpoint | 是 | repo extension import:15；optional live dump:17，synthetic fallback:146-152 | 不因 pristine package 要求紅；驗 extension slot 契約、無 private dump 亦須可跑 |
| date-cwd-anchor-stability | 否 | agentRoot read:31-32／dynamic module import，同根 | 補充閘已跑綠；A2 不遷移 |
| goal-tool-resident | 否 | OMP_AGENT_SRC／HOME 根:21-22，只有 source read | 補充閘已跑綠；A2 不遷移 |
| ollama-cloud-usage | 否 | HOME-derived AI import/read:19-23 同根，無 package override | 補充閘已跑綠；A2 不遷移 |
| idle-ephemeral-reservation | 否 | live AI/AGENT imports:3-9 | 補充閘已跑綠；A2 不遷移 |
| session-history-preview | 否 | live AGENT imports:1-3；private session fixture:15 | 未跑；非可移植 suite，A2 不遷移 |
| snapcompact-frame-budget | 否 | live SNAP import:2；session argv:10；無 assertion | 診斷輸出，不冒充 gate；A2 不遷移 |
| snapcompact-frame-reprice | 否 | AGENT_ROOT source:48；live SNAP/CORE imports:23-25；session argv | 混合樹＋特定 fixture；A2 只移除別支脚本對它的文字回聲，不宣稱已修其隔離 |
| auto-continue | 否 | repo extension import:2 | extension fixture，不以 pristine package 作負對照；A2 不改 |
| cache-prefix-audit | 否 | repo extension import:27；環境先隔離:18-26 | extension fixture，不以 pristine package 作負對照；A2 不改 |
| session-cache-keepalive | 否 | repo cron extension import:122；fake timers | extension fixture，不以 pristine package 作負對照；A2 不改 |

`verify-spec-contracts.sh` 是第 14 道現役閘，混合了 meta／結構檢查（:34-93,130-154）與 0052 billing source 形狀（:95-128）。不能給整支腳本套「pristine 應綠」或「應紅」的單一歸因；其回聲負對照已重現，其他根檢查要覆蓋現役 AGENT／CORE／AI／SNAPCOMPACT／CATALOG／NM，而非只看一個 env 名。`verify-patch-family-rollups.sh` 不在 14 道尾部 suite，獨立驗證五族及控制器；保留真正等價與反套證據。
