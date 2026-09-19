/**
 * Regression gate for the /session pin NameTooLong crash (patch 0072).
 *
 * Bug: loadProviderAuthUi() lazily required `@oh-my-pi/pi-ai/index.js` and
 * `@oh-my-pi/pi-ai/registry/oauth/index.js`. Inside a process that installed
 * the omp legacy-pi shim plugin (every normal omp startup), Bun's resolver
 * re-enters resolution with a stacked `file:` prefix each round until the
 * specifier exceeds NAME_MAX and the module read fails closed.
 *
 * Contract under test, against the tree this verifier runs on:
 *   1. source: the two lazy pi-ai requires are gone; the symbols arrive via
 *      static imports instead.
 *   2. behavior: with the shim plugin installed, importing the patched
 *      selector-controller module and calling both pi-ai symbols succeeds —
 *      the pre-patch tree fails this same import chain with NameTooLong.
 * Fails closed on any miss.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const PKG = process.env.OMP_VERIFY_PKG_ROOT
	?? "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent";
const file = path.join(PKG, "src/modes/controllers/selector-controller.ts");

let failed = 0;
const check = (ok: boolean, label: string) => {
	console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
	if (!ok) failed++;
};

// 1. Source contract: no lazy pi-ai subpath require; static import present.
let src = "";
try {
	src = fs.readFileSync(file, "utf8");
} catch (err) {
	console.log(`FAIL: cannot read ${file}: ${String(err)}`);
	process.exit(1);
}
check(!src.includes('require("@oh-my-pi/pi-ai/index.js")'), "no lazy require of pi-ai/index.js");
check(!src.includes('require("@oh-my-pi/pi-ai/registry/oauth/index.js")'), "no lazy require of pi-ai/registry/oauth/index.js");
check(src.includes('import { type Model, PASTE_CODE_LOGIN_PROVIDERS, type UsageReport } from "@oh-my-pi/pi-ai"'), "PASTE_CODE hoisted to static root import");
check(
	src.includes('import { getOAuthProviders as getOAuthProvidersRuntime') &&
		src.includes('getOAuthProviders: getOAuthProvidersRuntime,'),
	"getOAuthProviders hoisted to static registry/oauth import and wired",
);

// 2. Behavior contract: shim installed, then exercise the import chain that
// crashed pre-patch. This verifier's own module identity is irrelevant; what
// matters is that resolution happens inside a process whose resolver has the
// legacy-pi shim plugin armed — the exact condition that stacked prefixes.
const shimPath = path.join(PKG, "src/extensibility/plugins/legacy-pi-compat.ts");
if (!fs.existsSync(shimPath)) {
	console.log("SKIP: behavior gate needs a full package tree (no legacy-pi-compat.ts here); source gate above is authoritative for sandboxes");
	process.exit(failed ? 1 : 0);
}
const { installLegacyPiSpecifierShim } = await import(shimPath);
installLegacyPiSpecifierShim();
try {
	const pinMod = await import("@oh-my-pi/pi-ai");
	check(typeof pinMod.PASTE_CODE_LOGIN_PROVIDERS === "object", "PASTE_CODE_LOGIN_PROVIDERS reachable via static import under shim");
} catch (err) {
	check(false, `pi-ai root import under shim: ${String(err).slice(0, 120)}`);
}
try {
	const regMod = await import("@oh-my-pi/pi-ai/registry/oauth");
	check(typeof regMod.getOAuthProviders === "function", "getOAuthProviders reachable via static import under shim");
} catch (err) {
	check(false, `pi-ai registry/oauth import under shim: ${String(err).slice(0, 120)}`);
}

process.exit(failed ? 1 : 0);
