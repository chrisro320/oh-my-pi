// Archive every outbound provider payload to its own file.
//
// The diagnostic gap this closes: a prompt-cache miss is only visible AFTER the
// response arrives, by which point the request that caused it is gone. Hash
// fingerprints (see cache-prefix-audit.ts) can say WHICH segment changed but not
// WHAT changed, and the older payload-dump probe overwrote a single file, so the
// live request preceding a miss was always already lost.
//
// This keeps one file per request, named so the pre-exit and post-resume calls
// sort next to each other and can be diffed directly:
//
//   <dir>/<epoch_ms>-<pid>-<thread>-<seq>-<kind>-<model>.json
//
// `<thread>` is the OS thread id (`node:worker_threads`, 0 on the main thread).
// 18.18.0 runs subagent sessions on worker threads that share `process.pid`, so
// without it two realms archiving in the same millisecond at the same sequence
// number would choose the same name — and the "unknown" session fallback shares
// one directory. `seq` is per realm, so the thread id is what separates them;
// the epoch prefix still orders files chronologically.
//
// Then, for the two requests straddling a resume:
//   python3 -c "..."  # or: jq -S . a.json > /tmp/a; jq -S . b.json > /tmp/b; diff /tmp/a /tmp/b
//
// Observation only: the payload is never modified. Old files are pruned by total
// bytes so a long session cannot fill the disk — 155k-token requests are ~1 MB
// each, and the newest ones are the ones a miss investigation needs.
//
// Env:
//   OMP_PAYLOAD_ARCHIVE      directory (default ~/.omp/agent/payloads)
//   OMP_PAYLOAD_ARCHIVE_MAX  byte budget for the directory (default 400 MiB)
//   OMP_PAYLOAD_ARCHIVE_OFF  set to disable without unloading the extension
// Command: /payloads
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { threadId } from "node:worker_threads";

const DIR = process.env.OMP_PAYLOAD_ARCHIVE ?? join(homedir(), ".omp", "agent", "payloads");
const MAX_BYTES = Number(process.env.OMP_PAYLOAD_ARCHIVE_MAX ?? 400 * 1024 * 1024);
/** Marker the ephemeral cache-keepalive turn puts in its virtual tail. */
const SIDE_CHANNEL_MARKER = "Ephemeral side-channel turn";
/** Tail messages scanned for that marker. The observed side turn appends two
 *  virtual messages; a small window keeps the check cheap and bounded. */
const SIDE_TAIL_SCAN = 4;

const state = { seq: 0, written: 0, lastPath: "none yet" };

/** Every archived file across all session directories, oldest first.
 *  Filenames lead with epoch ms, so sorting by name is chronological. */
function archived(): { path: string; size: number; name: string }[] {
	const out: { path: string; size: number; name: string }[] = [];
	for (const entry of readdirSync(DIR, { withFileTypes: true })) {
		const children = entry.isDirectory()
			? readdirSync(join(DIR, entry.name)).map(name => ({ name, dir: join(DIR, entry.name) }))
			: [{ name: entry.name, dir: DIR }];
		for (const child of children) {
			if (!child.name.endsWith(".json")) continue;
			const path = join(child.dir, child.name);
			try {
				out.push({ path, size: statSync(path).size, name: child.name });
			} catch {
				// Raced with another process pruning the same directory.
			}
		}
	}
	out.sort((a, b) => (a.name < b.name ? -1 : 1));
	return out;
}

/** Drop oldest files until the archive fits the byte budget. */
function prune(): void {
	const entries = archived();
	let total = entries.reduce((sum, entry) => sum + entry.size, 0);
	if (total <= MAX_BYTES) return;
	for (const entry of entries) {
		if (total <= MAX_BYTES) break;
		try {
			unlinkSync(entry.path);
			total -= entry.size;
		} catch {
			// Already gone; keep going.
		}
	}
}

const SECRET_KEY = /api.?key|jwt|token|authorization|secret/i;

/** Serialize a payload for the archive. Devin requests are protobuf messages:
 *  they carry BigInt fields (a plain JSON.stringify throws, which used to drop
 *  every Devin request silently), credentials under `metadata`, and base64 PNG
 *  frames. Credentials are redacted and image bytes reduced to length + hash so
 *  files stay small and diffable while a changed image is still visible. */
function archiveJson(payload: unknown): string {
	return JSON.stringify(payload, function (this: unknown, key: string, value: unknown) {
		if (typeof value === "bigint") return value.toString();
		if (SECRET_KEY.test(key) && typeof value === "string") return "[redacted]";
		if (key === "base64Data" && typeof value === "string") {
			return `[base64 ${value.length} chars sha256=${createHash("sha256").update(value).digest("hex").slice(0, 16)}]`;
		}
		return value;
	});
}

export default function (pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		if (process.env.OMP_PAYLOAD_ARCHIVE_OFF) return undefined;
		try {
			// One directory per session: a resume keeps the same session id, so the
			// pre-exit and post-resume requests land together while other sessions
			// running in parallel stay out of the way.
			let session = "unknown";
			try {
				const id = ctx.sessionManager?.getSessionId?.();
				if (typeof id === "string" && id.length > 0) session = id;
			} catch {
				// Session id is a convenience for grouping, never load-bearing.
			}

			// The archive also receives side requests. Two kinds, needing two
			// different discriminators:
			//  - Title generation / advisor run on ANOTHER model, so the model name
			//    in the filename separates them.
			//  - Cron cache-keepalive reuses the conversation on the SAME model with
			//    a synthetic trailing message, so only its tail marker gives it away.
			//    It also carries cache_control on that virtual tail, which makes it
			//    look exactly like "the last request before exit" when it is not —
			//    diffing it against a post-resume request compares the wrong pair.
			const payload: unknown = event.payload;
			const inner = payload !== null && typeof payload === "object" && "request" in payload ? payload.request : undefined;
			const target: object =
				inner !== null && typeof inner === "object"
					? inner
					: payload !== null && typeof payload === "object"
						? payload
						: {};

			let model = "unknown";
			if ("model" in target && typeof target.model === "string") model = target.model;
			else if ("chatModelUid" in target && typeof target.chatModelUid === "string") model = target.chatModelUid;
			const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, "_");

			// A side-channel turn appends MORE THAN ONE virtual message (observed:
			// a `<system-reminder>` naming the ephemeral turn, then a `<recap>`
			// prompt), and every one of them carries cache_control. Scanning only
			// the final message therefore misses it, so check the whole tail window.
			let kind = "main";
			if ("messages" in target && Array.isArray(target.messages)) {
				const messages = target.messages;
				for (let i = Math.max(0, messages.length - SIDE_TAIL_SCAN); i < messages.length; i++) {
					const message: unknown = messages[i];
					if (message === null || typeof message !== "object" || !("content" in message)) continue;
					const content = message.content;
					const text =
						typeof content === "string"
							? content
							: Array.isArray(content)
								? content
										.map(block =>
											block !== null && typeof block === "object" && "text" in block && typeof block.text === "string"
												? block.text
												: "",
										)
										.join(" ")
								: "";
					if (text.includes(SIDE_CHANNEL_MARKER)) {
						kind = "side";
						break;
					}
				}
			}

			const dir = join(DIR, session);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			state.seq++;
			// Zero-padded seq keeps within-realm order correct past request 9; the
			// thread id keeps two worker realms in the same millisecond apart.
			const name = `${Date.now()}-${process.pid}-${threadId}-${String(state.seq).padStart(4, "0")}-${kind}-${safeModel}.json`;
			const path = join(dir, name);
			writeFileSync(path, archiveJson(event.payload), { mode: 0o600 });
			state.written++;
			state.lastPath = path;
			prune();
		} catch {
			// A probe must never break the run.
		}
		return undefined;
	});

	pi.registerCommand("payloads", {
		description: "Payload archive: newest main-model requests per session",
		handler: async (_args, ctx) => {
			let listing = "empty";
			try {
				const entries = archived();
				const total = entries.reduce((sum, entry) => sum + entry.size, 0);
				const newest = entries.slice(-8).map(entry => `${entry.name}  ${(entry.size / 1024).toFixed(0)}K`);
				listing = `${newest.length ? newest.join("\n") : "empty"}\n(archive total ${(total / 1024 / 1024).toFixed(1)} MiB across ${entries.length} files)`;
			} catch {
				listing = "unreadable";
			}
			ctx.ui.notify(`archived ${state.written} this process\n${DIR}\n${listing}`, "info");
		},
	});
}
