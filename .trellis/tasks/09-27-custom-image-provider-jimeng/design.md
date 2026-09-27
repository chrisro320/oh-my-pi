# Design — 0082 custom model kinds: image + tts (18.3.3)

## Glossary
- **kind**: catalog `Model.kind` (`pi-catalog/src/types.ts:28-41,1194`); absent means `chat` (`types.ts:64-66`). The `image` role only accepts `kind === "image"`; the `speech` role only accepts `kind === "tts"` (`config/model-roles.ts:67-80`).
- **custom model**: a `models.yml` `providers.<name>.models[]` row, built by `buildCustomModelOverlay` → `finalizeCustomModel` → `buildModel` (`config/custom-models.ts:65-158`, `pi-catalog/src/build.ts`).

## Decisions

### D1 Patch the config path, not the catalog rules
- Choice: let `models.yml` rows declare `kind`, carried to `Model.kind`.
- Why: `kind` today is only assigned from bundled KDL rules (`build.ts:76-78`); user providers can never be image models. A config field is the smallest general fix and also covers future OpenAI-Images-compatible services (for example a ComfyUI shim).
- Rejected: (a) extension `registerProvider` + `modifyModels` — the same overlay drops `kind`, and `modifyModels` only runs with an OAuth credential (`model-registry.ts:949-954`); (b) editing bundled KDL/catalog for `jimeng` — hardcodes a private local service into shared rules; (c) `discovery:` against `/v1/models` — the proxy response has no `output_modalities`, so discovery keeps rows as chat (`model-discovery.ts:832-850`).

### D2 Schema scope: minimal allowlist
- `ApiSchema` (`models-config-schema-bundle.ts:105-107`) gains `"openai-images"` and `"openai-speech"`.
- `ModelDefinitionSchema` (`:191-`) gains `"kind?": '"chat" | "image" | "tts"'`.
- Why: these are the two runner transports that existing tools consume for custom endpoints — `generate_image` via `isImageGenerationApi` (`pi-ai/src/images/index.ts:18-33`) and `tts` via `synthesizeSpeech` (`pi-ai/src/speech/index.ts:13-30`, `tools/tts.ts:213-214`). Restricting `kind` to `chat | image | tts` avoids exposing kinds with no tool consumer or whose transports the schema still rejects (stt/embedding/rerank/video/search/judge/tiny), which would configure models that can never run.
- Rejected: `openrouter-images` / `xai-tts` (vendor-specific, bundled providers already cover them); `video` (no omp role or tool yet — child task 3 adds kind `video` together with its role/tool); `kind` on `ModelOverrideSchema` (re-kinding bundled models is not requested).

### D3 Propagation points
1. `ModelPatch` (`config/model-patch.ts:234-257`) gains `kind?: ModelKind`; `applyModelPatch` (`:267-`) copies it when defined. This covers the same-`provider+id` merge in `#mergeCustomModels` (`model-registry.ts:1092-1114`).
2. `buildCustomModelOverlay` returns `kind: modelDef.kind`.
3. `finalizeCustomModel` passes `kind: resolvedModel.kind` into `buildModel`; `buildModel` spreads the spec, and `applyCatalogAssignments` overrides only when a catalog rule carries a kind.
- Invariant: when `kind` is absent everywhere, every produced object is byte-for-byte the same shape as upstream (no `kind: undefined` key added to models). Implementation must use conditional spreads, not `kind: undefined` assignments, so `modelKind()` and any key-count/serialization observers stay unchanged.
- Published declarations under `pi-coding-agent/dist/types/config/` must stay in sync for every changed exported interface/schema (`model-patch.d.ts`, `custom-models.d.ts` if its interfaces change, `models-config-schema-bundle.d.ts` if it encodes the literal unions).

### D4 User configuration (not part of the patch)
- `models.yml` provider `jimeng`: `baseUrl: http://localhost:5100/v1`, `api: openai-images`, `apiKey: "!cat <token path>"` (command value, cached after first success, `config/resolve-config-value.ts:15-19,62-66`); models `jimeng-image-5.0-pro`, `-5.0-lite`, `-4.7`, `-4.6`, `-4.5`, each `kind: image`, `input: [text, image]`. Direct connection accepts the proxy's fixed ratio/resolution (it ignores `size`/`n`); child task 2 later repoints `baseUrl` at the local media gateway without touching the patch.
- No production TTS provider is configured here (no local TTS backend exists yet); `speechgen.enabled` stays unchanged.
- `config.yml`: `modelRoles.image: jimeng/jimeng-image-5.0-pro`; `retry.fallbackChains.image: [openai-codex/gpt-image-1, jimeng/jimeng-image-5.0-lite, google-antigravity/gemini-3-pro-image]`. Configured selectors are explicit, so `hoistProvider` does not reorder them (`model-resolver.ts:1547-1575`). Existing `retry.fallbackChains.web` and the model-keyed chain stay untouched.
- Why command form: keeps the secret out of `models.yml`; the token file path is already the one `api-image.ts:445-449` uses.
- Risk: a literal or unknown env name would be sent verbatim as the key (`resolve-config-value.ts:105-110`) — the command form avoids that ambiguity.

### D5 Response handling unchanged
- The proxy ignores `n` and returns every upstream `item_list` entry (5.0-lite measured 4; count varies by model/resolution and is not promised). The user keeps all returned items. `generateOpenAIImage` / `decodeImageResponse` already save every returned item (`pi-ai/src/images/shared.ts:145-173`). No transport change.

## Compatibility / rollback
- Patch touches only `pi-coding-agent` source (+ its published `.d.ts`); root `${AGENT}`; new tail candidate `0082-omp-custom-model-kinds-v18.3.3-candidate.patch` after 0081.
- Existing `models.yml` (10 providers, no `kind`) must load identically; the gate asserts a no-kind custom row stays `chat`.
- Rollback: `apply.sh` reverse of 0082, or restore the pre-deploy backups of the three source files; revert `models.yml` / `config.yml` from their timestamped backups. Changes take effect only in newly started omp processes.
