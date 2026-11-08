# Version registry helper for bash. SOURCE it; do not execute it.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/version-registry.sh"     # from patches/
#
# versions.json (next to this file) is the only place a supported omp version
# is declared. It must list exactly two versions, ascending: the running stable
# release and the one replacing it. Every consumer fails closed on anything
# else. There is deliberately no function that hands the list back to callers:
# behaviour is chosen with omp_since (a numeric "this release or newer" test),
# never by naming versions.
#
#   omp_since VERSION BOUNDARY         exit 0 when VERSION >= BOUNDARY (numeric)
#   omp_require_registered V [LABEL]   exit 2 with a message unless V is registered
#   omp_tree_version PACKAGE_JSON      print the "version" field of a package.json
#   omp_plan_version LABEL [PKGJSON..] print the resolved plan version, or exit 2
#   omp_supported_text                 "a, b" for diagnostics only
#
# omp_plan_version resolves env OMP_PATCH_VERSION and/or the version of the
# runtime package.json files passed in: every one must be registered and equal
# to each other and to OMP_PATCH_VERSION when that is set. With neither source
# it fails. Use it as `PLAN="$(omp_plan_version "$0" "$AGENT/package.json")"`
# under `set -e`.

_OMP_REG_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/versions.json"
_OMP_REG=()

_omp_reg_die() {
	echo "version registry ${_OMP_REG_FILE}: $*" >&2
	exit 2
}

_omp_numeric_triplet() { # V -> 0 when it is N.N.N
	[[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# Numeric compare: prints -1, 0 or 1 for A <=> B.
_omp_cmp() {
	local -a a b
	local i x y
	IFS=. read -r -a a <<<"$1"
	IFS=. read -r -a b <<<"$2"
	for i in 0 1 2; do
		x=$((10#${a[i]})); y=$((10#${b[i]}))
		if ((x < y)); then echo -1; return 0; fi
		if ((x > y)); then echo 1; return 0; fi
	done
	echo 0
}

omp_since() { # VERSION BOUNDARY
	_omp_numeric_triplet "${1:-}" || { echo "omp_since: '${1:-}' is not a N.N.N version" >&2; exit 2; }
	_omp_numeric_triplet "${2:-}" || { echo "omp_since: boundary '${2:-}' is not a N.N.N version" >&2; exit 2; }
	[[ "$(_omp_cmp "$1" "$2")" != -1 ]]
}

# The registry is parsed as real JSON (python3, already required by apply.sh):
# a missing comma, duplicate key, trailing garbage, extra key, any backslash escape,
# non-N.N.N entry, wrong count or non-ascending order is an error, exactly as in the TS and Py loaders.
_omp_reg_load() {
	local out v prev=""
	[[ -f "$_OMP_REG_FILE" ]] || _omp_reg_die "missing"
	command -v python3 >/dev/null 2>&1 || _omp_reg_die "python3 is required to read the registry"
	out="$(python3 -I - "$_OMP_REG_FILE" <<'PY'
import json, re, sys

def die(message):
    print(f"version registry {sys.argv[1]}: {message}", file=sys.stderr)
    sys.exit(3)

def pairs(items):
    keys = [key for key, _ in items]
    if len(keys) != len(set(keys)):
        die("duplicate object key")
    return dict(items)

try:
    with open(sys.argv[1]) as stream:
        text = stream.read()
    if "\\" in text:  # one key grammar for every loader: no escape sequences anywhere
        die("backslash escapes are not allowed")
    data = json.loads(text, object_pairs_hook=pairs)
except (OSError, ValueError) as error:
    die(f"unreadable or not valid JSON ({error})")
if not isinstance(data, dict) or set(data) != {"supported"}:
    die('the only key is "supported"')
supported = data["supported"]
if not isinstance(supported, list) or not all(isinstance(v, str) and re.fullmatch(r"\d+\.\d+\.\d+", v) for v in supported):
    die('"supported" must be an array of N.N.N strings')
if len(supported) != 2:
    die(f"must list exactly 2 versions (the running stable one and the one replacing it), found {len(supported)}")
if tuple(map(int, supported[0].split("."))) >= tuple(map(int, supported[1].split("."))):
    die("versions must be strictly ascending")
print("\n".join(supported))
PY
	)" || exit 2
	while IFS= read -r v; do
		[[ -n "$v" ]] && _OMP_REG+=("$v")
	done <<<"$out"
	((${#_OMP_REG[@]} == 2)) || _omp_reg_die "internal: loader returned ${#_OMP_REG[@]} versions"
	for v in "${_OMP_REG[@]}"; do
		if [[ -n "$prev" && "$(_omp_cmp "$prev" "$v")" != -1 ]]; then
			_omp_reg_die "versions must be strictly ascending: ${prev} then ${v}"
		fi
		prev="$v"
	done
}
_omp_reg_load

omp_supported_text() {
	local IFS=,
	local text="${_OMP_REG[*]}"
	echo "${text//,/, }"
}

omp_require_registered() { # VERSION [LABEL]
	local v="${1-}" label="${2:-version}" v0
	if _omp_numeric_triplet "$v"; then
		for v0 in "${_OMP_REG[@]}"; do
			[[ "$v0" == "$v" ]] && return 0
		done
		if [[ "$(_omp_cmp "$v" "${_OMP_REG[0]}")" == -1 ]]; then
			echo "${label}: ${v} is retired (older than the oldest supported release); supported: $(omp_supported_text) (registry: ${_OMP_REG_FILE}); retired plans live under patches/.retired/" >&2
		else
			echo "${label}: ${v} is not registered; supported: $(omp_supported_text) (registry: ${_OMP_REG_FILE}); a new release is added there and its .<version>-families/ directory created, retiring the oldest in the same change" >&2
		fi
	else
		echo "${label}: '${v:-<empty>}' is not a N.N.N version; supported: $(omp_supported_text) (registry: ${_OMP_REG_FILE})" >&2
	fi
	exit 2
}

omp_tree_version() { # PACKAGE_JSON
	awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$1" 2>/dev/null || true
}

omp_plan_version() { # LABEL [PACKAGE_JSON...]
	local label="$1"; shift
	local plan="" pkg tree
	if [[ -n "${OMP_PATCH_VERSION+x}" ]]; then
		omp_require_registered "$OMP_PATCH_VERSION" "${label}: OMP_PATCH_VERSION"
		plan="$OMP_PATCH_VERSION"
	fi
	for pkg in "$@"; do
		tree="$(omp_tree_version "$pkg")"
		[[ -n "$tree" ]] || { echo "${label}: cannot read the version of ${pkg}" >&2; exit 2; }
		omp_require_registered "$tree" "${label}: tree version of ${pkg}"
		if [[ -n "$plan" && "$tree" != "$plan" ]]; then
			echo "${label}: ${pkg} is ${tree} but the selected plan is ${plan}" >&2
			exit 2
		fi
		plan="$tree"
	done
	[[ -n "$plan" ]] || { echo "${label}: no plan version (set OMP_PATCH_VERSION or pass a runtime package.json)" >&2; exit 2; }
	echo "$plan"
}
