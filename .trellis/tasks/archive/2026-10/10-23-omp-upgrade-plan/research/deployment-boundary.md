# Observed deployment and planning boundary

## Evidence collected on 2026-10-23

- `git status --short --branch && git remote -v && git log -5 --oneline`: branch `trellis/ds-snapcompact-tuning`, remote `origin` at `https://github.com/chrisro320/oh-my-pi.git`, initial HEAD `c26d8f6e7`, 6 modified tracked paths and 17 untracked entries. No commit, staging, reset, cleanup, or stash was performed.
- `git push origin HEAD:refs/heads/trellis/ds-snapcompact-tuning`: exit 0, `Everything up-to-date`. This covers existing commits only, not uncommitted work. Raw initial status: `artifact://1` in this session.
- `/home/chris/.bun/bin/omp --version`: exit 0, `omp/18.10.1 (installed; ready for a new process)`. This executes the admission wrapper's metadata path, not the OMP source or a provider request.
- `readlink -f /home/chris/.bun/bin/omp`: `/home/chris/.bun/install/omp-releases/18.10.1-14d1e60540b2-e3991b5e-00608cd3/bin/omp`.
- `readlink -f /home/chris/.omp/patches`: the same release's `ledger` directory; its `.runtime-root` points to the same release's `runtime` directory.
- Receipt fields: `version:18.10.1`, `code_installation:complete`, `current_session_upgrade:false`, `production_activation:false`, `production_admission_started:true`, candidate `14d1e60540b2b24e618b7ad9cff6be2c8c023fc754f541731189514218243bc7`.
- Receipt package metadata lists 13 OMP packages, all `18.10.1`: `pi-catalog`, `pi-natives-linux-x64`, `pi-utils`, `pi-ai`, `pi-natives`, `pi-coding-agent`, `snapcompact`, `omp-stats`, `omptype`, `pi-agent-core`, `pi-wire`, `pi-tui`, `pi-mnemopi`. This is receipt evidence, not a fresh full-tree integrity audit.
- Installed `pi-coding-agent/package.json` independently reports `18.10.1` and `engines.bun:>=1.3.14`; `bun --version` reports `1.3.14`.

## Operational consequences

1. Do not infer non-activation from `production_activation:false`: `release-launcher.py:141-145` durably sets the admission marker before source execution but does not update that activation field. Existing receipt already prohibits a code-only rollback of this installed release (`publish-release.py:144-146`). It does not prove a successful provider call or identify all currently running code.
2. A future unpublished target must be independently assembled, verified, and prepared. Never patch the currently running tree or the live Bun cache. Keep all official OMP dependency/native package versions coherent (`publish-release.py:61-94`).
3. Future target tooling needs actual migration, not an invocation with a new number:
   - `publish-release.py:224`: `prepare --version` currently accepts only `18.10.1`.
   - `verify-release-family-plan.py:50-85`: retained-family approval accepts only `18.10.0` and `18.10.1`; upstream-adoption/ownership checks are explicit, not generic.
   - `native/build-natives.sh:10,35`: source commit comes from `overlay.json`, while native stamp is hard-coded to `18.10.1`. Both target identity and patch semantics must be assessed against new upstream sources.
   - Archived `run-installed-smoke.py:37-39` pins `omp/18.10.1` and marker strings. It is a reusable behavioral pattern, not a ready-made target-version proof.
4. Publication requires six installed-path private checks (`publish-release.py:184-188`): `version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog`. Smoke must use allowlisted private HOME/XDG/agent and block external transport where specified. Neither passing metadata nor a candidate-path test substitutes for this.
5. A future candidate may roll back code pointers only before its own `production_admission_started` flag. After possible admission, fix forward; never restore old tokens or clear the marker. Do not run a normal public launch as a planning smoke.
6. Native acceptance includes refreshed Escape key mapping, bounded AT-SPI initialization, Chrome profile-decorated title matching, PID ownership and ambiguity rejection (`native/overlay.json:5-10`). The past one-release physical Escape waiver is not permission for this upgrade. TUI/native interaction checks belong in Tern with live human approval when required.
7. `DEPLOYMENT-RUNBOOK.md:11` still describes 26 families/61 capabilities; current `plan.tsv` includes 0101 and has 27 entries. Use controller/manifest evidence, not historical prose counts.

## Trellis compatibility note

- `task.py create` created `.trellis/tasks/10-23-omp-upgrade-plan` in `planning`.
- `task.py current --source` returned `Current task: (none)`, `Source: none`, exit 1. Session-identity environment keys were absent. Do not run `task.py start` as a workaround; that would cross the planning approval gate.
- Installed `task.py --help` has no `profile` command, while the shared handbook describes newer overlay behavior. Record risk as high/complex in the plan; do not invent unsupported metadata semantics or upgrade Trellis implicitly.

## Not exercised

No pristine replay, package installation, native rebuild, behavioral gate, source CLI smoke, production database access, credential operation, provider request, publication, rollback, process termination, or TUI/native physical acceptance was performed in this planning investigation.
