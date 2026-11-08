#!/usr/bin/env python3
"""Mutation receipts for the real worker legs. Edits only disposable copied runtimes."""
import argparse, json, runpy, shutil, tempfile
from pathlib import Path
repo = Path(__file__).resolve().parent.parent
capture = runpy.run_path(str(repo / 'patches/run-worker-matrix.py'))['capture']
p = argparse.ArgumentParser()
p.add_argument('runtime'); p.add_argument('receipt')
a = p.parse_args()
runtime = Path(a.runtime).resolve()
receipt = {'runtime': str(runtime), 'baseline': None, 'controls': []}
command = ['bash', str(repo / 'patches/worker-matrix.sh'), str(runtime), 'main', str(repo / 'patches/verify-worker-runtime.ts')]
receipt['baseline'] = capture(command, 180)
assert receipt['baseline']['exit'] == 0, receipt['baseline']
controls = [
    ('0081', 'pi-coding-agent/src/thread/remote-agent-session.ts', 'getMainCacheHitRate: () => this.#entryIndex.mainCacheHitRate(),', 'getMainCacheHitRate: () => 0,', 'real mirror excludes auxiliary usage'),
    ('0081', 'pi-coding-agent/src/thread/remote-agent-session.ts', 'return this.#state.sessionAgents;', 'return []; // mutation: drop the advertised model/eval-tool surface', '0083 model/eval-tool surface survives the actual mirror'),
    ('Q2', 'pi-coding-agent/src/task/persisted-revive.ts', 'systemPrompt: () => [...init.systemPrompt],', 'systemPrompt: () => ["M6 MUTATED COLD PREFIX"],', '0101 cold revival preserves'),
    ('Q3', 'pi-coding-agent/src/thread/subagent-worker.ts', 'new Worker(entry.href, { type: "module" })', 'new Worker(entry.href, { type: "module", env: { ...process.env, OMP_PROFILE: "", PI_PROFILE: "", PI_CODING_AGENT_DIR: "" } })', 'worker profile must match CLI activation'),
    ('Q5', 'pi-coding-agent/src/thread/services/memory.ts', 'mentalModelsSnippet: state => state.mentalModelsSnippet,', 'mentalModelsSnippet: state => "M6 STALE MIRROR",', 'LIVE MAIN MM A'),
    ('Q7', 'pi-coding-agent/src/session/agent-storage.ts', 'this.#upsertModelUsageStmt.run(modelKey);', 'void modelKey; // mutation: lose committed writes', '900'),
    ('Q8', 'pi-coding-agent/src/thread/subagent-worker.ts', 'this.#holds++;', 'void 0; // mutation: resident no longer holds worker', 'resident survives more than three'),
    ('Devin', 'pi-ai/src/providers/devin.ts', 'const cached = devinAuthCache.get(key);', 'const cached = undefined; // mutation: disable JWT reuse', 'a worker mints at most one JWT'),
    ('Devin', 'pi-catalog/src/wire/devin.ts', 'const devinSessionId = crypto.randomUUID();', 'const devinSessionId = "00000000-0000-4000-8000-000000000000";', 'each realm owns a distinct Devin session UUID'),
    ('Devin', 'pi-catalog/src/wire/devin.ts', 'requestId: BigInt(++devinRequestId),', 'requestId: BigInt(devinRequestId),', '0n !== 1n'),
    ('Devin', 'pi-ai/src/providers/devin.ts', '${process.pid}-t${threadId}-a${attempt}', '${process.pid}-a${attempt}', '0071 each realm keeps'),
    ('threads', 'pi-agent-core/src/compaction/compaction.ts', 'statefulResponses: model.api === "anthropic-messages" ? false : undefined,', 'statefulResponses: model.api === "anthropic-messages" ? true : undefined,', 'child summary requests opt out'),
    ('threads', 'pi-coding-agent/src/task/executor.ts', '"compaction.midTurnEnabled": true,', '"compaction.midTurnEnabled": false,', 'worker child enables mid-turn compaction'),
    ('bridges', 'pi-coding-agent/src/thread/services/auth-remote.ts', 'providers: options?.providers,', 'providers: undefined,', '0031 provider scopes cross a real worker MessagePort'),
    ('bridges', 'pi-coding-agent/src/thread/services/settings.ts', 'target.applyMirrorState(state);', 'void state; // mutation: drop main settings updates', '0099 live main settings update reaches'),
    ('bridges', 'pi-coding-agent/src/thread/services/auth-remote.ts', 'return this.#remote.call("oauth.inspectUnresolvedRefresh", provider);', 'throw new Error("M6 MUTATION missing unlock bridge");', 'M6 MUTATION missing unlock bridge'),
    ('OAuth9', 'pi-coding-agent/src/thread/services/auth-remote.ts', 'return this.#remote.call("oauth.refresh", id, signal, options);', 'return this.#remote.call("oauth.refresh", id, signal, options).then(() => this.#remote.call("oauth.refresh", id, signal, options));', 'nine real worker threads share exactly one OAuth token POST'),
]
for index, (leg, relative, before, after, observable) in enumerate(controls):
    with tempfile.TemporaryDirectory(prefix='m6-mutation-', dir='/tmp') as temp:
        fault = Path(temp) / 'runtime'; shutil.copytree(runtime, fault, symlinks=True)
        target = fault / 'node_modules/@oh-my-pi' / relative
        source = target.read_text(); assert source.count(before) == 1, (relative, source.count(before))
        target.write_text(source.replace(before, after))
        cmd = ['bash', str(repo / 'patches/worker-matrix.sh'), str(fault), 'main', str(repo / 'patches/verify-worker-runtime.ts'), leg]
        result = capture(cmd, 150)
        combined = result['stdout']['tail'] + result['stderr']['tail']
        result.update(leg=leg, target=relative, before=before, after=after, observable=observable,
                      rejected=result['exit'] != 0 and not result['timeout'] and observable in combined)
        receipt['controls'].append(result)
        Path(a.receipt).write_text(json.dumps(receipt, indent=2) + '\n')
        print(index, leg, result['rejected'], result['seconds'], flush=True)
# The companion has no runtime family: stage the broken source inside the fault tree.
with tempfile.TemporaryDirectory(prefix='m6-payload-mutation-', dir='/tmp') as temp:
    fault = Path(temp) / 'runtime'; shutil.copytree(runtime, fault, symlinks=True)
    payload = fault / 'payload-archive-mutant.ts'
    source = (repo / 'patches/payload-archive-extension.ts').read_text()
    before = '${process.pid}-${threadId}-'; assert source.count(before) == 1
    payload.write_text(source.replace(before, '${process.pid}-'))
    # The launcher copies the runtime, so use a relative module inside the selected root via its URL.
    cmd = ['bash', str(repo / 'patches/worker-matrix.sh'), str(fault), 'main', str(repo / 'patches/verify-worker-runtime.ts'), 'payload', '../../../payload-archive-mutant.ts']
    result = capture(cmd, 90)
    combined = result['stdout']['tail'] + result['stderr']['tail']
    result.update(leg='payload', before=before, after='${process.pid}-', rejected=result['exit'] != 0 and not result['timeout'] and 'two archive instances in one millisecond' in combined)
    receipt['controls'].append(result)
    Path(a.receipt).write_text(json.dumps(receipt, indent=2) + '\n')
    print('payload', result['rejected'], flush=True)
assert all(row['rejected'] for row in receipt['controls']), 'a mutation did not turn its named observable red'
