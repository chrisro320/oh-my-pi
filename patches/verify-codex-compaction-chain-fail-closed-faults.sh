#!/usr/bin/env bash
# Mutate isolated copies only. Each fault must fail the real transport/type gate.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 -u - "$HERE" <<'PY'
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

def run(tree):
    env = dict(os.environ, OMP_PATCH_VERIFY_NM=str(tree), OMP_COMPACTION_TRACE_OFF="1")
    for key in ("AI", "CORE", "AGENT", "CATALOG"):
        env.pop(f"OMP_PATCH_VERIFY_{key}_ROOT", None)
    return subprocess.run(["bun", str(gate)], env=env, text=True, capture_output=True, timeout=30)

def replace(path, old, new):
    text = path.read_text()
    assert text.count(old) == 1, f"mutation anchor is ambiguous or absent: {path}: {old!r}"
    path.write_text(text.replace(old, new, 1))

faults = [
    ("endpoint bypass", core, "if (isCodexResponses && !shouldUseCodexProviderTransport(model)) {", "if (false) {", "Codex endpoint override must fail closed"),
    ("typed transport is terminal", core, "if (AIError.is(classification, AIError.Flag.Transient)) return true;", 'if (error.name === "CodexWebSocketTransportError") return false;\n\tif (AIError.is(classification, AIError.Flag.Transient)) return true;', "JSON Parse error"),
    ("unknown provider code retries", core, "if (error.code && Object.hasOwn(CODEX_PERMANENT_FAILURE_CODES, error.code)) return false;", "if (error.code) return !Object.hasOwn(CODEX_PERMANENT_FAILURE_CODES, error.code);", "permanent or unclassified failure must not retry"),
    ("event type becomes provider code", core, 'stringField(event, "code")\n', 'stringField(event, "code") ?? stringField(event, "type")\n', "only a real provider code may be preserved"),
    ("missing acceptance type", types, "    onAccept?: (commit: (recorded: OpenAICodexCompactionResponseMetadata) => void) => void;\n", "", "published acceptance API must type-check"),
    ("unsound metadata target type", types, "websocketState?: { modelsEtag?: string }", "websocketState?: unknown", "published acceptance API must type-check"),
    ("eager baseline reset", ai, "\t\trequestContext.websocketState.lastTransport = initial.transport;", "\t\trequestContext.websocketState.lastTransport = initial.transport;\n\t\tresetCodexWebSocketAppendState(requestContext.websocketState);", "CodexCompactionChainLostError"),
    ("SSE fallback permitted", ai, "const refuseSseFallback = isCompactionWireBody(transformedBody);", "const refuseSseFallback = false;", "sse-disabled: failure must stay terminal"),
    ("cold full replay permitted", ai, "const mustChain = isCompactionWireBody(requestContext.transformedBody);", "const mustChain = false;", "cold: failure must stay terminal"),
    ("acceptance does not reset", core, "\t\tapplyAcceptedMetadata?.(acceptedMetadata);", "\t\tvoid acceptedMetadata;", "accepted summary must invalidate its old baseline"),
    ("accepted metadata dropped", ai, "\t\tapplyOpenAICodexCompactionResponseMetadata(recorded, requestContext);", "\t\tvoid recorded;", "accepted summary must commit metadata"),
    ("raw error swallowed", core, 'type === "response.incomplete" || type === "error"', 'type === "response.incomplete"', "only a real provider code may be preserved"),
]

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
    shutil.rmtree(tree / "pi-ai/src")
    incomplete = run(tree)
    assert incomplete.returncode != 0 and "Cannot find module" in incomplete.stderr, incomplete.stdout + incomplete.stderr
    print("PASS fault: incomplete runtime cannot pass", flush=True)
print(f"verify-codex-compaction-chain-fail-closed faults: {len(faults) + 1} behavioral/type faults rejected")
PY
