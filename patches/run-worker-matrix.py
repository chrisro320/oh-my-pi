#!/usr/bin/env python3
"""Offline selected-root worker matrix with bounded, concurrently drained receipts."""
import argparse, hashlib, json, os, selectors, signal, subprocess, time
from pathlib import Path

NAMES = """main-cache-hit usage-reset-format hindsight-recall-snapshot hindsight-recall-promotion-slot usage-statusline-gate usage-thread-providers session-transfer-authority date-cwd-journal-prefix interrupt-prune-symmetry eval-state-context-persist turn-recovery-reminder-persist model-mention-surface-resume length-stop-reminder-persist prompt-effort-resume model-selection-resume devin-auth-cache devin-metadata devin-thinking-signature devin-idle-cascade-pin oauth-durable-refresh auth-unlock-extension codex-account-eligibility-retention google-account-eligibility-retention oauth-worker-single-owner subagent-warm-revival-prompt context-persist-audit retry-slow-schedule idle-ephemeral-reservation session-cache-keepalive resume-cache-breakpoint prefix-cache-compaction codex-compaction-chain remote-compaction-target-key compaction-cache-liveness anthropic-native-compaction-live-context compaction-length-stop manual-compaction-direct compaction-live-chain-midnight anthropic-thinking-drop-resume anthropic-request-audit anthropic-cache-boundaries anthropic-threads-cache-shape anthropic-threads-warm-compaction-isolation""".split()

def capture(command, timeout):
    started = time.monotonic()
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    select = selectors.DefaultSelector()
    streams = {}
    for name, pipe in [('stdout', child.stdout), ('stderr', child.stderr)]:
        select.register(pipe, selectors.EVENT_READ, name)
        streams[name] = {'count': 0, 'hash': hashlib.sha256(), 'tail': b''}
    expired = False
    while select.get_map():
        if not expired and time.monotonic() - started > timeout:
            expired = True
            os.killpg(child.pid, signal.SIGKILL)
        for key, _ in select.select(0.1):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data:
                select.unregister(key.fileobj)
                key.fileobj.close()
                continue
            stream = streams[key.data]
            stream['count'] += len(data)
            stream['hash'].update(data)
            stream['tail'] = (stream['tail'] + data)[-16000:]
    code = child.wait()
    result = {'command': command, 'exit': code, 'timeout': expired, 'timeout_limit_seconds': timeout, 'seconds': round(time.monotonic() - started, 3), 'output_complete': not expired}
    for name, stream in streams.items():
        result[name] = {'bytes': stream['count'], 'sha256': stream['hash'].hexdigest(), 'tail': stream['tail'].decode(errors='replace'), 'output_truncated': stream['count'] > 16000}
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('runtime')
    parser.add_argument('receipt')
    parser.add_argument('--gates', nargs='+')
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--modes', nargs='+', choices=('main', 'worker'), default=('main', 'worker'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    selected = subprocess.check_output(['bash', str(repo / 'patches/apply.sh'), '--print-gates'], env={**os.environ, 'OMP_PATCH_VERSION': '18.18.0'}, text=True).splitlines()
    gates = args.gates or [f'verify-{name}.ts' for name in NAMES if f'verify-{name}.ts' in selected]
    rows = []
    for gate in gates:
        assert gate in selected or gate == 'verify-worker-runtime.ts', f'gate not selected: {gate}'
        for mode in args.modes:
            # Existing root-fixture teardown has per-session deadlines in a worker;
            # the warm gate repeats ten scenarios for five production mutations.
            deadline = max(args.timeout, 1800) if gate == 'verify-subagent-warm-revival-prompt.ts' and mode == 'worker' else args.timeout
            result = capture(['bash', str(repo / 'patches/worker-matrix.sh'), args.runtime, mode, str(repo / 'patches' / gate)], deadline)
            result.update(gate=gate, mode=mode, status='PASS' if result['exit'] == 0 and result['output_complete'] else 'FAIL')
            rows.append(result)
            Path(args.receipt).write_text(json.dumps({'runtime': args.runtime, 'selected_gates': selected, 'rows': rows}, indent=2) + '\n')
            print(gate, mode, result['status'], result['seconds'], flush=True)
