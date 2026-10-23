#!/usr/bin/env bash
# acquisition.sh — pinned OMP 18.12.6 package acquisition for
# .trellis/tasks/10-23-omp-upgrade-plan.
#
# Phases (run individually or `all`):
#   metadata      fetch official npm version documents; derive the 13-package
#                 OMP closure from actual declared dependencies.
#   archives      download tarballs; verify npm sha512 integrity + sha1 shasum;
#                 record SHA-256 -> metadata/archive-manifest.json.
#   attestations  fetch npm attestation bundles; content-check SLSA provenance
#                 subject sha512 + resolvedDependency gitCommit vs the pinned
#                 source commit -> metadata/provenance.json.
#                 (Cryptographic signature verification runs separately via
#                 `npm audit signatures` in the runtime phase.)
#   pristine      extract the six patched source roots to
#                 pristine/@oh-my-pi/<name>; write metadata/pristine-manifest.json.
#   runtime       install the full transitive closure into runtime/ with an
#                 allowlisted env, scripts disabled and a private npm cache;
#                 pin package-lock.json; re-extract all 13 verified OMP archives.
#   signatures    run official npm signature/provenance verification in a
#                 separate tree; evidence binds its bundles to the saved SLSA
#                 subjects and inventories the selected runtime closure.
#
# Everything runs under `env -i` with an explicit allowlist: no inherited
# credentials, proxies or npm/bun production config. Egress is not OS-level
# sandboxed; acquisition contacts the URLs embedded below (registry.npmjs.org
# metadata/tarballs/attestations), while npm signature verification also uses
# Sigstore's TUF trust service. This is not a packet-level egress capture.

set -euo pipefail

SB="${OMP_ACQ_SANDBOX:-/tmp/omp-upgrade-18126-01a1684f}"
VERSION="18.12.6"
PINNED_COMMIT="45c35e40c46166dc726ccc52f5d27f40f2449f99"
REGISTRY="https://registry.npmjs.org"
SCOPE="@oh-my-pi"

# Six patched source roots (also the pristine targets).
PRISTINE_ROOTS="pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui"

TASK_RESEARCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Allowlisted environment. Nothing else is inherited.
sbx() {
	env -i \
		PATH="/home/chris/.bun/bin:/home/chris/.local/bin:/usr/local/bin:/usr/bin:/bin" \
		HOME="$SB/home" \
		TMPDIR="$SB/tmp" \
		TMP="$SB/tmp" \
		TEMP="$SB/tmp" \
		XDG_CACHE_HOME="$SB/cache/xdg" \
		XDG_CONFIG_HOME="$SB/home/.config" \
		XDG_DATA_HOME="$SB/home/.local/share" \
		BUN_INSTALL_CACHE_DIR="$SB/cache/bun" \
		npm_config_cache="$SB/cache/npm" \
		npm_config_audit=false \
		npm_config_fund=false \
		npm_config_progress=false \
		LANG=C.UTF-8 \
		"$@"
}

enc() { # url-encode a scoped package name for registry paths
	printf '%s' "$1" | sed 's|/|%2F|'
}

base() { basename "$1"; }

meta_file() { printf '%s/metadata/%s-%s.json' "$SB" "$(base "$1")" "$VERSION"; }

fetch_meta() { # $1 = package name
	local f; f="$(meta_file "$1")"
	if [ ! -s "$f" ]; then
		sbx curl -fsSL --retry 3 --retry-all-errors --retry-delay 2 -o "$f" "$REGISTRY/$(enc "$SCOPE/$1")/$VERSION"
	fi
	jq -e --arg n "$SCOPE/$1" --arg v "$VERSION" \
		'.name == $n and .version == $v' "$f" >/dev/null
}

phase_metadata() {
	mkdir -p "$SB/metadata"
	fetch_meta pi-coding-agent

	# Derive the closure: BFS over @oh-my-pi deps pinned at exactly $VERSION.
	# Optional platform packages are included only when they match linux-x64.
	local queue="pi-coding-agent" seen="" out=""
	while [ -n "$queue" ]; do
		local cur rest; cur="${queue%% *}"; rest="${queue#* }"
		[ "$cur" = "$rest" ] && rest=""
		queue="$rest"
		case " $seen " in *" $cur "*) continue ;; esac
		seen="$seen $cur"
		out="$out $cur"
		fetch_meta "$cur"
		local deps
		deps=$(jq -r --arg v "$VERSION" '
			((.dependencies // {}) + (.optionalDependencies // {}))
			| to_entries[]
			| select(.key | startswith("@oh-my-pi/"))
			| select(.value == $v)
			| .key | sub("^@oh-my-pi/"; "")' "$(meta_file "$cur")")
		local d
		for d in $deps; do
			# platform packages: keep only this platform's native archive
			case "$d" in
				pi-natives-*) [ "$d" = "pi-natives-linux-x64" ] || continue ;;
			esac
			case " $seen $queue " in *" $d "*) ;; *) queue="$queue $d" ;; esac
	done
	done

	local list; list=$(printf '%s\n' $out | sort)
	local count; count=$(printf '%s\n' $list | grep -c .)
	[ "$count" = "13" ] || { echo "FATAL: closure has $count packages, expected 13" >&2; return 1; }
	local expected="omp-stats omptype pi-agent-core pi-ai pi-catalog pi-coding-agent pi-mnemopi pi-natives pi-natives-linux-x64 pi-tui pi-utils pi-wire snapcompact"
	[ "$(printf '%s\n' $list | tr '\n' ' ' | sed 's/ $//')" = "$expected" ] || {
		echo "FATAL: derived closure differs from the installed 13-package shape" >&2
		printf 'derived: %s\n' "$list" >&2; return 1; }

	jq -n --arg v "$VERSION" --arg c "$PINNED_COMMIT" \
		--argjson pkgs "$(printf '%s\n' $list | jq -R . | jq -sc .)" '
		{version:$v, pinned_commit:$c, derivation:"BFS over @oh-my-pi dependencies+linux-x64 optionalDependencies of @oh-my-pi/pi-coding-agent pinned at exact version",
		 packages:$pkgs}' > "$SB/metadata/omp-package-list.json"
	echo "metadata: derived $(printf '%s' "$list" | tr '\n' ' ')"
}

pkg_list() { jq -r '.packages[]' "$SB/metadata/omp-package-list.json"; }

phase_archives() {
	mkdir -p "$SB/archives"
	local p entries="[]"
	for p in $(pkg_list); do
		local mf tgz; mf="$(meta_file "$p")"
		tgz="$SB/archives/$(base "$p")-$VERSION.tgz"
		local url integrity shasum
		url=$(jq -r '.dist.tarball' "$mf"); integrity=$(jq -r '.dist.integrity' "$mf")
		shasum=$(jq -r '.dist.shasum // ""' "$mf")
		case "$url" in "$REGISTRY/@oh-my-pi/"*) ;; *) echo "FATAL: unexpected tarball host: $url" >&2; return 1 ;; esac
		[ -s "$tgz" ] || sbx curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 -o "$tgz" "$url"

		# npm integrity: sha512-<base64>
		local algo="${integrity%%-*}" expect_b64="${integrity#*-}"
		[ "$algo" = "sha512" ] || { echo "FATAL: non-sha512 integrity for $p" >&2; return 1; }
		local got_b64; got_b64=$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)
		[ "$got_b64" = "$expect_b64" ] || { echo "FATAL: integrity mismatch $p" >&2; return 1; }
		local got_sha1; got_sha1=$(sha1sum "$tgz" | awk '{print $1}')
		if [ -n "$shasum" ] && [ "$got_sha1" != "$shasum" ]; then
			echo "FATAL: sha1 mismatch $p" >&2; return 1
		fi
		local got_sha256 bytes
		got_sha256=$(sha256sum "$tgz" | awk '{print $1}')
		bytes=$(stat -c %s "$tgz")
		entries=$(jq --arg n "$SCOPE/$p" --arg u "$url" --arg i "$integrity" \
			--arg s1 "$got_sha1" --arg s256 "$got_sha256" --argjson b "$bytes" \
			'. + [{name:$n, tarball:$u, integrity:$i, sha1:$s1, sha256:$s256, bytes:$b}]' \
			<<<"$entries")
		echo "archive ok: $SCOPE/$p sha256=$got_sha256"
	done
	jq -n --arg v "$VERSION" --arg c "$PINNED_COMMIT" --argjson a "$entries" \
		'{version:$v, pinned_commit:$c, registry:"https://registry.npmjs.org",
		  verification:"npm dist.integrity (sha512) + dist.shasum (sha1) verified pre-extraction; sha256 recorded",
		  archives:$a}' > "$SB/metadata/archive-manifest.json"
}

phase_attestations() {
	mkdir -p "$SB/metadata/attestations" "$SB/tmp"
	local p prov="[]"
	for p in $(pkg_list); do
		local af="$SB/metadata/attestations/$(base "$p")-$VERSION.json"
		[ -s "$af" ] || sbx curl -fsSL --retry 3 --retry-all-errors --retry-delay 2 -o "$af" \
			"$REGISTRY/-/npm/v1/attestations/$(enc "$SCOPE/$p")@$VERSION"
		local integrity_hex slsa_subject slsa_sha512 slsa_commit repo has_slsa
		integrity_hex=$(jq -r '.dist.integrity' "$(meta_file "$p")" \
			| sed 's/^sha512-//' | base64 -d | od -An -tx1 | tr -d ' \n')
		has_slsa=$(jq '[.attestations[] | select(.predicateType=="https://slsa.dev/provenance/v1")] | length' "$af")
		if [ "$has_slsa" -lt 1 ]; then echo "FATAL: no SLSA provenance for $p" >&2; return 1; fi
		slsa_subject=$(jq -r '[.attestations[] | select(.predicateType=="https://slsa.dev/provenance/v1")][0]
			.bundle.dsseEnvelope.payload' "$af" | base64 -d | jq -r '.subject[0].name')
		slsa_sha512=$(jq -r '[.attestations[] | select(.predicateType=="https://slsa.dev/provenance/v1")][0]
			.bundle.dsseEnvelope.payload' "$af" | base64 -d | jq -r '.subject[0].digest.sha512')
		slsa_commit=$(jq -r '[.attestations[] | select(.predicateType=="https://slsa.dev/provenance/v1")][0]
			.bundle.dsseEnvelope.payload' "$af" | base64 -d \
			| jq -r '.predicate.buildDefinition.resolvedDependencies[]? | .digest.gitCommit // empty' | head -1)
		repo=$(jq -r '[.attestations[] | select(.predicateType=="https://slsa.dev/provenance/v1")][0]
			.bundle.dsseEnvelope.payload' "$af" | base64 -d \
			| jq -r '.predicate.buildDefinition.externalParameters.workflow.repository // empty')
		[ "$slsa_sha512" = "$integrity_hex" ] || { echo "FATAL: attestation subject digest != tarball integrity for $p" >&2; return 1; }
		[ "$slsa_commit" = "$PINNED_COMMIT" ] || { echo "FATAL: attestation gitCommit $slsa_commit != $PINNED_COMMIT for $p" >&2; return 1; }
		local pubs; pubs=$(jq '[.attestations[] | select(.predicateType|startswith("https://github.com/npm/attestation"))] | length' "$af")
		local sigs; sigs=$(jq '.dist.signatures | length' "$(meta_file "$p")")
		prov=$(jq --arg n "$SCOPE/$p" --arg subj "$slsa_subject" --arg commit "$slsa_commit" \
			--arg repo "$repo" --argjson pubs "$pubs" --argjson sigs "$sigs" \
			'. + [{name:$n, slsa_subject:$subj, slsa_gitCommit:$commit, source_repo:$repo,
			       subject_digest_matches_integrity:true, gitcommit_matches_pinned:true,
			       publish_attestations:$pubs, registry_signatures:$sigs}]' <<<"$prov")
		echo "provenance ok: $SCOPE/$p commit=$slsa_commit"
	done
	jq -n --arg v "$VERSION" --arg c "$PINNED_COMMIT" --argjson p "$prov" \
		'{version:$v, pinned_commit:$c,
		  verification:"npm /-/npm/v1/attestations SLSA-v1 payload content check: subject sha512 == dist.integrity and buildDefinition.resolvedDependencies[].digest.gitCommit == pinned commit; registry publish attestations + ECDSA signatures present. Cryptographic bundle verification: see runtime phase npm audit signatures.",
		  packages:$p}' > "$SB/metadata/provenance.json"
}

extract_tgz() { # $1 tgz, $2 dest
	rm -rf "$2"; mkdir -p "$2"
	tar -xzf "$1" -C "$2" --strip-components=1
	# Canonicalize directory modes to 0755 (matches the frozen 18.10.1
	# pristine convention); file modes stay exactly as the archive records.
	find "$2" -type d -exec chmod 0755 {} +
}

phase_pristine() {
	local p
	for p in $PRISTINE_ROOTS; do
		extract_tgz "$SB/archives/$(base "$p")-$VERSION.tgz" "$SB/pristine/@oh-my-pi/$p"
		jq -e --arg v "$VERSION" '.version == $v' \
			"$SB/pristine/@oh-my-pi/$p/package.json" >/dev/null \
			|| { echo "FATAL: pristine $p version mismatch" >&2; return 1; }
	done
	# Normalize ancestor dirs too so the whole pristine root is uniformly 0755.
	chmod 0755 "$SB/pristine" "$SB/pristine/@oh-my-pi"
	# Per-file manifest (actual mode + sha256) + tree digest.
	local tmp="$SB/tmp/pristine-files.txt"; : >"$tmp"
	for p in $PRISTINE_ROOTS; do
		(cd "$SB/pristine/@oh-my-pi/$p" && find . -type f -print0 | sort -z \
			| while IFS= read -r -d '' f; do
				printf '%s %s  @oh-my-pi/%s/%s\n' "$(stat -c %a "$f")" \
					"$(sha256sum "$f" | awk '{print $1}')" "$p" "${f#./}"
			done) >>"$tmp"
	done
	(cd "$SB/pristine" && find . -type l -print | sort) > "$SB/tmp/pristine-symlinks.txt"
	(cd "$SB/pristine" && find . -type d -printf '%m %p\n' | sort) > "$SB/tmp/pristine-dirs.txt"
	local digest count sl dmodes
	digest=$(sha256sum "$tmp" | awk '{print $1}')
	count=$(grep -c . "$tmp")
	sl=$(grep -c . "$SB/tmp/pristine-symlinks.txt" || true)
	dmodes=$(awk '{print $1}' "$SB/tmp/pristine-dirs.txt" | sort -u | tr '\n' ' ' | sed 's/ $//')
	jq -n --arg v "$VERSION" --arg d "$digest" --argjson fc "$count" --argjson sc "$sl" \
		--arg dm "$dmodes" --arg roots "$PRISTINE_ROOTS" '
		{version:$v, root:"/tmp/omp-upgrade-18126-01a1684f/pristine/@oh-my-pi",
		 roots:($roots|split(" ")), file_count:$fc, symlink_count:$sc,
		 directory_modes_actual:($dm|split(" ")),
		 directory_normalization:"all directories chmod 0755 post-extraction; file modes as archive records; actual modes listed per file",
		 tree_sha256:$d,
		 digest_method:"sha256 of sorted lines `<mode> <sha256>  @oh-my-pi/<pkg>/<relpath>`",
		 listings:{files:"pristine-manifest-files.txt",dirs:"pristine-manifest-dirs.txt",symlinks:"pristine-manifest-symlinks.txt"}}' \
		> "$SB/metadata/pristine-manifest.json"
	cp "$tmp" "$SB/metadata/pristine-manifest-files.txt"
	cp "$SB/tmp/pristine-symlinks.txt" "$SB/metadata/pristine-manifest-symlinks.txt"
	cp "$SB/tmp/pristine-dirs.txt" "$SB/metadata/pristine-manifest-dirs.txt"
	echo "pristine: 6 roots, $count files, dir_modes=$dmodes, tree_sha256=$digest"
}


phase_runtime() {
	mkdir -p "$SB/runtime"
	cat > "$SB/runtime/package.json" <<EOF
{"name":"omp-18126-private-closure","private":true,"version":"0.0.0",
 "dependencies":{
  "@oh-my-pi/pi-coding-agent":"$VERSION",
  "@oh-my-pi/pi-agent-core":"$VERSION",
  "@oh-my-pi/pi-ai":"$VERSION",
  "@oh-my-pi/pi-catalog":"$VERSION",
  "@oh-my-pi/snapcompact":"$VERSION",
  "@oh-my-pi/pi-tui":"$VERSION"
 }}
EOF
	(cd "$SB/runtime" && sbx npm install --ignore-scripts --no-audit --no-fund 2>&1 \
		| tee "$SB/metadata/npm-install.log")
	[ -s "$SB/runtime/package-lock.json" ] || { echo "FATAL: no package-lock.json produced" >&2; return 1; }
	cp "$SB/runtime/package-lock.json" "$SB/metadata/package-lock.json"

	# Replace every installed OMP package with the verified archive bytes so no
	# Bun-cache inode is shared.
	local p nm="$SB/runtime/node_modules/@oh-my-pi"
	for p in $(pkg_list); do
		[ -d "$nm/$p" ] || { echo "FATAL: $p missing from installed closure" >&2; return 1; }
		extract_tgz "$SB/archives/$(base "$p")-$VERSION.tgz" "$nm/$p"
	done

	# Assertions: exact versions, no symlink aliases, no nested OMP copies.
	local bad=0 v
	for p in $(pkg_list); do
		v=$(jq -r '.version' "$nm/$p/package.json")
		[ "$v" = "$VERSION" ] || { echo "FATAL: $nm/$p is $v" >&2; bad=1; }
		[ ! -L "$nm/$p" ] || { echo "FATAL: $nm/$p is a symlink" >&2; bad=1; }
	done
	local nested; nested=$(find "$SB/runtime/node_modules" -mindepth 3 -type d -name '@oh-my-pi' \
		-not -path "$SB/runtime/node_modules/@oh-my-pi" || true)
	[ -z "$nested" ] || { echo "FATAL: nested OMP copies: $nested" >&2; bad=1; }
	local links; links=$(find "$nm" -maxdepth 1 -type l -print || true)
	[ -z "$links" ] || { echo "FATAL: symlinked OMP entries: $links" >&2; bad=1; }
	local extra; extra=$(find "$nm" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort \
		| grep -vxF "$(pkg_list)" || true)
	[ -z "$extra" ] || { echo "FATAL: unexpected OMP packages present: $extra" >&2; bad=1; }
	[ "$bad" = 0 ] || return 1

	jq -n --arg v "$VERSION" \
		--arg locksha "$(sha256sum "$SB/runtime/package-lock.json" | awk '{print $1}')" \
		--arg bunv "$(sbx bun --version)" --arg bunbin "$(command -v bun)" \
		--arg npmv "$(sbx npm --version)" --arg nodev "$(sbx node --version)" \
		--argjson pkgs "$(pkg_list | jq -R . | jq -sc)" '
		{version:$v, runtime:"/tmp/omp-upgrade-18126-01a1684f/runtime",
		 lockfile:"runtime/package-lock.json", lockfile_sha256:$locksha,
		 toolchain:{bun:$bunv, bun_bin:$bunbin, npm:$npmv, node:$nodev},
		 install:"npm install --ignore-scripts --no-audit --no-fund, env -i allowlist, private npm cache",
		 omp_reextracted_from_verified_archives:true, omp_packages:$pkgs,
		 assertions:{all_exact_version:true,no_symlink_aliases:true,no_nested_omp:true}}' \
		> "$SB/metadata/runtime-closure.json"
	echo "runtime: closure installed, 13 OMP packages re-extracted from verified archives"
}

phase_signatures() {
	# Official npm signature + provenance verification in a throwaway npm tree.
	local d="$SB/tmp/npm-verify"
	rm -rf "$d"; mkdir -p "$d"
	cp "$SB/runtime/package.json" "$d/package.json"
	(cd "$d" && sbx npm install --ignore-scripts --no-audit --no-fund \
		>/dev/null 2>"$SB/metadata/npm-install.err")
	(cd "$d" && sbx npm audit signatures 2>&1 | tee "$SB/metadata/npm-audit-signatures.log")
	local rc=$?
	jq -n --argjson rc "$rc" '{npm_audit_signatures_exit:$rc,
		log:"metadata/npm-audit-signatures.log"}' > "$SB/metadata/npm-signatures.json"
	return "$rc"
}

phase_evidence() {
	cp "$SB/metadata/archive-manifest.json" "$TASK_RESEARCH/acquisition-archive-manifest.json"
	cp "$SB/metadata/provenance.json" "$TASK_RESEARCH/acquisition-provenance.json"
	cp "$SB/metadata/pristine-manifest.json" "$TASK_RESEARCH/acquisition-pristine-manifest.json"
	[ -f "$SB/metadata/runtime-closure.json" ] && \
		cp "$SB/metadata/runtime-closure.json" "$TASK_RESEARCH/acquisition-runtime-closure.json"
	[ -f "$SB/metadata/npm-signatures.json" ] && \
		cp "$SB/metadata/npm-signatures.json" "$TASK_RESEARCH/acquisition-npm-signatures.json"
	echo "evidence copied to $TASK_RESEARCH"
}

case "${1:-all}" in
	metadata) phase_metadata ;;
	archives) phase_metadata && phase_archives ;;
	attestations) phase_metadata && phase_attestations ;;
	pristine) phase_metadata && phase_archives && phase_pristine ;;
	runtime) phase_metadata && phase_archives && phase_runtime ;;
	signatures) phase_signatures ;;
	evidence) phase_evidence ;;
	all)
		phase_metadata; phase_archives; phase_attestations
		phase_pristine; phase_runtime; phase_signatures; phase_evidence ;;
	*) echo "usage: $0 {metadata|archives|attestations|pristine|runtime|signatures|evidence|all}" >&2; exit 2 ;;
esac
