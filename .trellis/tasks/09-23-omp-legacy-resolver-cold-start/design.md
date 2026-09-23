# Design — legacy resolver and cold startup

## Boundary and invariant

本任務改的是 OMP 相容解析層與相應補丁／驗證，不是 Bun 二進位。`resolveLegacyPiSpecifier()` 將 canonical 與歷史 scope 映射到 host；`resolveCanonicalPiSpecifier()` 優先選 root override，否則使用 `Bun.resolveSync()`。插件攔截 canonical 自身，因此 resolver callback 內再次解析同一 specifier 可重入；Bun 同步插件返回值還可能留下 `file:` namespace 前綴。

已知位置（18.2.10，下一會話以當時行號重新定位）：
- `src/extensibility/plugins/legacy-pi-compat.ts:768-774`：filesystem／bundled namespace 返回值。
- `:837-865`：filter、解析快取與 invalidator。
- `:943-1053`：source／bundled root override 初始化。
- `:1057-1106`：alias/subpath remap、Bun resolve、import URL 轉換。
- `:2652-2680`：主 resolver callback，host 與 importer fallback。
- `:2686-2734`：Bun plugin 註冊及 virtual namespace callbacks。

必須維持：legacy plugins 使用 host module identity；不能讓 importer 的另一份 pi-* 套件取代 host，亦不能把 bundled virtual specifier 當磁碟路徑。

## Proposed investigation, not an approved implementation

1. 在官方 pristine + 完整補丁鏈的依賴齊全沙箱重現 package require，將 callback 重入與 namespace 返回錯誤分開。
2. 對照 Bun 的 resolver 返回合同及既有 loader 流程，優先尋找不經自身攔截的合法解析方式；僅在能證明保持 host identity／override 語義時，考慮將不需 remap 的 canonical 交回原生 resolver。
3. 若採用 reentrancy bookkeeping，必須涵蓋 importer fallback、例外釋放、快取與多次載入；但 bookkeeping 本身不是完整修復。
4. 根因確定後只修改必要邊界，不建立第二套 package export resolver，不做字串剝前綴的無證據補丁。

## Rejected approaches and constraints

- 已否決：只有 `Set` 重入鎖。實測把 NameTooLong 改成 `file:/tmp/...` ENOENT；不是成功。
- 已否決：僅修改 `namespace: "file"` 或空 namespace。最小 Bun 1.3.14 實驗仍不能完成同步載入。
- 不接受：每發現一個入口就新增靜態 import 作為通用解析器的完成證據。
- 不接受：取消 canonical 攔截但忽略 root overrides／host identity；這會引入不同類的插件狀態分裂。
- 不接受：catch 後回傳空模組、關閉插件、降低能力或以舊進程快取解釋新進程的確定復現。

## Two independent verification layers

### Resolver layer

精確復現（環境由隔離 runner 提供，root 必須明確）：

```ts
import { createRequire } from "node:module";
const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!root) throw new Error("Select an isolated pi-coding-agent root");
const { installLegacyPiSpecifierShim } = await import(`${root}/src/extensibility/plugins/legacy-pi-compat.ts`);
installLegacyPiSpecifierShim();
const require = createRequire(`${root}/src/cli.ts`);
const { ModelHubComponent } = require("@oh-my-pi/pi-tui/overlays/model-hub.js");
if (typeof ModelHubComponent !== "function") throw new Error("Missing model hub");
```

已部署的選單修復不會讓這個測試變綠；這是本任務真正要消除的剩餘故障。

### Startup/UI layer

永久 gate 的實際順序應是 `shim import → shim install → controller import → menu invocation`。各首次載入情境使用 fresh child process，不能先 import overlay 再聲稱冷載入。保留實際 render／Esc／focus assertions；不新增只檢查源碼字串、空 mock 或 import graph 的替代門。

## Patch compatibility and rollout

- 0072 現有靜態 UI imports 預設保留。只有根因修復和行為證據證明其不再需要，才考慮同一候選中的最小刪減；不可先撤銷已部署且有效的止血。
- 原位修改既有 18.2.10 候選優先；不可改舊版 patch bytes，也不可手改 hunk 計數。
- 官方 pristine 生成 → 完整選定鏈重放 → 反向還原 → 目標比對 → 隔離實測 → 備份 → atomic replace → ledger cmp。
- Live source 與 Bun cache 可能 hard-linked；僅從獨立產物部署到新 inode。
- 前次選單部署備份及 hash 位於 `../09-23-omp-model-selector-resolver-crash/research/deployment.json`。本任務如部署，必須另建新備份，不能直接使用前次備份回退，否則會撤掉已生效的選單修復。

## Known limits

正式 ESM browser 入口通過；強制 CJS require 整個 browser.ts 的 default-export 錯誤不是本任務的已確認產品問題。模組載入驗證也不等於 browser/computer 所有操作皆已端到端測試。無需為此擴大範圍。
