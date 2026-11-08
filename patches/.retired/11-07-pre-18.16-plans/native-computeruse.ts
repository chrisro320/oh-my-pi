#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type Manifest = {
  version: string;
  platform: string;
  arch: string;
  filename: string;
  artifact: string;
  sha256: string;
  stockSha256: string;
  sourcePatch: string;
  sourcePatchSha256: string;
};

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const [mode, nmArg] = process.argv.slice(2);
if (!["preflight", "apply", "check", "revert"].includes(mode) || !nmArg) {
  throw new Error("usage: bun native-computeruse.ts <preflight|apply|check|revert> <@oh-my-pi root>");
}
const manifest = JSON.parse(await readFile(join(import.meta.dir, "native-computeruse.json"), "utf8")) as Manifest;
if (manifest.version !== "18.7.0" || manifest.platform !== process.platform || manifest.arch !== process.arch
  || manifest.filename !== "pi_natives.linux-x64-modern.node") {
  throw new Error("native computeruse artifact does not match this release/host");
}
const nm = resolve(nmArg);
for (const packageName of ["pi-natives", "pi-natives-linux-x64"]) {
  const pkg = JSON.parse(await readFile(join(nm, packageName, "package.json"), "utf8"));
  if (pkg.version !== manifest.version) throw new Error(`${packageName} release mismatch`);
}
const artifact = resolve(import.meta.dir, manifest.artifact);
const sourcePatch = resolve(import.meta.dir, manifest.sourcePatch);
if (!artifact.startsWith(`${import.meta.dir}/.native-artifacts/`) || !sourcePatch.startsWith(`${import.meta.dir}/.native-sources/`)) {
  throw new Error("native artifact or source patch is outside its managed directory");
}
if (await digest(sourcePatch) !== manifest.sourcePatchSha256 || await digest(artifact) !== manifest.sha256) {
  throw new Error("native source patch/artifact digest mismatch; rebuild before deployment");
}
const target = join(nm, "pi-natives-linux-x64", manifest.filename);
const backup = join(dirname(target), `.computeruse-stock-${manifest.version}.node`);
const before = await digest(target);
if (before !== manifest.stockSha256 && before !== manifest.sha256) {
  throw new Error("refusing to overwrite an unrecognized native addon");
}
if (await exists(backup) && await digest(backup) !== manifest.stockSha256) {
  throw new Error("native rollback image digest mismatch");
}
if (before === manifest.sha256 && !await exists(backup)) {
  throw new Error("patched native addon has no verified rollback image");
}
if (mode === "check") {
  if (before !== manifest.sha256) throw new Error("native computeruse artifact is not installed");
  console.log(`APPLIED native-computeruse ${manifest.version} ${manifest.sha256}`);
} else if (mode === "preflight") {
  console.log(`native preflight: ${before === manifest.sha256 ? "applied" : "pending"}`);
} else {
  const wanted = mode === "apply" ? manifest.sha256 : manifest.stockSha256;
  if (before === wanted) {
    console.log(`SKIP native-computeruse ${mode}`);
  } else {
    if (mode === "apply" && !await exists(backup)) {
      await copyFile(target, backup, constants.COPYFILE_EXCL);
      if (await digest(backup) !== manifest.stockSha256) throw new Error("native backup verification failed");
    }
    const input = mode === "apply" ? artifact : backup;
    if (!await exists(input) || await digest(input) !== wanted) throw new Error("verified native input is unavailable");
    const temp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
    try {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(input, temp, constants.COPYFILE_EXCL);
      await chmod(temp, (await stat(target)).mode & 0o777);
      if (await digest(temp) !== wanted || await digest(target) !== before) {
        throw new Error("native image changed during deployment; refusing exchange");
      }
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
    console.log(`${mode === "apply" ? "APPLY" : "REVERT"} native-computeruse ${manifest.version}`);
  }
}
