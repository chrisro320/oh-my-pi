# ImageRoleDefaultUX (scout report, 2026-09-27)

All six questions answered with evidence chains. Paths are absolute under /home/chris/.bun/install/global/node_modules/@oh-my-pi/ (18.3.3, live src).

## Q1 — image role default/order; resolveRoleChain + hoistProvider

Settings keys (pi-coding-agent/src/config/model-settings.ts):
- `modelRoles` — type `record`, default {} (L97). Key `image`; value is a selector string (or array/comma-list, see below).
- `modelRoleStorage` — enum global|project, default "global" (L72-76). Chooses which config file role writes land in.
- `cycleOrder` — unrelated to image (only the ctrl+p chat-role cycle; default [smol,default,slow], L103).
- `retry.fallbackChains` (session/settings.ts L793-797, record) adds explicit per-role chain selectors.

Role value shape — ordered list, NOT single-only:
- settings.ts `modelRoleValueFromUnknown` (L414-420): a string passes through; an array is joined with `,`.
- model-resolver.ts `normalizeModelPatternList` (L1040-1044): "Normalize comma-separated or array model selectors into an ordered pattern list" — arrays flatMap and strings split on `,`.
- So `modelRoles.image: ["jimeng/x", "openai/gpt-image-1"]` or `"jimeng/x,openai/gpt-image-1"` yields an ordered fallback list.

`resolveModelRoleValue(roleValue, availableModels, opts)` (model-resolver.ts L1389-1453):
- expands the value via `resolveConfiguredModelPatterns` (L1226-1233) into ordered patterns (role aliases resolved by `resolveConfiguredRolePattern` L1183-1215),
- then `for (const [patternIndex, effectivePattern] of effectivePatterns.entries())` (L1423) calls `matchPatternWithContext` and returns the FIRST pattern that resolves, recording `matchedPatternIndex` — i.e. ordered first-match fallback; a single selector is a one-element list.

`resolveRoleChain(role, settings, pool, { hoistProvider })` (L1533-1576):
- `primarySelector = configured || formatModelRoleAlias(role)` → `"@image"` when unset (L1542).
- `configuredFallbacks = cfgRetryFallbackChains.get(settings)[role]`; `fallbackSelectors = hasConfiguredFallbackChain ? configuredFallbacks : rolePriorityDefaults(role)` (L1543-1546).
- selectors = primary (explicit = `Object.hasOwn(configuredRoles, role)`) followed by fallbacks (explicit = chain configured) (L1547-1550). Dedup by `formatModelStringWithRouting` (L1555-1561).
- `hoistProvider` (L1567-1575): partitions candidates into explicit vs non-explicit; among NON-explicit only, moves candidates whose `model.provider === hoistProvider` to the front, preserving relative order; explicit candidates keep their original index. If no non-explicit candidate matches the provider, order is unchanged (L1571). Purpose: prefer an image model from the same provider as the current chat model without overriding an explicitly-configured role model.
- image-gen calls it with `hoistProvider: ctx.model?.provider` (tools/image-gen.ts L214-216).

Built-in image defaults — `rolePriorityDefaults("image")` (L1117-1121; `ROLE_PRIORITY_ALIAS` L1094-1098 has NO image entry, so it reads MODEL_PRIO["image"]): priority.json L68-77 = ["openai/gpt-image-1", "openai-codex/gpt-image-1", "google-antigravity/gemini-3-pro-image", "xai/grok-imagine-image", "xai-oauth/grok-imagine-image", "openrouter/google/gemini-3-pro-image-preview", "google/gemini-3-pro-image-preview", "deepinfra/black-forest-labs/FLUX-2-pro"].

## Q2 — visual model-role list + persistence + auth filter

Role metadata: model-roles.ts `image: { tag:"IMAGE", name:"Image generation", color:"accent", section:"kind", accepts: model => modelKind(model)==="image" }` (L67-73). Kind-section role ids: pi-tui overlays/model-browser.ts `KIND_ROLE_IDS = ["image","web","speech","dictation","judge"]` (L82).

UI component: `ModelHubComponent` (pi-tui/src/overlays/model-hub.ts), mounted by `SelectorController.showModelSelector()` → `#showModelHub` (selector-controller.ts L559-566, L728-732). It renders the Roles view via `#buildRolesRows` (L675-718): when `#roleTab === "all"` it splits visible roles by `getRoleInfo(role).section` into chat roles and kind roles with a separator between (L692-697); a dedicated "kinds" tab filters to `section === "kind"` (L699). Role tabs are `ROLE_TABS = ["all","chat","kind"]` with label rendering at L2023-2027.

Picking a model for image: `#openRoleStrip` iterates `#visibleRoleIds()` and keeps only roles whose `getRoleInfo(role).accepts(item.model)` is true (L1030-1034) — so the image role chip appears only for kind==="image" models. Selecting a chip calls `#assignRole` → `callbacks.onAssign(item.model, role, level, item.selector, scope)` (L988-1016).

Host callback: selector-controller.ts `onAssign` (L734-818). For non-default roles it builds `formatModelSelectorValue(selectorValue, thinkingLevel)` and calls `settings.setProjectModelRole(role, value)` when scope project, else `settings.setModelRole(role, value)` (L809-816). `onUnassign` (L820+) clears.

Persistence: `Settings.setModelRole(role, modelId)` (settings.ts L1559-1583) mutates the `#global` layer `current[role] = modelId` and `setByPath(this.#global, ["modelRoles"], current)` then `#queueSave()` → the global config file (`~/.omp/agent/config.yml`), so the key written is `modelRoles.image`. Project mode (`cfgModelRoleStorage === "project"`) writes `.omp/config.yml` instead (`setProjectModelRole`, settings.ts L1601-1605).

Auth filter: yes. ModelHubComponent sets `availableModels = registry.getAvailable("all")` (L393) and `#availableItems = buildBrowserItems(availableModels)` (L404); getAvailable returns only authenticated + keyless providers (model-registry.ts L2622-2624 and doc "The default is chat-only; pass \"all\" to include authenticated and keyless runners"). Locked/unauthed providers appear in the sidebar but contribute no selectable rows (model-hub.ts L626-631). The compact alt+p picker (`ModelBrowser.create`) uses `registry.getAvailable()` chat-only (model-browser.ts L348-349). Assignment display/auto-selection: `resolveRoleAssignments` (model-browser.ts L160-212) — configured roles resolve against getAll("all"); unconfigured roles auto-select by resolving `pi/<role>` over getAvailable filtered by accepts (so an unset image role shows the first available image model as dim/autoSelected).

## Q3 — current user config (~/.omp/agent/config.yml)

modelRoles block (L7-20): smol, slow, vision, plan, commit, tiny, task, default, web, advisor, memory. NO `image` key → image role is currently unassigned/auto-selected. Other image-adjacent but non-role keys: `maxInlineImages: 0` (L65, under an images group) and `generate_image: enabled: true` (L137-138, the tool gate cfgGenerateImageEnabled). No modelRoleStorage override (defaults to global). No credentials printed.

## Q4 — generate_image `model` param resolution

image-gen.ts L205-217: `pool = roleCandidatePool("image", settings, ctx.modelRegistry)` = `registry.getAvailable("all").filter(modelKind === "image")` (model-roles.ts L104-106). If `params.model` is set: `resolveModelRoleValue(params.model, pool, { settings }).model`, else error `"Image model selector did not match an available image model: <x>"` (L208-212). Otherwise `resolveRoleChain("image", settings, pool, { hoistProvider: ctx.model?.provider })` (L213-217).

Selector syntax (model-resolver.ts): accepted forms are any pattern `resolveModelRoleValue` understands, e.g. `provider/id` exact (e.g. `jimeng/flux-1-schnell`), bare `id` exact, role aliases `@image` / `image` / `*`, legacy `pi/image`, comma-separated lists, and optional `:level` thinking suffix. Matching order is documented in the file header (L6-19): exact `provider/id` (variant-alias + OpenRouter routed/date fallbacks) → exact bare id → retired variant alias → provider-scoped fuzzy (`fuzzyMatch`) → substring with alias-vs-dated pick. Because the pool is pre-filtered to kind==="image", the selector must name one of those (fuzzy/role alias is OK). After selection, image-gen further skips models failing `isImageGenerationApi(model.api)` (L222-228; openai-images IS supported) and models whose key is not authenticated (L240-243); `openai-images` dispatches to `generateOpenAIImage` (pi-ai/src/images/index.ts L20-40).

## Q5 — `omp models --kind image`

Command: commands/models.ts declares `--kind` with options `MODEL_KINDS + "all"` (L11, L28-35) and calls runModelsCommand (L57-68). runModelsCommand (cli/models-cli.ts L377-407) builds `new ModelRegistry(authStorage)` (L392), refreshes, then renderProviderModels (L404) whose `source.getAvailable(kind)` (L198) calls `ModelRegistry.getAvailable(kind)` (model-registry.ts L2622-2624). This is the SAME registry class + getAvailable surface that `roleCandidatePool("image", …)` uses (model-roles.ts L104-106) and that generate_image consumes via ctx.modelRegistry. So `omp models --kind image` is valid acceptance evidence: a model listed there as kind=image is exactly what the image role pool would offer. (Currently an unpatched build lists nothing for a models.yml provider because custom yaml cannot set kind — see schema notes below.)

## Q6 — tests

The installed @oh-my-pi packages ship essentially no tests: the only `*.test.ts` under any of pi-coding-agent / pi-ai / pi-catalog / pi-tui is `pi-coding-agent/src/edit/auto-repair.test.ts`. There is no `test/` directory, no `test` script in package.json, and the on-disk scratch checkouts (/home/chris/.omp-scratch-cache1823/**/pi-coding-agent) share the same src-only layout. Greps for `openai-images`, `roleCandidatePool`, `kind: "image"`, `models-config-schema` in the packages return only source, no tests. Therefore there are NO existing unit-test regression commands for image role or the custom-provider schema; regression must be runtime evidence: (a) `omp models --kind image` lists the jimeng provider model, (b) a generate_image smoke run against http://localhost:5100/v1, (c) startup models.yml schema validation no longer rejecting `api: openai-images`.

## Blocking schema facts (context for the task)

- ApiSchema (models-config-schema-bundle.ts L105-107) = openai-completions | openai-responses | openai-codex-responses | azure-openai-responses | anthropic-messages | bedrock-converse-stream | google-generative-ai | google-gemini-cli | google-vertex | openrouter-decisions | typesafe. `openai-images` is absent → provider-level and model-level `api` validation rejects it.
- ModelDefinitionSchema (L191), ModelOverrideSchema (L247), ProviderConfigSchema (L319) expose no `kind` field (file-wide grep for `kind` = 0 matches).
- buildCustomModelOverlay (config/custom-models.ts L65-113) and finalizeCustomModel (L118-167) never pass `kind` to buildModel.
- `model.kind` is only assigned by pi-catalog `applyCatalogAssignments` from catalog rules (build.ts L76-78); catalog `kind "image"` rules live in pi-catalog/src/compat/rules/providers/*.kdl (xai.kdl L22-24, openai-codex.kdl L21-23, google.kdl L26-28, openrouter.kdl L191-193, deepinfra.kdl L30-32, google-antigravity.kdl L67-69, singularityapi-dev.kdl L81-86). modelKind defaults to "chat" when `kind` is absent (pi-catalog/src/types.ts L64-66) — which is why the registerProvider(api: openai-images) path produced kind "chat".
- Model-discovery maps an explicit OpenAI `/models` row whose sole output modality is `image` to `{ kind: "image", api: "openai-images" }` (config/model-discovery.ts L820-849), but that only fires for providers with `discovery:` configured, not for a static `models:` list.

[You have received this identical output 3 times. Re-reading 'agent://ImageRoleDefaultUX/report' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]
