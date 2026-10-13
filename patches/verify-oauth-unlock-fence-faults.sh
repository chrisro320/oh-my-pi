#!/usr/bin/env bash
# Fault controls for the 0090 unlock revision (verification-gate-contracts 6.2/6.3):
#
#   (q) a behavioural mutation that keeps every line of the new code and weakens
#       only the fence must turn `verify-oauth-durable-refresh.ts` red, and the
#       red must be a FENCE case — not a missing-symbol case.
#   (p) a tree missing one new store member must fail the gate closed, naming the
#       member, rather than skipping the unlock scenarios.
#
# The controller hands over an isolated pi-ai copy (`_omp_gate ... oauth`
# isolation), so every mutation lands in a private copy and never in a live
# install. Exit 0 only when the control passes and both fault trees fail for the
# intended reason.
set -euo pipefail

AI="${OMP_PATCH_VERIFY_AI_ROOT:?the controller must hand over an isolated pi-ai copy}"
GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/verify-oauth-durable-refresh.ts"
NMROOT="$(cd "$AI/../.." && pwd -P)"
[[ -d "$NMROOT/@oh-my-pi" ]] || { echo "FAIL: ${AI} is not inside a node_modules tree" >&2; exit 2; }
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

# mktree <name>: a private node_modules. The packages this repair owns (and every
# package the agent SDK loads in the same process) are real copies; only
# immutable third-party and sibling packages are symlinked, exactly as the
# controller's warm isolation does.
mktree() {
	local name="$1" dir="$WORK/$1" entry base copied
	mkdir -p "$dir/node_modules/@oh-my-pi"
	for entry in "$NMROOT"/* "$NMROOT"/.[!.]*; do
		[[ -e "$entry" || -L "$entry" ]] || continue
		base="${entry##*/}"
		[[ "$base" == "@oh-my-pi" ]] && continue
		ln -s "$entry" "$dir/node_modules/$base"
	done
	for copied in pi-ai pi-coding-agent pi-catalog pi-tui snapcompact; do
		[[ -e "$NMROOT/@oh-my-pi/$copied" ]] || continue
		cp -a --reflink=auto "$NMROOT/@oh-my-pi/$copied" "$dir/node_modules/@oh-my-pi/$copied"
	done
	for entry in "$NMROOT"/@oh-my-pi/*; do
		[[ -e "$entry" || -L "$entry" ]] || continue
		base="${entry##*/}"
		case "$base" in pi-ai | pi-coding-agent | pi-catalog | pi-tui | snapcompact) continue ;; esac
		ln -s "$entry" "$dir/node_modules/@oh-my-pi/$base"
	done
	printf '%s\n' "$dir/node_modules/@oh-my-pi/pi-ai"
}

replace_once() { # <file> <exact old text> <new text>
	python3 - "$1" "$2" "$3" <<'PY'
import pathlib, sys
path, old, new = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text()
count = text.count(old)
if count != 1:
    raise SystemExit(f"fault injection expected exactly one match in {path}, found {count}")
path.write_text(text.replace(old, new))
PY
}

gate() { # <ai-root> <log>: run the contract gate against an isolated tree
	OMP_PATCH_VERIFY_AI_ROOT="$1" bun "$GATE" >"$2" 2>&1
}

# 0. Control: the unmutated copy must pass, or the controls below prove nothing.
CONTROL="$(mktree control)"
if ! gate "$CONTROL" "$WORK/control.log"; then
	echo "FAIL: the unmutated isolated copy did not pass the 0090 contract gate" >&2
	tail -5 "$WORK/control.log" >&2
	exit 1
fi
echo "PASS control: the isolated copy is green ($(grep -c '^  PASS' "$WORK/control.log") scenarios)"

# (q) Drop the exchange OWNER from the fence hash. Every new line stays in place
# and the fence still covers the row bytes, the generation and the expected hash;
# only its identity over a REPLACED same-generation marker is gone. Case (j)
# ("a stale confirmation cannot release a newer attempt") must catch it.
FENCE="$(mktree fence)"
replace_once "$FENCE/src/auth/sqlite-credential-store.ts" \
	'.update(`${data}\u0000${exchange.generation}\u0000${exchange.owner}\u0000${exchange.expected_hash}`)' \
	'.update(`${data}\u0000${exchange.generation}\u0000${exchange.expected_hash}`)'
if gate "$FENCE" "$WORK/fence.log"; then
	echo "FAIL: the weakened fence left the contract gate green" >&2
	exit 1
fi
for expected in 'FAIL  (f)' 'FAIL  (j)'; do
	grep -q "$expected" "$WORK/fence.log" && caught="$expected"
done
[[ -n "${caught:-}" ]] || {
	echo "FAIL: the weakened fence was not caught by a fence case" >&2
	grep '^  FAIL' "$WORK/fence.log" >&2
	exit 1
}
# The failing assertion must be the fence identity itself, not an unrelated
# symptom: (f) asserts a newer attempt yields a new fence, (j) that a stale fence
# cannot release one.
grep -A1 "^  $caught" "$WORK/fence.log" | grep -q 'fence' || {
	echo "FAIL: the weakened fence failed for a reason unrelated to the fence" >&2
	grep -A1 "^  $caught" "$WORK/fence.log" >&2
	exit 1
}
echo "PASS (q): a fence that ignores the exchange owner turns $caught red"

# (p) Remove one store member. The gate must fail closed and name the missing
# member, not silently pass or skip the unlock scenarios.
INCOMPLETE="$(mktree incomplete)"
replace_once "$INCOMPLETE/src/auth/sqlite-credential-store.ts" \
	'	inspectUnresolvedCredentialRefreshExchange(id: number): CredentialRefreshExchangeInspection {' \
	'	private inspectUnresolvedCredentialRefreshExchangeDisabled(id: number): CredentialRefreshExchangeInspection {'
if gate "$INCOMPLETE" "$WORK/incomplete.log"; then
	echo "FAIL: an incomplete tree passed the contract gate" >&2
	exit 1
fi
grep -q "must expose the store's exchange inspection" "$WORK/incomplete.log" || {
	echo "FAIL: an incomplete tree failed without naming the missing member" >&2
	tail -5 "$WORK/incomplete.log" >&2
	exit 1
}
echo "PASS (p): a tree without the store inspection member fails closed"

# (s) Atomicity: revert the fix back to the previous delete-then-(separately
# reserved) shape in BOTH halves of it — the store deletes the released marker,
# and the refresher reserves it as its own transaction again. Every other line of
# the unlock code stays in place; case (s) must catch the resulting window while
# the ordinary unlock case (a) still succeeds, proving (s) discriminates on the
# atomicity property rather than on a broken unlock.
ATOMICITY="$(mktree atomicity)"
replace_once "$ATOMICITY/src/auth/sqlite-credential-store.ts" \
	'			this.#reserveRefreshExchangeStmt.run(id, generation, lease.owner, expectedHash);
			return "released";' \
	'			this.#deleteRefreshExchangeStmt.run(id);
			return "released";'
replace_once "$ATOMICITY/src/auth/refresh.ts" \
	'					markerReserved = release === "released";' \
	'					markerReserved = false;'
if gate "$ATOMICITY" "$WORK/atomicity.log"; then
	echo "FAIL: a deletion-only release left the contract gate green" >&2
	exit 1
fi
grep -q 'FAIL  (s)' "$WORK/atomicity.log" || {
	echo "FAIL: the atomicity mutation was not caught by case (s)" >&2
	grep '^  FAIL' "$WORK/atomicity.log" >&2
	exit 1
}
grep -A1 '^  FAIL  (s)' "$WORK/atomicity.log" | grep -q 'reserved by the new owner' || {
	echo "FAIL: the atomicity mutation failed for a reason unrelated to the lost reservation" >&2
	grep -A1 '^  FAIL  (s)' "$WORK/atomicity.log" >&2
	exit 1
}
echo "PASS (s): a release that deletes instead of reserving turns the boundary case red"
