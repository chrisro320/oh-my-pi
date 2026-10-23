#!/usr/bin/env python3
"""Generate ordered 18.12.6 family transitions; no behavioral verification.

prepare writes merge proposals, never candidate source. Apply proposals with
specialized source-edit tools, resolve conflicts there, then accept. Historical
18.10.1 inputs are independently extracted from pinned official archives.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

REPO = Path(__file__).resolve().parents[4]
ROOT = Path('/tmp/omp-upgrade-18126-01a1684f/rebase')
ROOTS = {'NM': '', 'AGENT': 'pi-coding-agent', 'CORE': 'pi-agent-core', 'AI': 'pi-ai', 'TUI': 'pi-tui', 'SNAP': 'snapcompact'}
BASELINE = REPO / 'patches/.18.10.1-families/manifest.json'


def load(path):
    return json.loads(path.read_text())


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def data(path):
    return path.read_bytes() if path.exists() else b''


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args}: {result.stdout.decode()}\n{result.stderr.decode()}')
    return result.stdout


def oracle():
    spec = importlib.util.spec_from_file_location('release_oracle', REPO / 'patches/verify-release-family-plan.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def init(pristine=None):
    assert not (ROOT / 'state.json').exists(), 'already initialized'
    ROOT.mkdir(parents=True, exist_ok=True)
    baseline = load(BASELINE)
    old = ROOT / 'old-pristine'
    for archive in baseline['archives']:
        package = archive['package']
        path = ROOT / 'old-archives' / f'{package}-18.10.1.tgz'
        path.parent.mkdir(exist_ok=True)
        if not path.exists():
            with urllib.request.urlopen(archive['tarball'], timeout=60) as response:
                path.write_bytes(response.read())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == archive['sha256'], package
        destination = old / package
        if not destination.exists():
            unpack = ROOT / 'unpack' / package
            unpack.mkdir(parents=True)
            with tarfile.open(path) as bundle:
                bundle.extractall(unpack, filter='data')
            destination.parent.mkdir(exist_ok=True)
            shutil.move(str(unpack / 'package'), destination)
    # Historical oracle inputs were extracted with directory modes masked to
    # 0755. Preserve archive file modes; canonicalize directories only.
    for directory in old.rglob('*'):
        if directory.is_dir() and not directory.is_symlink():
            directory.chmod(0o755)
    assert oracle().tree_digest(old) == baseline['pristine_tree_sha256'], 'old pristine identity'
    historical = ROOT / 'old-work'
    if historical.exists():
        shutil.rmtree(historical)
    shutil.copytree(old, historical)
    for family in baseline['families']:
        snapshots = ROOT / 'history' / family['id']
        for path in family['paths']:
            source = historical / path
            if source.exists():
                target = snapshots / 'before' / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        patch = REPO / 'patches' / family['patch']
        assert hashlib.sha256(patch.read_bytes()).hexdigest() == family['sha256']
        command(['patch', '-p1', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '--remove-empty-files'], cwd=historical / ROOTS[family['root']], input=patch.read_bytes())
        for path in family['paths']:
            source = historical / path
            if source.exists():
                target = snapshots / 'after' / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    assert oracle().tree_digest(historical) == baseline['candidate_tree_sha256'], 'old chain identity'
    if pristine is None:
        print('historical inputs ready', historical)
        return
    shutil.copytree(pristine, ROOT / 'work')
    save(ROOT / 'state.json', {'next': 0, 'pristine': str(pristine.resolve()), 'families': baseline['families'], 'completed': []})
    print('initialized', ROOT / 'work')


def prepare():
    state = load(ROOT / 'state.json')
    assert not state.get('pending'), 'accept pending family first'
    family = state['families'][state['next']]
    records = []
    for path in family['paths']:
        current = ROOT / 'work' / path
        before = ROOT / 'history' / family['id'] / 'before' / path
        after = ROOT / 'history' / family['id'] / 'after' / path
        fragment = ROOT / 'fragments' / family['id'] / path
        fragment.mkdir(parents=True, exist_ok=True)
        (fragment / 'before').write_bytes(data(current))
        args = []
        for name, content in [('current', data(current)), ('old-before', data(before)), ('old-after', data(after))]:
            file = fragment / name
            file.write_bytes(content)
            args.append(str(file))
        result = subprocess.run(['git', 'merge-file', '--diff3', '-p', '-L', 'TARGET', '-L', 'OLD_BEFORE', '-L', 'LOCAL_FAMILY', *args], capture_output=True)
        assert 0 <= result.returncode <= 127, result.stderr.decode()
        proposal = fragment / 'proposal'
        proposal.write_bytes(result.stdout)
        record = {'path': path, 'before_exists': current.exists(), 'after_exists': after.exists() or bool(result.stdout), 'conflict': result.returncode != 0, 'proposal': str(proposal)}
        save(fragment / 'exists.json', record)
        records.append(record)
    state['pending'] = {'id': family['id'], 'records': records}
    save(ROOT / 'state.json', state)
    print(json.dumps(state['pending'], indent=2))

def register(path):
    state = load(ROOT / 'state.json')
    family = state['families'][state['next']]
    assert state['pending']['id'] == family['id']
    assert path not in family['paths']
    assert not Path(path).is_absolute() and '..' not in Path(path).parts
    current = ROOT / 'work' / path
    fragment = ROOT / 'fragments' / family['id'] / path
    fragment.mkdir(parents=True)
    for name in ('before', 'proposal'):
        (fragment / name).write_bytes(data(current))
    record = {'path': path, 'before_exists': current.exists(),
              'after_exists': current.exists(), 'conflict': False,
              'proposal': str(fragment / 'proposal'), 'target_native_path': True}
    save(fragment / 'exists.json', record)
    family['paths'].append(path)
    state['pending']['records'].append(record)
    save(ROOT / 'state.json', state)
    print('registered', family['id'], path)



def accept():
    state = load(ROOT / 'state.json')
    family = state['families'][state['next']]
    pending = state['pending']
    assert family['id'] == pending['id']
    for record in pending['records']:
        path = record['path']
        source = ROOT / 'work' / path
        if source.exists() and not record['before_exists']:
            source.chmod(0o644)
        content = data(source)
        assert not any(line.startswith((b'<<<<<<< ', b'||||||| ', b'>>>>>>> ')) for line in content.splitlines()), path
        fragment = ROOT / 'fragments' / family['id'] / path
        (fragment / 'after').write_bytes(content)
        record['after_exists'] = source.exists()
        save(fragment / 'exists.json', record)
    state['completed'].append(family['id'])
    state['next'] += 1
    del state['pending']
    save(ROOT / 'state.json', state)
    print('accepted', family['id'])


def amend(family_id, path):
    """Capture an explicit post-resolution repair in its existing source owner."""
    state = load(ROOT / 'state.json')
    assert not state.get('pending')
    index = next(i for i, family in enumerate(state['families']) if family['id'] == family_id)
    family = state['families'][index]
    assert family_id in state['completed']
    assert not any(path in later['paths'] for later in state['families'][index + 1:]), 'shared repair needs explicit snapshot propagation'
    fragment = ROOT / 'fragments' / family_id / path
    if path not in family['paths']:
        fragment.mkdir(parents=True)
        before = Path(state['pristine']) / path
        (fragment / 'before').write_bytes(data(before))
        save(fragment / 'exists.json', {'path': path, 'before_exists': before.exists(), 'target_native_path': True})
        family['paths'].append(path)
    existence = load(fragment / 'exists.json')
    source = ROOT / 'work' / path
    (fragment / 'after').write_bytes(data(source))
    existence['after_exists'] = source.exists()
    save(fragment / 'exists.json', existence)
    save(ROOT / 'state.json', state)
    print('amended', family_id, path)


def export(archives):
    state = load(ROOT / 'state.json')
    assert state['next'] == len(state['families']) and not state.get('pending')
    target = REPO / 'patches/.18.12.6-families'
    target.mkdir(exist_ok=True)
    for path in (ROOT / 'work').rglob('*'):
        assert not path.name.endswith(('.orig', '.rej')), path
        if path.is_file() and path.suffix in {'.ts', '.json', '.kdl', '.py'}:
            assert not any(line.startswith((b'<<<<<<< ', b'||||||| ', b'>>>>>>> ')) for line in path.read_bytes().splitlines()), path
    families = []
    for original in state['families']:
        chunks = []
        paths = []
        for path in original['paths']:
            fragment = ROOT / 'fragments' / original['id'] / path
            existence = load(fragment / 'exists.json')
            prefix = ROOTS[original['root']]
            relative = path[len(prefix) + 1:] if prefix else path
            result = subprocess.run(['diff', '-u', '--label', f'a/{relative}' if existence['before_exists'] else '/dev/null', '--label', f'b/{relative}' if existence['after_exists'] else '/dev/null', str(fragment / 'before'), str(fragment / 'after')], capture_output=True)
            assert result.returncode in (0, 1), result.stderr.decode()
            if result.stdout:
                chunks.append(result.stdout)
                paths.append(path)
        patch = b''.join(chunks)
        assert patch, original['id']
        filename = original['id'] + '-v18.12.6.patch'
        (target / filename).write_bytes(patch)
        capabilities = [capability for capability in original['capabilities'] if capability != '0078']
        families.append({**original, 'capabilities': capabilities, 'patch': '.18.12.6-families/' + filename, 'sha256': hashlib.sha256(patch).hexdigest(), 'paths': paths})
    archive_input = load(archives)
    archive_rows = archive_input['archives'] if isinstance(archive_input, dict) else archive_input
    packages = {path.name for path in Path(state['pristine']).iterdir() if path.is_dir()}
    selected_archives = [{**row, 'package': row.get('package', row.get('name', '').split('/')[-1])} for row in archive_rows
                         if row.get('package', row.get('name', '').split('/')[-1]) in packages]
    assert len(selected_archives) == 6 and {row['package'] for row in selected_archives} == packages
    adoptions = [*load(BASELINE)['upstream_adoptions'], {
        'capability': '0078', 'family': 'family-image-display',
        'contract': 'Python producer emits exactly one PNG-preferred image with JPEG fallback; real producer and two negative controls passed.',
        'source': 'pi-coding-agent/src/eval/py/runner.py',
        'evidence': '.trellis/tasks/10-23-omp-upgrade-plan/research/mime-adoption-0078.md',
    }]
    local = [capability for family in families for capability in family['capabilities']]
    union = local + [row['capability'] for row in adoptions]
    baseline = load(BASELINE)
    expected = {capability for family in baseline['families'] for capability in family['capabilities']} | {row['capability'] for row in baseline['upstream_adoptions']}
    assert len(families) == 27 and len(local) == 60 and len(union) == len(set(union)) == 62
    assert set(union) == expected and '0097' not in union
    manifest = {'schema_version': 1, 'version': '18.12.6', 'upstream_commit': '45c35e40c46166dc726ccc52f5d27f40f2449f99', 'archives': selected_archives, 'families': families, 'upstream_adoptions': adoptions, 'pristine_tree_sha256': oracle().tree_digest(Path(state['pristine'])), 'candidate_tree_sha256': oracle().tree_digest(ROOT / 'work')}
    save(target / 'manifest.json', manifest)
    (target / 'plan.tsv').write_text(''.join(f"{f['patch']}\t{f['root']}\t{','.join(f['capabilities'])}\n" for f in families))
    evidence_path = REPO / '.trellis/tasks/10-23-omp-upgrade-plan/research/rebase-evidence.json'
    evidence = load(evidence_path)
    evidence.update({'status': 'candidate-exported-unverified', 'behavioral_checks_run': False,
                     'candidate': str(ROOT / 'work'), 'candidate_tree_sha256': manifest['candidate_tree_sha256'],
                     'pristine_tree_sha256': manifest['pristine_tree_sha256'], 'family_count': len(families),
                     'local_capability_count': len(local), 'upstream_adoptions': adoptions,
                     'generation': 'Ordered merge-file proposals, explicit target API conflict resolutions, accept snapshots, real diff -u before/after export; no behavioral verification.',
                     'owners': [{'id': family['id'], 'capabilities': family['capabilities'], 'paths': family['paths'],
                                 'declarations': [path for path in family['paths'] if path.endswith('.d.ts')],
                                 'source': [path for path in family['paths'] if '/src/' in path],
                                 'sha256': family['sha256']} for family in families]})
    save(evidence_path, evidence)
    print(json.dumps({'candidate': str(ROOT / 'work'), 'manifest': str(target / 'manifest.json'), 'digest': manifest['candidate_tree_sha256']}))


if __name__ == '__main__':
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['old-inputs', 'init', 'prepare', 'register', 'accept', 'amend', 'export'])
    parser.add_argument('--pristine', type=Path)
    parser.add_argument('--archives', type=Path)
    parser.add_argument('--path')
    parser.add_argument('--family')
    args = parser.parse_args()
    if args.command in {'old-inputs', 'init'}:
        init(args.pristine if args.command == 'init' else None)
    elif args.command == 'prepare':
        prepare()
    elif args.command == 'register':
        register(args.path)
    elif args.command == 'accept':
        accept()
    elif args.command == 'amend':
        amend(args.family, args.path)
    else:
        export(args.archives)
