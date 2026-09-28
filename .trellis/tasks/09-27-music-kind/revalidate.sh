#!/usr/bin/env bash
# Pre-implementation revalidation for subtask 09-27-music-kind (patch P4, provisional 0086).
#
# Baseline: omp 18.3.3 UNPATCHED. PASS = baseline assumption still holds; DRIFT = upstream changed
# (revise design.md before implementing; a DRIFT on this task's own artifact also means P4 is already applied).
#
# F01 rule: every DRIFT check below must hold BOTH before any predecessor lands AND after P1 (0083),
# P2 (0084) and P3 (0085) are applied. Facts those predecessors introduce (schema kind/api allowlist,
# "media" job type, asyncJobManager/asyncSettles, tools/media-job.ts, media-output.ts, ACE weights on disk)
# are PREREQ lines — informational, never affecting the exit code.
# Read-only: no writes, no network calls that need credentials.
set -u
A="${OMP_ROOT:-/home/chris/.bun/install/global/node_modules/@oh-my-pi}"
AG="$A/pi-coding-agent/src"
T="$A/pi-tui/src"
AI="$A/pi-ai/src"
CAT="$A/pi-catalog"
CT=/media/chris/Agents/LLM/ComfyUI
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
drift=0

check() { # check <id> <description> <expected> <command...>
	local id="$1" desc="$2" want="$3"; shift 3
	local got; got="$(eval "$*" 2>/dev/null)"
	if [[ "$got" == "$want" ]]; then printf 'PASS  %-4s %s\n' "$id" "$desc"
	else printf 'DRIFT %-4s %s\n       want: %s\n       got:  %s\n' "$id" "$desc" "$want" "$got"; drift=$((drift + 1)); fi
}

prereq() { # prereq <name> <command>  (predecessor patch marker / external prerequisite; informational)
	local name="$1" cmd="$2"
	if eval "$cmd" >/dev/null 2>&1; then printf 'PREREQ %-30s applied\n' "$name"
	else printf 'PREREQ %-30s missing\n' "$name"; fi
}

info() { # info <label> <command>
	local label="$1" cmd="$2"
	printf 'INFO   %-30s %s\n' "$label" "$(eval "$cmd" 2>/dev/null)"
}

echo "omp pi-coding-agent version: $(grep -m1 '"version"' "$A/pi-coding-agent/package.json" | tr -d ' ,')"
echo "--- upstream facts: must hold before AND after P1/P2/P3 (unpatched 18.3.3) ---"
check 1  "MODEL_KINDS has no music (P4's own edit point)"         0 "grep -c '\"music\"' '$CAT/src/types.ts'"
check 2  "published MODEL_KINDS literal has no music"             0 "grep -c '\"music\"' '$CAT/dist/types/types.d.ts'"
check 3  "published MODEL_KINDS is a single-line readonly tuple"  1 "grep -c 'export declare const MODEL_KINDS: readonly' '$CAT/dist/types/types.d.ts'"
check 4  "KIND_API_KINDS unchanged (music needs no new api)"      1 "grep -c 'KIND_API_KINDS = \\[\"image\", \"tts\", \"stt\", \"embedding\", \"rerank\", \"video\"\\]' '$CAT/src/types.ts'"
check 5  "RUNNER_APIS has openrouter-video (reused transport)"    1 "grep -c '\"openrouter-video\",' '$CAT/src/types.ts'"
check 6  "no exhaustive Record<ModelKind,...> exists"             0 "grep -rE 'Record<ModelKind,' '$AG' '$T' '$AI' '$CAT/src' | grep -vc 'Partial<Record<ModelKind,'"
check 7  "MODEL_ROLES is a full Record (the only forced point)"   1 "grep -c 'MODEL_ROLES: Record<ModelRole, ModelRoleInfo>' '$AG/config/model-roles.ts'"
check 8  "KIND_ROLE_IDS is a plain ModelRole[] declaration"       1 "grep -c 'export const KIND_ROLE_IDS: ModelRole\\[\\]' '$T/overlays/model-browser.ts'"
check 9  "pi-tui roles have no music"                             0 "grep -c '\"music\"' '$T/overlays/model-browser.ts'"
check 10 "published ModelRole union has no music"                 0 "grep -c 'music' '$A/pi-tui/dist/types/overlays/model-browser.d.ts'"
check 11 "priority.json has no music chain"                       0 "grep -c '\"music\"' '$AG/priority.json'"
check 12 "/models kind tabs derive from MODEL_KINDS"              1 "grep -c 'MODEL_KIND_TABS: ReadonlyArray<\"all\" | ModelKind>' '$T/overlays/model-hub.ts'"
check 13 "omp models --kind options derive from MODEL_KINDS"      1 "grep -c 'MODEL_KIND_OPTIONS: readonly (ModelKind | \"all\")\\[\\] = \\[\\.\\.\\.MODEL_KINDS, \"all\"\\]' '$AG/commands/models.ts'"
check 14 "image role filters kind via modelKind()"                1 "grep -c 'modelKind(model) === \"image\"' '$AG/config/model-roles.ts'"
check 15 "video transport only accepts openrouter-video"          3 "grep -c 'model.api === \"openrouter-video\"' '$AI/video/index.ts'"
check 16 "content GET sends Accept: video/* (gateway must ignore)" 1 "grep -c 'Accept: \"video/\\*\"' '$AI/video/openrouter-video.ts'"
check 17 "provider.options escape hatch exists"                   1 "grep -c 'provider?: { options' '$AI/video/types.ts'"
check 18 "audio_url input reference exists"                       1 "grep -c 'audioUrl' '$AI/video/types.ts'"
check 19 "speech APIS list has no music transport"                1 "grep -c 'SPEECH_APIS = \\[\"xai-tts\", \"openai-speech\"\\]' '$AI/speech/index.ts'"
check 20 "speech transport hard timeout is 60s"                   1 "grep -c 'SPEECH_TIMEOUT_MS = 60_000' '$AI/speech/transport.ts'"
check 21 "AsyncJobType still declared once in job-manager"        1 "grep -c 'export type AsyncJobType' '$AG/async/job-manager.ts'"
check 22 "schema bundle has no music kind (P4's own edit point)"  0 "grep -c '\"music\"' '$AG/config/models-config-schema-bundle.ts'"
check 23 "published settings.d.ts has no cfgGenerateMusicEnabled" 0 "grep -c 'cfgGenerateMusicEnabled' '$A/pi-coding-agent/dist/types/tools/settings.d.ts'"
check 24 "tools barrel exports image-gen"                         1 "grep -c 'export \\* from \"./image-gen\"' '$AG/tools/index.ts'"
check 25 "ComfyUI ACE-Step 1.5 nodes present (3)"                 3 "grep -cE 'node_id=\"(TextEncodeAceStepAudio1\\.5|EmptyAceStep1\\.5LatentAudio|ReferenceTimbreAudio)\"' '$CT/comfy_extras/nodes_ace.py'"
check 26 "ComfyUI ACEStep15 model + ACEAudio15 latent present"    "1 1" "echo \"\$(grep -c 'class ACEStep15' '$CT/comfy/supported_models.py') \$(grep -c 'class ACEAudio15' '$CT/comfy/latent_formats.py')\""
check 27 "DualCLIPLoader supports type \"ace\""                    2 "grep -c '\"ace\"' '$CT/nodes.py'"
check 28 "official ACE-Step blueprint present"                    present "test -f '$CT/blueprints/Text to Audio (ACE-Step 1.5).json' && echo present"
check 29 "ComfyUI prompt + cancel routes present"                 2 "grep -cE 'routes.post\\(\"/prompt\"\\)|/api/jobs/\\{job_id\\}/cancel' '$CT/server.py'"
check 30 "ffmpeg present"                                         present "test -x /usr/bin/ffmpeg && echo present"

echo "--- prerequisites (PREREQ; never DRIFT) ---"
prereq "P1-0083 kind/api allowlist"  "grep -q 'openai-images' '$AG/config/models-config-schema-bundle.ts' && sed -n '/export interface ModelPatch/,/^}/p' '$AG/config/model-patch.ts' | grep -qE '^[[:space:]]+kind\\??:'"
prereq "P2-0084 media async jobs"    "sed -n '/export type AsyncJobType/,/;/p' '$AG/async/job-manager.ts' | grep -q '\"media\"' && grep -q 'asyncJobManager' '$AG/extensibility/custom-tools/types.ts' && grep -q 'asyncSettles' '$AG/extensibility/custom-tools/types.ts'"
prereq "P2-0084 media-output helper" "grep -q 'export function generatedMediaPath' '$AG/tools/media-output.ts' && grep -q 'export async function copyMediaToOutputPath' '$AG/tools/media-output.ts'"
prereq "P3-0085 media-job helper"    "grep -q 'export async function runMediaJob' '$AG/tools/media-job.ts' && grep -q 'export async function cancelMediaJob' '$AG/tools/media-job.ts'"
prereq "P3-0085 video role present"  "grep -qE '^[[:space:]]+video:' '$AG/config/model-roles.ts'"
prereq "ACE-Step weights downloaded" "find '$CT/models' -iname '*ace*' 2>/dev/null | grep -q ."
prereq "gateway ACE adapter (G7) live" "curl -s -m 3 http://127.0.0.1:5200/v1/models | grep -q 'ace-step-1.5-turbo'"

echo "--- external readiness (INFO; not acceptance gates) ---"
info "media-gateway :5200" "curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:5200/v1/videos"
info "ComfyUI :8188" "curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:8188/system_stats"

echo "18.3.3 tail candidates (assign the next free number at implementation time):"
grep -n '_omp_tail_candidate "18.3.3"' "$REPO/patches/apply.sh" | tail -3
echo "drift=$drift"
exit $(( drift > 0 ))
