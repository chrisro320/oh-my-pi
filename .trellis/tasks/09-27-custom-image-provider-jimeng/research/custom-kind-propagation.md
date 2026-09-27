# CustomImageKindPath (scout report, 2026-09-27)

## Q1 models.yml 的 `api` 白名單

- 定義處：`pi-coding-agent/src/config/models-config-schema-bundle.ts:105-107`：
  `const ApiSchema = type('"openai-completions" | "openai-responses" | ... | "openrouter-decisions" | "typesafe"')`。
  這是**硬編碼字串聯集**，不是從 `KNOWN_APIS`/`RUNNER_APIS`/pi-catalog `Api` 推導。
- 使用點：model 級 `api?` L194（`ModelDefinitionSchema` 起於 L191）；provider 級 `api?` L322（`ProviderConfigSchema` 起於 L319）；另有 `RemoteCompactionSchema.api` L165。
- pi-catalog 端 `Api = KnownApi | (string & {})`（`pi-catalog/src/types.ts:25`），且 `RUNNER_APIS` 已含 `"openai-images"`、`"openrouter-images"`（`types.ts:48-61`）。因此型別層不需改，只有 schema 白名單擋住。
- **最小改動**：在 ApiSchema 白名單加入 `"openai-images"`。`"openrouter-images"` 建議一併加入（image-gen 的 `isImageGenerationApi` 認 `openai-images | openrouter-images | google-generative-ai | google-gemini-cli | openai-responses | openai-codex-responses`，見 `pi-ai/src/images/index.ts:18-33`），成本零、語意一致；但對 jimeng 本地代理非必需。
- 其他 api 驗證：`models-config.ts:37-108 validateProviderConfiguration`：
  - provider 定義了 models 時**只要求** `baseUrl`（L67-69）與 `apiKey`（除非 `auth: none|oauth`，L70-80）；
  - 逐模型只要求「provider 級或 model 級有 api」（L84-91）、`id` 非空（L92-94）；
  - `contextWindow`/`maxTokens` 僅在提供時驗證 `> 0`（L98-103）——**不要求**存在，也**不要求**任何 chat-only 欄位；
  - discovery 開啟時才要求 provider 級 `api`（L83-85）。
  → 一個只有 `id/api: openai-images/baseUrl` 的 image-only 模型可通過。驗證掛載點在 `models-config.ts:111-131`（`ModelsConfigFile.withValidation`）。

## Q2 kind 現況

- `pi-catalog/src/types.ts:28-40`：`MODEL_KINDS = ["chat","tiny","image","tts","stt","search","judge","embedding","rerank","video"]`；`ModelKind`（L41）；`KIND_API_KINDS = ["image","tts","stt","embedding","rerank","video"]`（L43）。
- `Model.kind?: ModelKind`（`types.ts:1194`）；`modelKind(model) { return model.kind ?? "chat" }`（`types.ts:64-66`）。
- `ModelSpec`（`types.ts:1425-1440`）extends `Omit<Model, 'compat'|'identity'|'compatConfig'|...>`，**未 omit `kind`** → ModelSpec 帶 `kind`。
- `buildModel` 會 `const model = { ...spec, ... }`（`pi-catalog/src/build.ts`，見 ~L300 起）→ spec.kind 會直接落到 model；之後 `applyCatalogAssignments(model, policy.catalog)`（`build.ts:76-78`）只有在 catalog 有合法 `kind` 時才覆寫。
- **沒有** kind 的地方：
  - `ModelPatch`（`config/model-patch.ts:234-257`）——無 `kind`；`applyModelPatch`（L267-）逐欄 patch，也不處理 kind。
  - `ModelOverrideSchema`（`models-config-schema-bundle.ts:247-`）——無 `kind`；`ModelOverride = typeof ModelOverrideSchema.infer`（`models-config-schema.ts:11`）。
  - `CustomModelDefinitionLike`（`custom-models.ts:14-18`）與 `CustomModelOverlay`（L25-32）皆 extends ModelPatch，故也無 kind。
- 唯一寫入 kind 的路徑是 catalog 規則（`pi-catalog/src/compat/rules/providers/*.kdl` 的 `kind "image"`），經 `applyCatalogAssignments`。

## Q3 kind 的完整傳遞路徑與斷點

models.yml custom provider model 路徑：
1. schema 窄化 `models-config-schema-bundle.ts`（L191 ModelDefinitionSchema / L247 ModelOverrideSchema）→ 目前**不認** kind（also 不認 model 級 api 的 image 值）。
2. `ModelRegistry.#parseModels`（`model-registry.ts:2496-2527`）把 `modelDef as CustomModelDefinitionLike` 傳入 `buildCustomModelOverlay`。
3. `buildCustomModelOverlay`（`custom-models.ts:65-107`）**手動重建** overlay 物件（L80-106），未複製 kind → 斷點。
4. `finalizeCustomModel`（`custom-models.ts:114-158`）以**手動列舉欄位**呼叫 `buildModel`（L127-156），未傳 kind → 斷點。
5. `buildModel`（`pi-catalog/src/build.ts` ~L300）`{...spec}` → 若 spec 有 kind 即成立；`applyCatalogAssignments`（L76-78）僅在 catalog 有 kind 時覆寫。→ **不需改**。
6. `#mergeCustomModels`（`model-registry.ts:1092-1114`）：同 `provider+id` 命中既有（尤其 bundled）模型時走 `applyModelPatch(base, customModel, "replace")`；此處的 patch 型別是 `CustomModelOverlay`（extends ModelPatch），若 ModelPatch 無 kind，即使 overlay 帶 kind 也不會被套用 → 斷點。
7. `modelOverrides` 路徑 `#applyModelOverrides` → `applyModelOverride`(=`applyModelPatch(...,'merge')`)（`model-patch.ts:267-`, `328-330`）→ 若要讓 override 也能改 kind，需在 ModelPatch/applyModelPatch 加 kind。

**結論：必須補 kind 的位置**（全部）：
- `models-config-schema-bundle.ts`：ApiSchema（L105-107）、`ModelDefinitionSchema`（L191-）、`ModelOverrideSchema`（L247-）。
- `model-patch.ts`：`ModelPatch`（L234-257）加 `kind?: ModelKind`；`applyModelPatch`（L267-）加 `if (patch.kind !== undefined) result.kind = patch.kind;`（放在 buildModel 之前，並注意 `buildModel` 後 catalog 若無 kind 即保留）。
- `custom-models.ts`：`buildCustomModelOverlay`（L80-106）複製 `kind: modelDef.kind`；`finalizeCustomModel`（L127-156）傳 `kind: resolvedModel.kind`。
- （可選）`CustomModelOverlay`/`CustomModelDefinitionLike` 已透過 extends ModelPatch 取得 kind，無需另改。

## Q4 apiKey 解析與 image-gen 憑證

- `#installProviderApiKey`（`model-registry.ts:392-397`）：`authStorage.keys.setConfig(provider, keyConfig)`；constructor 設 `authStorage.keys.setResolver(resolveConfigValue)`（L436）。
- `resolveConfigValue`（`resolve-config-value.ts:105-110`）：`!cmd` → 執行命令（L46-103）；否則 `$envExact(value)` 命中就當環境變數，否則視為**字面值**。→ `apiKey: SOME_ENV_VAR`、字面 token、`!command` 三者皆支援。
- 可用性：`#createProviderAvailabilityCheck`（`model-registry.ts:2568-2586`）判斷 `keylessProviders.has || keys.source(provider)!==undefined || keys.keyless`；`setConfig` 會讓 `keys.source` 有值 → 自訂 provider 只要聲明 apiKey（或 auth: none）即為 available。`getAvailable`（L2622-2624）用它。
- `getApiKey(model,...)`（L2785-2798）→ `authStorage.keys.get(provider, sessionId, {baseUrl, modelId})` → 走 config resolver 得到實際 key。
- image-gen.ts L233-241：`const initialKey = await ctx.modelRegistry.getApiKey(model, sessionId, {signal})`，`isAuthenticated` 檢查通過後 `apiKey = ctx.modelRegistry.resolver(model, sessionId)` 交給 `generateImage`。對自訂 provider 模型成立（provider 名即 models.yml 的 key）。
- 注意：`authStorage.keys.source(provider, {env:'aliases'})` 的 alias 機制不影響自訂 provider（後者靠 setConfig）。

## Q5 image kind 對既有 chat 假設的風險

- `dropProviderModels(..., {kind:'chat'})`（`model-registry.ts:1021/1028/1733`；定義 `model-patch.ts:160-168`）只移除 chat kind → image 列**不會**被 authoritative 覆蓋邏輯清掉。若某內建 provider 同時有 image 列且被標 authoritative，可能出現「image 列未被取代」；對自訂 provider（非 authoritative）無影響。
- 預設/聊天角色：`getAll()` 預設 `kind="chat"`（L2548-2560），`acceptsChat = modelKind==='chat'`（`model-roles.ts:34-36`）。→ image 模型**不會**被挑成 default/smol/slow 等 chat 角色。安全。
- image 角色：`roleCandidatePool('image') = getAvailable('all').filter(kind==='image')`（`model-roles.ts:104-106`），`MODEL_ROLES.image.section='kind'`（L67-73）。getAvailable('all') 含所有 kind → 自訂 image 模型會出現在 image role 候選。
- 模型選擇器：`pi-tui/src/overlays/model-browser.ts:355` 用 `registry.getAll('all')` 做角色指派，L349 用 `getAvailable()`（預設 chat）列列；image 只在 kind 區段角色下顯示。
- `omp models`：`models-cli.ts` 預設 kind chat（L47 參數 doc、`renderProviderModels(..., kind='chat')`）→ image 列預設不列出，需 `--kind image` 或 `--kind all`；這是預期行為非 bug。
- identity/catalog 覆寫風險：`finalizeCustomModel` 在 `useDefaults` 時用 `resolveModelReference(id)` 查 bundled reference（`custom-models.ts:116-121`）。若自訂模型 id **恰好等於**某 bundled id 且該 id 的 catalog policy 帶 kind，`applyCatalogAssignments`（build.ts:76-78）會覆寫我們傳入的 kind。→ 用唯一 id（如 `jimeng-*`）可避免。
- provider 級 `api: openai-images`：`buildCustomModelOverlay` 取 `api = modelDef.api ?? providerApi`（`custom-models.ts:80`）→ 該 provider 全部 model 都會是 openai-images，需在 models 級逐列覆寫或只放 image 列。
- discovery：若同時開 discovery 且 provider 級 api 為 openai-images，`validateProviderConfiguration`（L83-85）只要求 api 存在；`openai-compat.ts:6562-6566` 的 kind/kind-apis 過濾只作用於 discovery 動態列，models.yml 靜態列不受影響。
- 無其他 chat-only 硬性檢查會拒絕 image 列；`Model.kind` 對 chat transports 無副作用（chat 角色以 kind 過濾排除）。

## Q6 openai-images transport 的 auth 與 headers

- `pi-ai/src/images/openai-images.ts`：`generateOpenAIImage` 以 `imageBaseUrl(model)` + `/images/generations`（L63/L71）呼叫 `postJson(... apiKey: options.apiKey ...)`。
- `pi-ai/src/images/shared.ts:79-107 postJson`：headers = `{ ...(await modelHeaders(model, signal)), Authorization: \`Bearer ${key}\`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT }`；key 來自 `withAuth(options.apiKey, ...)`（L86-104）。→ **是** Bearer。
- `shared.ts:33-35 modelHeaders(model)` = `{ ...model.headers, ...(await model.resolveHeaders?.(signal)) }` → 自訂 provider 的 `headers` 與 `resolveHeaders` 都會被帶上（自訂模型的 resolveHeaders 是 `createConfigHeaderResolver([providerHeaders, modelDef.headers], {authHeader, apiKeyConfig})`，見 `custom-models.ts:33-40/97`；`authHeader: true` 時會注入 `Authorization: Bearer <apiKey>`，`resolve-config-value.ts:198-207`）。
- `image-gen.ts:279-283` 以 `resolveHeaders: () => ctx.modelRegistry.resolveModelHeaders(model, signal)` 包裝模型；`model-registry.ts:2777-2780 resolveModelHeaders` 若 `model.resolveHeaders` 存在就呼叫它 → 自訂 header 鏈完整保留。
- `imageBaseUrl`（`shared.ts:27-30`）用 `model.baseUrl` 去尾斜線 → models.yml 只要 `baseUrl: http://localhost:5100/v1` 即可正確組成 `.../v1/images/generations`。

## 最小 diff 草案

### 1) `pi-coding-agent/src/config/models-config-schema-bundle.ts`
```diff
 const ApiSchema = type(
-  '"openai-completions" | ... | "openrouter-decisions" | "typesafe"',
+  '"openai-completions" | ... | "openrouter-decisions" | "typesafe" | "openai-images" | "openrouter-images"',
 );

 const ModelDefinitionSchema = type({
   id: "string",
   name?: "string",
   api?: ApiSchema,
+  kind?: '"chat" | "tiny" | "image" | "tts" | "stt" | "search" | "judge" | "embedding" | "rerank" | "video"',
   ...
 });

 const ModelOverrideSchema = type({
   name?: "string",
+  kind?: <same union>,
   ...
 });
```
（或於檔案頂部建立 `const ModelKindSchema = type('
 Chat" | ...)`, 供兩處共用。）

### 2) `pi-coding-agent/src/config/model-patch.ts`
```diff
 export interface ModelPatch {
+  kind?: ModelKind;
   name?: string;
   ...
 }

 export function applyModelPatch(base, patch, transport) {
   const result = { ...base };
+  if (patch.kind !== undefined) result.kind = patch.kind;
   if (patch.name !== undefined) result.name = patch.name;
   ...
```
需 `import { modelKind, type ModelKind } from "@oh-my-pi/pi-catalog/types";`（該檔已 import modelKind，見第 6 行）。

### 3) `pi-coding-agent/src/config/custom-models.ts`
```diff
 export function buildCustomModelOverlay(...): CustomModelOverlay | undefined {
   const api = modelDef.api ?? providerApi;
   if (!api) return undefined;
   return {
     id: modelDef.id,
+    kind: modelDef.kind,
     provider: providerName,
     ...
   };
 }

 export function finalizeCustomModel(model, options) {
   ...
   const built = buildModel({
     id: resolvedModel.id,
+    kind: resolvedModel.kind,
     name: ...,
     ...
   } as ModelSpec<Api>);
```
（`CustomModelDefinitionLike`/`CustomModelOverlay` 因 extends ModelPatch 自動獲得 kind。）

### 4) 不需改但須確認
- `pi-catalog/src/build.ts`：`{...spec}` 已帶 kind；`applyCatalogAssignments`（L76-78）僅在 catalog 有 kind 時覆寫。
- `models-config.ts` validateProviderConfiguration：無 chat-only 要求。
- `model-registry.ts`：`#mergeCustomModels` 走 `applyModelPatch` 後即自動帶 kind（靠 #2）；`getAll/getAvailable` 依 modelKind 過濾，無需改。

### models.yml 使用範例（參考、未落地）
```yaml
providers:
  jimeng:
    baseUrl: http://localhost:5100/v1
    api: openai-images
    apiKey: JIMENG_API_KEY   # 或字面值 / !command
    models:
      - id: jimeng-image
        kind: image
        input: [text, image]
```

## 風險彙總
1. **catalog 覆寫**：自訂 id 若撞 bundled id，`applyCatalogAssignments` 可能覆蓋 kind（`build.ts:76-78`）；用唯一 id。
2. **provider 級 api 汙染**：`api: openai-images` 會套用到該 provider 全部 models（`custom-models.ts:80`）。
3. **dropProviderModels({kind:'chat'})** 不清 image 列（`model-registry.ts:1021/1028/1733`）——自訂 provider 無影響，內建 authoritative provider 需留意殘留。
4. **`getApiKey` 對手寫 env 名**：`apiKey: SOME_ENV_VAR` 只有在該 env 真的存在時 $envExact 命中；否則整串被當**字面金鑰**送去（`resolve-config-value.ts:105-110`），可能產生 401 而非「缺憑證」。
5. **getAvailable('image') / `omp models ls`** 預設只列 chat；須 `--kind image` 才看得到（models-cli.ts）。
6. **schema 白名單加入 openai-images 後**，provider 級 api 可讓 chat 模型被誤設為 image transport；但因 chat 角色以 kind 過濾，唯一風險是使用者把 `kind: chat` 搭配 `api: openai-images` 造成 chat 串流走錯 transport（使用者設定錯誤，非系統缺陷）。


[You have received this identical output 3 times. Re-reading 'agent://CustomImageKindPath/report' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]
