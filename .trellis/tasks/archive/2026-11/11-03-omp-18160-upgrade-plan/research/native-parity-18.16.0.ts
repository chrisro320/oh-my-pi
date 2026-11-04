// M3: fresh-process stamp probe + export parity of rebuilt vs upstream 18.16.0 pi-natives addons.
// Usage: bun native-parity-18.16.0.ts <rebuilt-dir> <original-dir> <out-json>
// Each addon loads in its own child process so one addon's registration cannot mask another's.
const [rebuiltDir, originalDir, outPath] = Bun.argv.slice(2);
if (!rebuiltDir || !originalDir || !outPath) throw new Error("usage: <rebuilt-dir> <original-dir> <out-json>");

const probe = `const b=require(process.argv[1]);const s=typeof b.__piNativesBuildVersion==="function"?b.__piNativesBuildVersion():null;
console.log(JSON.stringify({stamp:s,exports:Object.keys(b).sort().map(k=>k+":"+typeof b[k])}));`;

async function load(path: string) {
	const proc = Bun.spawn([process.execPath, "-e", probe, path], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) throw new Error(`load ${path} exit ${code}: ${err.slice(0, 400)}`);
	return JSON.parse(out) as { stamp: string | null; exports: string[] };
}

const result: Record<string, unknown> = {};
let ok = true;
for (const variant of ["modern", "baseline"]) {
	const file = `pi_natives.linux-x64-${variant}.node`;
	const rebuilt = await load(`${rebuiltDir}/${file}`);
	const original = await load(`${originalDir}/${file}`);
	const missing = original.exports.filter(e => !rebuilt.exports.includes(e));
	const extra = rebuilt.exports.filter(e => !original.exports.includes(e));
	const pass = rebuilt.stamp === "18.16.0" && original.stamp === "18.16.0" && missing.length === 0 && extra.length === 0;
	ok &&= pass;
	result[variant] = {
		file, pass,
		rebuilt_stamp: rebuilt.stamp, original_stamp: original.stamp,
		exports: rebuilt.exports.length, missing, extra,
		rebuilt_sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(`${rebuiltDir}/${file}`).arrayBuffer()).digest("hex"),
		original_sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(`${originalDir}/${file}`).arrayBuffer()).digest("hex"),
	};
}
await Bun.write(outPath, JSON.stringify({ status: ok ? "PASS" : "FAIL", ...result }, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
