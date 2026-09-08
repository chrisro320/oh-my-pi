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
	--verify-rollups) MODE="verify-rollups" ;;
	"") ;;
	*)
		echo "usage: $0 [--revert|--check|--verify-rollups]" >&2
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
	"0019-omp-model-switch-read-description-refresh.patch:${AGENT}"
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
	"0042-omp-resume-read-description-refresh.patch:${AGENT}"
	"0043-omp-interrupt-prune-symmetry.patch:${AGENT}"
	"0044-omp-image-budget-wire-api-family.patch:${NM}"
	"0045-omp-snapcompact-frame-reprice.patch:${AGENT}"
	"0046-omp-supersede-warm-prefix-guard.patch:${AGENT}"
	"0048-omp-advisor-quota-rotation-bound.patch:${AGENT}"
)

if [[ "$MODE" == "verify-rollups" ]]; then
	# Exec before version selection: the rollup gate builds its own pristine
	# 18.0.9 sandboxes and must not see or fail on OMP_PATCH_VERSION.
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
	installed="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$pkgjson" 2>/dev/null || true)"
	[[ "$installed" == "$version" ]] || {
		echo "OMP_PATCH_VERSION=$version requires pi-coding-agent $version, found: ${installed:-<unreadable>}" >&2
		exit 2
	}
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
# Versioned 0010 selection (opt-in only). Unset keeps the canonical 18.0.9
# chain exactly as before; OMP_PATCH_VERSION=18.0.11 swaps entry 0010 for the
# versioned candidate under .18.0.11-candidates/ (and requires the installed
# pi-coding-agent to be 18.0.11). Any other value — including an empty string —
# fails closed before anything is touched.

if [[ -n "${OMP_PATCH_VERSION+x}" ]]; then
	case "$OMP_PATCH_VERSION" in
	18.0.9) ;;
	18.0.11)
		IDLE0010_CANDIDATE=".18.0.11-candidates/0010-omp-extension-idle-ephemeral-turn-v18.0.11-candidate.patch"
		pkgjson="${NM}/pi-coding-agent/package.json"
		installed="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$pkgjson" 2>/dev/null || true)"
		[[ "$installed" == "18.0.11" ]] || {
			echo "OMP_PATCH_VERSION=18.0.11 requires pi-coding-agent 18.0.11, found: ${installed:-<unreadable>}" >&2
			exit 2
		}
		[[ -f "${HERE}/${IDLE0010_CANDIDATE}" ]] || {
			echo "candidate patch missing: ${HERE}/${IDLE0010_CANDIDATE}" >&2
			exit 2
		}
		for i in "${!PATCHES[@]}"; do
			if [[ "${PATCHES[i]}" == "0010-omp-extension-idle-ephemeral-turn.patch:"* ]]; then
				PATCHES[i]="${IDLE0010_CANDIDATE}:${PATCHES[i]##*:}"
			fi
		done
		echo "NOTE: OMP_PATCH_VERSION=18.0.11 — 0010 served from ${IDLE0010_CANDIDATE}" >&2
		;;
	18.1.2)
		_omp_version_candidates "18.1.2" 0010 0030 omit:0038
		;;
	18.1.5)
		_omp_version_candidates "18.1.5" 0010 0030 0038
		;;
	18.1.10)
		# 0019/0042 退役：上游移除 inspect_image 與整套 read description refresh
		# 機制，兩個補丁修的漂移源不存在了（見 .retired/09-04-18.1.10-inspect-image-removal/）。
		# 0035 新增候選：上游在 TURN_PREFIX_SUMMARIZATION_PROMPT 之後插入 Codex
		# 判定函式，擠掉 canonical hunk 的下文。
		_omp_version_candidates "18.1.10" 0010 0030 0035 0038 omit:0019 omit:0042
		# 0047 僅在 18.1.10 計畫可用：它的 a 側是 candidate-0038 的產出形態，對
		# 18.0.9 canonical-0038 樹 --fuzz=0 四 hunk 全掛（實測否決），故 base 計畫
		# （= 無 OMP_PATCH_VERSION 的 18.0.9 鏈）不得包含它。與後續條目檔案不相交，
		# 直接追加鏈尾。
		PATCHES+=("0047-omp-date-cwd-anchor-stability.patch:${AGENT}")
		;;
	18.1.14)
		# 18.1.10 → 18.1.14（上游 4 版：11 retry.waitForUsageReset / bash 複合命令批准、
		# 12 Muse Code、13 dotenv provenance、14 reasoning-effort fallback）。
		# 0004/0014/0017/0030 因上下文行侵蝕需新候選（0014 的 isClaude 尾部上下文、
		# 0030 的 import 區、0004 的 segments 註解塊、0017 的 warm flag 鄰行）；
		# 0010/0035/0038 沿用 18.1.10 候選字節（已核 cmp 相同），為版本計畫完整性另存一份。
		_omp_version_candidates "18.1.14" 0004 0010 0014 0017 0030 0035 0038 omit:0019 omit:0042
		# 0047 同 18.1.10：a 側是 candidate-0038 的產出形態，只能掛在該分支鏈尾。
		PATCHES+=("0047-omp-date-cwd-anchor-stability.patch:${AGENT}")
		;;
	*)
		echo "OMP_PATCH_VERSION='${OMP_PATCH_VERSION}' unsupported (known: 18.0.9, 18.0.11, 18.1.2, 18.1.5, 18.1.10, 18.1.14)" >&2
		exit 2
		;;
	esac
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
	sed -n 's|^--- a/||p' "$1" | cut -f1
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
	patch -p1 "$dir_flag" --force --silent --dry-run -d "$dir" <"$file" >/dev/null 2>&1 || return 1
	patch -p1 "$dir_flag" --force --silent --no-backup-if-mismatch -d "$dir" <"$file" >/dev/null 2>&1 || {
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
	bun "${HERE}/verify-antigravity-envelope.ts"
	bun "${HERE}/verify-prefix-cache-compaction.ts"
	bun "${HERE}/verify-provider-image-budget.ts"
	bun "${HERE}/verify-hindsight-recall-snapshot.ts"
	OMP_PATCH_VERIFY_AGENT_ROOT="$AGENT" bun "${HERE}/verify-interrupt-prune-symmetry.ts"
	OMP_PATCH_VERIFY_AGENT_ROOT="$AGENT" OMP_PATCH_VERIFY_CORE_ROOT="$CORE" bun "${HERE}/verify-supersede-warm-prefix-guard.ts"
fi
if [[ "$MODE" != "check" ]]; then
	if [[ "$OFFLINE_VERIFY" == "1" ]]; then
		echo "smoke: skipped by explicit offline replay mode"
	else
		printf 'smoke: '
		if out="$(cd /tmp && timeout 90 omp --no-session --no-extensions --no-skills --no-lsp -p 'say PATCH_OK' 2>&1)"; then
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
