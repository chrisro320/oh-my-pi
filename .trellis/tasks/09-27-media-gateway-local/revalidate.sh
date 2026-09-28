#!/usr/bin/env bash
# Pre-implementation revalidation for subtask 09-27-media-gateway-local (local media gateway service).
#
# Baseline: omp 18.3.3 UNPATCHED wire contracts + ComfyUI 0.35.0 source + jimeng-free-api 0.0.6 repo
# + the user's own ComfyUI workflows/weights state.
# Every check describes an EXTERNAL interface this plan depends on; nothing depends on this task's output.
# Read-only. No network beyond loopback (never calls Google/AI Studio).
#
#   PASS   the baseline assumption still holds
#   DRIFT  upstream (or the user's workflow/asset state) moved -> revise design.md before implementing (exit 1)
#   PREREQ informational: predecessor patch / on-disk asset / external service state (never affects exit)
#
# Credentials are checked for EXISTENCE only; values are never read or printed.
# Overrides: OMP_ROOT, COMFY_ROOT, JIMENG_REPO, JIMENG_URL, GATEWAY_PORT, FFMPEG, HF_CACHE
set -u
A="${OMP_ROOT:-/home/chris/.bun/install/global/node_modules/@oh-my-pi}"
AI="$A/pi-ai/src"
AG="$A/pi-coding-agent/src"
AC="$A/pi-catalog/src"
CT="${COMFY_ROOT:-/media/chris/Agents/LLM/ComfyUI}"
JM="${JIMENG_REPO:-/home/chris/jimeng-free-api/repo}"
JW="${JIMENG_URL:-http://127.0.0.1:5100}"
GP="${GATEWAY_PORT:-5200}"
FF="${FFMPEG:-/usr/bin/ffmpeg}"
HF="${HF_CACHE:-$HOME/.cache/huggingface/hub}"
H3WF="$CT/user/default/workflows/H3-官方本地/video_minimax_h3_t2v.json"
ACEBP="$CT/blueprints/Text to Audio (ACE-Step 1.5).json"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/../../..")"
drift=0
prereq_ok=0
prereq_bad=0

check() { # check <id> <description> <expected> <command...>
	local id="$1" desc="$2" want="$3"; shift 3
	local got; got="$(eval "$*" 2>/dev/null)"
	if [[ "$got" == "$want" ]]; then printf 'PASS  %-3s %s\n' "$id" "$desc"
	else printf 'DRIFT %-3s %s\n      want: %s\n      got:  %s\n' "$id" "$desc" "$want" "$got"; drift=$((drift + 1)); fi
}

prereq() { # prereq <label> <command...>  -> applied | missing (marker symbol of a predecessor patch)
	local label="$1"; shift
	local got; got="$(eval "$*" 2>/dev/null)"
	if [[ -n "$got" && "$got" != "0" ]]; then printf 'PREREQ %-30s applied\n' "$label"; prereq_ok=$((prereq_ok + 1))
	else printf 'PREREQ %-30s missing\n' "$label"; prereq_bad=$((prereq_bad + 1)); fi
}

need() { # need <label> <path...>  every path must exist, be non-empty (files) / readable (dirs)
	local label="$1"; shift
	local n=$# ok=0 miss=""
	for f in "$@"; do
		if [[ -d "$f" ]]; then
			if [[ -r "$f" ]]; then ok=$((ok + 1)); else miss+="$(basename "$f") "; fi
		elif [[ -r "$f" && -s "$f" ]]; then ok=$((ok + 1))
		else miss+="$(basename "$f") "; fi
	done
	if (( ok == n )); then printf 'PREREQ %-30s present  (%d/%d)\n' "$label" "$ok" "$n"; prereq_ok=$((prereq_ok + 1))
	else printf 'PREREQ %-30s INCOMPLETE (%d/%d) missing: %s\n' "$label" "$ok" "$n" "$miss"; prereq_bad=$((prereq_bad + 1)); fi
}

needfind() { # needfind <label> <min> <dir-csv> <name-glob>  count readable non-empty files (symlinks followed) >= min
	local label="$1" min="$2" dirs="$3" pat="$4"
	local ok=0
	local IFS=','
	for d in $dirs; do
		local c; c="$(find -L "$d" -maxdepth 4 -type f -name "$pat" -size +0c -readable 2>/dev/null | wc -l)"
		ok=$((ok + c))
	done
	unset IFS
	if (( ok >= min )); then printf 'PREREQ %-30s present  (%d>=%d)\n' "$label" "$ok" "$min"; prereq_ok=$((prereq_ok + 1))
	else printf 'PREREQ %-30s MISSING  (%d<%d)\n' "$label" "$ok" "$min"; prereq_bad=$((prereq_bad + 1)); fi
}

needexists() { # needexists <label> <path...>  existence ONLY (never opens or reads the file)
	local label="$1"; shift
	local n=$# ok=0 miss=""
	for f in "$@"; do if [[ -e "$f" ]]; then ok=$((ok + 1)); else miss+="$f "; fi; done
	if (( ok == n )); then printf 'PREREQ %-30s present  (%d/%d, existence only)\n' "$label" "$ok" "$n"; prereq_ok=$((prereq_ok + 1))
	else printf 'PREREQ %-30s MISSING  (%d/%d) %s\n' "$label" "$ok" "$n" "$miss"; prereq_bad=$((prereq_bad + 1)); fi
}

needdirfiles() { # needdirfiles <label> <min> <dir>  require >= min non-empty files inside (symlinks followed)
	local label="$1" min="$2" dir="$3"
	local ok=0
	if [[ -d "$dir" ]]; then ok="$(find -L "$dir" -type f -size +0c 2>/dev/null | wc -l)"; fi
	ok="${ok:-0}"
	if (( ok >= min )); then printf 'PREREQ %-30s present  (%d>=%d files)\n' "$label" "$ok" "$min"; prereq_ok=$((prereq_ok + 1))
	else printf 'PREREQ %-30s MISSING  (%d<%d files)\n' "$label" "$ok" "$min"; prereq_bad=$((prereq_bad + 1)); fi
}

echo "== baseline facts =="
echo "omp pi-coding-agent version : $(grep -m1 '"version"' "$A/pi-coding-agent/package.json" 2>/dev/null | tr -d ' ,')"
echo "ComfyUI version             : $(grep -m1 '__version__' "$CT/comfyui_version.py" 2>/dev/null | tr -d ' ,')"
echo

echo "== omp wire contracts: video (openrouter-video) =="
check 1  "video transport file exists"               present "test -f '$AI/video/openrouter-video.ts' && echo present"
check 2  "videoJobSchema present"                    1 "grep -c 'const videoJobSchema' '$AI/video/openrouter-video.ts'"
check 3  "unsigned_urls -> contentUrls"              1 "grep -c 'parsed.unsigned_urls' '$AI/video/openrouter-video.ts'"
check 4  "content endpoint /videos/{id}/content"     1 "grep -c 'videos/\${encodeURIComponent(jobId)}/content' '$AI/video/openrouter-video.ts'"
check 5  "submit endpoint /videos"                   1 "grep -c 'authenticatedFetch(model, \"/videos\"' '$AI/video/openrouter-video.ts'"
check 6  "8-value status vocabulary"                 8 "grep -oE \"'(queued|processing|pending|in_progress|completed|failed|cancelled|expired)'\" '$AI/video/openrouter-video.ts' | sort -u | wc -l"
check 7  "only openrouter-video dispatch (3 sites)"  3 "grep -c 'model.api === \"openrouter-video\"' '$AI/video/index.ts'"
check 8  "video type unions present"                 3 "grep -cE 'export type (VideoResolution|VideoAspectRatio|VideoJobStatus) =' '$AI/video/types.ts'"
echo

echo "== omp server-side video spec (pi-ai/src/providers/video-server.ts) =="
check 9  "5 exported wire helpers"                   5 "grep -cE 'export function (parseRequest|encodeSubmitResponse|encodePollResponse|encodeGatewayJobId|formatError)' '$AI/providers/video-server.ts'"
check 10 "error envelope {error:{code,type,message}}" 1 "grep -c 'error: { code: status, type: errorType, message }' '$AI/providers/video-server.ts'"
check 11 "only auth-gateway calls video transport"   3 "grep -rnE 'submitVideo\(|pollVideo\(|downloadVideo\(' '$AI' | grep -v '/src/video/' | wc -l"
echo

echo "== omp wire contracts: speech (openai-speech) =="
check 12 "/audio/speech endpoint"                    1 "grep -c '\"/audio/speech\"' '$AI/speech/openai-speech.ts'"
check 13 "speech timeout hard-coded 60s"             1 "grep -c 'SPEECH_TIMEOUT_MS = 60_000' '$AI/speech/transport.ts'"
check 14 "tts codec from output extension"           1 "grep -c 'endsWith(\".wav\") ? \"wav\" : \"mp3\"' '$AG/tools/tts.ts'"
echo

echo "== omp wire contracts: images (openai-images) =="
check 15 "text-to-image posts /images/generations"   2 "grep -c 'images/generations' '$AI/images/openai-images.ts'"
check 16 "reference path posts /images/edits (JSON)" 2 "grep -c 'images/edits' '$AI/images/openai-images.ts'"
check 17 "size collapses to exactly three values"    2 "grep -cE 'return \"(1024x1536|1536x1024)\"' '$AI/images/shared.ts'"
check 18 "generate_image hard-codes count: 1"        1 "grep -c 'count: 1' '$AG/tools/image-gen.ts'"
check 19 "response decoder accepts b64_json+media_type" 2 "grep -c 'image.media_type' '$AI/images/shared.ts'"
check 20 "openai-images is a valid image api"        1 "grep -c 'api === \"openai-images\"' '$AI/images/index.ts'"
check 21 "SPEECH_APIS includes openai-speech"        1 "grep -c 'SPEECH_APIS = \\[\"xai-tts\", \"openai-speech\"\\]' '$AI/speech/index.ts'"
echo

echo "== omp models.yml schema (what the gateway provider rows must satisfy) =="
check 22 "ModelDefinition input enum is text|image only" 1 "sed -n '/const ModelDefinitionSchema = type({/,/^\t}).narrow/p' '$AG/config/models-config-schema-bundle.ts' | grep -cF '(\"text\" | \"image\")[]'"
check 23 "provider schema has baseUrl/apiKey/models" 3 "sed -n '/const ProviderConfigSchema = type({/,/^\t}).narrow/p' '$AG/config/models-config-schema-bundle.ts' | grep -cE '\"(baseUrl|apiKey|models)\\?\": '"
echo

echo "== ComfyUI 0.35.0 HTTP contract ($CT) =="
check 24 "per-job atomic cancel route"               1 "grep -c 'api/jobs/{job_id}/cancel' '$CT/server.py'"
check 25 "_cancel_job_by_id implementation"          3 "grep -c '_cancel_job_by_id' '$CT/server.py'"
check 26 "POST /free"                                1 "grep -c '@routes.post(\"/free\")' '$CT/server.py'"
check 27 "GET /system_stats"                         1 "grep -c '@routes.get(\"/system_stats\")' '$CT/server.py'"
check 28 "POST /prompt"                              1 "grep -c '@routes.post(\"/prompt\")' '$CT/server.py'"
check 29 "POST /upload/image (only upload route)"    1 "grep -c '@routes.post(\"/upload/image\")' '$CT/server.py'"
check 30 "GET /history/{prompt_id}"                  1 "grep -c '@routes.get(\"/history/{prompt_id}\")' '$CT/server.py'"
check 31 "GET /view"                                 1 "grep -c '@routes.get(\"/view\")' '$CT/server.py'"
check 32 "GET /queue"                                1 "grep -c '@routes.get(\"/queue\")' '$CT/server.py'"
check 33 "upload handler does no MIME validation"    0 "sed -n '/def image_upload/,/@routes.post(\\\"\\\\/upload\\\\/image\\\")/p' '$CT/server.py' | grep -cE 'mimetypes|content_type|guess_type'"
echo

echo "== ComfyUI ACE-Step 1.5 nodes (music backend) =="
check 34 "three ACE nodes present"                   3 "grep -cE 'node_id=\"(TextEncodeAceStepAudio1.5|EmptyAceStep1.5LatentAudio|ReferenceTimbreAudio)\"' '$CT/comfy_extras/nodes_ace.py'"
check 35 "SaveAudioAdvanced node"                    1 "grep -c 'node_id=\"SaveAudioAdvanced\"' '$CT/comfy_extras/nodes_audio.py'"
check 36 "core supports ACEStep15"                   1 "grep -c 'class ACEStep15' '$CT/comfy/supported_models.py'"
echo

echo "== ComfyUI MiniMax H3 t2v workflow facts =="
check 37 "t2v workflow is UI format (needs export)"  0 "grep -c '\"class_type\"' '$H3WF'"
check 38 "t2v does NOT use the latent upscaler"      0 "grep -c 'latent_upscal' '$H3WF'"
check 39 "t2v references the missing turbo LoRA"     8 "grep -c 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16' '$H3WF'"
check 40 "t2v has NO LoadImage node (frame branch must be added or 400)" 0 "grep -c 'LoadImage' '$H3WF'"
echo

echo "== user workflow edit prerequisites (F06: must be edited before the owning phase) =="
check 41 "ACE blueprint has NO output node (add SaveAudio*)"        0 "grep -cE 'SaveAudio|PreviewAudio' '$ACEBP'"
check 42 "ACE blueprint has NO reference-audio chain (add branch)"  0 "grep -cE 'LoadAudio|VAEEncodeAudio|ReferenceTimbreAudio' '$ACEBP'"
echo

echo "== jimeng-free-api ($JM, proxy at $JW) =="
check 43 "image route /generations exists"           1 "grep -c '\"/generations\"' '$JM/src/api/routes/images.ts'"
check 44 "video route /generations exists"           1 "grep -c \"'/generations'\" '$JM/src/api/routes/videos.ts'"
check 45 "video sync budget ~20 min (maxRetries 60)" 1 "grep -c 'maxRetries = 60' '$JM/src/api/controllers/videos.ts'"
check 46 "proxy lists the 5 planned image models"    5 "curl -s -m 5 '$JW/v1/models' | grep -oE 'jimeng-image-(5\\.0-pro|5\\.0-lite|4\\.7|4\\.6|4\\.5)\"' | sort -u | wc -l"
check 47 "proxy lists jimeng-video-seedance-2.0-fast" 1 "curl -s -m 5 '$JW/v1/models' | grep -c 'jimeng-video-seedance-2\\.0-fast\"'"
check 48 "proxy reports supported_resolutions"       yes "curl -s -m 5 '$JW/v1/models?type=image' | grep -q 'supported_resolutions' && echo yes"
echo

echo "== local machine interfaces =="
check 49 "ffmpeg present"                            present "test -x '$FF' && echo present"
check 50 "ffmpeg has libmp3lame"                     1 "'$FF' -hide_banner -encoders 2>/dev/null | grep -c libmp3lame"
check 51 "port $GP is free"                          0 "ss -ltn 2>/dev/null | grep -c ':$GP'"
echo

echo "== informational prerequisites (do not affect exit code; credential paths: existence only, values never read) =="
prereq patch-P1-kind-0083        "grep -c 'openai-images' '$AG/config/models-config-schema-bundle.ts'"
prereq patch-P2-media-jobs       "grep -c '\"media\"' '$AG/async/job-manager.ts'"
prereq patch-P3-video-tool       "grep -c 'generate_video' '$AG/tools/video-gen.ts' 2>/dev/null | head -1"
prereq patch-P4-music-kind       "grep -c '\"music\"' '$AC/types.ts'"
echo "-- Qwen-Image route A = GGUF Q4_K_M (TE may be any qwen_2.5_vl_7b variant: fp8 or nvfp4, see design D6.7)"
needfind qimg-A-unet-gguf 1 "$CT/models/diffusion_models,$CT/models/unet" "*2512*Q4_K_M*.gguf"
needfind qimg-text-encoder 1 "$CT/models/text_encoders,$CT/models/clip" "qwen_2.5_vl_7b_*.safetensors"
need     qimg-vae "$CT/models/vae/qwen_image_vae.safetensors"
need     qimg-lightning-lora "$CT/models/loras/Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors"
needdirfiles node-ComfyUI-GGUF 1 "$CT/custom_nodes/ComfyUI-GGUF"
echo "-- Qwen-Image route B = fp8 UNET (+ the fp8 TE variant specifically)"
need     qimg-B-unet-fp8 "$CT/models/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors"
need     qimg-B-te-fp8 "$CT/models/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"
echo "-- MiniMax H3 turbo LoRA (any single non-empty file; symlinks followed)"
needfind h3-turbo-lora 1 "$CT/models/loras" "*fl2v_turbo*.safetensors"
echo "-- ACE-Step 1.5 (all four required; 0.6b + 1.7b are the recommended TE pair)"
need     ace-step-all "$CT/models/diffusion_models/acestep_v1.5_turbo.safetensors" "$CT/models/text_encoders/qwen_0.6b_ace15.safetensors" "$CT/models/text_encoders/qwen_1.7b_ace15.safetensors" "$CT/models/vae/ace_1.5_vae.safetensors"
echo "-- local Qwen3-TTS (shim interpreter + HF snapshot with real files)"
need     qwen3tts-venv "$REPO/services/media-gateway/py/qwen3tts/venv/bin/python"
needdirfiles qwen3tts-weights 3 "$HF/models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice"
echo "-- credentials / install (existence only)"
needexists creds-jimeng-config "/home/chris/.config/jimeng"
needexists creds-gateway-config "$HOME/.config/media-gateway/config.yml"
needexists gateway-installed "$REPO/services/media-gateway"
echo "PREREQ comfy/running                http=$([ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:8188/system_stats" 2>/dev/null)" = "200" ] && echo yes || echo no)"
echo "PREREQ 18.3.3 tail candidates:"
grep -n '_omp_tail_candidate "18.3.3"' "$REPO/patches/apply.sh" 2>/dev/null | tail -3

echo
echo "prereq: $prereq_ok satisfied / $prereq_bad outstanding (informational)"
echo "drift=$drift"
exit $(( drift > 0 ))
