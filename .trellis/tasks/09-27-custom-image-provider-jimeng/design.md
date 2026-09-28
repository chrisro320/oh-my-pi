# Design — 0083 (provisional number) custom model kinds: image + tts (baseline omp 18.3.3)

> Planning-only document. Line numbers are 18.3.3 references; symbols are the anchors. Before implementation run the "Revalidation anchors" table below and record results in `implement.md` → "重驗紀錄" (protocol: parent PRD "開工前重驗協議").

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
- Rejected: `openrouter-images` / `xai-tts` (vendor-specific, bundled providers already cover them); `video` (no omp role or tool yet — subtask 4 `09-27-video-role-tool` adds kind `video` together with its role/tool); `kind` on `ModelOverrideSchema` (re-kinding bundled models is not requested).

### D3 Propagation points
1. `ModelPatch` (`config/model-patch.ts:234-257`) gains `kind?: ModelKind`; `applyModelPatch` (`:267-`) copies it when defined. This covers the same-`provider+id` merge in `#mergeCustomModels` (`model-registry.ts:1092-1114`).
2. `buildCustomModelOverlay` returns `kind: modelDef.kind`.
3. `finalizeCustomModel` passes `kind: resolvedModel.kind` into `buildModel`; `buildModel` spreads the spec, and `applyCatalogAssignments` overrides only when a catalog rule carries a kind.
- Invariant: when `kind` is absent everywhere, every produced object is byte-for-byte the same shape as upstream (no `kind: undefined` key added to models). Implementation must use conditional spreads, not `kind: undefined` assignments, so `modelKind()` and any key-count/serialization observers stay unchanged.
- Published declarations under `pi-coding-agent/dist/types/config/` must stay in sync for every changed exported interface/schema (`model-patch.d.ts`, `custom-models.d.ts` if its interfaces change, `models-config-schema-bundle.d.ts` if it encodes the literal unions).

### D4 User configuration (not part of the patch)
- `models.yml` provider `jimeng`: `baseUrl: http://localhost:5100/v1`, `api: openai-images`, `apiKey: "!cat <token path>"` (command value, cached after first success, `config/resolve-config-value.ts:15-19,62-66`); models `jimeng-image-5.0-pro`, `-5.0-lite`, `-4.7`, `-4.6`, `-4.5`, each `kind: image`, `input: [text]` (direct phase is text-to-image only, see D6). Direct connection accepts the proxy's fixed ratio/resolution (it ignores `size`/`n`); subtask 3 (`09-27-media-gateway-local`, phase G1) later repoints `baseUrl`/`apiKey` at the local media gateway without touching the patch, and only then may `input` gain `image`.
- No production TTS provider is configured here (no local TTS backend exists yet); `speechgen.enabled` stays unchanged.
- `config.yml`: `modelRoles.image: jimeng/jimeng-image-5.0-pro`; `retry.fallbackChains.image: [openai-codex/gpt-image-1, jimeng/jimeng-image-5.0-lite, google-antigravity/gemini-3-pro-image]`. Configured selectors are explicit, so `hoistProvider` does not reorder them (`model-resolver.ts:1547-1575`). Existing `retry.fallbackChains.web` and the model-keyed chain stay untouched.
- Why command form: keeps the secret out of `models.yml`; the token file path is already the one `api-image.ts:445-449` uses.
- Risk: a literal or unknown env name would be sent verbatim as the key (`resolve-config-value.ts:105-110`) — the command form avoids that ambiguity.

### D5 Response handling unchanged
- The proxy ignores `n` and returns every upstream `item_list` entry (5.0-lite measured 4; count varies by model/resolution and is not promised). The user keeps all returned items. `generateOpenAIImage` / `decodeImageResponse` already save every returned item (`pi-ai/src/images/shared.ts:145-173`). No transport change.

### D6 Direct-connection limits (review F12 + round-2 correction, verified on 18.3.3, 2026-09-28)
- **Reference images fail the whole call**: with input images `generateOpenAIImage` posts to `{baseUrl}/images/edits` (`pi-ai/src/images/openai-images.ts`). The live proxy answers that path with HTTP 200 + `{code:-1000, data:null}` (read-only probe by the round-2 reviewer), so `decodeImageResponse` throws `ProviderResponseError` ("response is missing data", `pi-ai/src/images/shared.ts`). `image-gen` only falls back on `ProviderHttpError`, so the tool call fails; it does NOT fall back to codex/gemini. (The earlier "404 → fallback" statement was wrong. Even a real 404 would not help: `openai-images.ts` then retries `/images/generations` with `input_references`, which the proxy ignores, silently producing a text-only image.)
- **Business errors**: failures (no credits `-2009`, content filter `-2006`, …) are HTTP 200 + `{code, message}` without `data` → same `ProviderResponseError` → no fallback.
- `image-gen` does not skip candidates by `model.input`, so declaring `input: [text]` documents capability but does not route reference-image requests away from jimeng.
- **Resolution path**: P2 design D14 makes `ProviderResponseError` fallback-eligible → both limits disappear as soon as P2 lands (the call falls through to `openai-codex/gpt-image-1`). Gateway G1 additionally returns real HTTP errors and implements/declines `/images/edits` explicitly.
- **Until P2 lands**: reference-image or edit requests must name a non-jimeng model explicitly (e.g. `model: openai-codex/gpt-image-1`); a jimeng business error fails the call. P1 acceptance covers text-to-image through jimeng only.

## Compatibility / rollback
- Patch touches only `pi-coding-agent` source (+ its published `.d.ts`); root `${AGENT}`; new tail candidate `0083-omp-custom-model-kinds-v18.3.3-candidate.patch` after 0082 (`0082-omp-user-display-text`, session input translator — uncommitted as of 2026-09-28; if its number changes, 0083 takes the next free tail number and the 18.3.3 plan count becomes predecessor count + 1).
- Existing `models.yml` (10 providers, no `kind`) must load identically; the gate asserts a no-kind custom row stays `chat`.
- Rollback: `apply.sh` reverse of 0083, or restore the pre-deploy backups of the three source files; revert `models.yml` / `config.yml` from their timestamped backups. Changes take effect only in newly started omp processes.

## Revalidation anchors (verified on 18.3.3, 2026-09-28: 16/16 PASS)

Runnable form: `.trellis/tasks/09-27-custom-image-provider-jimeng/revalidate.sh` (exit 0 = all baseline assumptions hold; prints `DRIFT` rows otherwise; `OMP_ROOT=` overrides the install root). The table below is the human-readable index; the script is authoritative.

Run from any cwd with `A=/home/chris/.bun/install/global/node_modules/@oh-my-pi; AG=$A/pi-coding-agent/src`. "Expected" is the unpatched 18.3.3 result. If a row differs: upstream moved it (record new location), upstream now supports it natively (drop that design point and use upstream), or it is gone (redesign).

| # | Design dependency (symbol / external interface) | 18.3.3 ref | Command | Expected (unpatched) |
|---|---|---|---|---|
| 1 | `ApiSchema` literal union lacks `openai-images` | `models-config-schema-bundle.ts:106` | `grep -c 'openai-images' $AG/config/models-config-schema-bundle.ts` | `0` (if >0: upstream opened it — drop D2 api part) |
| 2 | `ApiSchema` is a string-literal union (patch style) | same | `grep -n '"openai-completions" \| "openai-responses"' $AG/config/models-config-schema-bundle.ts` | 1 hit, single-line union |
| 3 | `ModelDefinitionSchema` has no `kind` | `:191-` | `grep -cE '"kind\??"' $AG/config/models-config-schema-bundle.ts` | `0` |
| 4 | `ModelPatch` interface + `applyModelPatch` exist | `model-patch.ts:234,267` | `grep -nE 'export interface ModelPatch\|export function applyModelPatch' $AG/config/model-patch.ts` | 2 hits |
| 5 | `ModelPatch` carries no `kind` (only `dropProviderModels` option uses kind) | `model-patch.ts:159-166` | `grep -nE '\bkind\b' $AG/config/model-patch.ts` | hits only in `dropProviderModels` block |
| 6 | Overlay/finalize entry points | `custom-models.ts:65,114` | `grep -nE 'export function (buildCustomModelOverlay\|finalizeCustomModel)' $AG/config/custom-models.ts` | 2 hits |
| 7 | Custom-model path drops `kind` | `custom-models.ts` | `grep -cE '\bkind\b' $AG/config/custom-models.ts` | `0` |
| 8 | Roles filter by `modelKind()` (`image`→image, `speech`→tts) | `model-roles.ts:72,80` | `grep -nE 'modelKind\(model\) === "(image\|tts)"' $AG/config/model-roles.ts` | 2 hits |
| 9 | Catalog runner APIs include both transports | `pi-catalog/src/types.ts:53,56` | `grep -nE '"openai-(images\|speech)"' $A/pi-catalog/src/types.ts` | 2 hits |
| 10 | Image tool accepts `openai-images` | `pi-ai/src/images/index.ts:27-29` | `grep -nE 'isImageGenerationApi\|api === "openai-images"' $A/pi-ai/src/images/index.ts` | both present |
| 11 | Speech tool accepts `openai-speech` | `pi-ai/src/speech/index.ts:13` | `grep -n 'SPEECH_APIS = \["xai-tts", "openai-speech"\]' $A/pi-ai/src/speech/index.ts` | 1 hit |
| 12 | Catalog assigns kind only from rules | `pi-catalog/src/build.ts:77-78` | `grep -nE 'MODEL_KINDS.find\|model.kind = kind' $A/pi-catalog/src/build.ts` | 2 hits |
| 13 | Absent kind means chat | `pi-catalog/src/types.ts:65` | `grep -n 'return model.kind ?? "chat"' $A/pi-catalog/src/types.ts` | 1 hit |
| 14 | `!command` config values | `resolve-config-value.ts:23` | `grep -n 'startsWith("!")' $AG/config/resolve-config-value.ts` | ≥1 hit |
| 15 | jimeng proxy serves image models | external `:5100` | `curl -s -m 5 http://127.0.0.1:5100/v1/models \| grep -o 'jimeng-image-[0-9a-z.-]*' \| sort -u` | 10 ids incl. `5.0-pro`,`5.0-lite`,`4.7`,`4.6`,`4.5` |
| 16 | jimeng token file present (never print it) | external | `test -s /home/chris/orca/projects/人山/.jimeng-token && echo present` | `present` |
| 17 | Patch-chain tail and free number | `patches/apply.sh` 18.3.3 branch | `grep -n '_omp_tail_candidate "18.3.3"' patches/apply.sh \| tail -3` | last is `0082-omp-user-display-text` → use next free number |
