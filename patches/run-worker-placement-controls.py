#!/usr/bin/env python3
"""Each new forced-placement matrix leg must reject a real main-thread placement."""
import argparse, json, os, runpy, shutil, subprocess, tempfile
from pathlib import Path
from version_registry import resolve_plan
repo = Path(__file__).resolve().parent.parent
matrix = runpy.run_path(str(repo / 'patches/run-worker-matrix.py'))
p = argparse.ArgumentParser(); p.add_argument('runtime'); p.add_argument('receipt'); a = p.parse_args()
# The plan is the runtime under test (fail closed on an unregistered version), not a literal.
plan = resolve_plan('run-worker-placement-controls', roots=[Path(a.runtime) / 'node_modules/@oh-my-pi/pi-coding-agent'])
selected = subprocess.check_output(['bash', str(repo / 'patches/apply.sh'), '--print-gates'], env={**os.environ, 'OMP_PATCH_VERSION': plan.version}, text=True).splitlines()
gates = [f'verify-{name}.ts' for name in matrix['NAMES'] if f'verify-{name}.ts' in selected]
rows = []
with tempfile.TemporaryDirectory(prefix='m6-placement-control-', dir='/tmp') as temp:
    harness = Path(temp) / 'patches'; harness.mkdir()
    for filename in ('worker-matrix.sh', 'worker-matrix-runner.ts', 'worker-matrix-entry.ts', 'worker-matrix-spawn.ts', 'worker-pool-for-tests.ts', 'version-registry.sh', 'versions.json'):
        shutil.copy2(repo / 'patches' / filename, harness / filename)
    fixture = harness / 'worker-pool-for-tests.ts'
    before = 'hostsOnMain: false,\n\t\tmaxWorkers: () => 4,'
    source = fixture.read_text(); assert source.count(before) == 1
    fixture.write_text(source.replace(before, 'hostsOnMain: true,\n\t\tmaxWorkers: () => 0,'))
    for gate in gates:
        result = matrix['capture'](['bash', str(harness / 'worker-matrix.sh'), a.runtime, 'worker', str(repo / 'patches' / gate)], 30)
        result.update(gate=gate, mutation='allow main placement; maxWorkers=0', rejected=result['exit'] != 0 and not result['timeout'] and 'forced placement must not silently select main' in result['stderr']['tail'])
        rows.append(result)
        Path(a.receipt).write_text(json.dumps({'runtime': a.runtime, 'rows': rows}, indent=2) + '\n')
        print(gate, result['rejected'], flush=True)
assert all(row['rejected'] for row in rows), 'placement mutation must fail at the forced-worker assertion'
