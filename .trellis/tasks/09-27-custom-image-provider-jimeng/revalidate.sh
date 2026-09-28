#!/usr/bin/env bash
# Pre-implementation revalidation for subtask 09-27-custom-image-provider-jimeng.
# Baseline: omp 18.3.3 UNPATCHED. Each check prints PASS (baseline assumption holds)
# or DRIFT (upstream changed; revise design.md before implementing). Read-only.
set -u
A="${OMP_ROOT:-/home/chris/.bun/install/global/node_modules/@oh-my-pi}"
AG="$A/pi-coding-agent/src"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
drift=0

check() { # check <id> <description> <expected> <command...>
	local id="$1" desc="$2" want="$3"; shift 3
	local got; got="$(eval "$*" 2>/dev/null)"
	if [[ "$got" == "$want" ]]; then printf 'PASS  %-3s %s\n' "$id" "$desc"
	else printf 'DRIFT %-3s %s\n      want: %s\n      got:  %s\n' "$id" "$desc" "$want" "$got"; drift=$((drift + 1)); fi
}

echo "omp pi-coding-agent version: $(grep -m1 '"version"' "$A/pi-coding-agent/package.json" | tr -d ' ,')"
check 1  "ApiSchema lacks openai-images"                  0 "grep -c 'openai-images' '$AG/config/models-config-schema-bundle.ts'"
check 2  "ApiSchema is a single-line literal union"       1 "grep -c '\"openai-completions\" | \"openai-responses\"' '$AG/config/models-config-schema-bundle.ts'"
check 3  "ModelDefinitionSchema has no kind"              0 "grep -cE '\"kind\\??\"' '$AG/config/models-config-schema-bundle.ts'"
check 4  "ModelPatch + applyModelPatch exist"             2 "grep -cE 'export interface ModelPatch|export function applyModelPatch' '$AG/config/model-patch.ts'"
check 5  "ModelPatch interface has no kind field"         0 "sed -n '/export interface ModelPatch/,/^}/p' '$AG/config/model-patch.ts' | grep -cE '^\s+kind\??:'"
check 6  "overlay/finalize entry points exist"            2 "grep -cE 'export function (buildCustomModelOverlay|finalizeCustomModel)' '$AG/config/custom-models.ts'"
check 7  "custom-models path drops kind"                  0 "grep -cE '\bkind\b' '$AG/config/custom-models.ts'"
check 8  "image/speech roles filter via modelKind()"      2 "grep -cE 'modelKind\(model\) === \"(image|tts)\"' '$AG/config/model-roles.ts'"
check 9  "catalog RUNNER_APIS has both transports"        2 "grep -cE '^\s+\"openai-(images|speech)\",' '$A/pi-catalog/src/types.ts'"
check 10 "image tool accepts openai-images"               1 "grep -c 'export function isImageGenerationApi' '$A/pi-ai/src/images/index.ts'"
check 11 "speech tool accepts openai-speech"              1 "grep -c 'SPEECH_APIS = \[\"xai-tts\", \"openai-speech\"\]' '$A/pi-ai/src/speech/index.ts'"
check 12 "catalog assigns kind only from rules"           1 "grep -c 'if (kind !== undefined) model.kind = kind' '$A/pi-catalog/src/build.ts'"
check 13 "absent kind means chat"                         1 "grep -c 'return model.kind ?? \"chat\"' '$A/pi-catalog/src/types.ts'"
check 14 "!command config values supported"              1 "grep -c 'startsWith(\"!\")' '$AG/config/resolve-config-value.ts'"
check 15 "jimeng proxy lists the 5 planned image models" 5 "curl -s -m 5 http://127.0.0.1:5100/v1/models | grep -oE 'jimeng-image-(5\.0-pro|5\.0-lite|4\.7|4\.6|4\.5)\"' | sort -u | wc -l"
check 16 "jimeng token file present (value never read)"  present "test -s /home/chris/orca/projects/人山/.jimeng-token && echo present"

echo "18.3.3 tail candidates (assign the next free number):"
grep -n '_omp_tail_candidate "18.3.3"' "$REPO/patches/apply.sh" | tail -3
echo "drift=$drift"
exit $(( drift > 0 ))
