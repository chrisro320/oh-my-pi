# StepFun 0100 throwaway consumer smoke

## Scope and execution status

This artifact and `stepfun-smoke.ts` are the entire assigned change. They do not register a permanent gate, edit package sources, generate a patch, mutate an existing gate, or access production state. FamilyRebaseOwner owns the target 0100 implementation. Retain this consumer probe until the parent exercises the final integrated candidate.

**Negative control exercised; patched candidate pending.** Main ran this consumer probe against the complete unpatched18.12.6 acquisition closure with the documented allowlisted private environment. It exited1 at `built-in: default/override discovery URL`, observing actual `https://api.stepfun.ai/v1/models`; all selected imports resolved successfully and denied global fetch calls were0. Evidence: `research/stepfun-negative-control.json`. No patched-target PASS is claimed.

The behavior gap is the built-in StepFun base URL: the coding-plan consumer must use `https://api.stepfun.ai/step_plan/v1`, while an explicit caller `baseUrl` must still win. The behavior lives in the selected catalog discovery builder, its dynamic model, the real OpenAI-completions stream consumer, generated bundled models, and the compiled authentication descriptor/engine. This script only observes those existing consumers; it does not replace their URL construction.

## Exact parent command

Run from the repository root in Bash, with `CANDIDATE_NM` already set to the final isolated candidate's **`node_modules/@oh-my-pi` directory**, not its parent `node_modules` or a production/cache path:

```bash
set -euo pipefail
: "${CANDIDATE_NM:?Set CANDIDATE_NM to the final isolated node_modules/@oh-my-pi}"
BUN_BIN="$(command -v bun)"
SMOKE_DIR="$(mktemp -d /tmp/omp-stepfun-smoke.XXXXXXXX)"
mkdir -p "$SMOKE_DIR/home" "$SMOKE_DIR/tmp" "$SMOKE_DIR/cache/bun" \
  "$SMOKE_DIR/cache/xdg" "$SMOKE_DIR/home/.config" "$SMOKE_DIR/home/.local/share"
timeout 45s env -i \
  PATH="/usr/local/bin:/usr/bin:/bin" \
  HOME="$SMOKE_DIR/home" TMPDIR="$SMOKE_DIR/tmp" \
  XDG_CACHE_HOME="$SMOKE_DIR/cache/xdg" \
  XDG_CONFIG_HOME="$SMOKE_DIR/home/.config" \
  XDG_DATA_HOME="$SMOKE_DIR/home/.local/share" \
  BUN_INSTALL_CACHE_DIR="$SMOKE_DIR/cache/bun" \
  LANG=C.UTF-8 \
  "$BUN_BIN" .trellis/tasks/10-23-omp-upgrade-plan/research/stepfun-smoke.ts \
  --nm "$CANDIDATE_NM" | tee "$SMOKE_DIR/result.json"
printf 'StepFun smoke evidence: %s\n' "$SMOKE_DIR/result.json"
```

`OMP_PATCH_VERIFY_NM="$CANDIDATE_NM"` inside the same `env -i` invocation can replace the `--nm` pair; explicit `--nm` wins if both are supplied. There is deliberately no installed-tree default. The script rejects a HOME outside the fresh directory shape above and requires selected pi-ai/pi-catalog package metadata to be exactly 18.12.6. It imports every target module by an absolute selected-root file URL, reports the resolved module URLs/package versions, and requires the streamer's catalog-policy dependency to resolve to that same selected catalog. Missing modules/dependencies fail, never SKIP.

The caller has no inherited credentials, proxies, production HOME, XDG settings, Bun cache, or agent databases. The script does not instantiate a model manager/cache database; it invokes the returned real discovery function and materializes its discovered row with the real catalog `buildModel`.

## Consumer observations required for PASS

1. `stepfunModelManagerOptions({ apiKey: syntheticKey, fetch: syntheticTransport })` returns a callable `fetchDynamicModels`. Invoke it and require exactly one observed **GET `https://api.stepfun.ai/step_plan/v1/models`**. Parse the real returned dynamic row; materialize it with `buildModel`, requiring provider `stepfun`, API `openai-completions`, and the same coding-plan base URL. The script does not assign the expected base onto the discovered model.
2. Pass that unmodified selected model to the real `streamOpenAICompletions`, using its fetch injection. Require an actual **POST `https://api.stepfun.ai/step_plan/v1/chat/completions`**, the discovered synthetic model ID in the request, and `stream:true`. Consume the real SSE decoder/event stream and require `text_delta`, `done`, stop reason `stop`, and the synthetic completion text. Require exactly the discovery request and one stream request.
3. Repeat both real consumers with explicit `baseUrl: "https://custom.stepfun.invalid/explicit/v1"`. Require GET `/explicit/v1/models`, the selected dynamic model base, and POST `/explicit/v1/chat/completions` all to follow that override. The `.invalid` hostname is only a label; it is never resolved.
4. Call `getBundledModels("stepfun")` and require a nonempty bounded bundled seed whose every model uses the coding-plan base. This reads the generated consumer registry, not a source spelling or locally recomputed seed.
5. Call `authPolicyFor("stepfun")`, require its actual `api-key` / `chat-completions` descriptor, and pass that actual login rule into `createApiKeyLogin`. Supply the synthetic key through `onPrompt` and synthetic transport through `fetch`. Require the real engine to issue exactly one validation POST to the coding-plan chat-completions URL and return the synthetic key. Target-native naming is `login.validate.baseUrl`, **not** the historical `validateUrl` field. No credential store is opened and no key is persisted.
6. Require zero calls to the denied global fetch, including attempts swallowed by optional auth validation.

The transport never calls native fetch or forwards a request. It returns a fixed synthetic models listing for a models GET and fixed synthetic SSE for a completion POST. Crucially it does not manufacture the asserted URLs or return URL correctness flags: URL construction, dynamic-model selection, streaming POST, payload serialization, SSE decode, bundled selection, and descriptor-driven validation all run in the selected real packages. The expected default/override URLs are independent literals in the probe. The transport permits only the synthetic key, the two named hosts, bounded request counts, models GET, and completions POST; no response depends on matching the desired coding-plan prefix.

Global fetch is replaced **before target imports** with an unconditional rejecting function; injected transports never delegate. This is a fail-closed fetch boundary, **not OS-level network isolation**. No provider call or DNS lookup is needed or authorized. There is no production auth/DB access, native interaction, package mutation, publication, or commit.

## Expected negative control and output

The dependency-complete unpatched18.12.6 closure exited1 at **`built-in: default/override discovery URL`**, observing its old `https://api.stepfun.ai/v1/models` rather than the required coding-plan URL. This is the intended consumer failure, not an import/dependency failure; `research/stepfun-negative-control.json` records the exact command/root/environment/output. A fully integrated patched candidate still must exit0 with `status: "pass"`, both completed stream cases, bundled base URLs, auth validation request, and `deniedGlobalFetchCalls: 0`.

Output is bounded JSON: selected root, module-resolution/package identities, at most two stream cases with bounded request/event lists, bundled count/distinct bases, one auth-validation request, and status. It never prints headers, keys, request bodies, complete prompts, or returned credentials. Failure messages are capped at 500 characters and redact the synthetic key. Early argument/HOME setup errors can be ordinary assertion output; candidate consumer errors are emitted as failure JSON and nonzero exit. `timeout` bounds the whole process, including imports.

## API inspection evidence (not execution)

Observed in official pinned pristine sources under `/tmp/omp-upgrade-18126-01a1684f/pristine/@oh-my-pi`:

- `pi-catalog/src/provider-models/openai-compat.ts:847-879,5417-5441`: config base URL precedence, injected discovery fetch, and real `fetchDynamicModels`; pristine StepFun defaults to `/v1`.
- `pi-catalog/src/build.ts:426-451`: `buildModel` materializes discovered specs using the real target catalog policy.
- `pi-ai/src/providers/openai-completions.ts:887-956,1867-1874`: real POST URL construction, `options.fetch` injection, and exported stream consumer.
- `pi-catalog/src/models.ts:24-65`: `getBundledModels` reads generated `models.json` consumer rows.
- `pi-catalog/src/compat/auth.ts:17-20`: `authPolicyFor` returns the compiled provider descriptor.
- `pi-ai/src/registry/engine/api-key.ts:16-35,64-113` and `registry/api-key-validation.ts:87-109`: the actual login engine consumes the descriptor's validation base and forwards injected transport into the real validation request.

Main attached the observed negative-control result, selected runtime tree digest and exit status in `research/stepfun-negative-control.json`; patched-candidate acceptance remains unverified until integration.
