#!/usr/bin/env bash
# Pre-implementation revalidation for subtask 09-27-media-tools-background (P2, media tool background jobs).
# Baseline: omp 18.3.3 WITHOUT this task's patch. Every DRIFT row means the upstream
# assumption the design rests on no longer holds -> revise design.md before implementing.
# Read-only: grep/sed/find against the install plus localhost reachability probes. No credentials, no mutation.
set -u
A="${OMP_ROOT:-/home/chris/.bun/install/global/node_modules/@oh-my-pi}"
AG="$A/pi-coding-agent/src"
TUI="$A/pi-tui/src"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")")"
drift=0

check() { # check <id> <description> <expected> <command...>
	local id="$1" desc="$2" want="$3"; shift 3
	local got; got="$(eval "$*" 2>/dev/null)"
	if [[ "$got" == "$want" ]]; then printf 'PASS  %-3s %s\n' "$id" "$desc"
	else printf 'DRIFT %-3s %s\n      want: %s\n      got:  %s\n' "$id" "$desc" "$want" "$got"; drift=$((drift + 1)); fi
}
info() { printf 'INFO  %-3s %s\n' "$1" "$2"; }
prereq() { # prereq <name> <command printing applied|missing>  (never affects exit code)
	local name="$1"; shift
	printf 'PREREQ %s: %s\n' "$name" "$(eval "$*" 2>/dev/null)"
}

echo "omp pi-coding-agent version: $(grep -m1 -o '"version": *"[^"]*"' "$A/pi-coding-agent/package.json" 2>/dev/null | tr -dc '0-9.')"
echo "root: $A"

# ---- baseline: upstream 18.3.3 facts the design depends on (symbols, not line numbers) ----
check 1  "installed pi-coding-agent version is the 18.3.3 baseline"  '18.3.3' 'grep -m1 -o "\"version\": *\"[^\"]*\"" "$A/pi-coding-agent/package.json" | tr -dc "0-9."'
check 2  "AsyncJobType union is exactly bash|task|eval (no media)"  1 'grep -c "export type AsyncJobType = \"bash\" | \"task\" | \"eval\";" "$AG/async/job-manager.ts"'
check 3  "the union is hardcoded in exactly 2 source sites"          2 'grep -rn "\"bash\" | \"task\" | \"eval\"" "$AG" "$TUI" | wc -l'
check 4  "CustomToolContext has no asyncJobManager/agentId field"   0 'grep -cE "asyncJobManager|agentId" "$AG/extensibility/custom-tools/types.ts"'
check 5  "ExtensionContext has no asyncJobManager field"            0 'grep -c "asyncJobManager" "$AG/extensibility/extensions/types.ts"'
check 6  "ExtensionContext exposes only getAsyncJobSnapshot"        1 'grep -c "getAsyncJobSnapshot(): AsyncJobSnapshot | null;" "$AG/extensibility/extensions/types.ts"'
check 7  "runner createContext inherits only addAdditionalContext"  1 'grep -c "delegation?.context?.addAdditionalContext" "$AG/extensibility/extensions/runner.ts"'
check 8  "runner createContext carries no asyncJobManager"          0 'grep -c "asyncJobManager" "$AG/extensibility/extensions/runner.ts"'
check 9  "RegisteredToolAdapter re-creates ctx via createContext"   1 'grep -c "this.runner.createContext(undefined, {" "$AG/extensibility/extensions/wrapper.ts"'
check 10 "ExtensionRunner ctor takes getAsyncJobSnapshot callback"  1 'grep -c "getAsyncJobSnapshot?: () => AsyncJobSnapshot | null," "$AG/extensibility/extensions/runner.ts"'
check 11 "getSessionContext base ctx has no asyncJobManager"        0 'sed -n "/const getSessionContext = () => ({/,/^		});/p" "$AG/sdk.ts" | grep -c "asyncJobManager"'
check 12 "createCustomToolContext projection entry point exists"    1 'grep -c "function createCustomToolContext(ctx: ExtensionContext): CustomToolContext" "$AG/sdk.ts"'
check 13 "custom-tool projection still lists the 7 known fields"    1 'grep -c "localProtocolOptions: ctx.localProtocolOptions," "$AG/sdk.ts"'
check 14 "owner-scoped manager is threaded into sessions"           3 'grep -c "asyncJobManager: scopedAsyncJobManager" "$AG/sdk.ts"'
check 15 "secondary in-process top-level session has no manager"    1 'grep -c "options.parentTaskPrefix ? AsyncJobManager.instance() : undefined" "$AG/sdk.ts"'
check 16 "session exposes getAgentId for ownerId routing"           1 'grep -c "getAgentId(): string | undefined" "$AG/session/agent-session.ts"'
check 17 "unowned deliveries dead-letter (no live sink)"            1 'grep -c "no delivery sink" "$AG/async/job-manager.ts"'
check 18 "manager is constructed without a default onJobComplete"   1 'grep -c "onJobComplete" "$AG/sdk.ts"'
check 19 "register accepts queued: true (no execution slot held)"   1 'grep -c "queued: options?.queued === true" "$AG/async/job-manager.ts"'
check 20 "markRunning clears the queued flag"                       1 'grep -c "job.queued = false" "$AG/async/job-manager.ts"'
check 21 "atCapacity counts only non-queued running jobs"           1 'grep -c "!job.queued" "$AG/async/job-manager.ts"'
check 22 "register capacity check ignores queued jobs"              1 'grep -c "!existing.queued" "$AG/async/job-manager.ts"'
check 23 "default running-job cap is 15"                            1 'grep -c "const DEFAULT_MAX_RUNNING_JOBS = 15;" "$AG/async/job-manager.ts"'
check 24 "at-capacity registration throws instead of falling back"  1 'grep -c "Background job limit reached" "$AG/async/job-manager.ts"'
check 25 "session teardown cancels own jobs by ownerId"             1 'grep -c "cancelAll({ ownerId: this.#agentId }" "$AG/session/agent-session.ts"'
check 26 "delivery folds latestDetails.images into provider content" 1 'grep -cF "latestDetails?.images ?? []" "$AG/session/async-job-delivery.ts"'
check 27 "AsyncResultJobDetails card payload type exists"           1 'grep -c "type AsyncResultJobDetails = {" "$AG/session/async-job-delivery.ts"'
check 28 "async-result UI card builder exists in pi-tui"            1 'grep -c "export function buildAsyncResultBlock" "$TUI/chat/transcript-render-helpers.ts"'
check 29 "pi-tui JobSnapshot union is the second hardcoded copy"    1 'grep -c "\"bash\" | \"task\" | \"eval\"" "$A/pi-tui/dist/types/tools/wait.d.ts"'
check 30 "ensurePng conversion cache exists for thumbnails"         1 'grep -c "export function ensurePng" "$TUI/chat/image-loading.ts"'
check 31 "foreground tool details.images render path exists"        1 'grep -c "function imageBlocksFromDetails" "$TUI/chat/tool-execution.ts"'
check 32 "terminal.showImages gate exists for image rendering"      1 'grep -c "id: \"terminal.showImages\"" "$AG/modes/settings.ts"'
check 33 "image-gen still saves to os tmpdir (to be replaced)"      2 'grep -c "saveImagesToTemp" "$AG/tools/image-gen.ts"'
check 34 "image-gen still uses os.tmpdir()"                         1 'grep -c "os.tmpdir()" "$AG/tools/image-gen.ts"'
check 35 "image-gen details still carry base64 images"              1 'grep -c "images: result.images," "$AG/tools/image-gen.ts"'
check 36 "tts output_path is still required in the schema"          1 'grep -c "output_path: \"string\"," "$AG/tools/tts.ts"'
check 37 "tts resolves output_path against cwd"                     1 'grep -c "resolveToCwd(params.output_path, cwd)" "$AG/tools/tts.ts"'
check 38 "async.enabled global gate exists"                         1 'grep -c "id: \"async.enabled\"" "$AG/tools/settings.ts"'
check 39 "generate_image.enabled gate exists"                       1 'grep -c "id: \"generate_image.enabled\"" "$AG/tools/settings.ts"'
check 40 "speechgen.enabled gate exists"                            1 'grep -c "id: \"speechgen.enabled\"" "$AG/tools/settings.ts"'
check 41 "cloud speech transport keeps its 60s hard timeout"        2 'grep -c "SPEECH_TIMEOUT_MS" "$A/pi-ai/src/speech/transport.ts"'
check 42 "/jobs renders job.type by string interpolation"           1 'grep -cF "\${job.type}]" "$AG/modes/controllers/command-controller.ts"'
check 43 "proc:// renders job.type by string interpolation"         2 'grep -cF "\${job.type}]" "$AG/internal-urls/proc-protocol.ts"'
check 44 "AsyncJobSnapshotItem is derived from AsyncJob"            1 'grep -c "export type AsyncJobSnapshotItem = Pick<" "$AG/session/agent-session-types.ts"'
check 45 "AsyncJobDetails is an open Record (new keys allowed)"     1 'grep -c "export interface AsyncJobDetails extends Record<string, unknown>" "$AG/async/job-manager.ts"'
check 46 "AsyncJobManager is exported for ctx typing"               1 'grep -c "export class AsyncJobManager" "$AG/async/job-manager.ts"'
check 47 "bash background notice formatter lives in pi-tui"         1 'grep -c "export function formatBackgroundNotice" "$TUI/tools/bash.ts"'
check 48 "tools/bash.ts reuses formatBackgroundNotice"              1 'grep -c "formatBackgroundNotice(jobId)" "$AG/tools/bash.ts"'
check 49 "bash reports async details with type: bash"               2 'grep -c "async: { state: \"running\", jobId, type: \"bash\" }" "$AG/tools/bash.ts"'
check 50 "immediate backgrounding helper exists (0 = background now)" 1 'grep -c "export function resolveAutoBackgroundWaitMs" "$AG/async/auto-background.ts"'
check 51 "print + ACP modes never settle async work (interactive/RPC/subagent executor do)" 0 'grep -rl "settleAsyncWork" "$AG/modes/print-mode.ts" "$AG/modes/acp" 2>/dev/null | wc -l'
check 52 "print mode disposes the session right after the turn"   1 'grep -c "await session.dispose({ mnemopiConsolidateTimeoutMs" "$AG/modes/print-mode.ts"'
check 53 "tts falls back only on MissingApiKeyError|ProviderHttpError (conn errors abort the chain)" 1 'grep -c "error instanceof MissingApiKeyError || error instanceof ProviderHttpError" "$AG/tools/tts.ts"'
check 54 "image-gen falls back only on ProviderHttpError"          1 'grep -c "if (!(error instanceof ProviderHttpError) || requestSignal?.aborted) throw error;" "$AG/tools/image-gen.ts"'
check 55 "speech transport carries its own timeout signal"        1 'grep -c "AbortSignal.timeout(SPEECH_TIMEOUT_MS)" "$A/pi-ai/src/speech/transport.ts"'

# ---- informational: never affects the exit code ----
info 1 "tests shipped in install: $(find "$A" -maxdepth 3 -type d -name 'test*' 2>/dev/null | wc -l) dir(s) (0 = no AsyncJobType test to re-pin; npm tarball ships no tests)"
info 2 "Object.keys(ctx)/JSON.stringify(ctx) observers in extensibility: $(grep -rn "Object.keys(ctx)\|JSON.stringify(ctx)" "$AG/extensibility" 2>/dev/null | wc -l) hit(s) (0 = adding optional ctx keys cannot change an observed key set)"
info 3 "18.3.3 tail candidates in repo: $(grep -c "_omp_tail_candidate \"18.3.3\"" "$REPO/patches/apply.sh" 2>/dev/null) entr(ies), last: $(grep "_omp_tail_candidate \"18.3.3\"" "$REPO/patches/apply.sh" 2>/dev/null | tail -1)"
info 4 "18.3.3 plan contract line: $(grep -o "48-entry capability contract" "$REPO/patches/verify-patch-family-rollups.sh" 2>/dev/null | head -1) (recount at implementation time; 49+ once P1/0083 lands)"
info 5 "external jimeng proxy 5100 http: $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:5100/v1/models 2>/dev/null) (P1 backend for the real smoke; the P2 gate itself uses in-process fake HTTP)"
info 6 "external media gateway 5200 http: $(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:5200/v1/models 2>/dev/null) (P3 backend; 000 = not running yet, expected)"

info 7 "bun fetch connection-failure error code (D14 allowlist): $(bun -e 'try{await fetch("http://127.0.0.1:1/x")}catch(e){console.log(String(e.code))}' 2>/dev/null) (expected ConnectionRefused on Bun 1.3.x)"

# ---- predecessor / successor markers: informational only, must never gate ----
prereq p1-model-kinds 'grep -q "openai-images" "$AG/config/models-config-schema-bundle.ts" && echo applied || echo missing'
prereq p2-media-job-type 'grep -q "| \"media\"" "$AG/async/job-manager.ts" && echo applied || echo missing'
prereq p2-media-output-module 'test -f "$AG/tools/media-output.ts" && echo applied || echo missing'
prereq p3-generate-video 'grep -q "generate_video" "$AG/sdk.ts" && echo applied || echo missing'
prereq p4-music-kind 'grep -q "\"music\"" "$A/pi-catalog/src/types.ts" && echo applied || echo missing'

echo "drift=$drift"
exit $(( drift > 0 ))
