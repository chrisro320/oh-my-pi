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
		ok "verify-snapcompact-model-billing.ts defers reduction behavior to the session consumer gate"
	fi
fi



# Resolved gate coverage and package-root behavior are exercised by
# verify-patch-family-rollups.sh against the archived OLD controller.
# Do not pin direct `bun "${HERE}/name.ts"` spelling here: family-aware
# dispatch is shared with --print-gates and no longer has that source shape.

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
