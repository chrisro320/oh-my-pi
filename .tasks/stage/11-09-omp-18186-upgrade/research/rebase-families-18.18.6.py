#!/usr/bin/env python3
"""Generate ordered 18.18.6 family transitions; no behavioral verification.

prepare writes merge proposals, never candidate source. Apply proposals with
specialized source-edit tools, resolve conflicts there, then accept. Historical
18.18.0 inputs are independently extracted from pinned official archives.
`check` replays the accepted families' emitted patches on a fresh pristine
copy at fuzz 0 and requires the result to equal the work tree byte-for-byte.

`replay` is the read-only measurement command: it applies every 18.18.6
registry patch, in plan.tsv order, to a fresh pristine 18.18.6 tree under
/var/tmp/omp-18186/rebase, reports which families apply at fuzz 0 (and any
large hunk offsets) and writes nothing into the repository.

`classify` is the read-only dry run of the whole chain: it merges every family
in order onto a private work copy under ROOT and reports, per family, whether
the three-way merge was clean or conflicting. It never touches state.json, so
it leaves no pending family behind.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

REPO = next(p for p in Path(__file__).resolve().parents if (p / 'patches/apply.sh').is_file())
ROOT = Path('/var/tmp/omp-18186/rebase')
ROOTS = {'NM': '', 'AGENT': 'pi-coding-agent', 'CORE': 'pi-agent-core', 'AI': 'pi-ai', 'TUI': 'pi-tui', 'SNAP': 'snapcompact'}
OLD_VERSION, NEW_VERSION = '18.18.0', '18.18.6'
UPSTREAM_COMMIT = '9058ab9d229663e229e2867824ba6df6f21e9e59'
BASELINE = REPO / f'patches/.{OLD_VERSION}-families/manifest.json'
TARGET = REPO / f'patches/.{NEW_VERSION}-families'
# Official archives, pinned by the manifests themselves; every file is
# sha256-checked against its manifest row before it is used. The release oracle
# names them `<package>-<version>.tgz`; an `oh-my-pi-`-prefixed copy (the npm
# pack name) is accepted too, because both are the same bytes.
ARCHIVE_CACHE = Path(os.environ.get('OMP_PLAN_TARBALLS', Path.home() / '.cache/omp-plan-18186/tarballs'))
# 18.18.6 rotations (user decisions, 2026-11-09): the whole Antigravity wire
# family retires (upstream paused Google Antigravity in 18.18.4), the advisor
# quota-rotation family retires, and four capabilities lose their code inside
# families that stay. 0038 moves the other way: upstream owns it.
RETIRED_ROWS = {'family-antigravity-wire', '0048-omp-advisor-quota-rotation-bound'}
RETIRED_CAPABILITIES = {'0014', '0048', '0004', '0036', '0052', '0071', '0054'}
ADDED_ROWS = [{'id': '0103-omp-advisor-tools-done-visible', 'root': 'NM', 'capabilities': ['0103']}]
ADOPTION_0038 = {
    'capability': '0038', 'family': 'family-persistent-prefix-resume',
    'source': 'pi-coding-agent/src/session/date-cwd-reminder.ts',
    'evidence': '.retired/11-09-0038-upstream-adopted/consumer-proof-0038.md',
    'contract': 'The date/cwd reminder is a journaled placement on the message chain (createSessionDateCwdReminderJournal/renderDateCwdReminder in upstream 18.18.6), so the provider-facing messages[0] stays byte-identical across resume, branch, fork, transfer and subagent revival with the clock moved one day; no local provider tail remains.',
}
EVIDENCE = Path(__file__).resolve().parent / f'rebase-evidence-{NEW_VERSION}.json'


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


def archive_path(version, package):
    """The pinned official archive from the local cache; a miss is reported, never fetched."""
    for name in (f'{package}-{version}.tgz', f'oh-my-pi-{package}-{version}.tgz'):
        path = ARCHIVE_CACHE / name
        if path.is_file():
            return path
    raise RuntimeError(f'pinned archive missing, nothing is downloaded (offline-only harness): {ARCHIVE_CACHE}/'
                       f'{{{package}-,oh-my-pi-{package}-}}{version}.tgz; stage it in OMP_PLAN_TARBALLS or --tgz-cache')


def extract(version, destination):
    """Unpack the release's pinned package set and canonicalize directory modes."""
    manifest = load(BASELINE if version == OLD_VERSION else TARGET / 'manifest.json')
    destination.mkdir(parents=True)
    for archive in manifest['archives']:
        source = archive_path(version, archive['package'])
        if hashlib.sha256(source.read_bytes()).hexdigest() != archive['sha256']:
            raise RuntimeError(f'archive digest mismatch: {archive["package"]}-{version}')
        unpack = destination.parent / f'unpack-{archive["package"]}-{version}-{os.getpid()}'
        unpack.mkdir(parents=True)
        with tarfile.open(source) as bundle:
            bundle.extractall(unpack, filter='data')
        shutil.move(str(unpack / 'package'), destination / archive['package'])
        shutil.rmtree(unpack)
    oracle().canonicalize_extracted(destination)


def pristine_tree(target=None):
    """Extract the new release's pinned package set as the rebase pristine input."""
    target = target or ROOT / 'pristine'
    if target.exists():
        raise RuntimeError(f'{target} exists')
    extract(NEW_VERSION, target)
    digest = oracle().tree_digest(target)
    if digest != load(TARGET / 'manifest.json')['pristine_tree_sha256']:
        raise RuntimeError('pristine tree identity')
    print(json.dumps({'pristine': str(target), 'digest': digest}))
    return target


def init(pristine=None):
    if (ROOT / 'state.json').exists():
        raise RuntimeError('already initialized')
    ROOT.mkdir(parents=True, exist_ok=True)
    baseline = load(BASELINE)
    old = ROOT / 'old-pristine'
    if not old.exists():
        extract(OLD_VERSION, old)
    if oracle().tree_digest(old) != baseline['pristine_tree_sha256']:
        raise RuntimeError('old pristine identity')
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
        if hashlib.sha256(patch.read_bytes()).hexdigest() != family['sha256']:
            raise RuntimeError(f'retired baseline patch digest drifted: {family["patch"]}')
        command(['patch', '-p1', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '--remove-empty-files'], cwd=historical / ROOTS[family['root']], input=patch.read_bytes())
        for path in family['paths']:
            source = historical / path
            if source.exists():
                target = snapshots / 'after' / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    if oracle().tree_digest(historical) != baseline['candidate_tree_sha256']:
        raise RuntimeError('old chain identity')
    if pristine is None:
        print('historical inputs ready', historical)
        return
    if oracle().tree_digest(pristine) != load(TARGET / 'manifest.json')['pristine_tree_sha256']:
        raise RuntimeError('new pristine identity')
    shutil.copytree(pristine, ROOT / 'work')
    families, union = registry()
    baseline_union = ({capability for family in baseline['families'] for capability in family['capabilities']}
                      | {row['capability'] for row in baseline['upstream_adoptions']})
    expected = (baseline_union - RETIRED_CAPABILITIES) | {cap for row in ADDED_ROWS for cap in row['capabilities']}
    if union != expected:
        raise RuntimeError(f'registry union drifted: {sorted(union ^ expected)}')
    save(ROOT / 'state.json', {'next': 0, 'pristine': str(pristine.resolve()), 'families': families, 'completed': []})
    print('initialized', ROOT / 'work')


def registry():
    """The 18.18.6 chain: plan.tsv order, row identity and paths from its manifest."""
    manifest = load(TARGET / 'manifest.json')
    rows = [line.split('\t') for line in (TARGET / 'plan.tsv').read_text().splitlines()]
    expected = [[entry['patch'], entry['root'], ','.join(entry['capabilities'])] for entry in manifest['families']]
    if rows != expected:
        raise RuntimeError('plan.tsv differs from the manifest family order')
    families = [{'id': entry['id'], 'root': entry['root'], 'capabilities': entry['capabilities'],
                 'paths': list(entry['paths'])} for entry in manifest['families']]
    union = {capability for family in families for capability in family['capabilities']}
    union |= {row['capability'] for row in manifest['upstream_adoptions']}
    return families, union


def merge(current, before, after, fragment):
    """Three-way merge of one path: writes before/current/old-* into `fragment` and returns (conflict, proposal bytes)."""
    fragment.mkdir(parents=True, exist_ok=True)
    (fragment / 'before').write_bytes(data(current))
    args = []
    for name, content in [('current', data(current)), ('old-before', data(before)), ('old-after', data(after))]:
        file = fragment / name
        file.write_bytes(content)
        args.append(str(file))
    result = subprocess.run(['git', 'merge-file', '--diff3', '-p', '-L', 'TARGET', '-L', 'OLD_BEFORE', '-L', 'LOCAL_FAMILY', *args], capture_output=True)
    if not 0 <= result.returncode <= 127:
        raise RuntimeError(result.stderr.decode())
    return result.returncode != 0, result.stdout


def prepare():
    state = load(ROOT / 'state.json')
    if state.get('pending'):
        raise RuntimeError('accept pending family first')
    family = state['families'][state['next']]
    records = []
    for path in family['paths']:
        current = ROOT / 'work' / path
        before = ROOT / 'history' / family['id'] / 'before' / path
        after = ROOT / 'history' / family['id'] / 'after' / path
        fragment = ROOT / 'fragments' / family['id'] / path
        conflict, proposal_bytes = merge(current, before, after, fragment)
        proposal = fragment / 'proposal'
        proposal.write_bytes(proposal_bytes)
        record = {'path': path, 'before_exists': current.exists(), 'after_exists': after.exists() or bool(proposal_bytes), 'conflict': conflict, 'proposal': str(proposal)}
        save(fragment / 'exists.json', record)
        records.append(record)
    state['pending'] = {'id': family['id'], 'records': records}
    save(ROOT / 'state.json', state)
    print(json.dumps(state['pending'], indent=2))


def classify():
    """Dry run of the whole chain: per family, the three-way merge verdict; state.json is never written."""
    state = load(ROOT / 'state.json')
    work = ROOT / 'classify'
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(state['pristine'], work)
    rows = []
    for family in state['families']:
        conflicted = []
        added = 0
        for path in family['paths']:
            current = work / path
            before = ROOT / 'history' / family['id'] / 'before' / path
            after = ROOT / 'history' / family['id'] / 'after' / path
            fragment = ROOT / 'classify-fragments' / family['id'] / path
            conflict, proposal_bytes = merge(current, before, after, fragment)
            if not after.exists() and not proposal_bytes:
                current.unlink(missing_ok=True)
            else:
                current.parent.mkdir(parents=True, exist_ok=True)
                current.write_bytes(proposal_bytes)
                if not current.exists():
                    added += 1
            if conflict:
                conflicted.append(path)
        rows.append({'id': family['id'], 'root': family['root'], 'capabilities': family['capabilities'],
                     'paths': len(family['paths']), 'clean': not conflicted,
                     'conflicted': conflicted})
    summary = {'version': NEW_VERSION, 'families': len(rows),
               'clean_families': sum(1 for row in rows if row['clean']),
               'conflict_families': sum(1 for row in rows if not row['clean']),
               'conflicted_paths': sum(len(row['conflicted']) for row in rows),
               'work_tree': str(work), 'report': rows}
    print(json.dumps(summary, indent=2))
    return summary


def register(path):
    state = load(ROOT / 'state.json')
    family = state['families'][state['next']]
    if state['pending']['id'] != family['id']:
        raise RuntimeError('pending family is not the next one')
    if path in family['paths']:
        raise RuntimeError(f'already registered: {path}')
    if Path(path).is_absolute() or '..' in Path(path).parts:
        raise RuntimeError(f'must be a repository-relative path inside the runtime: {path}')
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
    if family['id'] != pending['id']:
        raise RuntimeError('pending family is not the next one')
    for record in pending['records']:
        path = record['path']
        source = ROOT / 'work' / path
        if source.exists() and not record['before_exists']:
            source.chmod(0o644)
        content = data(source)
        if any(line.startswith((b'<<<<<<< ', b'||||||| ', b'>>>>>>> ')) for line in content.splitlines()):
            raise RuntimeError(f'unresolved conflict markers: {path}')
        fragment = ROOT / 'fragments' / family['id'] / path
        (fragment / 'after').write_bytes(content)
        record['after_exists'] = source.exists()
        save(fragment / 'exists.json', record)
    state['completed'].append(family['id'])
    state['next'] += 1
    del state['pending']
    save(ROOT / 'state.json', state)
    print('accepted', family['id'])


def propagate_amend(state, index, path):
    """Apply one work-tree repair atomically across its accepted ownership chain."""
    owners = [family for family in state['families'][index:state['next']] if path in family['paths']]
    if not owners or owners[0]['id'] != state['families'][index]['id']:
        raise RuntimeError('propagation requires an existing source-family path')
    work = ROOT / 'work' / path
    latest = ROOT / 'fragments' / owners[-1]['id'] / path / 'after'
    if not work.is_file() or not latest.is_file():
        raise RuntimeError('propagation requires existing work and snapshot files')
    # A neighbouring later-family change is not part of this repair; require its own
    # changed lines plus one exact context line, still with patch fuzz forbidden.
    result = subprocess.run(['diff', '-U1', '--label', path, '--label', path, str(latest), str(work)],
                            capture_output=True)
    if result.returncode not in (0, 1):
        raise RuntimeError(f'cannot derive repair: {result.stderr.decode()}')
    snapshots = []
    for owner in owners:
        fragment = ROOT / 'fragments' / owner['id'] / path
        for side in (('after',) if owner is owners[0] else ('before', 'after')):
            snapshot = fragment / side
            if not snapshot.is_file():
                raise RuntimeError(f'propagation requires an existing snapshot: {snapshot}')
            snapshots.append(snapshot)
    updates = []
    with tempfile.TemporaryDirectory(prefix='amend-propagate-', dir=ROOT) as directory:
        for number, snapshot in enumerate(snapshots):
            staged = Path(directory) / str(number)
            staged.write_bytes(snapshot.read_bytes())
            if result.stdout:
                try:
                    command(['patch', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', str(staged)],
                            input=result.stdout)
                except RuntimeError as error:
                    raise RuntimeError(f'repair does not apply cleanly to {snapshot}: {error}') from error
            updates.append((snapshot, staged.read_bytes()))
    # No accepted snapshot changes until every owner has accepted exactly the same repair.
    for snapshot, content in updates:
        snapshot.write_bytes(content)
    print('amended with propagation', owners[0]['id'], path, 'through', [owner['id'] for owner in owners[1:]])


def amend(family_id, path, propagate=False):
    """Capture an explicit post-resolution repair in its existing source owner."""
    state = load(ROOT / 'state.json')
    pending = state.get('pending')
    if pending and path in {record['path'] for record in pending['records']}:
        raise RuntimeError('pending family owns this path')
    index = next(i for i, family in enumerate(state['families']) if family['id'] == family_id)
    family = state['families'][index]
    if family_id not in state['completed']:
        raise RuntimeError(f'{family_id} is not accepted yet')
    # Only an already-accepted later owner froze a snapshot of this path; an unprepared one
    # will read the repaired work file as its TARGET when it is prepared.
    if any(path in later['paths'] for later in state['families'][index + 1:state['next']]):
        if not propagate:
            raise RuntimeError('shared repair needs explicit snapshot propagation (--propagate)')
        propagate_amend(state, index, path)
        return
    fragment = ROOT / 'fragments' / family_id / path
    if path not in family['paths']:
        fragment.mkdir(parents=True)
        before = Path(state['pristine']) / path
        before_exists = before.exists()
        # An added path still starts after every earlier accepted owner, not pristine.
        for prior in reversed(state['families'][:index]):
            if path in prior['paths']:
                prior_fragment = ROOT / 'fragments' / prior['id'] / path
                before = prior_fragment / 'after'
                before_exists = load(prior_fragment / 'exists.json')['after_exists']
                break
        (fragment / 'before').write_bytes(data(before))
        save(fragment / 'exists.json', {'path': path, 'before_exists': before_exists, 'target_native_path': True})
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
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr.decode())
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
    if residue:
        raise RuntimeError(f'patch residue: {residue}')
    replayed, work = oracle().tree_digest(replay), oracle().tree_digest(ROOT / 'work')
    through = state['families'][state['next'] - 1]['id'] if state['next'] else None
    print(json.dumps({'through': through, 'accepted': state['next'], 'replay_equals_work': replayed == work, 'digest': work}))
    if replayed != work:
        raise RuntimeError('emitted patches do not reproduce the work tree')


def snapshot(through, out):
    """Fresh pristine + accepted families' emitted patches up to and including `through`, at fuzz 0, into `out`."""
    state = load(ROOT / 'state.json')
    ids = [family['id'] for family in state['families'][:state['next']]]
    if through not in ids:
        raise RuntimeError(f'{through} is not accepted')
    if out.exists():
        raise RuntimeError(f'{out} exists')
    shutil.copytree(state['pristine'], out)
    for original in state['families'][:ids.index(through) + 1]:
        patch, _ = family_patch(original)
        if patch:
            command(['patch', '-p1', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '--remove-empty-files'], cwd=out / ROOTS[original['root']], input=patch)
    residue = [str(path) for path in out.rglob('*') if path.name.endswith(('.orig', '.rej'))]
    if residue:
        raise RuntimeError(f'patch residue: {residue}')
    print(json.dumps({'through': through, 'out': str(out), 'digest': oracle().tree_digest(out)}))


def export(archives=None):
    state = load(ROOT / 'state.json')
    # Rows not accepted yet (new capabilities authored later) keep their registered skeleton row.
    if (state.get('pending') or {}).get('records'):
        raise RuntimeError('a prepared family with proposals must be accepted first')
    TARGET.mkdir(exist_ok=True)
    for path in (ROOT / 'work').rglob('*'):
        if path.name.endswith(('.orig', '.rej')):
            raise RuntimeError(f'patch residue: {path}')
        if path.is_file() and path.suffix in {'.ts', '.json', '.kdl', '.py', '.rs', '.md'}:
            if any(line.startswith((b'<<<<<<< ', b'||||||| ', b'>>>>>>> ')) for line in path.read_bytes().splitlines()):
                raise RuntimeError(f'unresolved conflict markers: {path}')
    families = []
    registered = {row['id']: row for row in load(TARGET / 'manifest.json')['families']}
    for original in state['families'][state['next']:]:
        families.append(registered[original['id']])
    for original in reversed(state['families'][:state['next']]):
        patch, paths = family_patch(original)
        if not patch:
            raise RuntimeError(f'empty family patch: {original["id"]}')
        filename = f"{original['id']}-v{NEW_VERSION}.patch"
        (TARGET / filename).write_bytes(patch)
        families.insert(0, {**original, 'patch': f'.{NEW_VERSION}-families/' + filename, 'sha256': hashlib.sha256(patch).hexdigest(), 'paths': paths})
    if archives is None:
        existing = load(TARGET / 'manifest.json')['archives']
        packages = {path.name for path in Path(state['pristine']).iterdir() if path.is_dir()}
        if {row['package'] for row in existing} != packages:
            raise RuntimeError('manifest archive rows differ from the pristine package set')
        selected_archives = existing
    else:
        archive_input = load(archives)
        archive_rows = archive_input['archives'] if isinstance(archive_input, dict) else archive_input
        packages = {path.name for path in Path(state['pristine']).iterdir() if path.is_dir()}
        selected_archives = [{**row, 'package': row.get('package', row.get('name', '').split('/')[-1])} for row in archive_rows
                             if row.get('package', row.get('name', '').split('/')[-1]) in packages]
        if len(selected_archives) != len(packages) or {row['package'] for row in selected_archives} != packages:
            raise RuntimeError('archive rows do not cover the pristine package set')
    # The approved adoption list is the 18.18.0 contract (each row keeps its own
    # durable record under `patches/.retired/`) plus 0038, which upstream owns
    # from 18.16.0 on and which joined in the 18.18.6 rotation (M0).
    adoptions = [{**row} for row in load(BASELINE)['upstream_adoptions']
                 if row['capability'] not in RETIRED_CAPABILITIES] + [ADOPTION_0038]
    local = [capability for family in families for capability in family['capabilities']]
    union = local + [row['capability'] for row in adoptions]
    expected = (({capability for family in load(BASELINE)['families'] for capability in family['capabilities']}
                 | {row['capability'] for row in adoptions}) - RETIRED_CAPABILITIES
                | {capability for row in ADDED_ROWS for capability in row['capabilities']})
    if len(union) != len(set(union)) or set(union) != expected or '0097' in union:
        raise RuntimeError('capability union drifted')
    manifest = {'schema_version': 1, 'version': NEW_VERSION, 'upstream_commit': UPSTREAM_COMMIT,
                'archives': selected_archives, 'families': families, 'upstream_adoptions': adoptions,
                'pristine_tree_sha256': oracle().tree_digest(Path(state['pristine'])),
                'candidate_tree_sha256': oracle().tree_digest(ROOT / 'work')}
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


HUNK_FAILED = re.compile(r'^Hunk #(\d+) FAILED at (\d+)', re.MULTILINE)
HUNK_OFFSET = re.compile(r'^Hunk #(\d+) succeeded at (\d+)(?: with fuzz \d+)? \(offset (-?\d+) lines?\)', re.MULTILINE)


def replay(tgz_cache=None):
    """Read-only: apply every registry patch at fuzz 0, in plan.tsv order, to fresh pristine."""
    global ARCHIVE_CACHE
    if tgz_cache is not None:
        ARCHIVE_CACHE = tgz_cache
    manifest = load(TARGET / 'manifest.json')
    if manifest['version'] != NEW_VERSION:
        raise RuntimeError('registry manifest version mismatch')
    work = ROOT / 'replay'
    if work.exists():
        shutil.rmtree(work)
    extract(NEW_VERSION, work)
    digest = oracle().tree_digest(work)
    if digest != manifest['pristine_tree_sha256']:
        raise RuntimeError('replay pristine identity')
    report = []
    failed_families = failed_hunks = 0
    for entry in manifest['families']:
        patch = (TARGET.parent / entry['patch']).read_bytes()
        result = subprocess.run(['patch', '-p1', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '--remove-empty-files'],
                                cwd=work / ROOTS[entry['root']], input=patch, capture_output=True)
        output = result.stdout.decode(errors='replace') + result.stderr.decode(errors='replace')
        failures = [{'hunk': int(number), 'at': int(at)} for number, at in HUNK_FAILED.findall(output)]
        offsets = [{'hunk': int(number), 'at': int(at), 'offset': int(offset)} for number, at, offset in HUNK_OFFSET.findall(output)]
        large = [item for item in offsets if abs(item['offset']) > 50]
        if result.returncode or failures:
            failed_families += 1
            failed_hunks += len(failures)
        report.append({'id': entry['id'], 'root': entry['root'], 'capabilities': entry['capabilities'],
                       'applied': result.returncode == 0 and not failures,
                       'failed_hunks': len(failures), 'failures': failures,
                       'max_offset': max((abs(item['offset']) for item in offsets), default=0),
                       'offsets_over_50': large})
    residue = sorted({str(path.relative_to(work)) for path in work.rglob('*') if path.name.endswith(('.rej', '.orig'))})
    summary = {'version': NEW_VERSION, 'families': len(report), 'applied_families': len(report) - failed_families,
               'failed_families': failed_families, 'failed_hunks': failed_hunks,
               'pristine_tree_sha256': digest, 'residue_files': len(residue),
               'order': [entry['id'] for entry in report], 'report': report}
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == '__main__':
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['old-inputs', 'pristine', 'init', 'prepare', 'take', 'register', 'accept', 'amend', 'check', 'snapshot', 'export', 'replay', 'classify'])
    parser.add_argument('--through')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--pristine', type=Path)
    parser.add_argument('--archives', type=Path)
    parser.add_argument('--tgz-cache', type=Path)
    parser.add_argument('--path')
    parser.add_argument('--family')
    parser.add_argument('--propagate', action='store_true', help='amend --family/--path through later owner snapshots')
    args = parser.parse_args()
    if args.propagate and (args.command != 'amend' or not args.family or not args.path):
        parser.error('--propagate requires amend --family SOURCE --path PATH')
    if args.command == 'pristine':
        pristine_tree()
    elif args.command in {'old-inputs', 'init'}:
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
        amend(args.family, args.path, args.propagate)
    elif args.command == 'check':
        check()
    elif args.command == 'snapshot':
        snapshot(args.through, args.out)
    elif args.command == 'replay':
        replay(args.tgz_cache)
    elif args.command == 'classify':
        classify()
    else:
        export(args.archives)
