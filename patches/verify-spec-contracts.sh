#!/usr/bin/env bash
# Spec conformance gate for `.trellis/spec/backend/verification-gate-contracts.md`.
#
# The spec states contracts; this script asserts the live artifacts still honour
# them. Run before delivery and again at review time:
#
#   bash patches/verify-spec-contracts.sh
#
# Zero provider calls; source-text assertions only.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The script runs from the repository and from the deployed ledger
# (`~/.omp/patches`). The repo copy is the source of truth for the spec; when
# invoked from the ledger, fall back to the canonical checkout.
if [[ -f "${HERE}/../.trellis/spec/backend/verification-gate-contracts.md" ]]; then
	REPO="$(cd "${HERE}/.." && pwd)"
else
	REPO="${OMP_PATCH_REPO_ROOT:-/home/chris/orca/projects/omp-move}"
	[[ -f "${REPO}/.trellis/spec/backend/verification-gate-contracts.md" ]] || {
		echo "  FAIL  spec not found; set OMP_PATCH_REPO_ROOT to the repository root" >&2
		exit 1
	}
fi
SPEC="${REPO}/.trellis/spec/backend/verification-gate-contracts.md"
LEDGER="${HOME}/.omp/patches"

fail=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "=== verification-gate-contracts conformance ==="

# --- Contract: the spec exists and is indexed -------------------------------
[[ -f "$SPEC" ]] && ok "spec file present" || bad "spec file missing"
grep -q "verification-gate-contracts.md" "${REPO}/.trellis/spec/backend/index.md" \
	&& ok "spec indexed in backend/index.md" || bad "spec not indexed"


# --- Contract: no tautological recomputation of a consumer formula ----------
# The billing gate must NOT restate the reduction arithmetic that
# verify-snapcompact-frame-reprice.ts owns.
BILLING="${HERE}/verify-snapcompact-model-billing.ts"
if [[ -f "$BILLING" ]]; then
	if grep -qE 'perFrameOvercharge|reductionBaseline|projectedForReduction' "$BILLING"; then
		bad "verify-snapcompact-model-billing.ts restates the reduction arithmetic (tautology)"
	else
		ok "verify-snapcompact-model-billing.ts defers reduction routing to 0045's gate"
	fi
fi


# --- Contract: measurement tables are keyed by exact id, not prefix ---------
NM="${OMP_PATCH_VERIFY_NM:-${HOME}/.bun/install/global/node_modules/@oh-my-pi}"
SNAP_ROOT="${OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT:-${NM}/snapcompact}"
SNAP_SRC="${SNAP_ROOT}/src/snapcompact.ts"
if [[ ! -f "$SNAP_SRC" ]]; then
	bad "snapcompact source not found at ${SNAP_SRC} (set OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT)"
else
	if grep -qE 'MODEL_FRAME_TOKEN_STEPS: Readonly<Record<string, ReadonlyArray' "$SNAP_SRC"; then
		ok "billing table keyed by exact model id"
	else
		bad "billing table is not a keyed Record"
	fi
	# Lookup must be a map index, not a regex test. Scanning only code lines
	# avoids matching the comment that explains WHY a prefix is not used.
	if sed -n '/^function modelFrameTokenEstimate/,/^}/p' "$SNAP_SRC" | grep -qE '\.test\('; then
		bad "modelFrameTokenEstimate uses a regex test (prefix override)"
	elif sed -n '/^function modelFrameTokenEstimate/,/^}/p' "$SNAP_SRC" | grep -qE 'MODEL_FRAME_TOKEN_STEPS\['; then
		ok "modelFrameTokenEstimate uses an exact-id map lookup"
	else
		bad "modelFrameTokenEstimate lookup shape unrecognised"
	fi
	# Every table key must be a full model id (contains a slash), never a bare prefix.
	keys="$(sed -n '/^const MODEL_FRAME_TOKEN_STEPS/,/^};/p' "$SNAP_SRC" | grep -oE '^[[:space:]]*"[^"]+"' | tr -d ' \t"')"
	if [[ -z "$keys" ]]; then
		bad "billing table has no keys"
	else
		allfull=1
		while IFS= read -r k; do
			[[ "$k" == */* ]] || allfull=0
		done <<<"$keys"
		[[ "$allfull" -eq 1 ]] \
			&& ok "all billing keys are full model ids ($(echo "$keys" | wc -l) entries)" \
			|| bad "billing table contains a bare prefix key"
	fi
fi

# --- Contract: gates are registered in the apply.sh suite -------------------
for g in verify-provider-image-budget verify-snapcompact-model-billing; do
	grep -q "bun \"\${HERE}/${g}.ts\"" "${HERE}/apply.sh" \
		&& ok "${g} registered in apply.sh suite" \
		|| bad "${g} NOT registered in apply.sh suite"
done
# The layers this migration carries each own a gate; a gate no suite invokes is
# documentation, not verification. 0050's preview, 0072's auth UI and 0073's
# read-description all guard behavior the current plans still ship.
for g in verify-session-history-preview verify-session-pin-static-auth-ui verify-read-description-live; do
	grep -q "bun \"\${HERE}/${g}.ts\"" "${HERE}/apply.sh" \
		&& ok "${g} registered in apply.sh suite" \
		|| bad "${g} NOT registered in apply.sh suite"
done

# --- Contract: the moved TUI package is a first-class plan root ------------
# 18.2.10 moved the status line and the session picker into pi-tui. The
# controller must resolve, print and export that root exactly like the others:
# a layer whose root stays AGENT would patch a path upstream no longer has, and
# every gate reading it would measure the wrong tree.
if grep -q '^TUI="${NM}/pi-tui"' "${HERE}/apply.sh" \
	&& grep -q '"$TUI") rn=TUI' "${HERE}/apply.sh" \
	&& grep -q 'OMP_PATCH_VERIFY_TUI_ROOT="$TUI"' "${HERE}/apply.sh"; then
	ok "controller declares, prints and exports the TUI root"
else
	bad "controller does not treat TUI as a first-class root (declare / print / export)"
fi

# --- Contract: gates select their tree, never a workstation path -----------
# A hardcoded live-package path keeps measuring the live install whatever root
# the suite exported (verification-gate-contracts: "Absolute-path imports defeat
# root redirection"), and a hardcoded type-only import is not portable either.
# Repo-owned fixture paths are not package roots and stay allowed.
offenders="$(grep -lE '"/home/[^"]*/node_modules/' "${HERE}"/verify-*.ts 2>/dev/null || true)"
if [[ -z "$offenders" ]]; then
	ok "no gate hardcodes a live package path"
else
	for f in $offenders; do bad "$(basename "$f") hardcodes a live package path (selected root is bypassed)"; done
fi

# --- Contract: repository and deployed ledger are byte-identical ------------
if [[ -d "$LEDGER" ]]; then
	for f in "${HERE}"/0052-*.patch "${HERE}"/0057-*.patch "${HERE}"/verify-snapcompact-model-billing.ts \
		"${HERE}"/verify-snapcompact-frame-reprice.ts "${HERE}"/verify-provider-image-budget.ts \
		"${HERE}"/apply.sh "${HERE}"/PATCHES.md; do
		[[ -f "$f" ]] || continue
		name="$(basename "$f")"
		if [[ ! -f "${LEDGER}/${name}" ]]; then
			bad "${name} absent from the deployed ledger"
		elif cmp -s "$f" "${LEDGER}/${name}"; then
			ok "${name} identical in ledger"
		else
			bad "${name} DRIFTED from the deployed ledger"
		fi
	done
else
	echo "  skip  ledger ${LEDGER} not present on this host"
fi

echo
if [[ "$fail" -eq 0 ]]; then
	echo "spec-contracts verification: ok"
	exit 0
fi
echo "spec-contracts verification: FAILED"
exit 1
