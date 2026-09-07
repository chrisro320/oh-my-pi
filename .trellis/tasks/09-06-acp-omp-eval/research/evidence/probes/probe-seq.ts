// Sandbox-only observer for task 09-06-acp-omp-eval (GATE 0 evidence).
//
// Two jobs, both pure observation — returns undefined so the chained reduce in
// `runner.ts:1668-1694` keeps the upstream payload untouched (GATE 1 contract).
//
//   1. S1.3 evidence: archive every outbound provider body, one file per
//      request, so snapcompact frames / inline transforms can be searched for.
//   2. S1.5 evidence: append a line carrying a process-monotonic sequence
//      number at module-load time and at each handler invocation. The load
//      lines give the real registration order; the handler lines give the real
//      execution order. Neither is inferred from filenames.
//
// Env:
//   ACP_PROBE_DIR   where bodies land (default /tmp/acp-sandbox/evidence/bodies)
//   ACP_PROBE_LOG   sequence log     (default /tmp/acp-sandbox/logs/handler-seq.log)
//   ACP_PROBE_NAME  label for this instance (default "probe-seq")
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = process.env.ACP_PROBE_NAME || "probe-seq";
const DIR = process.env.ACP_PROBE_DIR || "/tmp/acp-sandbox/evidence/bodies";
const LOG = process.env.ACP_PROBE_LOG || "/tmp/acp-sandbox/logs/handler-seq.log";

// One counter per process, shared by every instance of this module that the
// loader binds. Module identity is per-path, so a second copy under a
// different path gets its own counter; the log timestamps still order them.
let seq = 0;
let requests = 0;

function log(kind: string, extra: Record<string, unknown> = {}): void {
	try {
		mkdirSync(join(LOG, ".."), { recursive: true });
		appendFileSync(
			LOG,
			`${JSON.stringify({ seq: ++seq, kind, name: NAME, pid: process.pid, at: new Date().toISOString(), ...extra })}\n`,
			{ mode: 0o600 },
		);
	} catch {
		// a probe must never break the run
	}
}

log("module_load");

export default function (pi: {
	on: (e: string, fn: (event: { payload?: unknown; model?: unknown }) => undefined) => void;
}): void {
	log("factory_called");

	pi.on("before_provider_request", event => {
		const n = ++requests;
		const payload = event.payload;
		let file: string | null = null;
		try {
			mkdirSync(DIR, { recursive: true });
			file = join(DIR, `${NAME}-${String(process.pid)}-${String(n).padStart(4, "0")}.json`);
			writeFileSync(
				file,
				JSON.stringify(
					{
						at: new Date().toISOString(),
						pid: process.pid,
						probe: NAME,
						request: n,
						keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
						payload,
					},
					null,
					1,
				),
				{ mode: 0o600 },
			);
		} catch {
			// keep observing even if the archive write fails
		}
		log("before_provider_request", { request: n, file });
		// MUST stay undefined: any non-undefined return replaces the payload.
		return undefined;
	});
}
