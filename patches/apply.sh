#!/usr/bin/env bash
# Re-apply local omp source patches after an upgrade.
#
#   ~/.omp/patches/apply.sh          apply (idempotent)
#   ~/.omp/patches/apply.sh --revert undo, restore the stock bundle entrypoint
#   ~/.omp/patches/apply.sh --check  report state, change nothing
#   ~/.omp/patches/apply.sh --verify-rollups  verify family representations
#   ~/.omp/patches/apply.sh --print-{plan,capabilities,gates,gate-map,families}  read-only menus
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
# The one version registry (versions.json) and its shared helper.
# shellcheck source=version-registry.sh
source "${HERE}/version-registry.sh"
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
	--print-gate-map) MODE="print-gate-map" ;;
	--print-no-gate) MODE="print-no-gate" ;;
	--print-families) MODE="print-families" ;;
	"") ;;
	*)
		echo "usage: $0 [--revert|--check|--print-plan|--print-capabilities|--print-gates|--print-gate-map|--print-no-gate|--print-families|--verify-rollups]" >&2
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

# Resolved plan entries, "patch-file:package-root", in application order. They
# come only from the selected release's family registry (_omp_family_plan).
PATCHES=()
# Per registry row, in order: the family id (patch file name without its
# `-v<version>.patch` suffix) and its comma-joined capabilities. `--print-families`
# prints them; run-gates.py maps `--families` to capabilities through them.
FAMILY_IDS=()
FAMILY_CAPS=()

declare -A PLAN_CAPABILITIES=()
# Physical membership and capability membership are the same registry: a
# capability is selected when a family owns it or the manifest records its
# upstream adoption (marker "upstream").
function _omp_has_capability {
	[[ -n "${PLAN_CAPABILITIES[$1]:-}" ]]
}

function _omp_family_plan {
	local registry="${HERE}/.${OMP_PATCH_VERSION}-families/plan.tsv"
	local file root_key members extra member
	local -a ids
	[[ -f "$registry" ]] || { echo "family registry missing: $registry" >&2; exit 2; }
	PATCHES=()
	FAMILY_IDS=()
	FAMILY_CAPS=()
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
		file="${file##*/}"
		FAMILY_IDS+=("${file%-v${OMP_PATCH_VERSION}.patch}")
		FAMILY_CAPS+=("$members")
	done <"$registry"
	[[ ${#PATCHES[@]} -gt 0 ]] || { echo "empty family registry" >&2; exit 2; }
}

# Versioned plan selection. versions.json (version-registry.sh) is the only
# place a supported release is declared; each one is the family registry of
# .<version>-families/ (plan.tsv + manifest.json). Unset OMP_PATCH_VERSION
# auto-routes by the installed pi-coding-agent version (exact match only) so
# the documented one-key re-apply flow keeps working; an explicit value must
# be registered. Retired and unknown values exit 2 before anything is touched.
if [[ -z "${OMP_PATCH_VERSION+x}" ]]; then
	installed="$(omp_tree_version "${NM}/pi-coding-agent/package.json")"
	omp_require_registered "$installed" "installed pi-coding-agent (set OMP_PATCH_VERSION explicitly to select a plan)"
	OMP_PATCH_VERSION="$installed"
	echo "NOTE: OMP_PATCH_VERSION unset — routed to installed ${installed}" >&2
else
	omp_require_registered "$OMP_PATCH_VERSION" "OMP_PATCH_VERSION"
fi
# Gate processes and their children must see the resolved plan even when the
# caller left OMP_PATCH_VERSION unset: several gates choose their contract (or
# fail closed) from it.
export OMP_PATCH_VERSION

if [[ "$MODE" == "verify-rollups" ]]; then
	# Explicit retained release only; deleted historical baselines are not restored.
	exec bash "${HERE}/verify-patch-family-rollups.sh" --version "$OMP_PATCH_VERSION"
fi

# One active revision per functional family. Historical bytes are archived.
case "${OMP_PATCH_PLAN:-deployed}" in
	deployed) ;;
	repository)
		# The undeployed computeruse candidate overlay is retired with its plan.
		echo "0097 repository overlay is not migrated for ${OMP_PATCH_VERSION}; use deployed" >&2
		exit 2
		;;
	*) echo "OMP_PATCH_PLAN must be deployed or repository" >&2; exit 2 ;;
esac
if [[ ! -f "${HERE}/.${OMP_PATCH_VERSION}-families/manifest.json" ]]; then
	echo "family manifest missing: ${HERE}/.${OMP_PATCH_VERSION}-families/manifest.json" >&2
	exit 2
fi
if [[ "$READ_ONLY_QUERY" != 1 ]]; then
	for package in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
		package_version="$(omp_tree_version "${NM}/${package}/package.json")"
		[[ "$package_version" == "$OMP_PATCH_VERSION" ]] || {
			echo "${package} must be ${OMP_PATCH_VERSION}, found: ${package_version:-<missing>}" >&2
			exit 2
		}
	done
fi
_omp_family_plan
# Approved upstream adoptions: the manifest's list must equal the independently
# reviewed approvals.json next to it (release_approvals.py exits 2 on any
# omission or unapproved addition, in every mode including --print-gates).
# Upstream owns the contract, no local patch remains, and the capability's gate
# stays selected through the marker so an adopted capability is never silently
# ungated.
command -v python3 >/dev/null 2>&1 || { echo "python3 is required to read the family manifest" >&2; exit 2; }
adopted="$(python3 -B -I "${HERE}/release_approvals.py" "$HERE" "$OMP_PATCH_VERSION")" || exit 2
for member in $adopted; do
	[[ "$member" =~ ^[0-9]{4}$ && -z "${PLAN_CAPABILITIES[$member]:-}" ]] || {
		echo "invalid or duplicate upstream adoption: $member" >&2
		exit 2
	}
	PLAN_CAPABILITIES[$member]=upstream
done

if [[ "$MODE" == "print-capabilities" ]]; then
	printf '%s\n' "${!PLAN_CAPABILITIES[@]}" | sort
	exit 0
fi
if [[ "$MODE" == "print-families" ]]; then
	for i in "${!FAMILY_IDS[@]}"; do
		printf '%s\t%s\n' "${FAMILY_IDS[i]}" "${FAMILY_CAPS[i]}"
	done
	exit 0
fi


# Both registered plans (18.18.0 and newer) trace fsync calls in the durability
# proof, so the toolchain must be able to trace a child before anything is
# touched. The proof runs only from a real apply (the gate suite is apply-only),
# so --check and --revert must stay usable on a box without working ptrace.
# Refuse with the prerequisite named instead of letting the gate fail later
# (or skip).
if [[ "$MODE" == "apply" ]]; then
	if ! command -v strace >/dev/null 2>&1; then
		echo "${OMP_PATCH_VERSION} plan requires strace: the fsync durability leg must not skip; install strace and re-run" >&2
		exit 2
	fi
	if ! strace -f -e trace=fsync true >/dev/null 2>&1; then
		echo "${OMP_PATCH_VERSION} plan requires a working strace (ptrace of a child failed: strace -f -e trace=fsync true); fix ptrace permissions or install a working strace" >&2
		exit 2
	fi
	# From 18.18.0 the chain assumes the thread-safe payload-archive companion.
	# Pin the source of record here; the LIVE copy is validated only after it
	# has been staged and its symlinks resolved (_omp_stage_companions), so this
	# preflight never opens a path under the live tree. A tree that fails the
	# gates must never be installed first: the operator deploys the companion,
	# then re-runs; the message names the source.
	APPROVED_PAYLOAD="${HERE}/payload-archive-extension.ts"
	APPROVED_PAYLOAD_SHA256="4ca8e6dd31e34d0162fa2535b6e473a2239823d5636567ce97f129dd026fad93"
	if [[ ! -f "$APPROVED_PAYLOAD" ]]; then
		echo "${OMP_PATCH_VERSION} apply requires the approved companion source ${APPROVED_PAYLOAD}" >&2
		exit 2
	fi
	source_payload_sha="$(sha256sum -- "$APPROVED_PAYLOAD" | cut -d' ' -f1)"
	if [[ "$source_payload_sha" != "$APPROVED_PAYLOAD_SHA256" ]]; then
		echo "${OMP_PATCH_VERSION} apply: ${APPROVED_PAYLOAD} is not the approved thread-safe payload-archive companion (${source_payload_sha}); restore the approved source before applying" >&2
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
		echo "companions: live extensions directory not found: ${live}; ${OMP_PATCH_VERSION} apply stages the enabled companions from it" >&2
		exit 2
	}
	if [[ -L "$live" ]]; then
		echo "companions: ${live} is a symlink; ${OMP_PATCH_VERSION} apply stages a real extensions directory, not whatever a link resolves to" >&2
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
				echo "companions: ${live} still contains retired ${retired} (O5); remove it before applying ${OMP_PATCH_VERSION}" >&2
				exit 2
			fi
			names+=("$name")
			continue
		fi
		case "$name" in
			*.js | *.mjs | *.cjs | package.json)
				echo "companions: ${live} contains ${name}, an extension entry native discovery loads; ${OMP_PATCH_VERSION} apply stages top-level *.ts companions only — remove it" >&2
				exit 2
				;;
		esac
		if [[ -L "$entry" ]]; then
			echo "companions: ${live} contains symlinked entry ${name}, an extension entry native discovery loads; ${OMP_PATCH_VERSION} apply stages top-level *.ts companions only — remove it" >&2
			exit 2
		fi
		if [[ -d "$entry" ]]; then
			for candidate in index.ts index.js index.mjs index.cjs package.json; do
				if [[ -e "${entry}/${candidate}" || -L "${entry}/${candidate}" ]]; then
					echo "companions: ${live} contains directory extension ${name}/ (${candidate}), which native discovery loads; ${OMP_PATCH_VERSION} apply stages top-level *.ts companions only — remove it" >&2
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

# Gate registration: _omp_gate CAPS SCRIPT [FLAGS] [COVERS]. One registry serves
# `--print-gates` (menu), `--print-gate-map` (menu plus the metadata the
# parallel runner and its subset selection use) and, through run-gates.py, the
# real execution, so the three can never disagree.
#   CAPS   "" = always selected, tied to no capability; otherwise capability ids
#          joined by "|": selected when the plan carries (or upstream adopted)
#          any of them. This is the SELECTION GUARD of the full menu only.
#   FLAGS  comma list, optional:
#            tree        writes into the runtime tree: runs on a private copy
#            companions  needs the staged companion fixture (OMP_EXTENSIONS_STAGED_DIR)
#            exclusive   timing-sensitive or heavy: runs alone, nothing in parallel
#            slow        >= 30 s alone: scheduled first so it never becomes the tail
#   COVERS capability ids joined by "|" that the gate also verifies beyond its
#          guard (patches/PATCHES.md §2 gate column). Never changes whether the
#          gate is selected; run-gates.py `--capabilities/--families` select a
#          gate by CAPS ∪ COVERS, so a fix round runs every proof of what it touched.
# Every capability of the plan must be covered by a gate (CAPS or COVERS) or be
# declared with _omp_no_gate CAP REASON; --print-gate-map/--print-no-gate fail
# (exit 2) otherwise, so a new capability cannot silently have no proof.
declare -A GATE_COVERED=()
declare -A NO_GATE=()

_omp_check_capability_id() { # script, id
	[[ "$2" =~ ^[0-9]{4}$ ]] || { echo "gate registration ${1}: invalid capability id: $2" >&2; exit 2; }
}

_omp_gate() {
	local caps="$1" script="$2" flags="${3:-}" extra="${4:-}" cap selected=0 covers=""
	local -a alternatives=() more=()
	if [[ -n "$caps" ]]; then
		IFS='|' read -r -a alternatives <<<"$caps"
		for cap in "${alternatives[@]}"; do
			_omp_check_capability_id "$script" "$cap"
			if _omp_has_capability "$cap"; then
				selected=1
			fi
		done
		[[ "$selected" == 1 ]] || return 0
	fi
	case "$MODE" in
		print-gates) printf '%s\n' "$script" ;;
		print-gate-map | print-no-gate)
			[[ -z "$extra" ]] || IFS='|' read -r -a more <<<"$extra"
			for cap in "${alternatives[@]}"; do
				if _omp_has_capability "$cap"; then GATE_COVERED[$cap]=1; fi
			done
			for cap in "${more[@]}"; do
				_omp_check_capability_id "$script" "$cap"
				if _omp_has_capability "$cap"; then
					GATE_COVERED[$cap]=1
					case "|${caps}|" in *"|${cap}|"*) ;; *) covers+="${covers:+,}${cap}" ;; esac
				fi
			done
			[[ "$MODE" == print-gate-map ]] && printf '%s\t%s\t%s\t%s\n' "$script" "${caps//|/,}" "$flags" "$covers"
			;;
	esac
	return 0
}

_omp_no_gate() { # capability, reason: a plan capability with no observable behaviour to prove
	[[ "$MODE" == print-gate-map || "$MODE" == print-no-gate ]] || return 0
	_omp_check_capability_id "_omp_no_gate" "$1"
	[[ -n "${2:-}" ]] || { echo "_omp_no_gate ${1}: a reason is required" >&2; exit 2; }
	NO_GATE[$1]="$2"
}

# A no-gate declaration is bookkeeping for a capability, not for one plan: the
# other registered release may still carry it (the newest plan can retire a
# capability the stable one keeps), and its gate map must stay valid too.
# Stale only when no registered plan carries the capability.
_omp_capability_in_registered_plan() { # capability
	local version plan
	for version in $(omp_supported_text | tr ',' ' '); do
		plan="${HERE}/.${version}-families/plan.tsv"
		[[ -f "$plan" ]] || continue
		if cut -f3 "$plan" | tr ',' '\n' | grep -qx -- "$1"; then
			return 0
		fi
	done
	return 1
}

_omp_check_coverage() {
	local cap bad=0
	for cap in $(printf '%s\n' "${!PLAN_CAPABILITIES[@]}" | sort); do
		if [[ -n "${GATE_COVERED[$cap]:-}" && -n "${NO_GATE[$cap]:-}" ]]; then
			echo "capability ${cap} is covered by a gate but also declared _omp_no_gate; drop the declaration" >&2; bad=1
		elif [[ -z "${GATE_COVERED[$cap]:-}" && -z "${NO_GATE[$cap]:-}" ]]; then
			echo "capability ${cap} has no gate: register a gate with it in CAPS or COVERS, or declare _omp_no_gate ${cap} <reason>" >&2; bad=1
		fi
	done
	for cap in $(printf '%s\n' "${!NO_GATE[@]}" | sort); do
		if [[ -z "${PLAN_CAPABILITIES[$cap]:-}" ]] && ! _omp_capability_in_registered_plan "$cap"; then
			echo "_omp_no_gate ${cap}: not a capability of any registered plan (stale declaration)" >&2; bad=1
		fi
	done
	[[ "$bad" == 0 ]] || exit 2
}

_omp_run_gates() {
	_omp_gate "0014|0054" verify-antigravity-envelope.ts
	_omp_gate "" verify-prefix-cache-compaction.ts "" "0035|0088"
	_omp_gate "" verify-provider-image-budget.ts "" "0036|0044|0057"
	_omp_gate 0052 verify-snapcompact-model-billing.ts
	# 0025 is retired from the newer plan by user decision (upgrade plan
	# §2.1/§10); the capability decides, so only plans that carry it select the gate.
	_omp_gate 0025 verify-ollama-cloud-usage.ts
	# 0055 JWT cache + 0058 thinking signature: one Devin wire gate.
	_omp_gate "0055|0058" verify-devin-wire.ts
	_omp_gate "" verify-hindsight-recall-snapshot.ts "" 0034
	_omp_gate "" verify-interrupt-prune-symmetry.ts "" 0043
	# Retired gates (goal-tool residency, anchor stability) live under .retired/:
	# no supported plan carries their capabilities. Upstream's date/cwd journal
	# replaced the anchor API (DECISIONS.md, Q1).
	_omp_gate 0047 verify-date-cwd-journal-prefix.ts "" 0038
	_omp_gate 0047 verify-session-transfer-authority.ts
	_omp_gate 0056 verify-devin-metadata.ts
	_omp_gate "" verify-supersede-warm-prefix-guard.ts "" 0046
	_omp_gate "0045|0062" verify-snapcompact-frame-reprice.ts "" 0052
	_omp_gate 0050 verify-session-history-preview.ts
	_omp_gate "" verify-native-dialog-lifecycle.ts "" 0103
	_omp_gate "" verify-manual-compaction-direct.ts
	_omp_gate "" verify-context-notes-append-projection.ts
	_omp_gate 0060 verify-devin-idle-cascade-pin.ts
	_omp_gate 0010 verify-idle-ephemeral-reservation.ts
	_omp_gate "" verify-resume-cache-breakpoint.ts
	_omp_gate "" verify-codex-compaction-chain.ts "" "0063|0068"
	# 0065 is retired from the newer plan by user decision: the capability
	# decides, so only plans that carry it select the gate.
	_omp_gate 0065 verify-commandcode-model-record-parity.ts
	_omp_gate 0066 verify-anthropic-native-compaction-live-context.ts
	_omp_gate 0067 verify-compaction-lane-trace.ts "" 0068
	_omp_gate 0069 verify-codex-effort-resume.ts
	_omp_gate 0070 verify-codex-compaction-chain-fail-closed.ts "" 0096
	_omp_gate 0072 verify-session-pin-static-auth-ui.ts
	_omp_gate "" verify-read-description-live.ts
	_omp_gate 0074 verify-anthropic-cache-boundaries.ts
	_omp_gate 0074 verify-anthropic-request-audit.ts
	_omp_gate 0075 verify-hindsight-recall-promotion-slot.ts
	# 0076 eval-state / 0077 turn-recovery / 0084 length-stop: one reminder gate.
	_omp_gate "0076|0077|0084" verify-reminder-persist.ts
	_omp_gate 0078 verify-python-display-mime-preference.ts
	_omp_gate 0079 verify-kitty-conversion-finalization.ts
	_omp_gate 0080 verify-kitty-shared-png-cache.ts
	_omp_gate 0081 verify-main-cache-hit.ts "" "0033|0004"
	_omp_gate 0081 verify-usage-reset-format.ts "" "0033|0004"
	# These two write their child probe into the runtime's pi-coding-agent root.
	_omp_gate 0083 verify-model-mention-surface-resume.ts tree
	_omp_gate 0093 verify-model-effort-resume.ts tree
	_omp_gate 0094 verify-anthropic-thinking-drop-resume.ts
	_omp_gate 0095 verify-context-persist-audit.ts
	# Q10: the retired 18.16.0 plan dropped the 0082 HTML-export hunks; 18.18.0
	# carries them again, so every registered plan selects this gate.
	_omp_gate 0082 verify-user-display-text-queue.ts
	_omp_gate 0085 verify-rejected-prepared-draft-restore.ts
	_omp_gate 0088 verify-compaction-cache-liveness.ts "" 0089
	_omp_gate 0090 verify-oauth-durable-refresh.ts tree
	_omp_gate 0090 verify-oauth-unlock-fence-faults.sh tree,slow
	_omp_gate 0090 verify-auth-unlock-extension.ts tree
	# Codex/Antigravity 403 eligibility retention (one parameterized gate).
	_omp_gate 0090 verify-account-eligibility-retention.ts
	# The host warmer's idle budget and the /cron companion's idle-ownership
	# policy: one 0092 gate with one leg per retired gate. Each leg runs in its
	# own child process, so the slow real-timer leg stays isolated.
	_omp_gate 0092 verify-idle-warming-owners.ts slow
	_omp_gate 0010 verify-session-cache-keepalive.ts
	_omp_gate 0098 verify-tls-verify-transient-retry.ts
	_omp_gate 0099 verify-retry-slow-schedule.ts
	# 0100 is retired from the newer plan, so its consumer proof is selected by
	# the capability alone.
	_omp_gate 0100 verify-stepfun-step-plan.ts
	_omp_gate 0101 verify-subagent-warm-revival-prompt.ts
	# Capability-selected: a plan that does not carry 0102 never runs its gate.
	_omp_gate 0102 verify-computer-control-confirm-deadline.ts
	# Capability-selected: a plan that does not carry 0104 never runs its gate.
	_omp_gate 0104 verify-rollover-answered-request.ts
	# M7: the live companion set (symlinks followed) against the rebased chain,
	# including the four patch-dependency hooks. Every registered plan ships them
	# (the older 18.16.0 tree's own gate retired with its plan).
	_omp_gate 0082 verify-extensions-load-18180.ts companions
	# D5: Codex text.verbosity default low and its medium override, over a
	# loopback-only transport.
	_omp_gate "" verify-codex-text-verbosity.ts
	# R1: the usage pipeline's missing behaviour gate (0037 turn gate and
	# provider scoping, 0026 identity/alias invalidation, 0030 key collapse).
	_omp_gate 0037 verify-usage-statusline-gate.ts "" "0026|0030"
	# R1: 0031 provider scope across the worker boundary, over a real RpcLink
	# pair plus the pinned worker pool.
	_omp_gate 0031 verify-usage-thread-providers.ts
	# O1: journal-injected controls must not shorten the live compaction prefix.
	_omp_gate 0035 verify-compaction-live-chain-midnight.ts
	# R5: OAuth stays main-owned when a session is placed in a worker.
	_omp_gate 0090 verify-oauth-worker-single-owner.ts tree
	# M5: logical history diagnostics and summary/warm thread isolation.
	_omp_gate 0074 verify-anthropic-threads-cache-shape.ts tree
	_omp_gate 0088 verify-anthropic-threads-warm-compaction-isolation.ts tree
	# M6: real worker realm runtime contracts and shipped placement default.
	_omp_gate "" verify-worker-runtime.ts slow
	# M9b unowned P0/P1 proofs.
	_omp_gate "" verify-tools-wire.ts
	_omp_gate "" verify-remote-compaction-target-key.ts
	_omp_gate "" verify-compaction-length-stop.ts
	_omp_gate "" verify-tokenizer-budget-parity.ts
	_omp_gate "" verify-held-file-write-guard.ts
	_omp_gate 0048 verify-advisor-quota-rotation.ts
	_omp_gate "" verify-prompt-rebuild-inputs.ts
	_omp_gate "" verify-provider-registry-lazy.ts slow
	_omp_gate "" verify-catalog-regen-parity.ts
	# Plan capabilities with nothing observable to prove (or whose proof starts
	# later) are declared, never silently left without a gate.
	_omp_no_gate 0071 "Devin request-dump debug switch: diagnostic only, no behaviour a user observes"
	_omp_no_gate 0017 "upstream-adopted (native replay is warm upstream): no local patch, no local behaviour to pin"
}

if [[ "$MODE" == print-gates ]]; then
	_omp_run_gates
	exit 0
fi
if [[ "$MODE" == print-gate-map || "$MODE" == print-no-gate ]]; then
	_omp_run_gates
	_omp_check_coverage
	if [[ "$MODE" == print-no-gate ]]; then
		for cap in $(printf '%s\n' "${!NO_GATE[@]}" | sort); do
			printf '%s\t%s\n' "$cap" "${NO_GATE[$cap]}"
		done
	fi
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

# Patch state is a property of the whole stack, not of one entry in isolation.
# A later entry may rewrite lines an earlier one introduced (0041 over 0037);
# on the final tree that earlier patch no longer reverse-identifies, and a
# per-entry probe would report a bogus CONFLICT. Mirror every touched file into
# a sandbox, peel the stack there in reverse, and record what each layer says
# once the layers above it are gone. Only the sandbox is ever written.
SANDBOX=""
PLAN_SANDBOX=""
COMPANION_ROOT=""
GATES_OUT=""
cleanup_sandbox() {
	[[ -n "$SANDBOX" ]] && rm -rf "$SANDBOX"
	[[ -n "$PLAN_SANDBOX" ]] && rm -rf "$PLAN_SANDBOX"
	[[ -n "$COMPANION_ROOT" ]] && rm -rf "$COMPANION_ROOT"
	# The reserved gate output directory is kept only when gates wrote logs into it.
	if [[ -n "$GATES_OUT" ]]; then
		rmdir "$GATES_OUT/logs" "$GATES_OUT/work" "$GATES_OUT" 2>/dev/null || true
	fi
	return 0
}
trap cleanup_sandbox EXIT

# Both registered plans stage the live companion set before the first patch
# lands, so a retired, missing or live-agent-linked companion refuses without
# touching the install. The gate later loads exactly this fixture. The live
# payload-archive companion is hashed only after staging resolved it into the
# fixture: the check never opens a path under the live tree.
if [[ "$MODE" == "apply" ]]; then
	COMPANION_ROOT="$(mktemp -d)"
	COMPANION_STAGED="${COMPANION_ROOT}/extensions"
	_omp_stage_companions "$COMPANION_STAGED"
	staged_payload="${COMPANION_STAGED}/payload-archive.ts"
	staged_payload_sha=""
	if [[ -f "$staged_payload" ]]; then
		staged_payload_sha="$(sha256sum -- "$staged_payload" | cut -d' ' -f1)"
	fi
	if [[ "$staged_payload_sha" != "$APPROVED_PAYLOAD_SHA256" ]]; then
		echo "${OMP_PATCH_VERSION} apply: live ${HOME}/.omp/agent/extensions/payload-archive.ts is not the approved thread-safe payload-archive companion (found ${staged_payload_sha:-missing}, expected ${APPROVED_PAYLOAD_SHA256}); deploy ${APPROVED_PAYLOAD} to the live companion first, then re-run" >&2
		exit 2
	fi
fi

# Everything the parallel gate runner needs is validated now, before the first
# patch lands (a failure afterwards would leave a patched tree and a switched
# launcher with no gate run): bwrap and bun, a reserved output directory, the
# runtime's symlink policy, the gate menu with its capability coverage, and the
# companion fixture just staged. OMP_GATES_WORK_DIR (default /var/tmp) is where
# gate logs and private copies go.
if [[ "$MODE" == "apply" ]]; then
	GATES_OUT="$(mktemp -d "${OMP_GATES_WORK_DIR:-/var/tmp}/omp-gates-XXXXXX")" || {
		echo "cannot reserve the gate output directory under ${OMP_GATES_WORK_DIR:-/var/tmp}; set OMP_GATES_WORK_DIR to a writable directory" >&2
		exit 2
	}
	validate_args=(--validate-only --node-modules "$(readlink -f -- "${NM}/..")" --version "$OMP_PATCH_VERSION" --out "$GATES_OUT")
	[[ -z "$COMPANION_STAGED" ]] || validate_args+=(--companions "$COMPANION_STAGED")
	python3 -B "${HERE}/run-gates.py" "${validate_args[@]}" || exit 2
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
	# Every selected gate runs in its own offline bwrap with a private HOME, in
	# parallel, against the tree just patched (run-gates.py asks this script
	# for the menu; the companion fixture staged above is passed through).
	runner_args=(--node-modules "$(readlink -f -- "${NM}/..")" --version "$OMP_PATCH_VERSION" --out "$GATES_OUT")
	[[ -z "$COMPANION_STAGED" ]] || runner_args+=(--companions "$COMPANION_STAGED")
	python3 -B "${HERE}/run-gates.py" "${runner_args[@]}"
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
