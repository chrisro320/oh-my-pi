#!/usr/bin/env python3
"""Generate ordered 18.16.0 family transitions; no behavioral verification.

prepare writes merge proposals, never candidate source. Apply proposals with
specialized source-edit tools, resolve conflicts there, then accept. Historical
18.12.6 inputs are independently extracted from pinned official archives.
`check` replays the accepted families' emitted patches on a fresh pristine
copy at fuzz 0 and requires the result to equal the work tree byte-for-byte.
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
ROOT = Path('/tmp/omp-plan-18160/rebase')
ROOTS = {'NM': '', 'AGENT': 'pi-coding-agent', 'CORE': 'pi-agent-core', 'AI': 'pi-ai', 'TUI': 'pi-tui', 'SNAP': 'snapcompact'}
OLD_VERSION, NEW_VERSION = '18.12.6', '18.16.0'
BASELINE = REPO / f'patches/.{OLD_VERSION}-families/manifest.json'
TARGET = REPO / f'patches/.{NEW_VERSION}-families'
ARCHIVE_CACHE = Path('/tmp/omp-plan-18160/archives')  # measurement cache; every file is sha256-checked below
RETIRED_ROWS = {'0032-omp-goal-tool-resident'}  # Q7: approved behaviour removal for 18.16.0
ADDED_ROWS = [{'id': '0102-omp-computer-control-confirm-deadline', 'root': 'AGENT', 'capabilities': ['0102'], 'paths': []}]
EVIDENCE = REPO / '.trellis/tasks/11-03-omp-18160-upgrade-plan/research/rebase-evidence-18.16.0.json'


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
        path = ARCHIVE_CACHE / f'oh-my-pi-{package}-{OLD_VERSION}.tgz'
        if not path.exists():
            path = ROOT / 'old-archives' / f'{package}-{OLD_VERSION}.tgz'
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
    families = [family for family in baseline['families'] if family['id'] not in RETIRED_ROWS] + ADDED_ROWS
    save(ROOT / 'state.json', {'next': 0, 'pristine': str(pristine.resolve()), 'families': families, 'completed': []})
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
    pending = state.get('pending')
    assert not pending or path not in {record['path'] for record in pending['records']}, 'pending family owns this path'
    index = next(i for i, family in enumerate(state['families']) if family['id'] == family_id)
    family = state['families'][index]
    assert family_id in state['completed']
    # Only an already-accepted later owner froze a snapshot of this path; an unprepared one
    # will read the repaired work file as its TARGET when it is prepared.
    assert not any(path in later['paths'] for later in state['families'][index + 1:state['next']]), 'shared repair needs explicit snapshot propagation'
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


def take():
    """Write every pending proposal into the work tree; conflicted ones keep their diff3 markers for in-place resolution."""
    state = load(ROOT / 'state.json')
    pending = state['pending']
    conflicted = []
    for record in pending['records']:
        current = ROOT / 'work' / record['path']
        proposal = Path(record['proposal']).read_bytes()
        if not record['after_exists'] and not proposal:
            current.unlink(missing_ok=True)
            continue
        current.parent.mkdir(parents=True, exist_ok=True)
        current.write_bytes(proposal)
        if record['conflict']:
            conflicted.append(record['path'])
    print(json.dumps({'id': pending['id'], 'written': len(pending['records']), 'conflicted': conflicted}))


def family_patch(original):
    """Real `diff -u` of the accepted before/after fragments, rooted at the family's package root."""
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
    return b''.join(chunks), paths


def check():
    """Replay every accepted family's emitted patch on fresh pristine at fuzz 0; must equal the work tree."""
    state = load(ROOT / 'state.json')
    replay = ROOT / 'check'
    if replay.exists():
        shutil.rmtree(replay)
    shutil.copytree(state['pristine'], replay)
    for original in state['families'][:state['next']]:
        patch, _ = family_patch(original)
        if patch:
            command(['patch', '-p1', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '--remove-empty-files'], cwd=replay / ROOTS[original['root']], input=patch)
    residue = [str(path) for path in replay.rglob('*') if path.name.endswith(('.orig', '.rej'))]
    assert not residue, residue
    replayed, work = oracle().tree_digest(replay), oracle().tree_digest(ROOT / 'work')
    through = state['families'][state['next'] - 1]['id'] if state['next'] else None
    print(json.dumps({'through': through, 'accepted': state['next'], 'replay_equals_work': replayed == work, 'digest': work}))
    assert replayed == work, 'emitted patches do not reproduce the work tree'


def snapshot(through, out):
    """Fresh pristine + accepted families' emitted patches up to and including `through`, at fuzz 0, into `out`."""
    state = load(ROOT / 'state.json')
    ids = [family['id'] for family in state['families'][:state['next']]]
    assert through in ids, f'{through} is not accepted'
    assert not out.exists(), f'{out} exists'
    shutil.copytree(state['pristine'], out)
    for original in state['families'][:ids.index(through) + 1]:
        patch, _ = family_patch(original)
        if patch:
            command(['patch', '-p1', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '--remove-empty-files'], cwd=out / ROOTS[original['root']], input=patch)
    residue = [str(path) for path in out.rglob('*') if path.name.endswith(('.orig', '.rej'))]
    assert not residue, residue
    print(json.dumps({'through': through, 'out': str(out), 'digest': oracle().tree_digest(out)}))


def export(archives):
    state = load(ROOT / 'state.json')
    # Rows not accepted yet (new capabilities authored later, e.g. 0102) keep their registered skeleton row.
    assert not (state.get('pending') or {}).get('records'), 'a prepared family with proposals must be accepted first'
    TARGET.mkdir(exist_ok=True)
    for path in (ROOT / 'work').rglob('*'):
        assert not path.name.endswith(('.orig', '.rej')), path
        if path.is_file() and path.suffix in {'.ts', '.json', '.kdl', '.py', '.rs', '.md'}:
            assert not any(line.startswith((b'<<<<<<< ', b'||||||| ', b'>>>>>>> ')) for line in path.read_bytes().splitlines()), path
    families = []
    registered = {row['id']: row for row in load(TARGET / 'manifest.json')['families']}
    for original in state['families'][state['next']:]:
        families.append(registered[original['id']])
    for original in reversed(state['families'][:state['next']]):
        patch, paths = family_patch(original)
        assert patch, original['id']
        filename = f"{original['id']}-v{NEW_VERSION}.patch"
        (TARGET / filename).write_bytes(patch)
        families.insert(0, {**original, 'patch': f'.{NEW_VERSION}-families/' + filename, 'sha256': hashlib.sha256(patch).hexdigest(), 'paths': paths})
    archive_input = load(archives)
    archive_rows = archive_input['archives'] if isinstance(archive_input, dict) else archive_input
    packages = {path.name for path in Path(state['pristine']).iterdir() if path.is_dir()}
    selected_archives = [{**row, 'package': row.get('package', row.get('name', '').split('/')[-1])} for row in archive_rows
                         if row.get('package', row.get('name', '').split('/')[-1]) in packages]
    assert len(selected_archives) == len(packages) and {row['package'] for row in selected_archives} == packages
    # Adoptions beyond the baseline are appended by M5 only, together with their proofs.
    adoptions = load(BASELINE)['upstream_adoptions']
    local = [capability for family in families for capability in family['capabilities']]
    union = local + [row['capability'] for row in adoptions]
    baseline = load(BASELINE)
    expected = ({capability for family in baseline['families'] for capability in family['capabilities']}
                | {row['capability'] for row in baseline['upstream_adoptions']})
    expected = (expected - {c for f in baseline['families'] if f['id'] in RETIRED_ROWS for c in f['capabilities']}) \
        | {c for f in ADDED_ROWS for c in f['capabilities']}
    assert len(union) == len(set(union)) and set(union) == expected and '0097' not in union
    manifest = {'schema_version': 1, 'version': NEW_VERSION, 'upstream_commit': '650f3a108229ee11bf68ba3377f4e8c3391cd424', 'archives': selected_archives, 'families': families, 'upstream_adoptions': adoptions, 'pristine_tree_sha256': oracle().tree_digest(Path(state['pristine'])), 'candidate_tree_sha256': oracle().tree_digest(ROOT / 'work')}
    save(TARGET / 'manifest.json', manifest)
    (TARGET / 'plan.tsv').write_text(''.join(f"{f['patch']}\t{f['root']}\t{','.join(f['capabilities'])}\n" for f in families))
    evidence = load(EVIDENCE) if EVIDENCE.exists() else {}
    evidence.update({'status': 'candidate-exported-unverified', 'behavioral_checks_run': False,
                     'candidate': str(ROOT / 'work'), 'candidate_tree_sha256': manifest['candidate_tree_sha256'],
                     'pristine_tree_sha256': manifest['pristine_tree_sha256'], 'family_count': len(families),
                     'local_capability_count': len(local), 'upstream_adoptions': adoptions,
                     'generation': 'Ordered merge-file proposals, explicit target API conflict resolutions, accept snapshots, real diff -u before/after export; no behavioral verification.',
                     'owners': [{'id': family['id'], 'capabilities': family['capabilities'], 'paths': family['paths'],
                                 'declarations': [path for path in family['paths'] if path.endswith('.d.ts')],
                                 'source': [path for path in family['paths'] if '/src/' in path],
                                 'sha256': family['sha256']} for family in families]})
    save(EVIDENCE, evidence)
    print(json.dumps({'candidate': str(ROOT / 'work'), 'manifest': str(TARGET / 'manifest.json'), 'digest': manifest['candidate_tree_sha256']}))


if __name__ == '__main__':
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['old-inputs', 'init', 'prepare', 'take', 'register', 'accept', 'amend', 'check', 'snapshot', 'export'])
    parser.add_argument('--through')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--pristine', type=Path)
    parser.add_argument('--archives', type=Path)
    parser.add_argument('--path')
    parser.add_argument('--family')
    args = parser.parse_args()
    if args.command in {'old-inputs', 'init'}:
        init(args.pristine if args.command == 'init' else None)
    elif args.command == 'prepare':
        prepare()
    elif args.command == 'take':
        take()
    elif args.command == 'register':
        register(args.path)
    elif args.command == 'accept':
        accept()
    elif args.command == 'amend':
        amend(args.family, args.path)
    elif args.command == 'check':
        check()
    elif args.command == 'snapshot':
        snapshot(args.through, args.out)
    else:
        export(args.archives)
