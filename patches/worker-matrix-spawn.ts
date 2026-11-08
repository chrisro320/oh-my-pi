// Preserve the selected execution realm across gates' credential-free re-exec/probe children.
// Compiler/runtime subprocesses and shell mutation controllers are left untouched.
import { isAbsolute, resolve } from "node:path";
export function installMatrixSpawn(mode: "main" | "worker"): void {
	const original = Bun.spawnSync;
	const launcher = new URL("./worker-matrix-runner.ts", import.meta.url).pathname;
	const roots = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && (key.startsWith("OMP_PATCH_VERIFY_") || key === "OMP_PATCH_VERSION")));
	Bun.spawnSync = ((command: string[] | object, options?: Record<string, unknown>) => {
		if (!Array.isArray(command) || command[0] !== process.execPath || !command[1]?.endsWith(".ts") || command[1] === launcher) return original(command as never, options as never);
		const script = isAbsolute(command[1]) ? command[1] : resolve(command[1]);
		const env = options?.env as Record<string, string> | undefined;
		return original([process.execPath, launcher, mode, script, ...command.slice(2)], {
			...options, env: { ...process.env, ...roots, ...env },
		} as never);
	}) as typeof Bun.spawnSync;
}
