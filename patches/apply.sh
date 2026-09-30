#!/usr/bin/env bash
# Re-apply local omp source patches after an upgrade.
#
#   ~/.omp/patches/apply.sh          apply (idempotent)
#   ~/.omp/patches/apply.sh --revert undo, restore the stock bundle entrypoint
#   ~/.omp/patches/apply.sh --check  report state, change nothing
#   ~/.omp/patches/apply.sh --verify-rollups  rebuild sandboxes and verify the
#                                  five family rollups (needs npm registry)
#
# omp ships its TypeScript sources, and bun can execute them directly, so these
# are ordinary source patches rather than surgery on the 19 MB dist/cli.js
# bundle. `bin/omp` is repointed at src/cli.ts to make them take effect; the
# stock bundle is left untouched at dist/cli.js.
#
# Every `bun update`/`bun add -g` wipes both the patches and the symlink. Re-run
# this script afterwards.
set -euo pipefail

NM="${HOME}/.bun/install/global/node_modules/@oh-my-pi"
TUI="${NM}/pi-tui"
AGENT="${NM}/pi-coding-agent"
CORE="${NM}/pi-agent-core"
AI="${NM}/pi-ai"
SNAP="${NM}/snapcompact"
BIN="${HOME}/.bun/bin/omp"
SRC_ENTRY="../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts"
BUNDLE_ENTRY="../install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="apply"
case "${1:-}" in
	--revert) MODE="revert" ;;
	--check) MODE="check" ;;
	--print-plan) MODE="print-plan" ;;
	--verify-rollups) MODE="verify-rollups" ;;
	"") ;;
	*)
		echo "usage: $0 [--revert|--check|--print-plan|--verify-rollups]" >&2
		exit 2
		;;
esac

OFFLINE_VERIFY="${OMP_PATCH_OFFLINE_VERIFY:-0}"
case "$OFFLINE_VERIFY" in
	0 | 1) ;;
	*)
		echo "OMP_PATCH_OFFLINE_VERIFY must be 0 or 1" >&2
		exit 2
		;;
esac

# patch-file : package-root
PATCHES=(
	"0033-omp-cache-turn-status-rollup.patch:${AGENT}"
	"0004-omp-token-total-cacheread.patch:${AGENT}"
	"0034-omp-hindsight-snapshot-rollup.patch:${AGENT}"
	"0037-omp-usage-statusline-gate-rollup.patch:${AGENT}"
	"0010-omp-extension-idle-ephemeral-turn.patch:${AGENT}"
	"0035-omp-compaction-prefix-rollup.patch:${NM}"
	"0014-omp-antigravity-deterministic-session-identity.patch:${AI}"
	"0036-omp-image-frame-budget-rollup.patch:${NM}"
	"0017-omp-openai-responses-native-replay-warm.patch:${AI}"
	"0025-omp-ollama-cloud-usage-api.patch:${AI}"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:${AI}"
	"0030-omp-usage-cache-canonical-baseurl.patch:${AI}"
	"0031-omp-agent-session-providers-forward.patch:${AGENT}"
	"0032-omp-goal-tool-resident.patch:${AGENT}"
	"0038-omp-date-cwd-reminder-provider-tail.patch:${NM}"
	"0041-omp-anthropic-usage-turn-gate-60s.patch:${AGENT}"
	"0043-omp-interrupt-prune-symmetry.patch:${AGENT}"
	"0044-omp-image-budget-wire-api-family.patch:${NM}"
	"0052-omp-snapcompact-model-billing-commandcode-budget.patch:${NM}"
	"0057-omp-devin-image-budget.patch:${NM}"
	"0045-omp-snapcompact-frame-reprice.patch:${AGENT}"
	"0046-omp-supersede-warm-prefix-guard.patch:${AGENT}"
	"0048-omp-advisor-quota-rotation-bound.patch:${AGENT}"
	"0050-omp-session-history-preview.patch:${AGENT}"
	"0054-omp-antigravity-drop-requesttype-agent.patch:${AI}"
)

if [[ "$MODE" == "verify-rollups" ]]; then
	# Exec before version selection: the rollup gate builds its own pristine
	# sandboxes (18.0.9 for family checks, 18.1.14 for the full-chain oracle)
	# and must not see or fail on OMP_PATCH_VERSION.
	exec bash "${HERE}/verify-patch-family-rollups.sh"
fi

# Shared versioned-candidate machinery. Usage:
#   _omp_version_candidates VERSION TARGET...
# Each TARGET is either a patch-id prefix (entry replaced by its
# .VERSION-candidates/<name>-vVERSION-candidate.patch, keeping the package
# root) or omit:<prefix> (entry dropped from this version's plan entirely).
# Requires the installed pi-coding-agent to be exactly VERSION; fails closed
# on version mismatch or a missing candidate file.
function _omp_version_candidates {
	local version="$1"; shift
	local pkgjson="${NM}/pi-coding-agent/package.json"
	local installed
	# --print-plan is a read-only plan query: the installed-version gate exists
	# to stop a wrong-version mutation, so it does not apply here. Candidate
	# existence is still checked — that is a repo completeness property.
	if [[ "$MODE" != "print-plan" ]]; then
	installed="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$pkgjson" 2>/dev/null || true)"
	[[ "$installed" == "$version" ]] || {
		echo "OMP_PATCH_VERSION=$version requires pi-coding-agent $version, found: ${installed:-<unreadable>}" >&2
		exit 2
	}
	fi
	local entry name root target mode candidate
	declare -a version_patches=()
	for entry in "${PATCHES[@]}"; do
		name="${entry%%:*}"
		root="${entry##*:}"
		mode=keep
		for target in "$@"; do
			case "$target" in
			omit:*)
				[[ "$name" == "${target#omit:}"-* ]] && { mode=omit; break; }
				;;
			*)
				[[ "$name" == "$target"-* ]] && { mode=replace; break; }
				;;
			esac
		done
		case "$mode" in
		omit) ;;
		replace)
			candidate=".${version}-candidates/${name%.patch}-v${version}-candidate.patch"
			[[ -f "${HERE}/${candidate}" ]] || {
				echo "candidate patch missing: ${HERE}/${candidate}" >&2
				exit 2
			}
			version_patches+=("${candidate}:${root}")
			;;
		*) version_patches+=("$entry") ;;
		esac
	done
	PATCHES=("${version_patches[@]}")
	echo "NOTE: OMP_PATCH_VERSION=$version — plan targets: $*" >&2
}
# Gate selection predicate. `_omp_plan_has 0041` is true when the plan resolved
# for this version carries that patch number. Verifier registration is driven
# by the resolved plan, never by a version string: a new supported version that
# still carries a patch must not silently fall into the "not in this plan"
# branch and lose its gate.
function _omp_plan_has {
	local prefix="$1" entry name
	for entry in "${PATCHES[@]}"; do
		name="${entry%%:*}"
		name="${name##*/}"
		[[ "$name" == "$prefix"-* ]] && return 0
	done
	return 1
}
# Tail-candidate appender. Tail entries are not canonical PATCHES members, so
# `_omp_version_candidates` cannot see them; this appends the versioned
# candidate with the same fail-closed existence check (a missing candidate is a
# repo-completeness defect and must exit 2 before anything is touched).
function _omp_tail_candidate {
	local version="$1" stem="$2" root="$3"
	local candidate=".${version}-candidates/${stem}-v${version}-candidate.patch"
	[[ -f "${HERE}/${candidate}" ]] || {
		echo "candidate patch missing: ${HERE}/${candidate}" >&2
		exit 2
	}
	PATCHES+=("${candidate}:${root}")
}
# Versioned plan selection. The PATCHES array above is the canonical patch
# set shared by every supported plan; it is NOT itself a deployable chain —
# its members' a-sides span multiple upstream releases (e.g. 0045/0046 only
# exist as 18.1.x shapes). Supported plans: 18.1.14 (rollback), 18.1.18,
# 18.2.3, 18.2.10, 18.3.3, 18.4.1, and 18.4.4.
# Unset OMP_PATCH_VERSION auto-routes by the installed pi-coding-agent
# version (exact match only) so the documented one-key re-apply flow keeps
# working; an explicit value must match the installed version or fail
# closed. Unknown/unsupported values exit 2 before anything is touched.

if [[ -z "${OMP_PATCH_VERSION+x}" ]]; then
	pkgjson="${NM}/pi-coding-agent/package.json"
	installed="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$pkgjson" 2>/dev/null || true)"
	case "$installed" in
	18.1.14|18.1.18|18.2.3|18.2.10|18.3.3|18.4.1|18.4.4)
		OMP_PATCH_VERSION="$installed"
		echo "NOTE: OMP_PATCH_VERSION unset — routed to installed ${installed}" >&2
		;;
	*)
		echo "installed pi-coding-agent '${installed:-<unreadable>}' has no supported plan (known: 18.1.14, 18.1.18, 18.2.3, 18.2.10, 18.3.3, 18.4.1, 18.4.4); set OMP_PATCH_VERSION explicitly" >&2
		exit 2
		;;
	esac
fi

case "$OMP_PATCH_VERSION" in
18.1.14)
	# 0004/0014/0017/0030 因上下文行侵蝕需新候選（0014 的 isClaude 尾部上下文、
	# 0030 的 import 區、0004 的 segments 註解塊、0017 的 warm flag 鄰行）；
	# 0010/0035/0038 沿用 18.1.10 候選字節（已核 cmp 相同），為版本計畫完整性另存一份。
	_omp_version_candidates "18.1.14" 0004 0010 0014 0017 0030 0035 0038
	# 0047 的 a 側是 candidate-0038 的產出形態，只能掛在該分支鏈尾。
	PATCHES+=("0047-omp-date-cwd-anchor-stability.patch:${AGENT}")
	# 0063 與 18.1.18 共用同一份位元組（理由見該分支）：codex V2 壓縮的 lite
	# key 分流與前綴重建失配，兩版行為相同。
	PATCHES+=("0063-omp-codex-v2-compaction-live-chain.patch:${NM}")
	;;
18.1.18)
	# 18.1.14 → 18.1.18（上游 4 版：15/16/17/18）。
	# 0051 已於 2026-09-15 完全退役（位元組移入 .retired/09-15-0051-upstream-adopted/）：
	# 上游 18.1.17 逐字採納（prompt_eval_cached_count → cacheRead 映射，連註解一併
	# 進入 pi-ai/src/providers/ollama.ts）。它離開 canonical 陣列後 `omit:0051`
	# 一併移除；`omit:` 分支目前沒有任何存活計畫覆蓋（見 verify-patch-family-rollups.sh）。
	# 0010 需重寫：上游把 #wakeForIrc 的 dispatch 改成 whenWorkPoolYieldSettled()
	# 鏈，idleEphemeral 等待點必須併入該 join 之前，否則破壞「同步 ownership 檢查
	# 與 dispatch 之間無 await」的上游不變式。
	# 0035 需重寫：上游在 prepareCompaction 內把 boundaryStart 回退到上一次
	# compaction 的 firstKeptEntryId，本補丁的 previousRetainedMessages 攜帶列表
	# 語義已被吸收，故退掉該列表、historyTargetMessages 直接等於 messagesToSummarize。
	# 0033/0043 另存候選：canonical 在此版需 fuzz=1，候選把上下文重錨到 fuzz=0。
	# 0004/0014/0017/0030/0038 沿用 18.1.14 候選字節（已核 cmp 相同），
	# 為版本計畫完整性另存一份。
	_omp_version_candidates "18.1.18" 0004 0010 0014 0017 0030 0033 0035 0038 0043
	# 0047 同 18.1.14：a 側是 candidate-0038 的產出形態，只能掛在該分支鏈尾。
	PATCHES+=("0047-omp-date-cwd-anchor-stability.patch:${AGENT}")
	# 0055 僅 18.1.18：devin.ts 的 auth identity 在舊版仍是 windsurf
	# （DEVIN_SESSION_TOKEN_PREFIX），18.1.10+ 才是 devinCliMetadata；
	# 本補丁的 a 側以 18.1.18 樹為準。
	PATCHES+=("0055-omp-devin-auth-cache-turn-timing.patch:${AI}")
	# 0056 同 0055 的理由：a 側以 18.1.18 的 devinCliMetadata 為準。
	# 改的是 ${NM}/pi-catalog/src/wire/devin.ts（官方 CLI 身分 tuple 與
	# per-process sessionId／遞增 requestId），與 0055 的 pi-ai 路徑互不相交。
	PATCHES+=("0056-omp-devin-metadata-alignment.patch:${NM}")
	# 0058 同 0055/0056：a 側是 0055 套用後的 devin.ts 形態（18.1.18 鏈尾），
	# 修 thinking 簽名丟失——服務端把 deltaSignature 放在 deltaThinking 為空的
	# 獨立末尾幀，原碼只在 deltaThinking 分支內讀取 → 回放歷史無簽名 →
	# 服務端不認 → 每輪全量 prefill。捕獲獨立簽名幀 + 回放 signatureType=sealed。
	PATCHES+=("0058-omp-devin-thinking-signature-replay.patch:${AI}")
	# 0060 僅 18.1.18：idle keepalive 對 devin 傳 conversationId=主 sessionId，
	# 讓 side request 與主回合共用 cascade_id（cascadeId 還會 seed 每條
	# messageId），否則 keepalive 每次落在獨立 cascade、暖不到主會話 cache。
	# /btw//omfg 走 runEphemeralTurn 不帶 conversationId，保留 :side: 隔離；
	# cursor 以 conversationId 鍵 append-only 狀態，故只對 devin 啟用。
	PATCHES+=("0060-omp-devin-idle-cascade-pin.patch:${NM}")
	# 0062 僅 18.1.18：snapcompact 縮減基線漏算「即將被取代的舊歸檔」——
	# prepareCompaction 對 v2 preserve data 會把前一條 compaction 記錄排除在
	# 三個區域之外，基線因此看不到它，而投影帶著整份新歸檔（重渲染把舊文字
	# 折進新幀）。第二次以後壓縮等於拿整份新歸檔去比一個已不含舊歸檔的區域，
	# 真的會縮的壓縮被判「would not reduce context」而硬失敗。修法：基線以
	# 與投影相同的 frameTokenEstimate 記入被取代歸檔（淨額：幀數變多仍會拒絕）。
	PATCHES+=("0062-omp-snapcompact-reduction-baseline-previous-archive.patch:${AGENT}")
	# 0063 兩計畫共用：canonical 的 codex V2 遠端壓縮走 lite 傳輸，算出的
	# WebSocket session key 帶 `:lite` 後綴，連到一條沒有 append baseline 的
	# 空 socket；且重建前綴在磁碟上不含每輪注入的 context，嚴格前綴比對必
	# 然失敗 → 全量重播、cachedInputTokens 0（實測 01a09b46/01a09b50）。
	# 修法：壓縮路徑關閉 lite，並讓 chained-body 以 live baseline 為底、
	# 只送尾端 compaction_trigger。a 側形態在 18.1.14 與 18.1.18 相同
	# （0035 未觸及這三處），故不需版本候選。
	PATCHES+=("0063-omp-codex-v2-compaction-live-chain.patch:${NM}")
	# 0065 僅 18.1.18：pi-catalog 的 compat/rules/providers/commandcode.kdl
	# 是 18.1.18 才新增的檔（18.1.14 的 rules 樹只有 192 個 kdl，無此檔），
	# 掛進 canonical 母集會讓 18.1.14 計畫在 full-chain oracle 上「No file to
	# patch」。編譯產物 src/compat/rules.json 兩版也不同，故不做版本候選。
	PATCHES+=("0065-omp-commandcode-deepseek-model-record-parity.patch:${NM}")
	# 0066 僅 18.1.18：Anthropic 原生 server compaction（compact_20260112）
	# 的請求體繞過宿主管線——messages 走 convertToLlmForSideRequest（不跑
	# `context` 擴充鏈，Trellis 注入的 <session-context> 位元組缺失）、tools
	# 直送原始 agent.state.tools（無 normalizeTools 注入的 `i` 欄位）。官方
	# invalidation 規則：tool definitions 變 → tools/system/messages 全作廢。
	# 修法：新增 "live" scope，讓 native 分支複用 0035 已驗證的
	# buildCachePreservingContext（transformContext + buildSideRequestContext）
	# 取整條 live 上下文；宿主兩處 scope 分派補 leaf 對應。callback 回
	# undefined 時保留原手拼路徑。a 側是 0035 候選 + 0063 之後的
	# compaction.ts 形態，故掛鏈尾且不做 18.1.14 候選。
	PATCHES+=("0066-omp-anthropic-native-compaction-live-context.patch:${NM}")
	# 0067 僅 18.1.18：把 0066 的不變量推廣到兩條 OpenAI 遠端 lane 並補齊
	# 儀表。① Codex V2 lane 的 tools/system 同樣改取 buildCachePreservingContext
	# 的 live context（原為 summaryOptions.tools 原始 agent 工具，缺 intent
	# 注入的 `i`，tools 層失效即整條作廢）；② 三條 remote lane 補
	# summarize.request／summarize.usage 的 trace（帶 lane 欄位），Codex V2
	# 記 cachedInputTokens，Anthropic native 記 provider usage 原值——這是
	# 0066 唯一缺的真實命中率樣本來源。a 側是 0066 之後的 compaction.ts 形態。
	PATCHES+=("0067-omp-remote-compaction-lane-trace-live-tools.patch:${NM}")
	# 0068 僅 18.1.18：實測（PI_REQ_DEBUG wire dump）previous_response_id 是
	# connection-scoped——跨 socket 一律 400 invalid_request_error，但鏈式
	# 決策在重連檢查之前，舊代碼會把已死 baseline 的鏈式幀發上新 socket 白
	# 跑一趟。修法：openCodexWebSocketTransport 在 buildCodexChainedRequestBody
	# 前先判 connection.isHealthyForReuse()，不可复用即丟棄 baseline 走非鏈
	# 式；socket 存活時同 socket 鏈式壓縮實測 cached/input=98.0%。另把
	# compaction 實際 wire 形態（transport/chained/canAppend/inputItems）與
	# 每-attempt 診斷寫進 summarize.usage／summarize.attempt trace。
	# a 側是 0063+0067 之後的形態。
	PATCHES+=("0068-omp-codex-stale-baseline-chain.patch:${NM}")
	# 0069 restores Codex effort baselines from branch-local response history.
	# Source shape is pinned to 18.1.18 after 0068; no older-version candidate.
	PATCHES+=("0069-omp-codex-effort-history-resume.patch:${AI}")
	# 0070 僅 18.1.18：Codex V2 壓縮「只准續鏈，不准降級」。實測（session
	# 01a0a5f7，pid 1047924）一次遠端壓縮回報成功卻只命中 8.75%
	# （cached 22912 / input 261873），三層都在偷偷全量重放：
	#   ① openCodexCompactionEventStream 在**開啟**時就清 append baseline，
	#      該次成敗未知，於是重試必然無鏈可續；
	#   ② streamCodexCompactionEvents 遇 WS 傳輸錯自動切 SSE，而 SSE 端點
	#      沒有 previous_response_id（嚴格閘道 400），等於靜默全量；
	#   ③ compact() 的 V2 catch 吞掉錯誤後續走 V1 與 soft，產出一筆命中
	#      率極低但看起來成功的壓縮記錄。
	# The collector commits metadata and invalidates its append baseline only
	# after accepting the summary. Healthy-chain transient failures may retry.
	# Codex endpoint overrides and unchainable WS/SSE sends fail closed before
	# replay; core and both primary-session method ladders preserve the sentinel.
	# a 側是 0069 之後的形態。
	PATCHES+=("0070-omp-codex-compaction-chain-fail-closed.patch:${NM}")
	;;
18.2.3)
	# Preserve the 18.1.18 logical chain on the new upstream tree. The initial
	# textual replay found 13 conflicts; runtime loading additionally exposed
	# 0048's fuzzy insertions inside unrelated import/function/object bodies.
	# Its versioned candidate restores the original quota-rotation semantics.
	# 0004/0014/0017/0035/0043 retain their 18.1.18 candidate bytes.
	# 0037 absorbs 0041: 38 logical entries become 37 physical entries while
	# retaining the 60s Anthropic gate, 50s other-provider TTL and no repaint.
	_omp_version_candidates "18.2.3" \
		0004 0010 0014 0017 0030 0033 0034 0035 0037 0038 0043 0048 omit:0041
	# Tail 條目不在 canonical 母集（它們的 a 側只存在於 18.1.x/18.2.x 鏈尾），
	# 故逐條附加並維持既有順序：0047 掛在 candidate-0038 產出形態之後；
	# 0055/0056/0058 是 devin 家族；0060 依賴 0010；0062 在 snapcompact 之後；
	# 0063→0066→0067→0068→0069→0070 是 codex／remote compaction 鏈（0068 依賴
	# 0063+0067，0069 依賴 0068，0070 依賴 0069）。標註 cand 者在矩陣中為
	# CONFLICT，需 18.2.3 候選；未標註者在 18.2.3 上逐字節仍適用。
	_omp_tail_candidate "18.2.3" "0047-omp-date-cwd-anchor-stability" "${AGENT}"
	# Keep this historical plan unchanged. Official-archive comparison during
	# the 18.2.10 migration disproved the earlier upstream-adoption claim:
	# 0055/0071 were deployed outside this plan, and are registered in 18.2.10.
	PATCHES+=("0056-omp-devin-metadata-alignment.patch:${NM}")
	PATCHES+=("0058-omp-devin-thinking-signature-replay.patch:${AI}")
	_omp_tail_candidate "18.2.3" "0060-omp-devin-idle-cascade-pin" "${NM}"
	PATCHES+=("0062-omp-snapcompact-reduction-baseline-previous-archive.patch:${AGENT}")
	PATCHES+=("0063-omp-codex-v2-compaction-live-chain.patch:${NM}")
	_omp_tail_candidate "18.2.3" "0065-omp-commandcode-deepseek-model-record-parity" "${NM}"
	PATCHES+=("0066-omp-anthropic-native-compaction-live-context.patch:${NM}")
	PATCHES+=("0067-omp-remote-compaction-lane-trace-live-tools.patch:${NM}")
	_omp_tail_candidate "18.2.3" "0068-omp-codex-stale-baseline-chain" "${NM}"
	_omp_tail_candidate "18.2.3" "0069-omp-codex-effort-history-resume" "${AI}"
	_omp_tail_candidate "18.2.3" "0070-omp-codex-compaction-chain-fail-closed" "${NM}"
	# 0072 僅 18.2.3：/session pin、/login、/logout 共用的 loadProviderAuthUi()
	# 內 lazy require("@oh-my-pi/pi-ai/index.js") 在已安裝 legacy-pi shim plugin
	# 的進程中把 Bun resolver 推進 file: 前綴疊加循環，851 層後 NameTooLong
	# 崩潰（kitty/Orca 皆可重現，與終端無關）。修法：兩個 pi-ai 符號提升為
	# 頂層靜態 import，對話框組件 require 保留（實測同環境安全）。
	# a 側是 18.2.3 pristine；selector-controller 不在既有鏈任何補丁的
	# 觸碰清單，無候選需求。
	PATCHES+=("0072-omp-session-pin-static-auth-ui.patch:${AGENT}")
	# 0073 僅 18.2.3：read 工具的 description 原本在 constructor 只渲染一次，而
	# 模板帶 `IS_HL_MODE`（模型相關：deepseek 家族被 resolveEditMode 降為
	# replace）。切換模型後仍發舊模型的 schema；resume 時新進程按 stored model
	# 重建工具 → tools 位元組改變 → prompt cache 前綴在 tools 段斷裂（2026-09-19
	# 實測 strict 命中 99.1% → 35.7%，cacheRead 24960 → 9088）。改為 getter 每次
	# 現算，與上游 grep/glob 同形，因此不再依賴任何切換入口——舊修法 0019/0042
	# 是逐入口補呼叫，retry.fallbackChains 這條新入口即漏網。a 側是 18.2.3
	# pristine；read.ts 不在既有鏈任何補丁的觸碰清單，無候選需求。
	PATCHES+=("0073-omp-read-description-live.patch:${AGENT}")
	# Extension-modified messages can still be byte-stable across requests.
	# Keep their rolling Anthropic cache boundary and cache the complete OAuth system.
	PATCHES+=("0074-omp-anthropic-context-cache-boundaries.patch:${AI}")
	;;
18.2.10)
	_omp_version_candidates "18.2.10" \
		0004 0010 0014 0017 0030 0033 0034 0035 0037 0038 0043 0045 0048 0050 omit:0041
	if [[ "$MODE" != "print-plan" ]]; then
		for package in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
			package_version="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "${NM}/${package}/package.json" 2>/dev/null || true)"
			[[ "$package_version" == "$OMP_PATCH_VERSION" ]] || {
				echo "${package} must be ${OMP_PATCH_VERSION}, found: ${package_version:-<missing>}" >&2
				exit 2
			}
		done
	fi
	# Upstream moved status-line and selector UI ownership into pi-tui.
	for i in "${!PATCHES[@]}"; do
		name="${PATCHES[i]%%:*}"
		case "${name##*/}" in
			0004-*|0033-*) PATCHES[i]="${name}:${TUI}" ;;
			0037-*|0050-*) PATCHES[i]="${name}:${NM}" ;;
		esac
	done
	_omp_tail_candidate "18.2.10" "0047-omp-date-cwd-anchor-stability" "${AGENT}"
	_omp_tail_candidate "18.2.10" "0055-omp-devin-auth-cache-turn-timing" "${AI}"
	_omp_tail_candidate "18.2.10" "0071-omp-devin-request-dump" "${AI}"
	PATCHES+=("0056-omp-devin-metadata-alignment.patch:${NM}")
	PATCHES+=("0058-omp-devin-thinking-signature-replay.patch:${AI}")
	_omp_tail_candidate "18.2.10" "0060-omp-devin-idle-cascade-pin" "${NM}"
	_omp_tail_candidate "18.2.10" "0062-omp-snapcompact-reduction-baseline-previous-archive" "${AGENT}"
	_omp_tail_candidate "18.2.10" "0063-omp-codex-v2-compaction-live-chain" "${NM}"
	_omp_tail_candidate "18.2.10" "0065-omp-commandcode-deepseek-model-record-parity" "${NM}"
	_omp_tail_candidate "18.2.10" "0066-omp-anthropic-native-compaction-live-context" "${NM}"
	_omp_tail_candidate "18.2.10" "0067-omp-remote-compaction-lane-trace-live-tools" "${NM}"
	_omp_tail_candidate "18.2.10" "0068-omp-codex-stale-baseline-chain" "${NM}"
	_omp_tail_candidate "18.2.10" "0069-omp-codex-effort-history-resume" "${AI}"
	_omp_tail_candidate "18.2.10" "0070-omp-codex-compaction-chain-fail-closed" "${NM}"
	_omp_tail_candidate "18.2.10" "0072-omp-session-pin-static-auth-ui" "${AGENT}"
	_omp_tail_candidate "18.2.10" "0073-omp-read-description-live" "${AGENT}"
	_omp_tail_candidate "18.2.10" "0074-omp-anthropic-context-cache-boundaries" "${AI}"
	# These behaviors were deployed outside the older controller's plan.
	_omp_tail_candidate "18.2.10" "0075-omp-hindsight-recall-promotion-slot" "${AGENT}"
	# 0076: the eval state reminder (new in 18.2.10) lived only in memory, so a
	# resumed process rebuilt from disk dropped it mid-history and re-appended it
	# at the tail, forking the cached prefix. Committing rebuilds persist it.
	_omp_tail_candidate "18.2.10" "0076-omp-eval-state-context-persist" "${NM}"
	# 0077: turn-recovery retry reminders (empty stop, unexpected stop, malformed
	# call) lived only in memory the same way; they are now persisted with the
	# live context, as the plan-mode reminder already is.
	_omp_tail_candidate "18.2.10" "0077-omp-turn-recovery-reminder-persist" "${AGENT}"
	_omp_tail_candidate "18.2.10" "0078-omp-python-display-mime-preference" "${AGENT}"
	_omp_tail_candidate "18.2.10" "0079-omp-kitty-conversion-finalization" "${TUI}"
	_omp_tail_candidate "18.2.10" "0080-omp-kitty-shared-png-cache" "${TUI}"
	;;
18.3.3)
	_omp_version_candidates "18.3.3" \
		0033 0004 0034 0037 0010 0035 0014 0036 0017 0025 0026 0030 \
		0031 0032 0038 0043 0044 0052 0057 0045 0046 0048 0050 0054 omit:0041
	if [[ "$MODE" != "print-plan" ]]; then
		for package in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
			package_version="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "${NM}/${package}/package.json" 2>/dev/null || true)"
			[[ "$package_version" == "$OMP_PATCH_VERSION" ]] || {
				echo "${package} must be ${OMP_PATCH_VERSION}, found: ${package_version:-<missing>}" >&2
				exit 2
			}
		done
	fi
	for i in "${!PATCHES[@]}"; do
		name="${PATCHES[i]%%:*}"
		case "${name##*/}" in
			0004-*|0033-*) PATCHES[i]="${name}:${TUI}" ;;
			0037-*|0050-*) PATCHES[i]="${name}:${NM}" ;;
		esac
	done
	_omp_tail_candidate "18.3.3" "0047-omp-date-cwd-anchor-stability" "${AGENT}"
	_omp_tail_candidate "18.3.3" "0055-omp-devin-auth-cache-turn-timing" "${AI}"
	_omp_tail_candidate "18.3.3" "0071-omp-devin-request-dump" "${AI}"
	_omp_tail_candidate "18.3.3" "0056-omp-devin-metadata-alignment" "${NM}"
	_omp_tail_candidate "18.3.3" "0058-omp-devin-thinking-signature-replay" "${AI}"
	_omp_tail_candidate "18.3.3" "0060-omp-devin-idle-cascade-pin" "${NM}"
	_omp_tail_candidate "18.3.3" "0062-omp-snapcompact-reduction-baseline-previous-archive" "${AGENT}"
	_omp_tail_candidate "18.3.3" "0063-omp-codex-v2-compaction-live-chain" "${NM}"
	_omp_tail_candidate "18.3.3" "0065-omp-commandcode-deepseek-model-record-parity" "${NM}"
	_omp_tail_candidate "18.3.3" "0066-omp-anthropic-native-compaction-live-context" "${NM}"
	_omp_tail_candidate "18.3.3" "0067-omp-remote-compaction-lane-trace-live-tools" "${NM}"
	_omp_tail_candidate "18.3.3" "0068-omp-codex-stale-baseline-chain" "${NM}"
	_omp_tail_candidate "18.3.3" "0069-omp-codex-effort-history-resume" "${AI}"
	_omp_tail_candidate "18.3.3" "0070-omp-codex-compaction-chain-fail-closed" "${NM}"
	_omp_tail_candidate "18.3.3" "0072-omp-session-pin-static-auth-ui" "${AGENT}"
	# Upstream implements 0073's model-live getter; its behavior gate still runs.
	_omp_tail_candidate "18.3.3" "0074-omp-anthropic-context-cache-boundaries" "${AI}"
	_omp_tail_candidate "18.3.3" "0075-omp-hindsight-recall-promotion-slot" "${AGENT}"
	_omp_tail_candidate "18.3.3" "0076-omp-eval-state-context-persist" "${NM}"
	_omp_tail_candidate "18.3.3" "0077-omp-turn-recovery-reminder-persist" "${AGENT}"
	_omp_tail_candidate "18.3.3" "0078-omp-python-display-mime-preference" "${AGENT}"
	_omp_tail_candidate "18.3.3" "0079-omp-kitty-conversion-finalization" "${TUI}"
	_omp_tail_candidate "18.3.3" "0080-omp-kitty-shared-png-cache" "${TUI}"
	_omp_tail_candidate "18.3.3" "0081-omp-main-cache-footer" "${NM}"
	_omp_tail_candidate "18.3.3" "0082-omp-user-display-text" "${NM}"
	;;
18.4.1)
	# 18.3.3 -> 18.4.1 keeps all 48 capabilities as same-ID 18.4.1 candidates.
	_omp_version_candidates "18.4.1" \
		0033 0004 0034 0037 0010 0035 0014 0036 0017 0025 0026 0030 \
		0031 0032 0038 0043 0044 0052 0057 0045 0046 0048 0050 0054 omit:0041
	if [[ "$MODE" != "print-plan" ]]; then
		for package in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
			package_version="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "${NM}/${package}/package.json" 2>/dev/null || true)"
			[[ "$package_version" == "$OMP_PATCH_VERSION" ]] || {
				echo "${package} must be ${OMP_PATCH_VERSION}, found: ${package_version:-<missing>}" >&2
				exit 2
			}
		done
	fi
	for i in "${!PATCHES[@]}"; do
		name="${PATCHES[i]%%:*}"
		case "${name##*/}" in
			0004-*|0033-*) PATCHES[i]="${name}:${TUI}" ;;
			0037-*|0050-*) PATCHES[i]="${name}:${NM}" ;;
		esac
	done
	_omp_tail_candidate "18.4.1" "0047-omp-date-cwd-anchor-stability" "${AGENT}"
	_omp_tail_candidate "18.4.1" "0055-omp-devin-auth-cache-turn-timing" "${AI}"
	_omp_tail_candidate "18.4.1" "0071-omp-devin-request-dump" "${AI}"
	_omp_tail_candidate "18.4.1" "0056-omp-devin-metadata-alignment" "${NM}"
	_omp_tail_candidate "18.4.1" "0058-omp-devin-thinking-signature-replay" "${AI}"
	_omp_tail_candidate "18.4.1" "0060-omp-devin-idle-cascade-pin" "${NM}"
	_omp_tail_candidate "18.4.1" "0062-omp-snapcompact-reduction-baseline-previous-archive" "${AGENT}"
	_omp_tail_candidate "18.4.1" "0063-omp-codex-v2-compaction-live-chain" "${NM}"
	_omp_tail_candidate "18.4.1" "0065-omp-commandcode-deepseek-model-record-parity" "${NM}"
	_omp_tail_candidate "18.4.1" "0066-omp-anthropic-native-compaction-live-context" "${NM}"
	_omp_tail_candidate "18.4.1" "0067-omp-remote-compaction-lane-trace-live-tools" "${NM}"
	_omp_tail_candidate "18.4.1" "0068-omp-codex-stale-baseline-chain" "${NM}"
	_omp_tail_candidate "18.4.1" "0069-omp-codex-effort-history-resume" "${AI}"
	_omp_tail_candidate "18.4.1" "0070-omp-codex-compaction-chain-fail-closed" "${NM}"
	_omp_tail_candidate "18.4.1" "0072-omp-session-pin-static-auth-ui" "${AGENT}"
	# Upstream implements 0073's model-live getter; its behavior gate still runs.
	_omp_tail_candidate "18.4.1" "0074-omp-anthropic-context-cache-boundaries" "${AI}"
	_omp_tail_candidate "18.4.1" "0075-omp-hindsight-recall-promotion-slot" "${AGENT}"
	_omp_tail_candidate "18.4.1" "0076-omp-eval-state-context-persist" "${NM}"
	_omp_tail_candidate "18.4.1" "0077-omp-turn-recovery-reminder-persist" "${AGENT}"
	_omp_tail_candidate "18.4.1" "0078-omp-python-display-mime-preference" "${AGENT}"
	_omp_tail_candidate "18.4.1" "0079-omp-kitty-conversion-finalization" "${TUI}"
	_omp_tail_candidate "18.4.1" "0080-omp-kitty-shared-png-cache" "${TUI}"
	_omp_tail_candidate "18.4.1" "0081-omp-main-cache-footer" "${NM}"
	_omp_tail_candidate "18.4.1" "0082-omp-user-display-text" "${NM}"
	# 0083: 18.3.4+ absorbs `^` model tags into the task-tool surface only at a
	# base-prompt rebuild; a fresh-process resume rebuilt that surface from empty
	# and forked the tools prefix. The committed surface is persisted and restored.
	_omp_tail_candidate "18.4.1" "0083-omp-model-mention-surface-resume" "${AGENT}"
	# 0084: 18.3.4+ retries a reasoning-only `length` stop with a developer
	# reminder appended to agent memory only; any rebuild from the session file
	# (resume, in-process rebuild) dropped it and forked the prefix at its index.
	_omp_tail_candidate "18.4.1" "0084-omp-length-stop-reminder-persist" "${AGENT}"
	;;
18.4.4)
	# 18.4.1 -> 18.4.4 keeps all 49 capabilities as same-ID 18.4.4 candidates.
	_omp_version_candidates "18.4.4" \
		0033 0004 0034 0037 0010 0035 0014 0036 0017 0025 0026 0030 \
		0031 0032 0038 0043 0044 0052 0057 0045 0046 0048 0050 0054 omit:0041
	if [[ "$MODE" != "print-plan" ]]; then
		for package in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
			package_version="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "${NM}/${package}/package.json" 2>/dev/null || true)"
			[[ "$package_version" == "$OMP_PATCH_VERSION" ]] || {
				echo "${package} must be ${OMP_PATCH_VERSION}, found: ${package_version:-<missing>}" >&2
				exit 2
			}
		done
	fi
	for i in "${!PATCHES[@]}"; do
		name="${PATCHES[i]%%:*}"
		case "${name##*/}" in
			0004-*|0033-*) PATCHES[i]="${name}:${TUI}" ;;
			0037-*|0050-*) PATCHES[i]="${name}:${NM}" ;;
		esac
	done
	_omp_tail_candidate "18.4.4" "0047-omp-date-cwd-anchor-stability" "${AGENT}"
	_omp_tail_candidate "18.4.4" "0055-omp-devin-auth-cache-turn-timing" "${AI}"
	_omp_tail_candidate "18.4.4" "0071-omp-devin-request-dump" "${AI}"
	_omp_tail_candidate "18.4.4" "0056-omp-devin-metadata-alignment" "${NM}"
	_omp_tail_candidate "18.4.4" "0058-omp-devin-thinking-signature-replay" "${AI}"
	_omp_tail_candidate "18.4.4" "0060-omp-devin-idle-cascade-pin" "${NM}"
	_omp_tail_candidate "18.4.4" "0062-omp-snapcompact-reduction-baseline-previous-archive" "${AGENT}"
	_omp_tail_candidate "18.4.4" "0063-omp-codex-v2-compaction-live-chain" "${NM}"
	_omp_tail_candidate "18.4.4" "0065-omp-commandcode-deepseek-model-record-parity" "${NM}"
	_omp_tail_candidate "18.4.4" "0066-omp-anthropic-native-compaction-live-context" "${NM}"
	_omp_tail_candidate "18.4.4" "0067-omp-remote-compaction-lane-trace-live-tools" "${NM}"
	_omp_tail_candidate "18.4.4" "0068-omp-codex-stale-baseline-chain" "${NM}"
	_omp_tail_candidate "18.4.4" "0069-omp-codex-effort-history-resume" "${AI}"
	_omp_tail_candidate "18.4.4" "0070-omp-codex-compaction-chain-fail-closed" "${NM}"
	_omp_tail_candidate "18.4.4" "0072-omp-session-pin-static-auth-ui" "${AGENT}"
	# Upstream implements 0073's model-live getter; its behavior gate still runs.
	_omp_tail_candidate "18.4.4" "0074-omp-anthropic-context-cache-boundaries" "${AI}"
	_omp_tail_candidate "18.4.4" "0075-omp-hindsight-recall-promotion-slot" "${AGENT}"
	_omp_tail_candidate "18.4.4" "0076-omp-eval-state-context-persist" "${NM}"
	_omp_tail_candidate "18.4.4" "0077-omp-turn-recovery-reminder-persist" "${AGENT}"
	_omp_tail_candidate "18.4.4" "0078-omp-python-display-mime-preference" "${AGENT}"
	_omp_tail_candidate "18.4.4" "0079-omp-kitty-conversion-finalization" "${TUI}"
	_omp_tail_candidate "18.4.4" "0080-omp-kitty-shared-png-cache" "${TUI}"
	_omp_tail_candidate "18.4.4" "0081-omp-main-cache-footer" "${NM}"
	_omp_tail_candidate "18.4.4" "0082-omp-user-display-text" "${NM}"
	# 0083: 18.3.4+ absorbs `^` model tags into the task-tool surface only at a
	# base-prompt rebuild; a fresh-process resume rebuilt that surface from empty
	# and forked the tools prefix. The committed surface is persisted and restored.
	_omp_tail_candidate "18.4.4" "0083-omp-model-mention-surface-resume" "${AGENT}"
	# 0084: 18.3.4+ retries a reasoning-only `length` stop with a developer
	# reminder appended to agent memory only; any rebuild from the session file
	# (resume, in-process rebuild) dropped it and forked the prefix at its index.
	_omp_tail_candidate "18.4.4" "0084-omp-length-stop-reminder-persist" "${AGENT}"
	# 0085: a prepared submission rejected at dispatch (session.prompt throws)
	# lost its original text and attachments; an image pasted while a cancelled
	# preparation awaited was overwritten by the restore. Both restores share one
	# helper that never writes over a newer draft or attachment.
	_omp_tail_candidate "18.4.4" "0085-omp-rejected-prepared-draft-restore" "${AGENT}"
	# 0088 (rollup: the retired 0086 + 0087 + the 0088 draft, bytes frozen under
	# .retired/09-30-0086-0087-rolled-into-0088/): the summarize request rides the
	# main chain's live cache entries instead of anchoring the entry at the
	# summarize boundary -- written once and then never refreshed, because every
	# later main turn anchored its own advancing tail, so one hour later that entry
	# is gone and the whole history is rewritten (the 256k-token / $1.15 incident).
	# On 18.4.4 the Anthropic lane carries the host's whole live chain (whole turns
	# and split turns alike: a split turn's history leg IS the whole-conversation
	# request, so the second turn-prefix leg is dropped when the chain is selected
	# -- no `**Turn Context (split turn):**` merge) and names the scope in its
	# instruction, but only while the host vouches for the live scope, the previous
	# summary is absent or inside that chain, and the request fits the window.
	# Capacity is measured against the provider's OWN usage for the chain (the last
	# main request's billed input plus a local estimate of what is appended after
	# it, opaque reasoning bytes excluded), skipping a trailing host control-only
	# carrier (empty content, all-zero usage) while scanning back; tokenizing signed
	# thinking locally overstated the incident's 378k-token chain as 630k and
	# refused it. When the chain IS refused the fallback names the SPECIFIC reason
	# (capacity-unattested, live-chain-over-capacity, no-live-chain,
	# previous-summary-not-in-prefix, live-chain-overflow-retry, ...) and the
	# two-leg path keeps the pre-0088 bytes (serialized, not parallel); an empty
	# history range (no cut prefix at all) lets the live chain stand alone as the
	# host-vouched prefix, and every other shape keeps the pre-0088 bytes with a
	# named reason.
	_omp_tail_candidate "18.4.4" "0088-omp-compaction-cache-liveness" "${NM}"
	;;
*)
	echo "OMP_PATCH_VERSION='${OMP_PATCH_VERSION:-<unset>}' unsupported (known: 18.1.14, 18.1.18, 18.2.3, 18.2.10, 18.3.3, 18.4.1, 18.4.4)" >&2
	exit 2
	;;
esac

if [[ "$MODE" == "print-plan" ]]; then
	# Read-only plan dump for verifiers: one "file:ROOT" line per resolved
	# entry, in application order. This is the single resolver — anything that
	# needs the plan must read it from here, never re-implement the logic.
	for entry in "${PATCHES[@]}"; do
		name="${entry%%:*}"; root="${entry##*:}"
		case "$root" in
			"$AGENT") rn=AGENT ;; "$CORE") rn=CORE ;; "$AI") rn=AI ;;
			"$SNAP") rn=SNAP ;; "$TUI") rn=TUI ;; "$NM") rn=NM ;; *) rn="$root" ;;
		esac
		printf '%s:%s\n' "$name" "$rn"
	done
	exit 0
fi

# Patch state is a property of the whole stack, not of one entry in isolation.
# A later entry may rewrite lines an earlier one introduced (0041 over 0037);
# on the final tree that earlier patch no longer reverse-identifies, and a
# per-entry probe would report a bogus CONFLICT. Mirror every touched file into
# a sandbox, peel the stack there in reverse, and record what each layer says
# once the layers above it are gone. Only the sandbox is ever written.
SANDBOX=""
PLAN_SANDBOX=""
cleanup_sandbox() {
	[[ -n "$SANDBOX" ]] && rm -rf "$SANDBOX"
	[[ -n "$PLAN_SANDBOX" ]] && rm -rf "$PLAN_SANDBOX"
	return 0
}
trap cleanup_sandbox EXIT

patch_targets() { # patch file -> repo-relative paths it touches
	sed -n -e 's|^--- a/||p' -e 's|^+++ b/||p' "$1" | cut -f1 | sort -u
}

sandbox_root() { # sandbox base, absolute package root -> mirrored root
	local sb="$1" root="$2"
	if [[ "$root" == "$NM" ]]; then
		printf '%s/nm' "$sb"
	else
		printf '%s/nm/%s' "$sb" "${root#"$NM"/}"
	fi
}

mirror_touched() { # sandbox base -> copy every live file the chain declares
	local sb="$1"
	local i entry root file rel src dst sbr
	for i in "${!PATCHES[@]}"; do
		entry="${PATCHES[i]}"
		root="${entry##*:}"
		file="${HERE}/${entry%%:*}"
		[[ -f "$file" ]] || continue
		sbr="$(sandbox_root "$sb" "$root")"
		while IFS= read -r rel; do
			[[ -n "$rel" ]] || continue
			src="${root}/${rel}"
			dst="${sbr}/${rel}"
			[[ -e "$dst" ]] && continue
			[[ -f "$src" ]] || continue
			mkdir -p "${dst%/*}"
			cp "$src" "$dst"
		done < <(patch_targets "$file")
	done
}

# A patch that fails midway still rewrites the hunks it already matched, so
# every mutation is gated on a clean dry run first. A patch that clears its dry
# run and then still fails means the tree changed underneath us or `patch`
# misbehaved: the sandbox is now half-written and every later verdict is
# garbage, so abort rather than return a plain false the caller would read as
# "not applied".
probe_apply() { # dir, patch, direction-flag -> mutate only if the dry run is clean
	local dir="$1" file="$2" dir_flag="$3"
	local -a reverse_flags=()
	[[ "$dir_flag" == "-R" ]] && reverse_flags=(--remove-empty-files)
	patch -p1 "$dir_flag" "${reverse_flags[@]}" --force --silent --dry-run -d "$dir" <"$file" >/dev/null 2>&1 || return 1
	patch -p1 "$dir_flag" "${reverse_flags[@]}" --force --silent --no-backup-if-mismatch -d "$dir" <"$file" >/dev/null 2>&1 || {
		echo "internal: $(basename "$file") cleared its dry run but failed to apply — sandbox is inconsistent" >&2
		exit 1
	}
}

declare -a CHAIN_STATUS=()
compute_chain_status() { # fills CHAIN_STATUS with applied|pending|conflict|missing
	SANDBOX="$(mktemp -d)"
	local i entry root file sbr replay_broken=0
	for i in "${!PATCHES[@]}"; do
		if [[ -f "${HERE}/${PATCHES[i]%%:*}" ]]; then
			CHAIN_STATUS[i]=unknown
		else
			CHAIN_STATUS[i]=missing
		fi
	done
	mirror_touched "$SANDBOX"
	# Phase 1 — peel: walk the stack top-down and strip every layer that
	# reverse-identifies. Layers that are genuinely absent cover nothing, so
	# skipping them does not disturb the layers below. A self-consistent tree
	# ends this phase at pristine.
	for ((i = ${#PATCHES[@]} - 1; i >= 0; i--)); do
		[[ "${CHAIN_STATUS[i]}" == missing ]] && continue
		entry="${PATCHES[i]}"
		root="${entry##*:}"
		file="${HERE}/${entry%%:*}"
		sbr="$(sandbox_root "$SANDBOX" "$root")"
		if probe_apply "$sbr" "$file" -R; then
			CHAIN_STATUS[i]=applied
		fi
	done
	# Phase 2 — replay: rebuild the stack bottom-up. Only here can an absent
	# layer be classified, because its forward feasibility depends on every
	# layer below it already being on the tree — 0041's hunk context does not
	# exist until 0037 is laid down.
	#
	# If a layer peeled cleanly in phase 1 but will not replay here, the tree is
	# in a state this chain cannot produce. The sandbox has since diverged from
	# the live tree (which still carries that layer), so every verdict above it
	# would be guesswork — stop classifying and mark the rest conflict.
	for i in "${!PATCHES[@]}"; do
		[[ "${CHAIN_STATUS[i]}" == missing ]] && continue
		if [[ $replay_broken -eq 1 ]]; then
			CHAIN_STATUS[i]=conflict
			continue
		fi
		entry="${PATCHES[i]}"
		root="${entry##*:}"
		file="${HERE}/${entry%%:*}"
		sbr="$(sandbox_root "$SANDBOX" "$root")"
		if probe_apply "$sbr" "$file" --forward; then
			[[ "${CHAIN_STATUS[i]}" == applied ]] || CHAIN_STATUS[i]=pending
		else
			[[ "${CHAIN_STATUS[i]}" == applied ]] && replay_broken=1
			CHAIN_STATUS[i]=conflict
		fi
	done
}

fail=0
compute_chain_status

# Revert peels the stack in reverse; apply lays it down in order. Overlapping
# entries make the order load-bearing in both directions.
ORDER_IDX=("${!PATCHES[@]}")
if [[ "$MODE" == "revert" ]]; then
	ORDER_IDX=()
	for ((i = ${#PATCHES[@]} - 1; i >= 0; i--)); do
		ORDER_IDX+=("$i")
	done
fi
# Nothing may touch live node_modules until the whole chain is known good.
# Without this gate a conflict at entry N still lets entries 0..N-1 be written
# first, and the `exit 1` at the bottom then leaves the tree half-patched.
if [[ "$MODE" != "check" ]]; then
	blocked=0
	for i in "${!PATCHES[@]}"; do
		case "${CHAIN_STATUS[i]}" in
			conflict | missing)
				echo "${CHAIN_STATUS[i]^^}  ${PATCHES[i]%%:*}" >&2
				blocked=1
				;;
		esac
	done
	if [[ $blocked -ne 0 ]]; then
		echo "refusing to modify node_modules — resolve the entries above first" >&2
		exit 1
	fi
fi
# The verdicts above were computed on a peeled sandbox, which is not the tree we
# are about to write. In a non-prefix state (an upper layer applied while a
# lower one is absent) a lower entry can pass only *after* the upper layer is
# peeled off, yet the live tree still carries that upper layer — its per-entry
# dry-run would then fail partway through the run, after earlier pending
# entries were already written. So rehearse the exact plan, in execution order,
# on a mirror of the live tree, and refuse to write unless the whole plan lands.
if [[ "$MODE" != "check" ]]; then
	PLAN_SANDBOX="$(mktemp -d)"
	mirror_touched "$PLAN_SANDBOX"
	plan_steps=0
	for i in "${ORDER_IDX[@]}"; do
		entry="${PATCHES[i]}"
		name="${entry%%:*}"
		root="${entry##*:}"
		file="${HERE}/${name}"
		sbr="$(sandbox_root "$PLAN_SANDBOX" "$root")"
		case "$MODE:${CHAIN_STATUS[i]}" in
			apply:pending)
				probe_apply "$sbr" "$file" --forward || {
					echo "PLAN FAIL ${name} — would not apply at this point in the live sequence" >&2
					echo "refusing to modify node_modules — nothing was written" >&2
					exit 1
				}
				plan_steps=$((plan_steps + 1))
				;;
			revert:applied)
				probe_apply "$sbr" "$file" -R || {
					echo "PLAN FAIL ${name} — would not revert at this point in the live sequence" >&2
					echo "refusing to modify node_modules — nothing was written" >&2
					exit 1
				}
				plan_steps=$((plan_steps + 1))
				;;
		esac
	done
	rm -rf "$PLAN_SANDBOX"
	PLAN_SANDBOX=""
	[[ $plan_steps -eq 0 ]] || echo "plan: ${plan_steps} step(s) rehearsed on a live mirror, all clean" >&2
fi
# This loop is not atomic and does not pretend to be. The plan rehearsal above
# makes a mid-run failure unlikely, not impossible (a concurrent edit or an I/O
# error still can), and `patch` writes hunk by hunk. So track what actually
# landed and say so plainly instead of claiming nothing was written.
written=0
report_written() { # $1 = "half" when the entry that just failed may be partly written
	local half="${1:-}"
	[[ "$half" == half ]] && echo "the entry above may be partially written." >&2
	if [[ $written -gt 0 ]]; then
		echo "${written} earlier entr$([[ $written -eq 1 ]] && echo y || echo ies) already landed — the tree is in an intermediate state." >&2
	elif [[ "$half" == half ]]; then
		echo "no earlier entries were written." >&2
	else
		echo "no entries were written." >&2
		return 0
	fi
	echo "run '$(basename "$0") --check' to see the current chain state before retrying." >&2
}
for i in "${ORDER_IDX[@]}"; do
	entry="${PATCHES[i]}"
	name="${entry%%:*}"
	root="${entry##*:}"
	file="${HERE}/${name}"
	st="${CHAIN_STATUS[i]}"
	if [[ "$st" == missing ]]; then
		echo "MISSING  ${name}"
		fail=1
		continue
	fi
	case "$MODE:$st" in
		check:conflict) echo "CONFLICT  ${name}"; fail=1 ;;
		check:*) echo "${st^^}  ${name}" ;;
		apply:applied) echo "SKIP     ${name} (already applied)" ;;
		apply:pending)
			patch -p1 --forward --force --silent --dry-run -d "$root" <"$file" >/dev/null 2>&1 || {
				echo "ABORT    ${name} — forward dry-run failed on the live tree" >&2
				report_written
				exit 1
			}
			patch -p1 --forward --silent --no-backup-if-mismatch -d "$root" <"$file" || {
				echo "ABORT    ${name} — cleared its dry run but failed to apply; THIS ENTRY MAY BE HALF-WRITTEN" >&2
				report_written half
				exit 1
			}
			written=$((written + 1))
			echo "APPLIED  ${name}"
			;;
		apply:conflict)
			echo "CONFLICT ${name} — upstream changed; re-derive this patch by hand" >&2
			fail=1
			;;
		revert:applied)
			patch -p1 -R --force --silent --dry-run -d "$root" <"$file" >/dev/null 2>&1 || {
				echo "ABORT    ${name} — reverse dry-run failed on the live tree" >&2
				report_written
				exit 1
			}
			patch -p1 -R --forward --silent --no-backup-if-mismatch --remove-empty-files -d "$root" <"$file" || {
				echo "ABORT    ${name} — cleared its dry run but failed to revert; THIS ENTRY MAY BE HALF-WRITTEN" >&2
				report_written half
				exit 1
			}
			written=$((written + 1))
			echo "REVERTED ${name}"
			;;
		revert:*) echo "SKIP     ${name} (not applied)" ;;
	esac
done

want="$SRC_ENTRY"
[[ "$MODE" == "revert" ]] && want="$BUNDLE_ENTRY"
have="$(readlink "$BIN" 2>/dev/null || true)"
if [[ "$MODE" == "check" ]]; then
	[[ "$have" == "$SRC_ENTRY" ]] && echo "APPLIED  bin/omp -> src/cli.ts" || echo "PENDING  bin/omp -> ${have:-<missing>}"
elif [[ "$have" == "$want" ]]; then
	echo "SKIP     bin/omp already -> $(basename "$want")"
else
	ln -sfn "$want" "$BIN"
	echo "LINKED   bin/omp -> $(basename "$want")"
fi

if [[ $fail -ne 0 ]]; then
	echo "incomplete — see CONFLICT/MISSING above" >&2
	exit 1
fi

if [[ "$MODE" == "apply" ]]; then
	echo "=== Running Patches Regression Test Suite ==="
	# Chain-level rollup verification: `apply.sh --verify-rollups`.
	# Bind every gate to the tree selected by this controller, not its caller.
	export OMP_PATCH_VERIFY_NM="$NM"
	export OMP_PATCH_VERIFY_AGENT_ROOT="$AGENT"
	export OMP_PATCH_VERIFY_CORE_ROOT="$CORE"
	export OMP_PATCH_VERIFY_AI_ROOT="$AI"
	export OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="$SNAP"
	export OMP_PATCH_VERIFY_CATALOG_ROOT="${NM}/pi-catalog"
	export OMP_PATCH_VERIFY_TUI_ROOT="$TUI"
	bun "${HERE}/verify-antigravity-envelope.ts"
	bun "${HERE}/verify-prefix-cache-compaction.ts"
	bun "${HERE}/verify-provider-image-budget.ts"
	bun "${HERE}/verify-snapcompact-model-billing.ts"
	# 0025 兩計畫皆在 canonical 母集，故無條件執行。
	bun "${HERE}/verify-ollama-cloud-usage.ts"
	bash "${HERE}/verify-spec-contracts.sh"
	# Plan membership selects gates; missing patch effects must fail, not skip.
	# The predicate reads the resolved plan, so a newly supported version that
	# still carries a patch keeps its gate automatically instead of silently
	# falling into a version-string `else`.
	if _omp_plan_has 0055; then
		bun "${HERE}/verify-devin-auth-cache.ts"
	else
		echo "verify-devin-auth-cache: skipped (0055 not in this plan)"
	fi
	bun "${HERE}/verify-hindsight-recall-snapshot.ts"
	bun "${HERE}/verify-interrupt-prune-symmetry.ts"
	if _omp_plan_has 0032; then
		bun "${HERE}/verify-goal-tool-resident.ts"
	fi
	if _omp_plan_has 0047; then
		bun "${HERE}/verify-date-cwd-anchor-stability.ts"
	fi
	if _omp_plan_has 0056; then
		bun "${HERE}/verify-devin-metadata.ts"
	else
		echo "verify-devin-metadata: skipped (0056 not in this plan)"
	fi
	bun "${HERE}/verify-supersede-warm-prefix-guard.ts"
	if _omp_plan_has 0045; then
		bun "${HERE}/verify-snapcompact-frame-reprice.ts"
	fi
	if _omp_plan_has 0050; then
		bun "${HERE}/verify-session-history-preview.ts"
	fi
	if _omp_plan_has 0058; then
		bun "${HERE}/verify-devin-thinking-signature.ts"
	else
		echo "verify-devin-thinking-signature: skipped (0058 not in this plan)"
	fi
	if _omp_plan_has 0060; then
		bun "${HERE}/verify-devin-idle-cascade-pin.ts"
	else
		echo "verify-devin-idle-cascade-pin: skipped (0060 not in this plan)"
	fi
	# 0010's lifecycle contract: idle/ephemeral reservations vs main work,
	# session transitions and epoch resets. Reads the selected tree's version
	# itself and fails closed outside its supported set.
	if _omp_plan_has 0010; then
		bun "${HERE}/verify-idle-ephemeral-reservation.ts"
	else
		echo "verify-idle-ephemeral-reservation: skipped (0010 not in this plan)"
	fi
	if _omp_plan_has 0062; then
		bun "${HERE}/verify-snapcompact-reduction-baseline.ts"
	else
		echo "verify-snapcompact-reduction-baseline: skipped (0062 not in this plan)"
	fi
	bun "${HERE}/verify-resume-cache-breakpoint.ts"
	bun "${HERE}/verify-codex-compaction-chain.ts"
	if _omp_plan_has 0065; then
		bun "${HERE}/verify-commandcode-model-record-parity.ts"
	else
		echo "verify-commandcode-model-record-parity: skipped (0065 not in this plan)"
	fi
	if _omp_plan_has 0066; then
		bun "${HERE}/verify-anthropic-native-compaction-live-context.ts"
	else
		echo "verify-anthropic-native-compaction-live-context: skipped (0066 not in this plan)"
	fi
	if _omp_plan_has 0067; then
		bun "${HERE}/verify-compaction-lane-trace.ts"
	else
		echo "verify-compaction-lane-trace: skipped (0067 not in this plan)"
	fi
	if _omp_plan_has 0069; then
		bun "${HERE}/verify-codex-effort-resume.ts"
	else
		echo "verify-codex-effort-resume: skipped (0069 not in this plan)"
	fi
	if _omp_plan_has 0070; then
		bun "${HERE}/verify-codex-compaction-chain-fail-closed.ts"
	else
		echo "verify-codex-compaction-chain-fail-closed: skipped (0070 not in this plan)"
	fi
	if _omp_plan_has 0072; then
		bun "${HERE}/verify-session-pin-static-auth-ui.ts"
	else
		echo "verify-session-pin-static-auth-ui: skipped (0072 not in this plan)"
	fi
	if _omp_plan_has 0073 || [[ "$OMP_PATCH_VERSION" == "18.3.3" || "$OMP_PATCH_VERSION" == "18.4.1" || "$OMP_PATCH_VERSION" == "18.4.4" ]]; then
		OMP_PATCH_VERIFY_AGENT_ROOT="${AGENT}" bun "${HERE}/verify-read-description-live.ts"
	else
		echo "verify-read-description-live: skipped (0073 not in this plan)"
	fi
	if _omp_plan_has 0074; then
		bun "${HERE}/verify-anthropic-cache-boundaries.ts"
		bun "${HERE}/verify-anthropic-request-audit.ts"
	else
		echo "verify-anthropic-cache-boundaries: skipped (0074 not in this plan)"
	fi
	if _omp_plan_has 0075; then
		bun "${HERE}/verify-hindsight-recall-promotion-slot.ts"
	fi
	if _omp_plan_has 0076; then
		bun "${HERE}/verify-eval-state-context-persist.ts"
	fi
	if _omp_plan_has 0077; then
		bun "${HERE}/verify-turn-recovery-reminder-persist.ts"
	fi
	if _omp_plan_has 0078; then
		bun "${HERE}/verify-python-display-mime-preference.ts"
	fi
	if _omp_plan_has 0079; then
		bun "${HERE}/verify-kitty-conversion-finalization.ts"
	fi
	if _omp_plan_has 0080; then
		bun "${HERE}/verify-kitty-shared-png-cache.ts"
	fi
	if _omp_plan_has 0081; then
		bun "${HERE}/verify-main-cache-hit.ts"
	fi
	if _omp_plan_has 0083; then
		bun "${HERE}/verify-model-mention-surface-resume.ts"
	fi
	if _omp_plan_has 0084; then
		bun "${HERE}/verify-length-stop-reminder-persist.ts"
	fi
	if _omp_plan_has 0082; then
		bun "${HERE}/verify-user-display-text-queue.ts"
	fi
	if _omp_plan_has 0085; then
		bun "${HERE}/verify-rejected-prepared-draft-restore.ts"
	fi
	if _omp_plan_has 0088; then
		bun "${HERE}/verify-compaction-cache-liveness.ts"
	fi
fi
if [[ "$MODE" != "check" ]]; then
	if [[ "$OFFLINE_VERIFY" == "1" ]]; then
		echo "smoke: skipped by explicit offline replay mode"
	else
		printf 'smoke: '
		smoke_args=()
		[[ -n "${OMP_PATCH_SMOKE_MODEL:-}" ]] && smoke_args+=(--model "$OMP_PATCH_SMOKE_MODEL")
		# Cold start re-probes every provider catalog before the first token, which
		# costs ~90 s on this box; the budget must cover that, not the completion.
		if out="$(cd /tmp && timeout 300 "$BIN" --no-session --no-extensions --no-skills --no-lsp "${smoke_args[@]}" -p 'say PATCH_OK' </dev/null 2>&1)"; then
			grep -q PATCH_OK <<<"$out" && echo "ok" || {
				echo "unexpected output:"
				echo "$out" | tail -5
				exit 1
			}
		else
			echo "FAILED"
			echo "$out" | tail -10
			exit 1
		fi
	fi
fi
