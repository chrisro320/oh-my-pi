#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const version = "18.7.0";
const commit = "e0fc1cf4ea354b445a359b37fa5eb58deaa85598";
const filename = "pi_natives.linux-x64-modern.node";
const stockSha256 = "c856da931df73da78a26e57747092e74ffebc114e816695cacfb71a61bd1a5e9";
const sourcePatch = ".native-sources/18.7.0/0097-computeruse.patch";
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("this native computeruse build targets Linux x64 only");
}
const source = process.argv[2] && resolve(process.argv[2]);
const driver = process.argv[3] && resolve(process.argv[3]);
if (!source || !driver) throw new Error("usage: bun build-native-computeruse.ts <verified v18.7.0 source> <isolated napi-cli driver>");
const pkg = JSON.parse(await readFile(join(source, "packages/natives/package.json"), "utf8"));
const cliPkg = JSON.parse(await readFile(join(driver, "node_modules/@napi-rs/cli/package.json"), "utf8"));
if (pkg.version !== version || cliPkg.version !== "3.7.2") throw new Error("source or NAPI CLI release mismatch");

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const patchPath = join(import.meta.dir, sourcePatch);
const probe = Bun.spawn(["patch", "--dry-run", "--reverse", "--fuzz=0", "-p1", "-d", source], {
  stdin: Bun.file(patchPath), stdout: "pipe", stderr: "pipe",
});
if (await probe.exited !== 0) {
  throw new Error(`the source does not carry the complete native patch: ${await new Response(probe.stdout).text()}`);
}
process.env.PCRE2_SYS_STATIC = "1";
process.env.RUSTFLAGS = "-C target-cpu=x86-64-v3";
process.env.CARGO_BUILD_JOBS ??= "6";
process.env.PATH = `${join(driver, "tools/usr/bin")}:${process.env.PATH ?? ""}`;
const { NapiCli } = await import(join(driver, "node_modules/@napi-rs/cli/dist/index.js"));
const outputDir = join(import.meta.dir, ".native-artifacts", version);
await mkdir(outputDir, { recursive: true });
const build = await new NapiCli().build({
  cwd: source,
  manifestPath: join(source, "crates/pi-natives/Cargo.toml"),
  packageJsonPath: join(source, "packages/natives/package.json"),
  outputDir,
  platform: true,
  noJsBinding: true,
  dts: "index.d.ts",
  profile: "ci",
  cargoOptions: ["--locked"],
});
const outputs = await build.task;
const nodes = outputs.filter((output: { kind: string }) => output.kind === "node");
if (nodes.length !== 1) throw new Error("expected exactly one compiled native addon");
const { stampNativeVersion } = await import(join(source, "scripts/stamp-native-version.ts"));
await stampNativeVersion(nodes[0].path, version);
const artifactPath = join(outputDir, filename);
if (nodes[0].path !== artifactPath) await copyFile(nodes[0].path, artifactPath);
const probeAddon = Bun.spawn([process.execPath, "-e", "const n=require(process.argv[1]);if(n.__piNativesBuildVersion()!==process.argv[2])process.exit(1);", artifactPath, version], {
  stdout: "inherit", stderr: "inherit",
});
if (await probeAddon.exited !== 0) throw new Error("compiled native addon failed its release identity probe");
const manifest = {
  version, upstreamCommit: commit, platform: process.platform, arch: process.arch,
  filename, artifact: `.native-artifacts/${version}/${filename}`,
  sha256: await digest(artifactPath), stockSha256, sourcePatch,
  sourcePatchSha256: await digest(patchPath),
  cargoLockSha256: await digest(join(source, "Cargo.lock")),
  compiler: (await new Response(Bun.spawn(["rustc", "--version"], { cwd: source, stdout: "pipe" }).stdout).text()).trim(),
};
await writeFile(join(import.meta.dir, "native-computeruse.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
