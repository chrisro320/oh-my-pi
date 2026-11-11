#!/usr/bin/env python3
"""Run the assignment's unregistered fault script in the standard offline sandbox."""
import argparse
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('compaction_gate_runner', REPO / 'patches/run-gates.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node-modules', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
gate = 'verify-codex-compaction-chain-fail-closed-faults.sh'
out = runner.reserve_out(args.out)
nm = args.node_modules.resolve()
version = json.loads((nm / '@oh-my-pi/pi-coding-agent/package.json').read_text())['version']
menu = SimpleNamespace(flags={gate: set()}, caps={gate: ['0070']})
settings = SimpleNamespace(timeout=900, keep_work=False, jobs=1)
before, entries = runner.runtime_digest(nm, 1)
engine = runner.Runner(settings, nm, version, out, menu, None)
result = engine.run_gate(gate, ['explicit R4 assignment; not in apply.sh menu'])
after, _ = runner.runtime_digest(nm, 1)
receipt = {'version': version, 'runtime_before': before, 'runtime_after': after,
           'entries': entries, 'unchanged': before == after, 'result': result}
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
raise SystemExit(0 if result['exit'] == 0 and before == after else 1)
