---
description: "Initialize Trellis in this project for Oh My Pi."
---

Initialize Trellis in the current git repository. This is a **command**, not a skill — it must stay user-invocable so a throwaway directory does not pay Trellis skill tokens.

There is no `trellis-init` skill. The writer is the official CLI; this command only tells you how to run it and how to overlay the local fork.

## Step 1: Preconditions

- Must be inside a git repository. If not, stop.
- `trellis` must be on PATH (`~/.local/bin/trellis`). If missing, tell the user to install `@mindfoldhq/trellis` and stop.

## Step 2: Official scaffold

```bash
trellis init --omp --skip-existing
```

`--skip-existing` keeps files the project already customized. A first-time run writes `.trellis/` plus `.omp/{commands,skills,agents,extensions}`.

Do **not** hand-copy `.trellis/scripts` from a random tree. The CLI writes `.trellis/.template-hashes.json` and `.trellis/.version`; skipping it makes the next `trellis update` report every file as locally modified.

## Step 3: Fork overlay (this machine)

Official `session-insight` still says `trellis mem`, which cannot see omp history. Official commands also omit `/trellis-paused-work`. If the local fork exists, overlay those two surfaces. If it does not, skip this step and say so.

Fork root (first path that exists):

- `~/orca/projects/trellis/omp`

```bash
FORK="$HOME/orca/projects/trellis/omp"

# paused-work + this init command — official template does not ship them
mkdir -p .omp/commands
for f in trellis-paused-work.md trellis-init.md; do
  if [ ! -e ".omp/commands/$f" ]; then
    cp -L "$FORK/commands/$f" ".omp/commands/$f"
  fi
done

# session-insight must be the omp edition (trellis-mem). Replace the official copy.
rm -rf .omp/skills/trellis-session-insight
cp -rL "$FORK/skills/trellis-session-insight" .omp/skills/trellis-session-insight
```

Do not rewrite the rest of `.omp/` into absolute symlinks. That wiring is kimi-agent-specific and is gitignored there.

## Step 4: Developer workspace

```bash
python3 ./.trellis/scripts/init_developer.py
```

Add `.trellis/workspace/*/journal-*.log` to the project `.gitignore` if it is not already there.

## Step 5: Report

Print:

- `.trellis/` and `.omp/` are ready
- next: `/trellis-continue` or `python3 ./.trellis/scripts/task.py create`
- cross-session search uses `trellis-mem`, not `trellis mem`
