from pathlib import Path
import json
import re
from datetime import datetime, timezone

_audit_root = Path('.trellis/tasks/09-26-omp-1833-upgrade/research')
_audit_specs = [
    (str(_audit_root / 'work-order.md'), 'Trellis spec mechanism'),
    (str(_audit_root / 'work-order.md'), '| [Patch Rollup Contracts]'),
    (str(_audit_root / 'work-order.md'), '| [Verification Gate Contracts]'),
    ('.trellis/spec/backend/patch-rollup-contracts.md', 'Pristine input MUST'),
    ('.trellis/spec/backend/patch-rollup-contracts.md', 'Full-chain verification MUST'),
    ('.trellis/spec/backend/verification-gate-contracts.md', 'Gate loading MUST fail closed'),
]
# Two real executions, not duplicate copies of one captured result.
for _audit_stage in ('delivery', 'review'):
    _audit_checks = []
    for _audit_path, _audit_needle in _audit_specs:
        _audit_result = await tool.grep({
            'i': 'Checking executable specification contract',
            'pattern': re.escape(_audit_needle),
            'path': _audit_path,
            'case': True, 'gitignore': False, 'skip': 0,
        })
        _audit_text = _audit_result.get('text', '')
        _audit_matches = [
            line for line in _audit_text.splitlines()
            if line.startswith('*') and _audit_needle in line
            and 'grep -nF' not in line and 'Machine audit' not in line
        ]
        _audit_checks.append({
            'path': _audit_path, 'required': _audit_needle,
            'matched_source_rows': _audit_matches,
            'passed': bool(_audit_matches), 'raw_tool_output': _audit_result,
        })
    _audit_passed = all(item['passed'] for item in _audit_checks)
    (_audit_root / f'spec-audit-{_audit_stage}.json').write_text(json.dumps({
        'stage': _audit_stage, 'timestamp': datetime.now(timezone.utc).isoformat(),
        'executor': 'OMP built-in grep with fail-closed assertions',
        'status': 'passed' if _audit_passed else 'failed',
        'checks': _audit_checks,
    }, ensure_ascii=False, indent=2))
    assert _audit_passed, f'{_audit_stage}: missing required specification contract'
    print(f'{_audit_stage}: {_audit_passed}, {len(_audit_checks)}/6 contracts matched')
