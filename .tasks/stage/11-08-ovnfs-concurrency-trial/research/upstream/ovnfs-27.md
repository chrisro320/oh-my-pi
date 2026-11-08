Hi, a small documentation mismatch, in case it's useful.

## Summary

README.md and `docs/configuration.md` say that `cache` and `local` paths "show the live folder, read-only". In a checkout on Linux (FUSE) they can be written: the write goes to the checkout's own copy-on-write layer, which matches the code comment in `rules/rules.go:19-22` ("Cache paths are copy-on-write here"). The folder is never touched, and `diff`/`apply` ignore these paths, which is great. But after a checkout writes a cache path, it no longer shows the folder's later changes to that path, so "live" no longer holds there either.

## Environment

- ovnfs v0.2.3 (`go install github.com/stencil-hq/ovnfs@63f2700a`, go1.27.3 linux/amd64); the 4 commits on `main` since then don't touch this code
- Linux 7.0.0 (x86_64), ext4 on NVMe, default `serve` (FUSE), fusermount3 3.14.0, git 2.43.0
- Each script uses its own daemon (`OVNFS_STATE`/`OVNFS_MOUNT` in a temp dir) and removes it on exit

## Reproduce

```sh
#!/usr/bin/env bash
# Write into a cache-class path (node_modules) inside a checkout.
set -uo pipefail
R=$(mktemp -d)
export OVNFS_STATE=$R/state OVNFS_MOUNT=$R/mnt
cleanup() { ovnfs stop >/dev/null 2>&1; fusermount3 -u "$R/mnt" 2>/dev/null; rm -rf "$R"; }
trap cleanup EXIT
cd "$R"
git init -q -b main src && cd src
echo 'node_modules/' > .gitignore && mkdir -p node_modules/p && echo v1 > node_modules/p/i.js && echo a > a.txt
git add . && git -c user.name=t -c user.email=t@t commit -qm init && cd ..
ovnfs new src --name c >/dev/null 2>&1
ovnfs explain src node_modules
echo mine > "$OVNFS_MOUNT/c/node_modules/p/i.js"; echo "write in checkout: rc=$?"
echo "folder: $(cat src/node_modules/p/i.js)  checkout: $(cat "$OVNFS_MOUNT/c/node_modules/p/i.js")"
echo v2 > src/node_modules/p/i.js
echo "after the folder writes v2, checkout shows: $(cat "$OVNFS_MOUNT/c/node_modules/p/i.js")"
echo "diff: [$(ovnfs diff c)]"
```

Output:

```
cache    builtin:3  cache cachedir | dir & (node_modules | .venv | __pycache__ | .next | .nuxt | .turbo | .gradle | .pytest_cache | .mypy_cache | .ruff_cache | .tox)
write in checkout: rc=0
folder: v1  checkout: mine
after the folder writes v2, checkout shows: mine
diff: []
```

Writes like `rm -rf dist && <rebuild>` and `npm install`-style writes into `node_modules` also succeed inside a checkout.

## Suggestion

Maybe describe these paths as "the live folder until the checkout writes them; writes stay in the checkout and are never applied". For agents this is the useful part: builds and tests can run inside a checkout, but a checkout that installed or built keeps its own `node_modules`/`dist` from then on.

Doc lines: `README.md:59-60`, `docs/configuration.md:28-29` (table) and `:35-36`.
