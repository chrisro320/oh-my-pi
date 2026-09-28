#!/usr/bin/env bash
# Pre-implementation revalidation for subtask 09-27-video-role-tool (patch P3, provisional 0085).
#
# Baseline: omp 18.3.3 UNPATCHED. PASS = baseline assumption still holds; DRIFT = upstream changed
# (revise design.md before implementing; a DRIFT on this task's own artifact also means P3 is already applied).
#
# F01 rule: every DRIFT check below must hold BOTH before any predecessor lands AND after P1 (0083) + P2 (0084)
# are applied. Facts those predecessors introduce are PREREQ lines (informational, never affect the exit code).
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
echo "--- upstream facts: must hold before AND after P1/P2 (unpatched 18.3.3) ---"
check 1  "catalog MODEL_KINDS already has video"                  1 "grep -c '\"video\",' '$CAT/src/types.ts'"
check 2  "published MODEL_KINDS literal has video"                2 "grep -c '\"video\"' '$CAT/dist/types/types.d.ts'"
check 3  "RUNNER_APIS has openrouter-video"                       1 "grep -c '\"openrouter-video\",' '$CAT/src/types.ts'"
check 4  "three video transports dispatch on openrouter-video"    3 "grep -c 'model.api === \"openrouter-video\"' '$AI/video/index.ts'"
check 5  "submit POSTs /videos"                                   1 "grep -c '\"/videos\"' '$AI/video/openrouter-video.ts'"
check 6  "content GET sends Accept: video/*"                      1 "grep -c 'Accept: \"video/\\*\"' '$AI/video/openrouter-video.ts'"
check 7  "job status union exists (expired anchor)"               1 "grep -c 'expired' '$AI/video/openrouter-video.ts'"
check 8  "VideoOptions = apiKey/fetch/signal, no timeout"         "1 0" "echo \"\$(sed -n '/export interface VideoOptions/,/^}/p' '$AI/video/openrouter-video.ts' | grep -c 'signal') \$(sed -n '/export interface VideoOptions/,/^}/p' '$AI/video/openrouter-video.ts' | grep -c 'timeout')\""
check 9  "provider.options escape hatch exists"                   1 "grep -c 'provider?: { options' '$AI/video/types.ts'"
check 10 "audio_url input reference exists"                       1 "grep -c 'audioUrl' '$AI/video/types.ts'"
check 11 "server-side wire reference symbols"                     "1 1" "echo \"\$(grep -c 'export function parseRequest' '$AI/providers/video-server.ts') \$(grep -c 'export function formatError' '$AI/providers/video-server.ts')\""
check 12 "withAuth helper (used for the F07 cancel call)"         1 "grep -c 'export async function withAuth' '$AI/auth-retry.ts'"
check 13 "pi-tui roles have no video (P3's own edit point)"       0 "grep -c '\"video\"' '$T/overlays/model-browser.ts'"
check 14 "published ModelRole union has no video"                 0 "grep -c 'video' '$A/pi-tui/dist/types/overlays/model-browser.d.ts'"
check 15 "MODEL_ROLES is a full Record and has no video key"      "1 0" "echo \"\$(grep -c 'MODEL_ROLES: Record<ModelRole, ModelRoleInfo>' '$AG/config/model-roles.ts') \$(grep -cE '^[[:space:]]+video:' '$AG/config/model-roles.ts')\""
check 16 "priority.json has no video chain"                       0 "grep -c '\"video\"' '$AG/priority.json'"
check 17 "ApiSchema has no openrouter-video"                      0 "grep -c 'openrouter-video' '$AG/config/models-config-schema-bundle.ts'"
check 18 "ModelDefinitionSchema kind union has no video (P3's own edit)" 0 "grep -c '\"video\"' '$AG/config/models-config-schema-bundle.ts'"
check 19 "shared tools/media-job.ts absent (P3 creates it)"       no "test -f '$AG/tools/media-job.ts' && echo yes || echo no"
check 20 "published settings.d.ts has no cfgGenerateVideoEnabled" 0 "grep -c 'cfgGenerateVideoEnabled' '$A/pi-coding-agent/dist/types/tools/settings.d.ts'"
check 21 "tools barrel exports image-gen"                         1 "grep -c 'export \\* from \"./image-gen\"' '$AG/tools/index.ts'"
check 22 "image-gen template anchors (roleCandidatePool + name)"  "1 1" "echo \"\$(grep -c 'roleCandidatePool(\"image\"' '$AG/tools/image-gen.ts') \$(grep -c 'name: \"generate_image\"' '$AG/tools/image-gen.ts')\""
check 23 "settings-gated mount site exists"                       1 "grep -c 'const reconcileSettingsGatedCustomTools' '$AG/sdk.ts'"
check 24 "speech has 60s timeout; video transport has none"       "1 0" "echo \"\$(grep -c 'SPEECH_TIMEOUT_MS = 60_000' '$AI/speech/transport.ts') \$(grep -c 'timeout' '$AI/video/openrouter-video.ts')\""
check 25 "jimeng proxy advertises the 2 planned video models"      2 "curl -s -m 5 http://127.0.0.1:5100/v1/models | grep -oE 'jimeng-video-seedance-2\\.0-(fast|mini)\"' | sort -u | wc -l"
check 26 "ffmpeg present"                                         present "test -x /usr/bin/ffmpeg && echo present"
check 27 "ComfyUI tree present (MiniMax H3 backend)"              present "test -d '$CT' && echo present"

echo "--- prerequisites (PREREQ; never DRIFT) ---"
prereq "P1-0083 kind/api allowlist" "grep -q 'openai-images' '$AG/config/models-config-schema-bundle.ts' && sed -n '/export interface ModelPatch/,/^}/p' '$AG/config/model-patch.ts' | grep -qE '^[[:space:]]+kind\\??:'"
prereq "P2-0084 media async jobs"   "sed -n '/export type AsyncJobType/,/;/p' '$AG/async/job-manager.ts' | grep -q '\"media\"' && grep -q 'asyncJobManager' '$AG/extensibility/custom-tools/types.ts' && grep -q 'asyncSettles' '$AG/extensibility/custom-tools/types.ts'"
prereq "P2-0084 media-output helper" "grep -q 'export function generatedMediaPath' '$AG/tools/media-output.ts' && grep -q 'export async function copyMediaToOutputPath' '$AG/tools/media-output.ts'"

echo "--- external readiness (INFO; not acceptance gates) ---"
info "media-gateway :5200" "curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:5200/v1/videos"
info "gateway routes (G0/F07, read-only GET)" "curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:5200/v1/models"
info "ComfyUI :8188" "curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:8188/system_stats"
info "jimeng proxy :5100" "curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:5100/v1/models"

echo "18.3.3 tail candidates (assign the next free number at implementation time):"
grep -n '_omp_tail_candidate "18.3.3"' "$REPO/patches/apply.sh" | tail -3
echo "drift=$drift"
exit $(( drift > 0 ))
