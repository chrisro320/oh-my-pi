#!/usr/bin/env python3
"""Run Fusion behavior mutations in complete, disposable package copies."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOTS = {
    "AGENT": "pi-coding-agent",
    "CORE": "pi-agent-core",
    "AI": "pi-ai",
    "CATALOG": "pi-catalog",
    "SNAPCOMPACT": "snapcompact",
}
FAULTS = [
    ("field6", "pi-catalog/src/discovery/devin-proto.ts", '{ no: 6, name: "fusionModelRouterUid", kind: "string" }', '{ no: 7, name: "fusionModelRouterUid", kind: "string" }', "internal assignment must encode router UID in raw field 6"),
    ("child-field5", "pi-ai/src/providers/devin.ts", "{ fusionModelRouterUid: fusion.modelRouterUid }", "{ fusionModelRouterUid: fusion.modelRouterUid, chatMessagePrompt: buildRouterPrompt(turn.messages) }", "native child assignment omits field 5 on the wire"),
    ("mapping", "pi-ai/src/stream.ts", "devinFusion: options?.devinFusion,", "devinFusion: undefined,", "public stream mapping must preserve child routing"),
    ("child-jwt", "pi-ai/src/providers/devin.ts", "assignment && !options?.devinFusion ? { modelAssignmentJwt:", "assignment ? { modelAssignmentJwt:", "native child chat must not send"),
    ("lead-cache", "pi-ai/src/providers/devin.ts", "previous instanceof DevinFusionAssignmentState &&", "false && previous instanceof DevinFusionAssignmentState &&", "lead assignment must survive repeated requests"),
    ("child-cache", "pi-ai/src/providers/devin.ts", "previous instanceof DevinFusionAssignmentState &&", "!fusion && previous instanceof DevinFusionAssignmentState &&", "child assignment must survive repeated requests within a handoff"),
    ("auth-scope", "pi-ai/src/providers/devin.ts", "this.apiKey === apiKey && this.baseUrl", "this.baseUrl", "changed credentials must invalidate"),
    ("close", "pi-ai/src/providers/devin.ts", "this.controller.abort();\n\t\tthis.assignment = undefined;", "", "closed provider state must not reuse"),
    ("cache-upgrade", "pi-catalog/src/model-cache.ts", "const MODEL_MATERIALIZATION_VERSION = 2;", "const MODEL_MATERIALIZATION_VERSION = 1;", "pre-Fusion materialized rows must trigger fresh discovery"),
    ("returned-uid", "pi-ai/src/providers/devin.ts", "const chatModelUid = assignment?.modelUid ??", "const chatModelUid = model.id ??", "Fusion composite must be assigned before chat"),
    ("published-type", "pi-ai/dist/types/types.d.ts", "    devinFusion?: {", "    removedDevinFusion?: {", "Fusion declaration consumer failed"),
]


def main() -> None:
    selected = os.environ.get("OMP_PATCH_VERIFY_NM")
    if not selected:
        raise SystemExit("OMP_PATCH_VERIFY_NM must select a complete isolated tree")
    root = Path(selected).resolve()
    bun = shutil.which("bun")
    if not bun:
        raise SystemExit("Bun is required")
    gate = Path(__file__).with_name("verify-devin-fusion.ts").resolve()
    results = []
    with tempfile.TemporaryDirectory(prefix="fusion-faults-") as directory:
        target = Path(directory)
        for key, package in ROOTS.items():
            source = Path(os.environ.get(f"OMP_PATCH_VERIFY_{key}_ROOT", root / package))
            shutil.copytree(source, target / package)
        deps = target / "node_modules"
        scope = deps / "@oh-my-pi"
        scope.mkdir(parents=True)
        source_deps = root / "node_modules" if (root / "node_modules").is_dir() else root.parent
        for dependency in source_deps.iterdir():
            if dependency.name != "@oh-my-pi":
                (deps / dependency.name).symlink_to(dependency, target_is_directory=dependency.is_dir())
        source_scope = source_deps / "@oh-my-pi"
        for package in source_scope.iterdir():
            source = target / package.name if package.name in ROOTS.values() else package
            (scope / package.name).symlink_to(source, target_is_directory=source.is_dir())
        env = {**os.environ, "OMP_PATCH_VERIFY_NM": str(target), "OMP_FUSION_SCENARIO": "protocol"}
        env.pop("OMP_FUSION_RESTORE_FILE", None)
        env.pop("OMP_FUSION_WORKSPACE", None)
        env.pop("OMP_FUSION_EVIDENCE_DIR", None)
        for key, package in ROOTS.items():
            env[f"OMP_PATCH_VERIFY_{key}_ROOT"] = str(target / package)

        def run(case: str, expected: str | None, overrides: dict[str, str] | None = None) -> None:
            result = subprocess.run([bun, str(gate)], env={**env, **(overrides or {})},
                                    cwd=target, capture_output=True, text=True, timeout=90)
            output = result.stdout + result.stderr
            if expected is None:
                assert result.returncode == 0, output
            else:
                assert result.returncode != 0 and expected in output, (case, result.returncode, output)
            results.append({"case": case, "exitCode": result.returncode, "expectedFailure": expected, "output": output})
            print(f"PASS {case}: {'control accepted' if expected is None else 'fault rejected'}", flush=True)

        run("unmutated-control", None)
        for name, relative, before, after, expected in FAULTS:
            path = target / relative
            original = path.read_text()
            assert original.count(before) == 1, f"{name}: mutation anchor must be unique"
            try:
                path.write_text(original.replace(before, after))
                run(name, expected)
            finally:
                path.write_text(original)
        run("missing-runtime", "Cannot find module", {"OMP_PATCH_VERIFY_AI_ROOT": str(target / "missing-runtime")})
    evidence = os.environ.get("OMP_FUSION_FAULT_EVIDENCE")
    if evidence:
        evidence_path = Path(evidence).resolve()
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_path.write_text(json.dumps(results, indent=2) + "\n")
    print("PASS native Fusion protocol fault matrix")


if __name__ == "__main__":
    main()
