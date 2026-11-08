#!/usr/bin/env bash
set -euo pipefail
N=${1:-8}
MODE=${MODE:-parallel}
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cd "$dir"
git init -q repo && cd repo
for i in $(seq 0 $((N * 10 - 1))); do echo "line $i"; done > shared.txt
git add shared.txt && git -c user.email=t@t -c user.name=t commit -qm base
for i in $(seq 0 $((N - 1))); do
  sed "s/^line $((i * 10 + 5))\$/edited by worker $i/" shared.txt > ../w$i.txt
  git diff --no-index shared.txt ../w$i.txt | sed "s#b/../w$i.txt#b/shared.txt#" > ../p$i.patch || true
done
apply_like_omp() {
  local p=$1
  if git apply --check --reverse "$p" 2>/dev/null && ! git apply --check "$p" 2>/dev/null; then
    echo "already-applied"; return
  fi
  if git apply --check "$p" 2>/dev/null; then
    git apply "$p" 2>/dev/null && echo "applied" || echo "apply-failed"
  else
    echo "not-applicable"
  fi
}
for i in $(seq 0 $((N - 1))); do
  case "$MODE" in
    parallel) apply_like_omp ../p$i.patch > ../res$i & ;;
    locked) (flock ../apply.lock bash -c "$(declare -f apply_like_omp); apply_like_omp ../p$i.patch" > ../res$i) & ;;
    *) apply_like_omp ../p$i.patch > ../res$i ;;
  esac
done
wait
echo "$MODE N=$N reported applied: $(cat ../res* | grep -c '^applied$')/$N, edits present: $(grep -c '^edited by worker' shared.txt)/$N"
