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
sys.path.insert(0, str(here))
from version_registry import resolve_plan

nm = Path(os.environ.get("OMP_PATCH_VERIFY_NM", str(Path.home() / ".bun/install/global/node_modules/@oh-my-pi")))
roots = {"pi-ai": Path(os.environ.get("OMP_PATCH_VERIFY_AI_ROOT", nm / "pi-ai")),
         "pi-agent-core": Path(os.environ.get("OMP_PATCH_VERIFY_CORE_ROOT", nm / "pi-agent-core"))}
ai = "pi-ai/src/providers/openai-codex-responses.ts"
core = "pi-agent-core/src/compaction/compaction-v2-streaming.ts"
channel = "pi-ai/src/providers/responses-websocket-connection.ts"
types = "pi-ai/dist/types/providers/openai-codex-responses.d.ts"
gate = here / "verify-codex-compaction-chain-fail-closed.ts"
# Every supported plan carries the non-generating chain-recovery hook and the
# two-argument acceptance hook (commit + rollback); a tree without either fails
# closed in the gate this script mutates.
plan = resolve_plan("verify-codex-compaction-chain-fail-closed-faults", roots=[roots["pi-ai"]])
acceptance_declaration = "    onAccept?: (\n        commit: (recorded: OpenAICodexCompactionResponseMetadata) => void,\n        rollback: () => void,\n    ) => void;\n"

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
    ("eager baseline reset", ai, "\t\trequestContext.websocketState.lastTransport = initial.transport;", "\t\trequestContext.websocketState.lastTransport = initial.transport;\n\t\tresetCodexWebSocketAppendState(requestContext.websocketState);", "healthy retries must retain their response baseline"),
    ("SSE fallback permitted", ai, "const refuseSseFallback = isCompactionWireBody(transformedBody);", "const refuseSseFallback = false;", "compaction cannot replay over SSE without its append baseline"),
    ("cold full replay permitted", ai, "const mustChain = isCompactionWireBody(requestContext.transformedBody);", "const mustChain = false;", "cold: every sent compaction must chain"),
    ("acceptance does not reset", core, "\t\tapplyAcceptedMetadata?.(acceptedMetadata);", "\t\tvoid acceptedMetadata;", "accepted summary must invalidate its old baseline"),
    ("accepted metadata dropped", ai, "\t\t\tapplyOpenAICodexCompactionResponseMetadata(recorded, requestContext);", "\t\tvoid recorded;", "accepted summary must commit metadata"),
    ("raw error swallowed", core, 'type === "response.incomplete" || type === "error"', 'type === "response.incomplete"', "only a real provider code may be preserved"),
]
if plan.since("18.18.0"):
    # The 18.18.0 transport wraps ResponsesWebSocketConnection. Each mutation
    # reintroduces one way the lane can silently spend money or cut off another
    # request; the anchors carry their exact tabs and must exist exactly once.
    faults.extend([
        ("busy socket torn down instead of refused", ai,
         "\t\t\t\tif (error instanceof CodexWebSocketBusyError) {\n",
         "\t\t\t\tif (false as boolean) {\n",
         "Missing expected rejection"),
        ("hook may drop the chain", ai,
         "(websocketRequest.previous_response_id === undefined ||\n",
         "(false ||\n",
         "Missing expected rejection"),
        ("replaced socket may carry the chain", ai,
         "\t\t\t\twebsocketState.connection !== websocketConnection ||\n\t\t\t\t!websocketConnection.isOpen())\n",
         "\t\t\t\tfalse)\n",
         "Missing expected rejection"),
        ("peer close not reported", channel,
         "\t\tthis.#options.onRetired?.({ reason, peer });\n",
         "",
         "timed out waiting for the peer close"),
        ("local close reported as peer", channel,
         "\t\tthis.#options.onRetired?.({ reason, peer });\n",
         "\t\tthis.#options.onRetired?.({ reason, peer: peer ?? `peer (code 1000: ${reason})` });\n",
         "local close: our own reason"),
        ("sticky websocket disable", ai,
         "\tif (!state) return false;\n\t// Env val > Preference",
         "\tif (!state || state.fallbackCount > 0) return false;\n\t// Env val > Preference",
         "websocket transport unavailable"),
        ("sticky websocket disable field returns", ai,
         "export class CodexCompactionChainLostError extends Error {",
         "// disableWebsocket\nexport class CodexCompactionChainLostError extends Error {",
         "a sticky websocket disable would silently re-enable SSE fallback"),
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
    # The lane-trace gate owns the "no OpenAI-Beta on the compaction HTTP lane"
    # assertion (18.17 dropped the header from Codex HTTP). Reintroducing the
    # assignment into the shared header builder must turn it red.
    lane_gate = here / "verify-compaction-lane-trace.ts"
    lane_control = run(tree, lane_gate)
    assert lane_control.returncode == 0, lane_control.stdout + lane_control.stderr
    print("lane-trace fault control PASS", flush=True)
    lane_target = tree / core
    lane_original = lane_target.read_bytes()
    try:
        replace(
            lane_target,
            "\treturn headers;\n}\n\ninterface CompactionV2CollectionState {",
            "\theaders[\"OpenAI-Beta\"] = \"responses=experimental\";\n\treturn headers;\n}\n\ninterface CompactionV2CollectionState {",
        )
        result = run(tree, lane_gate)
        output = result.stdout + result.stderr
        assert result.returncode != 0, "OpenAI-Beta reintroduced: broken behavior stayed green"
        assert "no OpenAI-Beta header may be sent on the compaction HTTP lane" in output, f"failed for the wrong reason\n{output}"
        print("PASS fault: OpenAI-Beta reintroduced on the compaction HTTP lane", flush=True)
    finally:
        lane_target.write_bytes(lane_original)
    shutil.rmtree(tree / "pi-ai/src")
    incomplete = run(tree)
    assert incomplete.returncode != 0 and "Cannot find module" in incomplete.stderr, incomplete.stdout + incomplete.stderr
    print("PASS fault: incomplete runtime cannot pass", flush=True)
print(f"verify-codex-compaction-chain-fail-closed faults: {len(faults) + 3} behavioral/type faults rejected")
PY
