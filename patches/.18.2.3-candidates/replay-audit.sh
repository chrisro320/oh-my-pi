#!/usr/bin/env bash
# Independent, auditable replay of the 18.1.18 deploy plan on pristine 18.2.3.
set -u
NM=/tmp/omp1823/audit/@oh-my-pi
H=/tmp/omp1823/patches-ro
LOG=/tmp/omp1823/replay-audit.log
: > "$LOG"
echo "sandbox: $(ls -d $NM 2>&1)" >> "$LOG"
echo "pi-coding-agent version: $(awk -F'\"' '/\"version\"/{print $4; exit}' $NM/pi-coding-agent/package.json)" >> "$LOG"
find_file() { ls $H/$1-omp-*.patch 2>/dev/null | head -1; }
E=("0033|$NM/pi-coding-agent|c" "0004|$NM/pi-coding-agent|c" "0034|$NM/pi-coding-agent|" "0037|$NM/pi-coding-agent|" "0010|$NM/pi-coding-agent|c" "0035|$NM|c" "0014|$NM/pi-ai|c" "0036|$NM|" "0017|$NM/pi-ai|c" "0025|$NM/pi-ai|" "0026|$NM/pi-ai|" "0030|$NM/pi-ai|c" "0031|$NM/pi-coding-agent|" "0032|$NM/pi-coding-agent|" "0038|$NM|c" "0041|$NM/pi-coding-agent|" "0043|$NM/pi-coding-agent|c" "0044|$NM|" "0052|$NM|" "0057|$NM|" "0045|$NM/pi-coding-agent|" "0046|$NM/pi-coding-agent|" "0048|$NM/pi-coding-agent|" "0050|$NM/pi-coding-agent|" "0054|$NM/pi-ai|" "0047|$NM/pi-coding-agent|" "0055|$NM/pi-ai|" "0056|$NM|" "0058|$NM/pi-ai|" "0060|$NM|" "0062|$NM/pi-coding-agent|" "0063|$NM|" "0065|$NM|" "0066|$NM|" "0067|$NM|" "0068|$NM|" "0069|$NM/pi-ai|" "0070|$NM|")
clean=0; conflict=0
for e in "${E[@]}"; do
  IFS='|' read -r id root cand <<< "$e"
  f=$(find_file "$id")
  [[ "$cand" == "c" ]] && { c=$(ls $H/.18.1.18-candidates/$id-omp-*-v18.1.18-candidate.patch 2>/dev/null | head -1); [[ -n "$c" ]] && f=$c; }
  if [[ ! -f "$f" ]]; then echo "$id PATCHFILE_MISSING $f" >> "$LOG"; continue; fi
  if patch -d "$root" -R --dry-run -p1 < "$f" > /tmp/rev.out 2>&1; then
    echo "$id ADOPTED_UPSTREAM" >> "$LOG"; continue
  fi
  if patch -d "$root" --dry-run -p1 < "$f" > /tmp/fwd.out 2>&1; then
    patch -d "$root" -s -p1 < "$f" >> "$LOG" 2>&1 || echo "$id REAL_APPLY_FAILED" >> "$LOG"
    clean=$((clean+1)); echo "$id CLEAN $(grep -oE 'fuzz [0-9]+' /tmp/fwd.out | sort -u | tr '\n' ' ')" >> "$LOG"
  else
    conflict=$((conflict+1))
    echo "$id CONFLICT $(grep -c 'FAILED' /tmp/fwd.out)hunks-fail $(grep -c "can't find" /tmp/fwd.out)missing" >> "$LOG"
  fi
done
echo "SUMMARY clean=$clean conflict=$conflict" >> "$LOG"
