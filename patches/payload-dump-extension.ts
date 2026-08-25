// Diagnostic probe for prompt-cache investigations.
//
// Dumps the outbound provider payload (system blocks + tools + messages) via the
// official `before_provider_request` extension seam — no dist patching needed.
// `OMP_DUMP_EXIT` makes the process exit before the request is sent, so a probe
// costs zero provider quota.
//
// Usage:
//   OMP_DUMP=/tmp/a.json OMP_DUMP_EXIT=1 \
//     omp --no-title -e patches/payload-dump-extension.ts --resume <session.jsonl>
//
// Then diff the `system` array across runs: any byte change there invalidates
// the provider's prompt-cache prefix and forces full re-billing.
import { writeFileSync } from "node:fs";

export default function (pi: { on: (e: string, fn: (event: { payload: unknown }) => void) => void }): void {
	pi.on("before_provider_request", event => {
		try {
			const p = event.payload;
			writeFileSync(
				process.env.OMP_DUMP || "/tmp/omp-payload-dump.json",
				JSON.stringify({
					at: new Date().toISOString(),
					pid: process.pid,
					keys: p && typeof p === "object" ? Object.keys(p) : [],
					payload: p,
				}),
				{ mode: 0o600 },
			);
		} catch {
			// a probe must never break the run
		}
		if (process.env.OMP_DUMP_EXIT) process.exit(0);
	});
}
