// @omp-managed-extension
// Explicit unlock for an unresolved OAuth refresh exchange.
//
// Command: /auth-unlock [provider]        (default provider: anthropic)
//
// When a token refresh fails in a way that may have reached the provider, the
// runtime keeps a durable "unresolved exchange" marker and refuses to replay the
// rotating refresh token (at-most-once). This command is the supported key:
//   1. inspect the marker (redacted) and capture its opaque fence,
//   2. run a credential-free TLS preflight from this very process,
//   3. ask the user to confirm,
//   4. call the runtime's fenced unlock-and-refresh exactly once.
// It never prints tokens or account identifiers, never disables or deletes the
// credential, and never bypasses TLS verification. The release logic itself
// lives in the runtime (patch family 0090); this file only drives it.
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import type { OAuthRefreshUnlockInspection, OAuthRefreshUnlockResult } from "@oh-my-pi/pi-ai";

const DEFAULT_PROVIDER = "anthropic";

// Unauthenticated GET to a POST-only token endpoint. Any completed HTTPS
// response (normally HTTP 405) proves the TLS handshake works in this process.
const PREFLIGHT_URLS: Record<string, string> = {
	anthropic: "https://api.anthropic.com/v1/oauth/token",
};
const PREFLIGHT_TIMEOUT_MS = 15_000;

async function tlsPreflight(url: string): Promise<{ ok: true; status: number } | { ok: false; error: string }> {
	try {
		// No headers beyond defaults, no body, no credentials.
		const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
		await response.body?.cancel();
		return { ok: true, status: response.status };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function formatExpiry(expiresAt: number | undefined): string {
	return typeof expiresAt === "number" && Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : "unknown";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("auth-unlock", {
		description: "Unlock a stuck OAuth refresh exchange for one provider (explicit, fenced, one refresh)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const notify = (message: string, level: "info" | "error" | "warning" = "info") => ctx.ui.notify(message, level);
			const provider = (args || "").trim().split(/\s+/)[0] || DEFAULT_PROVIDER;

			if (!ctx.hasUI) {
				notify("auth-unlock: refused, an interactive confirmation is required (no UI in this mode)", "error");
				return;
			}
			// Older builds lack the fenced API; the runtime check keeps the command honest there.
			const { oauth } = ctx.modelRegistry.authStorage;
			if (typeof oauth.inspectUnresolvedRefresh !== "function" || typeof oauth.unlockAndRefreshStored !== "function") {
				notify("auth-unlock: unsupported runtime (the fenced unlock API is not present in this omp build)", "error");
				return;
			}
			const preflightUrl = PREFLIGHT_URLS[provider];
			if (!preflightUrl) {
				notify(`auth-unlock: refused, no TLS preflight endpoint is known for provider "${provider}"`, "error");
				return;
			}

			// 1. Inspect (read-only, redacted) and capture the fence BEFORE asking the user.
			let inspected: OAuthRefreshUnlockInspection;
			try {
				inspected = await oauth.inspectUnresolvedRefresh(provider);
			} catch (error) {
				notify(`auth-unlock: inspection failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (!inspected.eligible || !inspected.fence) {
				notify(`auth-unlock: nothing to unlock for ${provider} (${inspected.reason})`, "info");
				return;
			}
			if (inspected.holdsUnstagedResult) {
				notify(
					"auth-unlock: refused, this process still holds an unsaved refresh result for this credential; " +
						"let the normal refresh persist it first",
					"error",
				);
				return;
			}

			// 2. Credential-free TLS preflight from the live process.
			const preflight = await tlsPreflight(preflightUrl);
			if (!preflight.ok) {
				notify(
					`auth-unlock: refused, TLS preflight failed in this process (${preflight.error}). ` +
						"Fix the TLS path first; unlocking now would only create another unresolved exchange.",
					"error",
				);
				return;
			}

			// 3. Explicit confirmation.
			const confirmed = await ctx.ui.confirm(
				`Unlock ${provider} refresh?`,
				[
					`Credential #${inspected.credentialId ?? "?"}, access token expiry ${formatExpiry(inspected.expiresAt)}.`,
					"This releases the stuck refresh marker and performs ONE refresh with the stored refresh token.",
					"Close or idle every other omp process that uses this login before continuing.",
				].join("\n"),
			);
			if (!confirmed) {
				notify("auth-unlock: cancelled, nothing changed", "info");
				return;
			}

			// 4. One fenced unlock-and-refresh.
			let result: OAuthRefreshUnlockResult;
			try {
				result = await oauth.unlockAndRefreshStored(provider, { fence: inspected.fence });
			} catch (error) {
				notify(`auth-unlock: failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			switch (result.outcome) {
				case "refreshed":
					notify(`auth-unlock: refreshed ${provider}; new access token expires ${formatExpiry(result.expiresAt)}`, "info");
					break;
				case "staged-result-recovered":
					notify(`auth-unlock: recovered a previously saved refresh result for ${provider}; no new request was sent`, "info");
					break;
				case "nothing-to-unlock":
					notify(`auth-unlock: nothing to unlock for ${provider}`, "info");
					break;
				case "fence-mismatch":
					notify("auth-unlock: the refresh state changed after you looked; no change was made, run the command again", "warning");
					break;
				default:
					notify(
						`auth-unlock: refresh did not complete${result.error ? ` (${result.error})` : ""}. ` +
							"A new unresolved marker may exist; fix TLS first, then run the command again.",
						"error",
					);
			}
		},
	});
}
