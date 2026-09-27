"""Execute the controller's real 18.3.3 plan in its isolated install tree."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

research = Path(__file__).resolve().parent
repo = research.parents[2].parent
record = json.loads((research / 'integration-environment.json').read_text())
env = record['environment']
home = Path(record['home'])
nm = Path(record['global']) / 'node_modules/@oh-my-pi'
assert str(home).startswith('/tmp/omp-1833-upgrade-')
controller = repo / 'patches/apply.sh'
roots = {'NM': nm, 'AGENT': nm / 'pi-coding-agent', 'CORE': nm / 'pi-agent-core', 'AI': nm / 'pi-ai', 'SNAP': nm / 'snapcompact', 'TUI': nm / 'pi-tui', 'CATALOG': nm / 'pi-catalog'}
plan_run = subprocess.run(['bash', str(controller), '--print-plan'], env=env, capture_output=True, text=True, timeout=30)
assert plan_run.returncode == 0, plan_run.stderr
plan = [line.rsplit(':', 1) for line in plan_run.stdout.splitlines() if line.strip()]
assert len(plan) == 46, len(plan)
(research / 'plan-18.3.3.txt').write_text(plan_run.stdout)
results = []
for file, root in plan:
    command = ['patch', '--batch', '--fuzz=0', '--no-backup-if-mismatch', '-p1', '--forward', '-i', str(repo / 'patches' / file)]
    dry = subprocess.run(command + ['--dry-run'], cwd=roots[root], env=env, capture_output=True, text=True)
    results.append({'file': file, 'root': root, 'dry_exit': dry.returncode, 'output': dry.stdout + dry.stderr})
    if dry.returncode:
        (research / 'strict-integration.json').write_text(json.dumps(results, indent=2))
        raise RuntimeError(f'Strict replay stopped before mutation: {file}\n{dry.stdout}{dry.stderr}')
    applied = subprocess.run(command, cwd=roots[root], env=env, capture_output=True, text=True)
    assert applied.returncode == 0, applied.stdout + applied.stderr
    results[-1]['apply_exit'] = applied.returncode
(research / 'strict-integration.json').write_text(json.dumps(results, indent=2))
print(f'PASS strict ordered replay: {len(plan)} layers', flush=True)

def tree_digest():
    digest = hashlib.sha256()
    for package in ['pi-coding-agent', 'pi-agent-core', 'pi-ai', 'pi-catalog', 'snapcompact', 'pi-tui']:
        for path in sorted((nm / package).rglob('*')):
            digest.update(str(path.relative_to(nm)).encode())
            if path.is_symlink():
                digest.update(str(path.readlink()).encode())
            elif path.is_file():
                digest.update(path.read_bytes())
    return digest.hexdigest()

launcher = home / '.bun/bin/omp'
launcher.parent.mkdir(parents=True, exist_ok=True)
if not launcher.is_symlink():
    launcher.symlink_to(nm / 'pi-coding-agent/src/cli.ts')
before_digest = tree_digest()
before_launcher = str(launcher.readlink())

apply = subprocess.run(['bash', str(controller)], env=env, capture_output=True, text=True, timeout=900)
(research / 'controller-apply.log').write_text(apply.stdout + apply.stderr)
print('Controller second apply and gates exit:', apply.returncode, flush=True)
assert apply.returncode == 0, (apply.stdout + apply.stderr)[-16000:]
assert tree_digest() == before_digest, 'second controller apply changed package bytes'
assert str(launcher.readlink()) == before_launcher, 'second controller apply changed launcher'
(research / 'idempotence.json').write_text(json.dumps({
    'source_sha256_before_after': before_digest,
    'launcher_before_after': before_launcher,
    'second_apply_exit': apply.returncode,
}, indent=2))
check = subprocess.run(['bash', str(controller), '--check'], env=env, capture_output=True, text=True, timeout=180)
(research / 'controller-check.log').write_text(check.stdout + check.stderr)
assert check.returncode == 0, check.stdout + check.stderr
assert len(re.findall(r'^APPLIED  .*\.patch$', check.stdout, re.M)) == len(plan)
print('PASS controller idempotence, behavior suite and applied status', flush=True)
