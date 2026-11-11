#!/usr/bin/env python3
"""Audit historical family identifiers and imports against the accepted source."""
import difflib
import json
from pathlib import Path
import subprocess

ROOT = Path('/var/tmp/omp-18186/rebase')
FAMILY = 'family-compaction'
HISTORY = ROOT / 'history' / FAMILY
OUT = Path(__file__).parent / 'r4-symbol-audit.json'
state = json.loads((ROOT / 'state.json').read_text())
family = next(row for row in state['families'] if row['id'] == FAMILY)
inputs = []
for path in family['paths']:
    if not path.endswith('.ts'):
        continue
    versions = {}
    for label, root in [('before', HISTORY / 'before'), ('after', HISTORY / 'after'),
                        ('chain13', ROOT / 'fragments' / FAMILY), ('candidate', ROOT / 'work')]:
        source = root / path
        if label == 'chain13':
            source = source / 'before'
        versions[label] = source.read_text() if source.exists() else ''
    inputs.append({'path': path, **versions})
compiler = str(Path(subprocess.check_output(['which', 'tsc'], text=True).strip()).resolve().parent.parent)
script = r'''
const fs = require('node:fs');
const ts = require(process.argv[1]);
const rows = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const row of rows) {
  for (const label of ['before', 'after', 'chain13', 'candidate']) {
    const source = ts.createSourceFile(row.path, row[label], ts.ScriptTarget.Latest, true);
    const tokens = [], imports = [];
    function visit(node) {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        const start = node.getStart(source);
        tokens.push({name: node.text, line: source.getLineAndCharacterOfPosition(start).line + 1});
      }
      if (ts.isImportDeclaration(node) && node.importClause) {
        const names = [];
        if (node.importClause.name) names.push(node.importClause.name.text);
        const bindings = node.importClause.namedBindings;
        if (bindings) {
          if (ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
          else for (const binding of bindings.elements) names.push(binding.name.text);
        }
        imports.push(...names);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    row[label] = {tokens, imports};
  }
}
console.log(JSON.stringify(rows));
'''
parsed = json.loads(subprocess.check_output(['node', '-e', script, compiler], input=json.dumps(inputs), text=True))
files = []
for raw, ast in zip(inputs, parsed):
    affected = set()
    matcher = difflib.SequenceMatcher(None, raw['before'].splitlines(), raw['after'].splitlines(), autojunk=False)
    for tag, _a, _b, start, end in matcher.get_opcodes():
        if tag in ('insert', 'replace'):
            affected.update(range(start + 1, end + 1))
    wanted = sorted({token['name'] for token in ast['after']['tokens'] if token['line'] in affected})
    before = {token['name'] for token in ast['before']['tokens']}
    current = {token['name'] for token in ast['candidate']['tokens']}
    removed_imports = sorted(set(ast['chain13']['imports']) - set(ast['candidate']['imports']))
    files.append({
        'path': raw['path'], 'historical_added_or_used': wanted,
        'novel': sorted(set(wanted) - before), 'missing': sorted(set(wanted) - current),
        'anchors': {name: sorted({token['line'] for token in ast['candidate']['tokens'] if token['name'] == name}) for name in wanted},
        'removed_chain13_imports': removed_imports,
        'remaining_references_to_removed_imports': sorted(set(removed_imports) & current),
    })
result = {
    'family': FAMILY, 'historical_input': str(HISTORY),
    'method': 'TypeScript AST identifiers/private identifiers on inserted or replaced historical lines, compared with the accepted candidate; comments and string literals excluded',
    'identifier_path_pairs': sum(len(row['historical_added_or_used']) for row in files),
    'missing_count': sum(len(row['missing']) for row in files), 'files': files,
}
OUT.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}, indent=2))
print(json.dumps([row for row in files if row['missing'] or row['removed_chain13_imports']], indent=2))
