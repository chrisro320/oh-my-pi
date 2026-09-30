#!/usr/bin/env bash
# Mutate isolated copies only. Each fault must fail the real transport/type gate.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 -u - "$HERE" <<'PY'
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

here = Path(sys.argv[1])
nm = Path(os.environ.get("OMP_PATCH_VERIFY_NM", str(Path.home() / ".bun/install/global/node_modules/@oh-my-pi")))
roots = {"pi-ai": Path(os.environ.get("OMP_PATCH_VERIFY_AI_ROOT", nm / "pi-ai")),
         "pi-agent-core": Path(os.environ.get("OMP_PATCH_VERIFY_CORE_ROOT", nm / "pi-agent-core"))}
ai = "pi-ai/src/providers/openai-codex-responses.ts"
core = "pi-agent-core/src/compaction/compaction-v2-streaming.ts"
types = "pi-ai/dist/types/providers/openai-codex-responses.d.ts"
gate = here / "verify-codex-compaction-chain-fail-closed.ts"
# Supported recovery-era versions carry the non-generating chain-recovery hook;
# 18.1.18 predates it, so fault expectations differ by supported version.
version = json.loads((roots["pi-ai"] / "package.json").read_text())["version"]
supports_recovery = version in ("18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4")
acceptance_declaration = (
    "    onAccept?: (\n        commit: (recorded: OpenAICodexCompactionResponseMetadata) => void,\n        rollback: () => void,\n    ) => void;\n"
    if version in ("18.3.3", "18.4.1", "18.4.4") else
    "    onAccept?: (commit: (recorded: OpenAICodexCompactionResponseMetadata) => void) => void;\n"
)

def run(tree, gate_path=None):
    env = dict(os.environ, OMP_PATCH_VERIFY_NM=str(tree), OMP_COMPACTION_TRACE_OFF="1")
    for key in ("AI", "CORE", "AGENT", "CATALOG"):
        env.pop(f"OMP_PATCH_VERIFY_{key}_ROOT", None)
    return subprocess.run(["bun", str(gate_path or gate)], env=env, text=True, capture_output=True, timeout=30)

def replace(path, old, new):
    text = path.read_text()
    assert text.count(old) == 1, f"mutation anchor is ambiguous or absent: {path}: {old!r}"
    path.write_text(text.replace(old, new, 1))

faults = [
    ("endpoint bypass", core, "if (isCodexResponses && !shouldUseCodexProviderTransport(model)) {", "if (false) {", "Codex endpoint override must fail closed"),
    ("typed transport is terminal", core, "if (AIError.is(classification, AIError.Flag.Transient)) return true;", 'if (error.name === "CodexWebSocketTransportError") return false;\n\tif (AIError.is(classification, AIError.Flag.Transient)) return true;', "JSON Parse error"),
    ("unknown provider code retries", core, "if (error.code && Object.hasOwn(CODEX_PERMANENT_FAILURE_CODES, error.code)) return false;", "if (error.code) return !Object.hasOwn(CODEX_PERMANENT_FAILURE_CODES, error.code);", "permanent or unclassified failure must not retry"),
    ("event type becomes provider code", core, 'stringField(event, "code")\n', 'stringField(event, "code") ?? stringField(event, "type")\n', "only a real provider code may be preserved"),
    ("missing acceptance type", types, acceptance_declaration, "", "published acceptance API must type-check"),
    ("unsound metadata target type", types, "websocketState?: { modelsEtag?: string }", "websocketState?: unknown", "published acceptance API must type-check"),
    ("eager baseline reset", ai, "\t\trequestContext.websocketState.lastTransport = initial.transport;", "\t\trequestContext.websocketState.lastTransport = initial.transport;\n\t\tresetCodexWebSocketAppendState(requestContext.websocketState);", "healthy retries must retain their response baseline" if supports_recovery else "CodexCompactionChainLostError"),
    ("SSE fallback permitted", ai, "const refuseSseFallback = isCompactionWireBody(transformedBody);", "const refuseSseFallback = false;", "sse-disabled: failure must stay terminal"),
    ("cold full replay permitted", ai, "const mustChain = isCompactionWireBody(requestContext.transformedBody);", "const mustChain = false;", "cold: every sent compaction must chain" if supports_recovery else "cold: failure must stay terminal"),
    ("acceptance does not reset", core, "\t\tapplyAcceptedMetadata?.(acceptedMetadata);", "\t\tvoid acceptedMetadata;", "accepted summary must invalidate its old baseline"),
    ("accepted metadata dropped", ai, ("\t\t\t" if version in ("18.3.3", "18.4.1", "18.4.4") else "\t\t") + "applyOpenAICodexCompactionResponseMetadata(recorded, requestContext);", "\t\tvoid recorded;", "accepted summary must commit metadata"),
    ("raw error swallowed", core, 'type === "response.incomplete" || type === "error"', 'type === "response.incomplete"', "only a real provider code may be preserved"),
]
if version in ("18.3.3", "18.4.1", "18.4.4"):
    faults.extend([
        ("collector metadata rollback missing", core, "\t\t\trollbackAttemptMetadata?.();", "", "invalid-summary: handshake metadata must commit only after accepted compaction"),
        ("open metadata rollback missing", ai, "\t\trequestContextForDiag.turnState.value = turnStateBeforeOpen;", "", "recovery-invalid: handshake metadata must commit only after accepted compaction"),
    ])
if version in ("18.4.1", "18.4.4"):
    # 18.4.1 candidates carry the typed V2 failure's `status` and the shared
    # effective-lane predicate, so these two mutations reproduce the leading
    # defects: a status-based retry decision that outranks auth, and a lane
    # predicate narrowed back to `model.api`.
    faults.extend([
        ("status outranks auth", core,
         "\tconst classification = AIError.classify(error);\n\tif (AIError.is(classification, AIError.Flag.AuthFailed)) return false;\n",
         "\tconst classification = AIError.classify(error);\n\tif (error instanceof CompactionV2StreamFailure && error.status !== undefined) return AIError.isTransientStatus(error.status);\n\tif (AIError.is(classification, AIError.Flag.AuthFailed)) return false;\n",
         "auth failure must not consume the V2 retry budget"),
        ("narrow speculation lane predicate", core,
         'return compactionV2Api(model) === "openai-codex-responses" || model.provider === "openai-codex";',
         'return model.api === "openai-codex-responses";',
         "effective Codex lane must be recognized"),
    ])

with tempfile.TemporaryDirectory(prefix="omp-0070-faults-") as temporary:
    root = Path(temporary)
    tree = root / "node_modules/@oh-my-pi"
    tree.mkdir(parents=True)
    for entry in nm.parent.iterdir():
        if entry.name != "@oh-my-pi":
            (tree.parent / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
    for entry in nm.iterdir():
        if entry.name in roots:
            shutil.copytree(roots[entry.name], tree / entry.name, ignore=shutil.ignore_patterns("node_modules"))
        else:
            (tree / entry.name).symlink_to(entry, target_is_directory=True)
    control = run(tree)
    assert control.returncode == 0, control.stdout + control.stderr
    print("0070 fault control PASS", flush=True)
    for label, relative, old, new, expected in faults:
        target = tree / relative
        original = target.read_bytes()
        try:
            replace(target, old, new)
            result = run(tree)
            output = result.stdout + result.stderr
            assert result.returncode != 0, f"{label}: broken behavior stayed green"
            assert expected in output, f"{label}: failed for the wrong reason\n{output}"
            print(f"PASS fault: {label}", flush=True)
        finally:
            target.write_bytes(original)
    # The chain-body gate guards the same frame from the consumer side: a chained
    # compaction that appends the trigger without answering the calls the live
    # baseline left open must stop passing it. Measured 2026-09-17 (sessions
    # 01a0addd / 01a0ae09) and 2026-09-19 (session 01a0b80a, a custom tool
    # call): the endpoint rejected exactly that frame with
    # `invalid_request_error: No tool output found for … call …`.
    body_gate = here / "verify-codex-compaction-chain.ts"
    body_control = run(tree, body_gate)
    assert body_control.returncode == 0, body_control.stdout + body_control.stderr
    print("chain-body fault control PASS", flush=True)
    body_target = tree / ai
    body_original = body_target.read_bytes()
    try:
        replace(
            body_target,
            "\t\t\tinput: [...pendingOutputs, lastInput],",
            "\t\t\tinput: [lastInput],",
        )
        result = run(tree, body_gate)
        output = result.stdout + result.stderr
        assert result.returncode != 0, "pending items dropped: broken behavior stayed green"
        assert "function_call_output" in output, f"failed for the wrong reason\n{output}"
        print("PASS fault: chained compaction drops the pending items", flush=True)
    finally:
        body_target.write_bytes(body_original)
    shutil.rmtree(tree / "pi-ai/src")
    incomplete = run(tree)
    assert incomplete.returncode != 0 and "Cannot find module" in incomplete.stderr, incomplete.stdout + incomplete.stderr
    print("PASS fault: incomplete runtime cannot pass", flush=True)
print(f"verify-codex-compaction-chain-fail-closed faults: {len(faults) + 2} behavioral/type faults rejected")
PY
