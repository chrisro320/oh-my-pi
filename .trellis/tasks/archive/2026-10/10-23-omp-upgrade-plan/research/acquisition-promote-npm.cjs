#!/usr/bin/env node
// One-time continuation: retain already independent official OMP bytes while
// promoting the already installed, cryptographically audited npm dependency tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sb = process.env.OMP_ACQ_SANDBOX || '/tmp/omp-upgrade-18126-01a1684f';
const meta = path.join(sb,'metadata');
const runtime = path.join(sb,'runtime');
const source = path.join(sb,'tmp/npm-verify');
const old = path.join(sb,'tmp/initial-bun-node_modules');
if (fs.existsSync(old)) throw new Error('Promotion already started; inspect state rather than rerun');
for (const name of ['runtime-closure.json','runtime-inventory.json','runtime-manifest-files.txt']) {
  fs.copyFileSync(path.join(meta,name),path.join(meta,`initial-bun-${name}`));
  fs.copyFileSync(path.join(meta,name),path.join(__dirname,`acquisition-initial-bun-${name}`));
}
fs.renameSync(path.join(runtime,'node_modules'),old);
fs.cpSync(path.join(source,'node_modules'),path.join(runtime,'node_modules'),{
  recursive:true,verbatimSymlinks:true,
  filter:src=>src !== path.join(source,'node_modules/@oh-my-pi')
});
fs.renameSync(path.join(old,'@oh-my-pi'),path.join(runtime,'node_modules/@oh-my-pi'));
fs.copyFileSync(path.join(source,'package-lock.json'),path.join(runtime,'package-lock.json'));
fs.copyFileSync(path.join(source,'package-lock.json'),path.join(meta,'package-lock.json'));
fs.renameSync(path.join(runtime,'bun.lock'),path.join(meta,'initial-bun.lock'));
const info = JSON.parse(fs.readFileSync(path.join(meta,'runtime-closure.json')));
info.lockfile = 'runtime/package-lock.json';
info.lockfile_sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime,'package-lock.json'))).digest('hex');
info.install = 'Reused completed npm install --ignore-scripts --no-audit --no-fund verification tree; copied non-OMP dependencies with independent regular files; retained all13 independently extracted verified OMP directories';
info.replaced_initial_bun_closure = 'Initial Bun tree had invalid telemetry and ONNX peer resolutions; retained initial lock and inventory as historical evidence, not selected runtime';
fs.writeFileSync(path.join(meta,'runtime-closure.json'),JSON.stringify(info,null,2)+'\n');
console.log(JSON.stringify({runtime,lockfile:info.lockfile,lockfile_sha256:info.lockfile_sha256},null,2));
