// Vision warmup for Hyper models (qwen3.8-flash / glm-5.3-flash).
//
// Hyper's vision routing is sticky per session: the first request carrying an
// image locks the session onto the vision classifier. A first image arriving
// mid-session switches the classifier and bills a full cache miss no matter
// the context size.
//
// Measured 2026-09-05 (session 01a07257, qwen3.8-flash): injecting the image
// via this extension on turn 1 only — turns 2-3 carried no image and hit
// cacheRead 26368; a real 64x64 image read on turn 4 kept hitting
// (27136 -> 27904 -> 28160, no full miss).
//
// This extension returns a `before_agent_start` custom message with a 1x1 PNG
// on the session's first turn. The message persists in session history with
// display: false (hidden in the TUI, still sent to the model), so the wire
// prefix is stable from turn 1 and later turns keep hitting the cache.
//
// Contract-conformant: the image is added via the supported
// `before_agent_start` result message, never by mutating an outbound payload
// in a payload-interceptor hook (which the backend spec forbids).
import { appendFileSync } from "node:fs";

const PNG_1X1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

const CUSTOM_TYPE = "vision-warmup";
// Shared registry on globalThis: the deployed copy and an explicit `-e` copy
// load as separate module instances, so a module-local Set would not dedupe.
// Keyed by session id so later sessions in the same process still warm.
const REGISTRY_KEY = "__ompVisionWarmupSessions__";
const registryHost = globalThis as unknown as Record<string, unknown>;
if (!(registryHost[REGISTRY_KEY] instanceof Set)) registryHost[REGISTRY_KEY] = new Set<string>();
const warmedThisProcess = registryHost[REGISTRY_KEY] as Set<string>;
const LOG_PATH = process.env.OMP_VISION_WARMUP_LOG ?? "/tmp/vision-warmup.log";
const TARGET_MODELS = new Set(
	(process.env.OMP_VISION_WARMUP_MODELS ?? "qwen3.8-flash,glm-5.3-flash").split(",").filter(Boolean),
);

function log(obj: Record<string, unknown>): void {
	try {
		appendFileSync(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n");
	} catch {
		// never break the agent loop
	}
}

type ExtensionHandler = (event: unknown, ctx?: unknown) => unknown;

export default function (pi: { on: (event: string, handler: ExtensionHandler) => void }): void {
	pi.on("before_agent_start", (_event, ctx) => {
		try {
			// Current model: ctx.model shape varies by runtime; take the first string id field.
			const modelObj = (typeof ctx === "object" && ctx !== null && "model" in ctx ? ctx.model : undefined) as
				| Record<string, unknown>
				| undefined;
			let modelName = "";
			if (typeof modelObj === "object" && modelObj !== null) {
				for (const key of ["id", "model", "modelId", "identity"]) {
					const v = modelObj[key];
					if (typeof v === "string") {
						modelName = v;
						break;
					}
				}
			}
			if (!TARGET_MODELS.has(modelName)) return undefined;

			// Already injected? Look for a persisted custom message of our type.
			const sm = (typeof ctx === "object" && ctx !== null && "sessionManager" in ctx ? ctx.sessionManager : undefined) as
				| { getEntries?: () => unknown; getSessionId?: () => unknown }
				| undefined;
			const entries = typeof sm?.getEntries === "function" ? sm.getEntries() : undefined;
			const already = Array.isArray(entries) && entries.some(entry => {
				if (typeof entry !== "object" || entry === null) return false;
				const e = entry as { type?: unknown; customType?: unknown; message?: unknown };
				if (e.type === "custom_message" && e.customType === CUSTOM_TYPE) return true;
				if (e.type !== "message") return false;
				const msg = e.message;
				return (
					typeof msg === "object" &&
					msg !== null &&
					(msg as { customType?: unknown }).customType === CUSTOM_TYPE
				);
			});
			if (already) return undefined;

			// Same-process dedupe, keyed by session: the deployed copy and an
			// explicit `-e` copy can both register handlers in one process, and
			// entries are not yet persisted mid-event, so getEntries alone cannot
			// stop the second handler. A per-session key keeps later sessions in
			// the same process warm too. (Unresolvable ids share one slot.)
			const rawSid = typeof sm?.getSessionId === "function" ? sm.getSessionId() : undefined;
			const sid = typeof rawSid === "string" ? rawSid : "unknown-session";
			if (warmedThisProcess.has(sid)) return undefined;
			warmedThisProcess.add(sid);

			log({ warmed: true, modelName });
			return {
				message: {
					customType: CUSTOM_TYPE,
					content: [{ type: "image", data: PNG_1X1, mimeType: "image/png" }],
					display: false,
				},
			};
		} catch (e) {
			log({ error: e instanceof Error ? e.message : String(e) });
			return undefined;
		}
	});

	pi.on("message_end", (event, ctx) => {
		try {
			const m = (typeof event === "object" && event !== null && "message" in event ? event.message : undefined) as
				| { role?: unknown; usage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown } }
				| undefined;
			if (typeof m !== "object" || m === null || m.role !== "assistant") return;
			const u = m.usage;
			if (typeof u !== "object" || u === null) return;
			const sm = (ctx as { sessionManager?: { getSessionId?: () => unknown } } | undefined)?.sessionManager;
			const rawId = typeof sm?.getSessionId === "function" ? sm.getSessionId() : undefined;
			log({
				session: typeof rawId === "string" ? rawId : "unknown",
				usage: {
					input: typeof u.input === "number" ? u.input : 0,
					output: typeof u.output === "number" ? u.output : 0,
					cacheRead: typeof u.cacheRead === "number" ? u.cacheRead : 0,
					cacheWrite: typeof u.cacheWrite === "number" ? u.cacheWrite : 0,
				},
			});
		} catch {
			// never break the agent loop
		}
	});
}