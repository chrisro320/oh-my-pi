# Repository Guidelines

## Project Overview
Maintain patch families, companion extensions, and verification tooling for `@oh-my-pi/omp`. This is not the upstream application checkout: application sources belong to external `node_modules/@oh-my-pi/*` packages.

## Architecture & Data Flow
`patches/versions.json` selects a family plan → ordered diffs target upstream package roots → sandboxed gates verify the candidate → release tooling stages the runtime and ledger. Companion extensions are deployed separately from the patch chain.
`apply.sh` owns plan resolution and the gate menu; `run-gates.py` consumes that menu rather than maintaining another list. Family replay independently uses pinned upstream archives.

## Key Directories
- `patches/.<version>-families/`: `plan.tsv` orders patches and package roots; `manifest.json` pins archives and family digests; `approvals.json` records upstream adoptions.
- `patches/*-extension.ts`: companion sources, such as `cron-extension.ts` mirrored as `cron.ts` in the extension directory. `verify-*` files are gates, not application modules.
- `patches/native/<version>/`: overlay recipes and Rust source diffs; `patches/.retired/` is historical evidence, not an active plan.
- `.tasks/`: planned-work records managed with the `tasks` skill; keep task state out of this guide.

## Development Commands
Use a registered `VERSION`, a prepared `RUNTIME` root, disposable `WORK`/`OUT` directories, and `OVERLAY=patches/native/$VERSION/overlay.json`.

| Purpose | Command |
|---|---|
| Inspect the selected plan; no patch application | `OMP_PATCH_VERSION="$VERSION" bash patches/apply.sh --print-plan` |
| Build native addons into scratch output | `bash patches/native/build-natives.sh "$WORK" "$OUT" "$OVERLAY"` |
| Run one behavioral gate | `python3 patches/run-gates.py --node-modules "$RUNTIME/node_modules" --gates verify-main-cache-hit` |
| Static checks | `python3 patches/verify-no-version-literals.py` and `python3 patches/verify-gate-coverage.py` |
| Run the prepared CLI | `bun "$RUNTIME/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" --help` |

There is no repository-wide build, lint, or typecheck script. Use the native recipe and targeted checks above; upstream-only build commands require an exported upstream tree. Deployment commands belong in the runbook, not routine verification.

## Code Conventions & Common Patterns
- Match the touched file: TypeScript generally uses tabs and double quotes; Python uses four-space indentation and `snake_case`; Bash drivers use `set -euo pipefail`. Gates use `verify-<topic>` names; patch capability IDs have four digits.
- Extensions receive `ExtensionAPI` through an exported factory and register hooks, commands, or tools there. Keep mutable state factory-local; there is no dependency-injection container or shared application store.
- Async lifecycle work uses `AbortController`/composed signals plus generation checks to reject stale completions. Keep activation/protocol failures explicit; only best-effort diagnostic hooks suppress errors. Error classes are module-specific, not a global hierarchy.
- Rebase shared-file families in `plan.tsv` order: later hunks depend on earlier output. Use the language-specific version-registry helper instead of another supported-version list.

## Important Files
- `patches/apply.sh`: maintenance controller; `patches/publish-release.py`: release CLI; `patches/verify-release-family-plan.py`: independent replay verifier.
- [PATCHES.md](patches/PATCHES.md): capability ownership and gate map. [DEPLOYMENT-RUNBOOK.md](patches/DEPLOYMENT-RUNBOOK.md): candidate, native, smoke, and publication procedures.
- [DECISIONS.md](DECISIONS.md) owns lasting product choices; [.tasks/lessons.md](.tasks/lessons.md) owns recurring pitfalls. Read the applicable source instead of copying either into this guide.

## Runtime/Tooling Preferences
Use Bun for TypeScript gates/runtime scripts, Python 3 for Python tools, and Bash with Linux utilities. There is no root package manifest or package-manager install step; do not invent npm scripts or substitute Node for Bun-dependent gates.
Gate execution requires `bwrap`. Native builds additionally require Git, Cargo, CMake, and the recipe's pinned Rust toolchain; the build script uses locked dependencies and produces baseline/modern x64 addons. Offline native builds use `OMP_NATIVE_UPSTREAM_GIT` and `OMP_NATIVE_OFFLINE=1`.

## Testing & QA
- Tests are standalone `verify-*` programs, commonly using `node:assert/strict`, not a shared Jest/Vitest suite. Coverage is capability/behavior based, not a percentage target; new behavioral gate legs need a fault control that makes them fail.
- Select affected gates with `--gates`, `--families`, or `--capabilities`; selectors are unioned, and no selector means the full menu. Add `--list` to inspect without running. Gates flagged for companions require a staged `--companions` fixture.
- The runner provides offline sandboxes, private HOME/XDG/TMPDIR, and protected runtime inputs. Put `--out` evidence outside `/tmp` (normally `/var/tmp`); do not bypass isolation with live credentials.
- Replay with `python3 patches/verify-release-family-plan.py --version "$VERSION" --tgz-cache "$TGZ_CACHE"` using a pinned archive cache: acceptance requires zero-fuzz forward replay, reversal to pristine, and an identical second replay.
