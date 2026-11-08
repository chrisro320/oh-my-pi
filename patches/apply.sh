#!/usr/bin/env bash
# Re-apply local omp source patches after an upgrade.
#
#   ~/.omp/patches/apply.sh          apply (idempotent)
#   ~/.omp/patches/apply.sh --revert undo, restore the stock bundle entrypoint
#   ~/.omp/patches/apply.sh --check  report state, change nothing
#   ~/.omp/patches/apply.sh --verify-rollups  verify family representations
#
# omp ships its TypeScript sources, and bun can execute them directly, so these
# are ordinary source patches rather than surgery on the 19 MB dist/cli.js
# bundle. `bin/omp` is repointed at src/cli.ts to make them take effect; the
# stock bundle is left untouched at dist/cli.js.
#
# Every `bun update`/`bun add -g` wipes both the patches and the symlink. Re-run
# this script afterwards.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BOUND_RELEASE=0
NM="${HOME}/.bun/install/global/node_modules/@oh-my-pi"
BIN="${HOME}/.bun/bin/omp"
SRC_ENTRY="../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts"
BUNDLE_ENTRY="../install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js"
if [[ -f "${HERE}/.runtime-root" ]]; then
	IFS= read -r RUNTIME_ROOT < "${HERE}/.runtime-root"
	if [[ "$RUNTIME_ROOT" != "${HERE%/ledger}/runtime" || ! -d "$RUNTIME_ROOT/node_modules/@oh-my-pi" ]]; then
		echo "Invalid immutable release binding; refusing global fallback" >&2
		exit 2
	fi
	BOUND_RELEASE=1
	NM="${RUNTIME_ROOT}/node_modules/@oh-my-pi"
	BIN="${HERE%/ledger}/bin/source-omp"
	SRC_ENTRY="${NM}/pi-coding-agent/src/cli.ts"
	BUNDLE_ENTRY="${NM}/pi-coding-agent/dist/cli.js"
elif [[ -f "${HERE%/ledger}/release.json" && "${HERE##*/}" == ledger ]]; then
	echo "Missing immutable release binding; refusing global fallback" >&2
	exit 2
fi
TUI="${NM}/pi-tui"
AGENT="${NM}/pi-coding-agent"
CORE="${NM}/pi-agent-core"
AI="${NM}/pi-ai"
SNAP="${NM}/snapcompact"

MODE="apply"
case "${1:-}" in
	--revert) MODE="revert" ;;
	--check) MODE="check" ;;
	--print-plan) MODE="print-plan" ;;
	--print-capabilities) MODE="print-capabilities" ;;
	--print-gates) MODE="print-gates" ;;
	--verify-rollups) MODE="verify-rollups" ;;
	"") ;;
	*)
		echo "usage: $0 [--revert|--check|--print-plan|--print-capabilities|--print-gates|--verify-rollups]" >&2
		exit 2
		;;
esac
if [[ "$BOUND_RELEASE" == 1 && ( "$MODE" == apply || "$MODE" == revert ) ]]; then
	echo "Immutable release: use the code-only publisher/rollback, not apply or revert" >&2
	exit 2
fi
READ_ONLY_QUERY=0
[[ "$MODE" == print-* ]] && READ_ONLY_QUERY=1

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
	# Explicit retained release only; deleted historical baselines are not restored.
	exec bash "${HERE}/verify-patch-family-rollups.sh" --version "${OMP_PATCH_VERSION:-18.10.1}"
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
	if [[ "$READ_ONLY_QUERY" != 1 ]]; then
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
# Physical membership is deliberately separate from capability membership.
# Native patch lifecycle checks still need a real entry, not a historical ID.
function _omp_plan_has {
	local prefix="$1" entry name
	for entry in "${PATCHES[@]}"; do
		name="${entry%%:*}"
		name="${name##*/}"
		[[ "$name" == "$prefix"-* ]] && return 0
	done
	return 1
}

declare -A PLAN_CAPABILITIES=()
function _omp_has_capability {
	if [[ "$OMP_PATCH_VERSION" == "18.7.0" || "$OMP_PATCH_VERSION" == "18.10.0" || "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		[[ -n "${PLAN_CAPABILITIES[$1]:-}" ]]
	else
		_omp_plan_has "$1"
	fi
}

function _omp_family_plan {
	local registry="${HERE}/.${OMP_PATCH_VERSION}-families/plan.tsv"
	local file root_key members extra member
	local -a ids
	[[ -f "$registry" ]] || { echo "family registry missing: $registry" >&2; exit 2; }
	PATCHES=()
	PLAN_CAPABILITIES=()
	while IFS=$'\t' read -r file root_key members extra || [[ -n "$file$root_key$members$extra" ]]; do
		[[ -n "$file" && -n "$members" && -z "$extra" && "$file" != /* && "$file" != *..* ]] || {
			echo "invalid family registry row" >&2; exit 2;
		}
		case "$root_key" in
			AGENT|CORE|AI|SNAP|TUI|NM) ;;
			*) echo "invalid family root: $root_key" >&2; exit 2 ;;
		esac
		[[ -f "${HERE}/${file}" ]] || { echo "family patch missing: $file" >&2; exit 2; }
		IFS=, read -r -a ids <<<"$members"
		for member in "${ids[@]}"; do
			[[ "$member" =~ ^[0-9]{4}$ && -z "${PLAN_CAPABILITIES[$member]:-}" ]] || {
				echo "invalid or duplicate family capability: $member" >&2; exit 2;
			}
			PLAN_CAPABILITIES[$member]=1
		done
		PATCHES+=("${file}:${!root_key}")
	done <"$registry"
	[[ ${#PATCHES[@]} -gt 0 ]] || { echo "empty family registry" >&2; exit 2; }
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
# Versioned plan selection. PATCHES is the retained historical-plan base, not
# a deployable chain: its a-sides span upstream releases. Family releases replace
# that array with their versioned registry. Supported versions:18.4.4,
# 18.7.0,18.10.0,18.10.1,18.12.6,18.16.0 and18.18.0. Older baselines were removed by the user.
# Unset OMP_PATCH_VERSION auto-routes by the installed pi-coding-agent
# version (exact match only) so the documented one-key re-apply flow keeps
# working; an explicit value must match the installed version or fail
# closed. Unknown/unsupported values exit 2 before anything is touched.

if [[ -z "${OMP_PATCH_VERSION+x}" ]]; then
	pkgjson="${NM}/pi-coding-agent/package.json"
	installed="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$pkgjson" 2>/dev/null || true)"
	case "$installed" in
	18.1.14|18.1.18|18.2.3|18.2.10|18.3.3|18.4.1|18.4.4|18.7.0|18.10.0|18.10.1|18.12.6|18.16.0|18.18.0)
		OMP_PATCH_VERSION="$installed"
		echo "NOTE: OMP_PATCH_VERSION unset — routed to installed ${installed}" >&2
		;;
	*)
		echo "installed pi-coding-agent '${installed:-<unreadable>}' has no supported plan (known: 18.1.14, 18.1.18, 18.2.3, 18.2.10, 18.3.3, 18.4.1, 18.4.4, 18.7.0, 18.10.0, 18.10.1, 18.12.6, 18.16.0, 18.18.0); set OMP_PATCH_VERSION explicitly" >&2
		exit 2
		;;
	esac
fi
# Gate processes and their children must see the resolved plan even when the
# caller left OMP_PATCH_VERSION unset: several gates choose their contract (or
# fail closed) from it.
export OMP_PATCH_VERSION

case "$OMP_PATCH_VERSION" in
18.4.4)
	# 18.4.1 -> 18.4.4 keeps all 49 capabilities as same-ID 18.4.4 candidates.
	_omp_version_candidates "18.4.4" \
		0033 0004 0034 0037 0010 0035 0014 0036 0017 0025 0026 0030 \
		0031 0032 0038 0043 0044 0052 0057 0045 0046 0048 0050 0054 omit:0041
	if [[ "$READ_ONLY_QUERY" != 1 ]]; then
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
	# 0089: the live-chain capacity gate is DELETED (local and native lanes). The
	# pre-flight verdict could only refuse a chain the provider would take: the
	# 16:43Z compaction's ~129k-token chain in a 512k window was refused
	# `capacity-unattested` because no turn of it carried usable provider usage,
	# and a signed-thinking chain the local tokenizer overcounts several-fold was
	# refused as over capacity -- both abandoning the cache for nothing. The live
	# chain now ships whenever the host vouches for it and the previous-summary
	# condition holds, and the provider's own rejection is the safety: the
	# existing `live-chain-overflow-retry` fallback still replans the cold path
	# (halving the abandoned call's own transcript) and names the reason. The
	# `no-live-chain` / `no-host-prefix` / `previous-summary-not-in-prefix` and
	# `live-chain-overflow-retry` reasons remain; `capacity-unattested`,
	# `live-chain-over-capacity`, `native-capacity-unattested` and
	# `native-live-chain-over-capacity` are gone.
	_omp_tail_candidate "18.4.4" "0089-omp-compaction-drop-capacity-gate" "${NM}"
	# Preserve rotated OAuth tokens across waiter cancellation and timer starvation.
	# Anthropic refresh never blocks persistence on optional identity bootstrap.
	_omp_tail_candidate "18.4.4" "0090-omp-oauth-durable-refresh" "${AI}"
	# 0092 (rolls up 0091, deployed and retired 2026-10-03): the idle cache-warming horizon
	# becomes a process-local budget an extension owns (PI_CACHE_WARMING_IDLE_MAX_MS;
	# unset keeps the stock 30 minutes). A run that reaches the horizon is parked
	# with its request instead of discarded, so a larger budget set after the agent
	# run settled resumes from the cache entry's own clock. Each refresh that
	# reached the provider is reported through the new `cache_warming_result`
	# extension event (hit | miss | error).
	_omp_tail_candidate "18.4.4" "0092-omp-cache-warming-idle-budget" "${AGENT}"
	;;
18.7.0|18.10.0|18.10.1|18.12.6|18.16.0|18.18.0)
	# One active revision per functional family. Historical bytes are archived.
	case "${OMP_PATCH_PLAN:-deployed}" in
		deployed|repository) ;;
		*) echo "OMP_PATCH_PLAN must be deployed or repository" >&2; exit 2 ;;
	esac
	if [[ ( "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ) && ! -f "${HERE}/.${OMP_PATCH_VERSION}-families/manifest.json" ]]; then
		echo "family manifest missing: ${HERE}/.${OMP_PATCH_VERSION}-families/manifest.json" >&2
		exit 2
	fi
	if [[ "$READ_ONLY_QUERY" != 1 ]]; then
		for package in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
			package_version="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "${NM}/${package}/package.json" 2>/dev/null || true)"
			[[ "$package_version" == "$OMP_PATCH_VERSION" ]] || {
				echo "${package} must be ${OMP_PATCH_VERSION}, found: ${package_version:-<missing>}" >&2
				exit 2
			}
		done
	fi
	_omp_family_plan
	if [[ "$OMP_PATCH_VERSION" == "18.10.0" || "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		# Upstream b83200eb retains self-contained native replay warming while
		# deliberately excluding connection-bound histories; no local 0017
		# remains (18.12.6 keeps the same proven upstream adoption).
		PLAN_CAPABILITIES[0017]=upstream
	fi
	if [[ "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		# Approved upstream adoption (unpatched-target producer proof plus
		# mutation controls): the target's own MIME producer covers 0078, so
		# no local patch remains; its consumer gate stays selected via the
		# upstream capability marker.
		PLAN_CAPABILITIES[0078]=upstream
		if [[ "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
			# M5 adoptions: upstream owns the contract; the gate stays selected
			# through the marker so an adopted capability is never silently ungated.
			# 18.18.0 mirrors the approved 18.16.0 six; 0054 stays family-owned
			# until its own adoption lands (upgrade plan M1).
			PLAN_CAPABILITIES[0066]=upstream
			PLAN_CAPABILITIES[0072]=upstream
			PLAN_CAPABILITIES[0079]=upstream
			PLAN_CAPABILITIES[0062]=upstream
			if [[ "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
				# 0054 joined in R1 (M1) with its consumer proof plus the
				# negative control at verify-antigravity-envelope.ts:42; the
				# gate stays selected so the adopted contract is never ungated.
				PLAN_CAPABILITIES[0054]=upstream
			fi
		fi
	fi
	# The undeployed computeruse candidate is an explicit repository overlay.
	# A missing file never implicitly selects a smaller deployment plan.
	if [[ "${OMP_PATCH_PLAN:-deployed}" == repository ]]; then
		[[ "$OMP_PATCH_VERSION" == "18.7.0" ]] || {
			echo "0097 repository overlay is not migrated for ${OMP_PATCH_VERSION}; use deployed" >&2
			exit 2
		}
		_omp_tail_candidate "18.7.0" "0097-omp-computeruse" "${NM}"
		PLAN_CAPABILITIES[0097]=1
	fi
	;;
*)
	echo "OMP_PATCH_VERSION='${OMP_PATCH_VERSION:-<unset>}' unsupported (known:18.4.4,18.7.0,18.10.0,18.10.1,18.12.6,18.16.0,18.18.0)" >&2
	exit 2
	;;
esac

if [[ "$OMP_PATCH_VERSION" != "18.7.0" && "$OMP_PATCH_VERSION" != "18.10.0" && "$OMP_PATCH_VERSION" != "18.10.1" && "$OMP_PATCH_VERSION" != "18.12.6" && "$OMP_PATCH_VERSION" != "18.16.0" && "$OMP_PATCH_VERSION" != "18.18.0" && -n "${OMP_PATCH_PLAN+x}" ]]; then
	echo "OMP_PATCH_PLAN is supported only for 18.7.0, 18.10.0, 18.10.1, 18.12.6, 18.16.0 and 18.18.0" >&2
	exit 2
fi

if [[ "$MODE" == "print-capabilities" ]]; then
	if [[ "$OMP_PATCH_VERSION" == "18.7.0" || "$OMP_PATCH_VERSION" == "18.10.0" || "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		printf '%s\n' "${!PLAN_CAPABILITIES[@]}" | sort
	else
		for entry in "${PATCHES[@]}"; do
			name="${entry%%:*}"; name="${name##*/}"
			printf '%s\n' "${name%%-*}"
		done | sort -u
	fi
	exit 0
fi

# 18.18.0's durability proof traces fsync calls, so the toolchain must be able
# to trace a child before anything is touched. The proof runs only from a real
# apply (the gate suite is apply-only), so --check and --revert must stay
# usable on a box without working ptrace. Refuse with the prerequisite named
# instead of letting the gate fail later (or skip).
if [[ "$OMP_PATCH_VERSION" == "18.18.0" && "$MODE" == "apply" ]]; then
	if ! command -v strace >/dev/null 2>&1; then
		echo "18.18.0 plan requires strace: the fsync durability leg must not skip; install strace and re-run" >&2
		exit 2
	fi
	if ! strace -f -e trace=fsync true >/dev/null 2>&1; then
		echo "18.18.0 plan requires a working strace (ptrace of a child failed: strace -f -e trace=fsync true); fix ptrace permissions or install a working strace" >&2
		exit 2
	fi
	# The 18.18.0 chain assumes the thread-safe payload-archive companion. Pin
	# the source of record here; the LIVE copy is validated only after it has
	# been staged and its symlinks resolved (_omp_stage_companions), so this
	# preflight never opens a path under the live tree. A tree that fails the
	# gates must never be installed first: the operator deploys the companion,
	# then re-runs; the message names the source.
	APPROVED_PAYLOAD="${HERE}/payload-archive-extension.ts"
	APPROVED_PAYLOAD_SHA256="4ca8e6dd31e34d0162fa2535b6e473a2239823d5636567ce97f129dd026fad93"
	if [[ ! -f "$APPROVED_PAYLOAD" ]]; then
		echo "18.18.0 apply requires the approved companion source ${APPROVED_PAYLOAD}" >&2
		exit 2
	fi
	source_payload_sha="$(sha256sum -- "$APPROVED_PAYLOAD" | cut -d' ' -f1)"
	if [[ "$source_payload_sha" != "$APPROVED_PAYLOAD_SHA256" ]]; then
		echo "18.18.0 apply: ${APPROVED_PAYLOAD} is not the approved thread-safe payload-archive companion (${source_payload_sha}); restore the approved source before applying" >&2
		exit 2
	fi
fi

# Transitive symlink walk for companion fixtures. Every link reachable from
# ROOT must resolve inside one of the allowed roots and never under a
# `.omp/agent` tree. A link whose target is a directory is followed: its
# interior links are link targets too, and the two-hop shape (a directory link
# that stays inside an allowed root, whose target holds a file link into live
# agent state) is exactly what a one-level `find -type l` misses. Directories
# are visited once by realpath, so a link cycle terminates.
_omp_assert_link_tree() { # label root allowed...
	local label="$1" root="$2"; shift 2
	local -a allowed=("$@")
	local -A visited=()
	local -a pending=()
	local node entry target allowed_root ok
	target="$(readlink -f -- "$root" 2>/dev/null)" || {
		echo "${label}: root is missing or unresolvable: ${root}" >&2
		exit 2
	}
	pending=("$target")
	while (( ${#pending[@]} > 0 )); do
		node="${pending[${#pending[@]}-1]}"
		unset 'pending[${#pending[@]}-1]'
		if [[ -n "${visited[$node]:-}" ]]; then
			continue
		fi
		visited[$node]=1
		for entry in "$node"/* "$node"/.[!.]* "$node"/..?*; do
			[[ -e "$entry" || -L "$entry" ]] || continue
			if [[ -L "$entry" ]]; then
				target="$(readlink -f -- "$entry" 2>/dev/null)" || {
					echo "${label}: broken symlink: ${entry}" >&2
					exit 2
				}
				case "$target" in
					*/.omp/agent | */.omp/agent/*)
						echo "${label}: symlink resolves into live agent state: ${entry} -> ${target}" >&2
						exit 2
						;;
				esac
				ok=0
				for allowed_root in "${allowed[@]}"; do
					case "$target" in
						"$allowed_root" | "$allowed_root"/*)
							ok=1
							break
							;;
					esac
				done
				if (( ok == 0 )); then
					echo "${label}: symlink resolves outside the allowed roots: ${entry} -> ${target}" >&2
					exit 2
				fi
				if [[ -d "$target" ]]; then
					pending+=("$target")
				fi
			elif [[ -d "$entry" ]]; then
				pending+=("$entry")
			fi
		done
	done
}

# Stage the live companion set for verify-extensions-load-18180 (18.18.0 apply).
#
# Run before any patch is applied, so a bad companion tree fails closed without
# touching the install. The live directory is only read; the gate never sees a
# path into it.
#   - A symlinked root would resolve `${live}/<name>` wherever it points,
#     including `.omp/agent` state, so only a real directory is staged.
#   - `spec-update-gate.ts` was retired (O5) and must not come back.
#   - Native discovery also loads top-level `.js`, `<dir>/index.ts|index.js` and
#     package-manifest entries; those forms are refused, never silently dropped.
#   - The canonical 15 must all be present; other enabled `*.ts` modules are
#     staged and loaded too (the gate requires the canonical 15 as a subset and
#     reports the extras), and `*.bak-*` are not extensions.
#   - A symlinked entry is resolved FIRST: a target, or target directory, under
#     `.omp/agent` is refused before it is copied. The target directory is then
#     walked transitively and copied whole, so sibling imports travel with it.
#     The staged link keeps the canonical entry name and names the target by
#     its own basename, which may differ from the entry name.
COMPANION_STAGED=""
_omp_stage_companions() { # destination
	local dest="$1"
	local live="${HOME}/.omp/agent/extensions"
	local retired="spec-update-gate.ts"
	local -a canonical=(auth-unlock.ts auto-continue.ts cache-prefix-audit.ts
		context-notes-save-gate.ts context-persist-audit.ts cron.ts ctx.ts
		input-translator-extension.ts jev-memory-gate.ts magic-commands.ts
		payload-archive.ts resume-cache-breakpoint.ts subagent-gate.ts
		tasks.ts turn-timer.ts)
	local -a names=() missing=() extras=()
	local entry name target source_dir stem candidate
	[[ -d "$live" ]] || {
		echo "companions: live extensions directory not found: ${live}; 18.18.0 apply stages the enabled companions from it" >&2
		exit 2
	}
	if [[ -L "$live" ]]; then
		echo "companions: ${live} is a symlink; 18.18.0 apply stages a real extensions directory, not whatever a link resolves to" >&2
		exit 2
	fi
	# Native extension discovery also loads top-level `.js`, `<dir>/index.ts|
	# index.js` and package-manifest entries. Those have no faithful staged
	# representation here, so an install that would load them fails closed
	# instead of silently staging only the `*.ts` entries. `*.bak-*` are not
	# extensions and are ignored.
	for entry in "$live"/* "$live"/.[!.]* "$live"/..?*; do
		[[ -e "$entry" || -L "$entry" ]] || continue
		name="${entry##*/}"
		case "$name" in *.bak-*) continue ;; esac
		if [[ "$name" == *.ts ]]; then
			if [[ "$name" == "$retired" ]]; then
				echo "companions: ${live} still contains retired ${retired} (O5); remove it before applying 18.18.0" >&2
				exit 2
			fi
			names+=("$name")
			continue
		fi
		case "$name" in
			*.js | *.mjs | *.cjs | package.json)
				echo "companions: ${live} contains ${name}, an extension entry native discovery loads; 18.18.0 apply stages top-level *.ts companions only — remove it" >&2
				exit 2
				;;
		esac
		if [[ -L "$entry" ]]; then
			echo "companions: ${live} contains symlinked entry ${name}, an extension entry native discovery loads; 18.18.0 apply stages top-level *.ts companions only — remove it" >&2
			exit 2
		fi
		if [[ -d "$entry" ]]; then
			for candidate in index.ts index.js index.mjs index.cjs package.json; do
				if [[ -e "${entry}/${candidate}" || -L "${entry}/${candidate}" ]]; then
					echo "companions: ${live} contains directory extension ${name}/ (${candidate}), which native discovery loads; 18.18.0 apply stages top-level *.ts companions only — remove it" >&2
					exit 2
				fi
			done
		fi
	done
	for name in "${canonical[@]}"; do
		[[ -e "${live}/${name}" || -L "${live}/${name}" ]] || missing+=("$name")
	done
	if (( ${#missing[@]} > 0 )); then
		echo "companions: ${live} is missing canonical modules: ${missing[*]}; the gate requires all ${#canonical[@]}" >&2
		exit 2
	fi
	mkdir -p "$dest"
	for name in "${names[@]}"; do
		entry="${live}/${name}"
		if [[ -L "$entry" ]]; then
			target="$(readlink -f -- "$entry")" || {
				echo "companions: live ${name} is a broken symlink: ${entry}" >&2
				exit 2
			}
			case "$target" in
				*/.omp/agent | */.omp/agent/*)
					echo "companions: live ${name} resolves into live agent state: ${entry} -> ${target}" >&2
					exit 2
					;;
			esac
			source_dir="$(dirname "$target")"
			case "$source_dir" in
				*/.omp/agent | */.omp/agent/*)
					echo "companions: live ${name} target directory is live agent state: ${entry} -> ${source_dir}" >&2
					exit 2
					;;
			esac
			_omp_assert_link_tree "live ${name} source" "$source_dir" "$source_dir"
			stem="${name%.ts}"
			mkdir -p "${dest}/linked"
			cp -a --reflink=auto "$source_dir" "${dest}/linked/${stem}"
			ln -s "linked/${stem}/$(basename "$target")" "${dest}/${name}"
		elif [[ -f "$entry" ]]; then
			cp -a --reflink=auto "$entry" "${dest}/${name}"
		else
			echo "companions: live ${name} is neither a regular file nor a symlink" >&2
			exit 2
		fi
	done
	# Self-contained before the gate reads it, transitively: a directory link
	# must not smuggle a link into live agent state.
	_omp_assert_link_tree "staged companion fixture" "$dest" "$dest"
	for name in "${names[@]}"; do
		case " ${canonical[*]} " in
			*" ${name} "*) ;;
			*) extras+=("$name") ;;
		esac
	done
	echo "companions: staged ${#names[@]} modules from ${live} (canonical ${#canonical[@]}${extras[*]:+; extra enabled: ${extras[*]}})"
}

# One dispatch path serves execution and read-only coverage inspection.
_omp_gate() {
	local capability="$1" script="$2" isolation="${3:-}" entry pkg
	if [[ -n "$capability" ]] && ! _omp_has_capability "$capability"; then
		[[ "$MODE" == print-gates ]] || echo "${script%.*}: skipped ($capability not in this plan)"
		return 0
	fi
	if [[ "$MODE" == print-gates ]]; then
		printf '%s\n' "$script"
		return 0
	fi
	case "$isolation" in
		oauth)
			(
				oauth_verify_root="$(mktemp -d)"
				trap 'rm -rf -- "$oauth_verify_root"' EXIT
				cp -a --reflink=auto "${NM}/.." "${oauth_verify_root}/node_modules"
				# Outer selectors must not redirect consumers out of this private copy.
				unset OMP_PATCH_VERIFY_AGENT_ROOT OMP_PATCH_VERIFY_NM
				case "$script" in
					*.sh)
						OMP_PATCH_VERIFY_AI_ROOT="${oauth_verify_root}/node_modules/@oh-my-pi/pi-ai" \
							bash "${HERE}/${script}"
						;;
					*)
						OMP_PATCH_VERIFY_AI_ROOT="${oauth_verify_root}/node_modules/@oh-my-pi/pi-ai" \
							bun "${HERE}/${script}"
						;;
				esac
			)
			;;
		warm)
			(
				warm_verify_root="$(mktemp -d)"
				trap 'rm -rf -- "$warm_verify_root"' EXIT
				mkdir -p "${warm_verify_root}/node_modules/@oh-my-pi"
				for entry in "${NM}/.."/* "${NM}/.."/.[!.]* "${NM}/.."/..?*; do
					[[ -e "$entry" || -L "$entry" ]] || continue
					[[ "${entry##*/}" == "@oh-my-pi" ]] || ln -s "$entry" "${warm_verify_root}/node_modules/${entry##*/}"
				done
				for pkg in "${NM}"/* "${NM}"/.[!.]* "${NM}"/..?*; do
					[[ -e "$pkg" || -L "$pkg" ]] || continue
					[[ "${pkg##*/}" == "pi-coding-agent" ]] || ln -s "$pkg" "${warm_verify_root}/node_modules/@oh-my-pi/${pkg##*/}"
				done
				cp -a --reflink=auto "${AGENT}" "${warm_verify_root}/node_modules/@oh-my-pi/pi-coding-agent"
				OMP_PATCH_VERIFY_AGENT_ROOT="${warm_verify_root}/node_modules/@oh-my-pi/pi-coding-agent" \
					bun "${HERE}/${script}"
			)
			;;
		private)
			# Complete private runtime copy: these gates fail closed when a
			# selected root is the operator's live install, so every package root
			# (not just the one the gate reads first) is redirected into the copy.
			(
				private_verify_root="$(mktemp -d)"
				trap 'rm -rf -- "$private_verify_root"' EXIT
				cp -a --reflink=auto "${NM}/.." "${private_verify_root}/node_modules"
				private_nm="${private_verify_root}/node_modules/@oh-my-pi"
				unset OMP_PATCH_VERIFY_NM OMP_PATCH_VERIFY_AGENT_ROOT OMP_PATCH_VERIFY_AI_ROOT \
					OMP_PATCH_VERIFY_CORE_ROOT OMP_PATCH_VERIFY_CATALOG_ROOT \
					OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT OMP_PATCH_VERIFY_TUI_ROOT
				OMP_PATCH_VERIFY_NM="$private_nm" \
				OMP_PATCH_VERIFY_AGENT_ROOT="${private_nm}/pi-coding-agent" \
				OMP_PATCH_VERIFY_CORE_ROOT="${private_nm}/pi-agent-core" \
				OMP_PATCH_VERIFY_AI_ROOT="${private_nm}/pi-ai" \
				OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="${private_nm}/snapcompact" \
				OMP_PATCH_VERIFY_CATALOG_ROOT="${private_nm}/pi-catalog" \
				OMP_PATCH_VERIFY_TUI_ROOT="${private_nm}/pi-tui" \
					bun "${HERE}/${script}"
			)
			;;
		companions)
			# 18.18.0 apply is the real install, so the companion set it must
			# load is the live one, staged into a private fixture before the
			# first patch landed (_omp_stage_companions): the canonical 15 plus
			# every other enabled module, symlinked entries copied whole. The
			# gate owns the canonical list (verify-extensions-load-18180.ts
			# EXPECTED) and requires all 15. --check/--print-* never run gates,
			# never read live extensions, and never stage.
			[[ -n "${COMPANION_STAGED:-}" ]] || {
				echo "companions: no staged live companion fixture (mode: ${MODE}); 18.18.0 apply stages it before patching" >&2
				exit 2
			}
			OMP_EXTENSIONS_STAGED_DIR="$COMPANION_STAGED" bun "${HERE}/${script}"
			;;
		*)
			case "$script" in
				*.sh) bash "${HERE}/${script}" ;;
				*) bun "${HERE}/${script}" ;;
			esac
			;;
	esac
}

_omp_run_gates() {
	_omp_gate "" verify-antigravity-envelope.ts
	_omp_gate "" verify-prefix-cache-compaction.ts
	_omp_gate "" verify-provider-image-budget.ts
	_omp_gate "" verify-snapcompact-model-billing.ts
	# 0025 is retired for 18.18.0 by user decision (upgrade plan §2.1/§10): the
	# gate file and every older arm keep their registration, so only the 18.18.0
	# selection drops it.
	if [[ "$OMP_PATCH_VERSION" != "18.18.0" ]]; then
		_omp_gate "" verify-ollama-cloud-usage.ts
	fi
	_omp_gate 0055 verify-devin-auth-cache.ts
	_omp_gate "" verify-hindsight-recall-snapshot.ts
	_omp_gate "" verify-interrupt-prune-symmetry.ts
	_omp_gate 0032 verify-goal-tool-resident.ts
	# 18.16.0 replaced the anchor API with upstream's date/cwd journal; its arm
	# proves the journal prefix instead (DECISIONS.md, Q1). 18.18.0 carries the
	# same journal model, so the retired anchor gate stays out of both arms.
	if [[ "$OMP_PATCH_VERSION" != "18.16.0" && "$OMP_PATCH_VERSION" != "18.18.0" ]]; then
		_omp_gate 0047 verify-date-cwd-anchor-stability.ts
	fi
	if [[ "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0047 verify-date-cwd-journal-prefix.ts
	fi
	if [[ "$OMP_PATCH_VERSION" == "18.10.0" || "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0047 verify-session-transfer-authority.ts
	fi
	_omp_gate 0056 verify-devin-metadata.ts
	_omp_gate "" verify-supersede-warm-prefix-guard.ts
	if _omp_has_capability 0045 || _omp_has_capability 0062 || [[ "$OMP_PATCH_VERSION" == "18.7.0" ]]; then
		_omp_gate "" verify-snapcompact-frame-reprice.ts
	fi
	_omp_gate 0050 verify-session-history-preview.ts
	if [[ "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate "" verify-native-dialog-lifecycle.ts
		_omp_gate "" verify-manual-compaction-direct.ts
		_omp_gate "" verify-context-notes-append-projection.ts
	fi
	_omp_gate 0058 verify-devin-thinking-signature.ts
	_omp_gate 0060 verify-devin-idle-cascade-pin.ts
	_omp_gate 0010 verify-idle-ephemeral-reservation.ts
	_omp_gate "" verify-resume-cache-breakpoint.ts
	_omp_gate "" verify-codex-compaction-chain.ts
	# 0065 is retired for 18.18.0 by user decision: its capability leaves the
	# 18.18.0 plan, so this arm keeps older plans byte-identical and makes the
	# retirement explicit rather than implicit in plan membership.
	if [[ "$OMP_PATCH_VERSION" != "18.18.0" ]]; then
		_omp_gate 0065 verify-commandcode-model-record-parity.ts
	fi
	_omp_gate 0066 verify-anthropic-native-compaction-live-context.ts
	_omp_gate 0067 verify-compaction-lane-trace.ts
	_omp_gate 0069 verify-codex-effort-resume.ts
	_omp_gate 0070 verify-codex-compaction-chain-fail-closed.ts
	_omp_gate 0072 verify-session-pin-static-auth-ui.ts
	_omp_gate "" verify-read-description-live.ts
	_omp_gate 0074 verify-anthropic-cache-boundaries.ts
	_omp_gate 0074 verify-anthropic-request-audit.ts
	_omp_gate 0075 verify-hindsight-recall-promotion-slot.ts
	_omp_gate 0076 verify-eval-state-context-persist.ts
	_omp_gate 0077 verify-turn-recovery-reminder-persist.ts
	_omp_gate 0078 verify-python-display-mime-preference.ts
	_omp_gate 0079 verify-kitty-conversion-finalization.ts
	_omp_gate 0080 verify-kitty-shared-png-cache.ts
	_omp_gate 0081 verify-main-cache-hit.ts
	# The one-decimal reset countdowns exist only in the 18.10.1 family revision
	# (inherited by the 18.12.6 plan); the 18.4.4/18.7.0/18.10.0 plans keep
	# their own frozen family bytes.
	if [[ "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0081 verify-usage-reset-format.ts
	fi
	_omp_gate 0083 verify-model-mention-surface-resume.ts
	_omp_gate 0093 verify-prompt-effort-resume.ts
	_omp_gate 0093 verify-model-selection-resume.ts
	_omp_gate 0094 verify-anthropic-thinking-drop-resume.ts
	_omp_gate 0095 verify-context-persist-audit.ts
	_omp_gate 0084 verify-length-stop-reminder-persist.ts
	# Q10 (18.16.0): the 0082 HTML-export hunks are dropped and the gate's tree
	# pin ends at 18.12.6; the rebase is proven by a throwaway consumer smoke.
	# 18.18.0 rebases 0082 and selects the gate again (upgrade plan row 0082).
	if [[ "$OMP_PATCH_VERSION" != "18.16.0" ]]; then
		_omp_gate 0082 verify-user-display-text-queue.ts
	fi
	_omp_gate 0085 verify-rejected-prepared-draft-restore.ts
	_omp_gate 0088 verify-compaction-cache-liveness.ts
	_omp_gate 0090 verify-oauth-durable-refresh.ts oauth
	# The unlock revision and its fault controls ship with the 18.10.1 revision
	# (carried into the 18.12.6 plan); 18.10.0 keeps the frozen
	# reserve/stage/commit tree and its own gate list.
	if [[ "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0090 verify-oauth-unlock-fence-faults.sh oauth
	fi
	if [[ "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0090 verify-auth-unlock-extension.ts oauth
	fi
	# Codex/Antigravity 403 eligibility retention ships with the 18.10.1 family
	# revision (carried into the 18.12.6 plan); the 18.10.0 plan keeps its
	# frozen family bytes and gate list.
	if [[ "$OMP_PATCH_VERSION" == "18.10.1" || "$OMP_PATCH_VERSION" == "18.12.6" || "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0090 verify-codex-account-eligibility-retention.ts
		_omp_gate 0090 verify-google-account-eligibility-retention.ts
	fi
	_omp_gate 0092 verify-cache-warming-idle-budget.ts warm
	# The cron companion's idle-ownership proof is pinned to the 18.16.0 tree
	# (its catalog skip list and the warmer/session contracts it relies on);
	# 18.18.0 takes the same arm.
	if [[ "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0092 verify-cron-idle-owners.ts warm
		_omp_gate 0010 verify-session-cache-keepalive.ts
	fi
	_omp_gate 0098 verify-tls-verify-transient-retry.ts
	_omp_gate 0099 verify-retry-slow-schedule.ts
	# 0100's consumer proof is new for the 18.16.0 arm (the 18.12.6 plan proved it
	# with a throwaway research smoke); older arms keep their frozen gate list.
	# 0100 is retired for 18.18.0, so this arm stays 18.16.0-only.
	if [[ "$OMP_PATCH_VERSION" == "18.16.0" ]]; then
		_omp_gate 0100 verify-stepfun-step-plan.ts
	fi
	_omp_gate 0101 verify-subagent-warm-revival-prompt.ts
	# 0102 is new for the 18.16.0 arm: the 18.12.6 plan has no such capability, so
	# the marker keeps every earlier arm's frozen gate list.
	_omp_gate 0102 verify-computer-control-confirm-deadline.ts
	# M7: the companion extensions load through the real host, receive
	# before_agent_start prompt/revive and shut down cleanly. 18.16.0-only: the
	# gate pins the tree and needs 0082's prepare_user_input/display text.
	if [[ "$OMP_PATCH_VERSION" == "18.16.0" ]]; then
		_omp_gate 0082 verify-extensions-load-18160.ts
	fi
	# M7 (18.18.0): the live companion set (symlinks followed) against the
	# rebased chain, including the four patch-dependency hooks.
	if [[ "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate 0082 verify-extensions-load-18180.ts companions
		# D5: Codex text.verbosity default low and its medium override, over a
		# loopback-only transport.
		_omp_gate "" verify-codex-text-verbosity.ts
		# R1: the usage pipeline's missing behaviour gate (0037 turn gate and
		# provider scoping, 0026 identity/alias invalidation, 0030 key collapse).
		_omp_gate 0037 verify-usage-statusline-gate.ts
		# R1: 0031 provider scope across the worker boundary, over a real RpcLink
		# pair plus the pinned worker pool.
		_omp_gate 0031 verify-usage-thread-providers.ts
		# O1: journal-injected controls must not shorten the live compaction prefix.
		_omp_gate 0035 verify-compaction-live-chain-midnight.ts
		# R5: OAuth stays main-owned when a session is placed in a worker.
		_omp_gate 0090 verify-oauth-worker-single-owner.ts private
		# M5: logical history diagnostics and summary/warm thread isolation.
		_omp_gate 0074 verify-anthropic-threads-cache-shape.ts private
		_omp_gate 0088 verify-anthropic-threads-warm-compaction-isolation.ts private
		# M6: real worker realm runtime contracts and shipped placement default.
		_omp_gate "" verify-worker-runtime.ts
	fi
	# M9b unowned P0/P1 proofs: registered on the 18.16.0 and 18.18.0 arms, so
	# every earlier plan's gate list stays byte-identical.
	if [[ "$OMP_PATCH_VERSION" == "18.16.0" || "$OMP_PATCH_VERSION" == "18.18.0" ]]; then
		_omp_gate "" verify-withdrawn-tools-wire.ts
		_omp_gate "" verify-tool-schema-bytes.ts
		_omp_gate "" verify-remote-compaction-target-key.ts
		_omp_gate "" verify-compaction-length-stop.ts
		_omp_gate "" verify-tokenizer-budget-parity.ts
		_omp_gate "" verify-held-file-write-guard.ts
		_omp_gate 0048 verify-advisor-quota-rotation.ts
		_omp_gate "" verify-prompt-rebuild-inputs.ts
		_omp_gate "" verify-provider-registry-lazy.ts
		_omp_gate "" verify-catalog-regen-parity.ts
	fi
}

if [[ "$MODE" == print-gates ]]; then
	_omp_run_gates
	exit 0
fi

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

if _omp_plan_has 0097; then
	bun "${HERE}/native-computeruse.ts" preflight "${NM}"
fi

# Patch state is a property of the whole stack, not of one entry in isolation.
# A later entry may rewrite lines an earlier one introduced (0041 over 0037);
# on the final tree that earlier patch no longer reverse-identifies, and a
# per-entry probe would report a bogus CONFLICT. Mirror every touched file into
# a sandbox, peel the stack there in reverse, and record what each layer says
# once the layers above it are gone. Only the sandbox is ever written.
SANDBOX=""
PLAN_SANDBOX=""
COMPANION_ROOT=""
cleanup_sandbox() {
	[[ -n "$SANDBOX" ]] && rm -rf "$SANDBOX"
	[[ -n "$PLAN_SANDBOX" ]] && rm -rf "$PLAN_SANDBOX"
	[[ -n "$COMPANION_ROOT" ]] && rm -rf "$COMPANION_ROOT"
	return 0
}
trap cleanup_sandbox EXIT

# 18.18.0 apply stages the live companion set before the first patch lands, so a
# retired, missing or live-agent-linked companion refuses without touching the
# install. The gate later loads exactly this fixture. The live payload-archive
# companion is hashed only after staging resolved it into the fixture: the check
# never opens a path under the live tree.
if [[ "$OMP_PATCH_VERSION" == "18.18.0" && "$MODE" == "apply" ]]; then
	COMPANION_ROOT="$(mktemp -d)"
	COMPANION_STAGED="${COMPANION_ROOT}/extensions"
	_omp_stage_companions "$COMPANION_STAGED"
	staged_payload="${COMPANION_STAGED}/payload-archive.ts"
	staged_payload_sha=""
	if [[ -f "$staged_payload" ]]; then
		staged_payload_sha="$(sha256sum -- "$staged_payload" | cut -d' ' -f1)"
	fi
	if [[ "$staged_payload_sha" != "$APPROVED_PAYLOAD_SHA256" ]]; then
		echo "18.18.0 apply: live ${HOME}/.omp/agent/extensions/payload-archive.ts is not the approved thread-safe payload-archive companion (found ${staged_payload_sha:-missing}, expected ${APPROVED_PAYLOAD_SHA256}); deploy ${APPROVED_PAYLOAD} to the live companion first, then re-run" >&2
		exit 2
	fi
fi

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
	# Bind gates to the selected tree; credential-sensitive gates copy it again.
	# The roots are canonicalized: a tree reached through a symlinked global
	# root ($HOME/.bun/install/global/node_modules) makes the registry gate see
	# provider modules it imported under one path and compares by another, so
	# every provider reads as "loaded nothing". Hand the gates the real tree.
	export OMP_PATCH_VERIFY_NM="$(readlink -f -- "$NM")"
	export OMP_PATCH_VERIFY_AGENT_ROOT="$(readlink -f -- "$AGENT")"
	export OMP_PATCH_VERIFY_CORE_ROOT="$(readlink -f -- "$CORE")"
	export OMP_PATCH_VERIFY_AI_ROOT="$(readlink -f -- "$AI")"
	export OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="$(readlink -f -- "$SNAP")"
	export OMP_PATCH_VERIFY_CATALOG_ROOT="$(readlink -f -- "${NM}/pi-catalog")"
	export OMP_PATCH_VERIFY_TUI_ROOT="$(readlink -f -- "$TUI")"
	_omp_run_gates
fi
if _omp_plan_has 0097; then
	native_mode="$MODE"
	[[ "$native_mode" == "verify-rollups" ]] && native_mode=check
	bun "${HERE}/native-computeruse.ts" "$native_mode" "${NM}"
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
