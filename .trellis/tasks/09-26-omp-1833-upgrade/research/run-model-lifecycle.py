"""Run the offline SDK experiment; fail closed on model, role or prefix drift."""
import hashlib
import json
import subprocess
from pathlib import Path

research = Path(__file__).resolve().parent
isolation = json.loads((research / 'isolation.json').read_text())
lab = Path(isolation['sandbox']) / 'model-lifecycle'
probe = research / 'probe-model-lifecycle.ts'
assert lab.is_dir()
env = {**isolation['environment'], 'OMP_MODEL_LAB': str(lab)}
runs = {}
commands = []
for scenario in ['temporary', 'default', 'roundtrip', 'ephemeral', 'fresh-b']:
    case_env = {**env, 'OMP_MODEL_CASE': scenario}
    output = lab / f'final-{scenario}.json'
    phases = [('live', [scenario, str(output)])]
    for phase, args in phases:
        command = ['bun', str(probe), *args]
        result = subprocess.run(command, cwd=lab, env=case_env, capture_output=True, text=True, timeout=90)
        commands.append({'command': command, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
        assert result.returncode == 0, commands[-1]
        key = scenario if phase == 'live' else f'{scenario}-resume'
        runs[key] = json.loads(Path(args[1]).read_text())
        if phase == 'live' and scenario != 'fresh-b':
            phases.append(('resume', ['resume', str(lab / f'final-{scenario}-resume.json'), runs[key]['sessionFile']]))

checks = []
def compare(label, left, right):
    fields = {}
    for field in ['model', 'system', 'tools', 'effectiveEditMode']:
        a = (left['raw'][field] if field in ['system', 'tools'] else json.dumps(left[field], ensure_ascii=False, separators=(',', ':'))).encode('utf-8')
        b = (right['raw'][field] if field in ['system', 'tools'] else json.dumps(right[field], ensure_ascii=False, separators=(',', ':'))).encode('utf-8')
        offset = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
        fields[field] = {'equal': a == b, 'bytes': len(a), 'sha256': hashlib.sha256(a).hexdigest(), 'first_difference': None if a == b else offset}
    checks.append({'label': label, 'fields': fields})

for scenario in ['temporary', 'default', 'roundtrip', 'ephemeral']:
    live = runs[scenario]
    resumed = runs[f'{scenario}-resume']
    assert live['pid'] != resumed['pid'], 'resume must use a separate process'
    index = 0 if scenario == 'ephemeral' else -1
    compare(f'{scenario}: expected same-model prefix after disk resume', live['snapshots'][index], resumed['snapshots'][0])
    assert live['snapshots'][-1]['defaultRole'] == resumed['snapshots'][0]['defaultRole'], 'persisted role mismatch'
compare('A -> temporary B -> default A', runs['roundtrip']['snapshots'][0], runs['roundtrip']['snapshots'][-1])
compare('temporary B versus default B', runs['temporary']['snapshots'][-1], runs['default']['snapshots'][-1])
compare('temporary B versus fresh B', runs['temporary']['snapshots'][-1], runs['fresh-b']['snapshots'][0])

for name, run in runs.items():
    assert run['fetchAttempts'] == 0
    for snapshot in run['snapshots']:
        is_a = snapshot['model']['id'] == 'gpt-4.1'
        assert snapshot['model']['id'] in ['gpt-4.1', 'deepseek-v4.1-flash']
        assert snapshot['model']['input'] == (['text', 'image'] if is_a else ['text'])
        assert snapshot['effectiveEditMode'] == ('hashline' if is_a else 'replace')
        assert [tool['name'] for tool in snapshot['tools']] == ['read', 'edit']
        assert snapshot['system'], 'real SDK system prompt required'
a, b = runs['temporary']['snapshots']
assert a['system'] != b['system'], 'fixture must change model-shaped system prompt'
assert a['tools'][0]['description'] != b['tools'][0]['description'], 'fixture must distinguish read descriptions'
assert a['tools'][1]['parameters'] != b['tools'][1]['parameters'], 'fixture must distinguish edit schemas'

source_hashes = {}
for package in ['pi-coding-agent', 'pi-agent-core', 'pi-ai', 'pi-catalog', 'snapcompact', 'pi-tui']:
    pristine = lab.parent / '18.3.3' / package
    selected = lab / 'node_modules/@oh-my-pi' / package
    files = [path for path in pristine.rglob('*') if path.is_file()]
    for path in files:
        counterpart = selected / path.relative_to(pristine)
        assert counterpart.read_bytes() == path.read_bytes(), f'non-pristine source: {counterpart}'
    source_hashes[package] = {'version': json.loads((selected / 'package.json').read_text())['version'], 'pristine_files_compared': len(files)}

# Full request strings are comparison inputs, not repository artifacts.
for run in runs.values():
    for snapshot in run['snapshots']:
        snapshot['prefix_summary'] = {
            key: {'bytes': len(value.encode('utf-8')), 'sha256': hashlib.sha256(value.encode('utf-8')).hexdigest()}
            for key, value in snapshot['raw'].items()
        }
        for key in ['raw', 'system', 'tools']:
            del snapshot[key]

report = {
    'scope': 'Real SDK and registry lifecycle; restricted read/edit tools; synthetic catalog and offline adapter, not real provider HTTP payload or cache hit',
    'checks': checks, 'runs': runs, 'commands': commands, 'source_verification': source_hashes,
    'passed': all(field['equal'] for check in checks for field in check['fields'].values()),
}
(research / 'model-lifecycle-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
assert report['passed'], 'model lifecycle drift detected; inspect model-lifecycle-results.json'
print(json.dumps({'passed': True, 'comparisons': len(checks), 'processes': len(runs), 'requests': sum(len(run['snapshots']) for run in runs.values()), 'pristine_packages': len(source_hashes)}))
