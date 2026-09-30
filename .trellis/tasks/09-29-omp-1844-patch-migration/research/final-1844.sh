#!/usr/bin/env bash
# Integration verification of the 18.4.4 plan in the dependency-complete Full sandbox.
set -euo pipefail
W=/home/chris/.cache/omp-1844-upgrade
REPO=/home/chris/orca/projects/omp-move
R=$REPO/.trellis/tasks/09-29-omp-1844-patch-migration/research
S=Full
source $W/$S/env.sh || exit 99
[[ "$HOME" == "$W/$S/home" && "$NM" == "$W/$S/home/"* ]] || { echo "ABORT: HOME/NM not sandboxed ($HOME)"; exit 99; }
mkdir -p $HOME/.bun/bin
digest() { (cd $NM && for p in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do find $p -type f -not -path '*/node_modules/*' -print0 | sort -z | xargs -0 sha256sum; done | sha256sum | cut -c1-64); }
die() { echo "FAIL: $*" >&2; exit 1; }
PLAN=$(cd $REPO && OMP_PATCH_VERSION=18.4.4 bash patches/apply.sh --print-plan 2>/dev/null)
first=${PLAN%%$'\n'*}
first=${first##*/}; first=${first%%-*}
EXPECT=$(grep -c "\.patch:" <<<"$PLAN")
echo "first layer: $first expect layers: $EXPECT"
python3 $R/replay-1844.py --nm $NM --before $first | tail -1
P=$(digest); echo "pristine six digest: $P"
mkdir -p $HOME/.omp && rm -rf $HOME/.omp/patches && rsync -a --exclude '*.bak' $REPO/patches/ $HOME/.omp/patches/
L=$HOME/.omp/patches/apply.sh
bash $L > $W/$S/apply1.log 2>&1 || die "apply#1 exit $?"
A=$(digest); echo "applied six digest: $A"
bash $L > $W/$S/apply2.log 2>&1 || die "apply#2 exit $?"
skips=$(grep -c '^SKIP' $W/$S/apply2.log); echo "apply#2 SKIP=$skips"
[[ "$(digest)" == "$A" ]] || die "apply#2 digest changed"
bash $L --check > $W/$S/check.log 2>&1 || die "check exit $?"
n=$(grep '^APPLIED' $W/$S/check.log | grep -c '\.patch$'); echo "check APPLIED patches=$n"
[[ "$n" == "$EXPECT" ]] || die "check applied $n != plan $EXPECT"
bash $L --verify-rollups > $W/$S/rollups.log 2>&1 || die "verify-rollups exit $?"
grep -q "PASS 18.4.4" $W/$S/rollups.log || die "rollups did not cover 18.4.4"
bash $L --revert > $W/$S/revert.log 2>&1 || die "revert exit $?"
[[ "$(digest)" == "$P" ]] || die "revert differs from pristine"
bash $L > $W/$S/apply3.log 2>&1 || die "apply#3 exit $?"
[[ "$(digest)" == "$A" ]] || die "apply#3 digest differs"
strays=$(find $NM -name '*.rej' -o -name '*.orig' | wc -l); [[ "$strays" == 0 ]] || die "stray rej/orig: $strays"
echo ALLDONE
