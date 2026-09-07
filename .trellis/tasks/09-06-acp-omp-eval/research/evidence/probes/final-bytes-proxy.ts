// S1.6 / G0.4 observation point for task 09-06-acp-omp-eval.
//
// `before_provider_request` is NOT the final HTTP body: the adapter still runs
// `toWellFormedDeep` and the fetch wrapper can add headers afterwards. This
// plain-HTTP reverse proxy sits where the bytes actually leave the process, so
// what it records IS the final wire form.
//
// Wiring: sandbox `models.yml` points `providers.hyper.baseUrl` at
// http://127.0.0.1:<PORT>/v1 instead of the real upstream. No TLS interception,
// no custom CA, no host source change.
//
// Env:
//   FBP_PORT      listen port (default 8899)
//   FBP_UPSTREAM  upstream origin (default https://hyper.charm.land)
//   FBP_DIR       where captures land (default /tmp/acp-sandbox/evidence/final)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.FBP_PORT || 8899);
const UPSTREAM = (process.env.FBP_UPSTREAM || "https://hyper.charm.land").replace(/\/+$/, "");
const DIR = process.env.FBP_DIR || "/tmp/acp-sandbox/evidence/final";

mkdirSync(DIR, { recursive: true });
let n = 0;

// Authorization must never reach disk. Everything else is evidence.
const REDACT: Record<string, true> = {
	authorization: true,
	"proxy-authorization": true,
	"api-key": true,
	"x-api-key": true,
	cookie: true,
};

function snapshotHeaders(h: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of h) out[k] = REDACT[k.toLowerCase()] ? `<redacted len=${v.length}>` : v;
	return out;
}

const server = Bun.serve({
	port: PORT,
	hostname: "127.0.0.1",
	idleTimeout: 240,
	async fetch(req) {
		const seq = ++n;
		const url = new URL(req.url);
		const target = `${UPSTREAM}${url.pathname}${url.search}`;
		// Read the body once, archive it, then replay it upstream.
		const bodyText = req.method === "GET" || req.method === "HEAD" ? null : await req.text();
		// Re-create the dir on every write: clearing captures between runs
		// otherwise leaves this ENOENT-ing, which turns into 500s and makes the
		// host retry the same turn until it burns quota.
		try {
			mkdirSync(DIR, { recursive: true });
		} catch {
			// fall through; the write below reports the real failure
		}
		// The RAW bytes are the evidence. A parsed-and-reserialized body only
		// proves structural equality, so the untouched text is written to its own
		// `.body` file and hashed there; the `.json` sidecar carries metadata and
		// the digest, never a reparsed copy standing in for the original.
		const rawName = `final-${String(seq).padStart(4, "0")}`;
		let rawSha = "-";
		if (bodyText !== null) {
			rawSha = new Bun.CryptoHasher("sha256").update(bodyText).digest("hex");
			try {
				writeFileSync(join(DIR, `${rawName}.body`), bodyText, { mode: 0o600 });
			} catch {
				// metadata below still records the digest and length
			}
		}
		try {
			writeFileSync(
				join(DIR, `${rawName}.json`),
				JSON.stringify(
					{
						at: new Date().toISOString(),
						seq,
						method: req.method,
						target,
						headers: snapshotHeaders(req.headers),
						bodyBytes: bodyText === null ? 0 : Buffer.byteLength(bodyText),
						rawSha256: rawSha,
						rawFile: bodyText === null ? null : `${rawName}.body`,
					},
					null,
					1,
				),
				{ mode: 0o600 },
			);
		} catch (e) {
			writeFileSync(join(DIR, `${rawName}.err`), `${req.method} ${target}\n[archive error: ${String(e)}]\n`, { mode: 0o600 });
		}
		console.log(`[fbp] #${seq} ${req.method} ${url.pathname} bytes=${bodyText === null ? 0 : Buffer.byteLength(bodyText)}`);
		// `host` MUST NOT be forwarded: Bun resolves the connection target from
		// it, so passing `127.0.0.1:8899` upstream makes an https request dial
		// 127.0.0.1:443 and fail with ConnectionRefused. The other names here
		// are hop-by-hop and meaningless to the upstream connection.
		const fwd = new Headers(req.headers);
		for (const drop of ["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "content-length"]) {
			fwd.delete(drop);
		}
		const upstream = await fetch(target, {
			method: req.method,
			headers: fwd,
			body: bodyText,
			redirect: "manual",
		});
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: upstream.headers,
		});
	},
});

console.log(`[fbp] listening on http://127.0.0.1:${server.port} -> ${UPSTREAM}, captures in ${DIR}`);
