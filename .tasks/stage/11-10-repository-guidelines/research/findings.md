# Repository guidance research

Four read-only `scout` agents ran concurrently through one `task` batch. No agent ran build, lint, tests, formatters, installation, or provider operations. Main owns the guide and cross-slice verification.

## CoreSrcResearch
- The repository maintains external upstream package sources rather than an application `src/` tree: `patches/apply.sh:10-47,133-175`.
- Plan ordering, gate registration and companion staging: `patches/apply.sh:321-455,459-660,676-903`.
- Injected extension factories, local mutable state and lifecycle cancellation: `patches/cron-extension.ts:159-165`; `patches/input-translator-extension.ts:566-572,669-705,1077-1090`.

## TestsQAResearch
- The gate menu comes from the controller; filtering, sandboxing and output contracts are in `patches/run-gates.py:1-50,260-340,435-500`.
- Capability coverage uses guard/COVERS declarations and explicit no-gate declarations, not a line-coverage target: `patches/verify-gate-coverage.py:1-31`; `patches/apply.sh:429-448,482-525`.
- Direct gate execution is not the default recommendation because the runner supplies private HOME, offline execution and runtime roots.

## ConfigBuildResearch
- Canonical configuration is `patches/versions.json`; Bash/Python/TypeScript loaders share it: `patches/version-registry.sh`, `patches/version_registry.py`, `patches/version-registry.ts`.
- Native builds require an explicit overlay, scratch directories, locked Cargo dependencies and two CPU variants: `patches/native/build-natives.sh:1-66`.
- No root package manifest, formatter configuration, typecheck configuration or repository-wide build entry was found; do not invent npm scripts.

## ScriptsDocsResearch
- Maintenance controller, independent replay and publication are separate: `patches/apply.sh:1-17,57-82,136-174`; `patches/verify-release-family-plan.py:1-35,175-302`; `patches/publish-release.py:217-249`.
- Current capability documentation is `patches/PATCHES.md`; operational procedures are `patches/DEPLOYMENT-RUNBOOK.md`.
- Archived candidate-export scripts and former workflow commands are not active development entry points.

## Main verification
- `python3 patches/run-gates.py --help`: PASS; confirmed selectors, list mode, isolation and output requirements without running gates.
- `python3 patches/verify-release-family-plan.py --help`: PASS; confirmed exact replay flags without claiming a replay.
- Registry-derived `OMP_PATCH_VERSION` with `apply.sh --print-plan` and `--print-gates`: PASS; selected menu includes `verify-main-cache-hit.ts`, no patch application.
- Checked no root `package.json` or `tsconfig.json`; inspected native build arguments and sampled extension factories, errors and composed abort signals directly.

This report records source facts, not a claim that runtime gates, native builds, CLI sessions or release publication were executed.
