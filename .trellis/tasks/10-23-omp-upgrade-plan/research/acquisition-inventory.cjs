#!/usr/bin/env node
// Finish only the previously installed acquisition closure: no install, network,
// product execution or pristine mutation. Recover the completed npm crypto audit
// and bind its cached attestation bytes to the independently saved provenance.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sb = process.env.OMP_ACQ_SANDBOX || '/tmp/omp-upgrade-18126-01a1684f';
const research = __dirname;
const npmRoot = path.dirname(path.dirname(fs.realpathSync('/home/chris/.local/bin/npm')));
const Arborist = require(path.join(npmRoot, 'node_modules/@npmcli/arborist'));
const cacache = require(path.join(npmRoot, 'node_modules/cacache'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, x) => fs.writeFileSync(p, JSON.stringify(x, null, 2) + '\n');
const meta = path.join(sb, 'metadata');
const cache = path.join(sb, 'cache/npm/_cacache');
const runtime = path.join(sb, 'runtime');
const nm = path.join(runtime, 'node_modules');
const assert = (ok, message) => { if (!ok) throw new Error(message); };

async function main() {
  const status = readJSON(path.join(meta, 'npm-signatures.json'));
  assert(status.npm_audit_signatures_exit === 0, 'Previous official crypto audit did not pass');
  const logPath = path.join(sb, 'cache/npm/_logs/2026-10-23T11_48_13_977Z-debug-0.log');
  const log = fs.readFileSync(logPath, 'utf8');
  const npmLock = readJSON(path.join(runtime, 'package-lock.json'));
  const archives = readJSON(path.join(meta, 'archive-manifest.json'));
  const provenance = readJSON(path.join(meta, 'provenance.json'));
  const cacheEntries = await cacache.ls(cache);
  const subjects = [];
  for (const archive of archives.archives) {
    const name = archive.name;
    const basename = name.split('/')[1];
    const url = `https://registry.npmjs.org/-/npm/v1/attestations/@oh-my-pi%2f${basename}@18.12.6`;
    assert(log.includes(`GET 200 ${url} `), `Official audit did not fetch ${url}`);
    const entry = Object.values(cacheEntries).find(x => x.key.endsWith(url));
    assert(entry, `Missing official audit cached bundle: ${name}`);
    const cached = (await cacache.get(cache, entry.key)).data;
    const original = fs.readFileSync(path.join(meta, `attestations/${basename}-18.12.6.json`));
    assert(cached.equals(original), `Official audit bundle differs from content-checked bundle: ${name}`);
    const bundles = JSON.parse(cached).attestations;
    const slsa = bundles.find(a => a.predicateType === 'https://slsa.dev/provenance/v1');
    assert(slsa, `Missing SLSA v1: ${name}`);
    const statement = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64'));
    const digest = Buffer.from(archive.integrity.slice('sha512-'.length), 'base64').toString('hex');
    assert(statement.subject[0].name === `pkg:npm/%40oh-my-pi/${basename}@18.12.6`, `Wrong SLSA subject: ${name}`);
    assert(statement.subject[0].digest.sha512 === digest, `Wrong SLSA digest: ${name}`);
    const source = statement.predicate.buildDefinition.resolvedDependencies.find(x => x.digest?.gitCommit === archives.pinned_commit);
    assert(source, `Missing pinned source: ${name}`);
    const lock = npmLock.packages[`node_modules/${name}`];
    assert(lock.version === '18.12.6' && lock.integrity === archive.integrity, `Official audited tree differs: ${name}`);
    subjects.push({name, version:lock.version, official_audit_endpoint:url,
      bundle_sha256:sha(cached), bundle_byte_identical_to_saved_content_check:true,
      subject:statement.subject[0], source, npm_audited_integrity:lock.integrity});
  }

  const tree = await new Arborist({path:runtime}).loadActual();
  const inventory = [];
  const errors = [];
  const omitted = [];
  const audited = new Set(Object.values(npmLock.packages).filter(x => x.name || x.version)
    .map(x => `${x.name || ''}@${x.version}`));
  // Lock entries normally omit name; use their node_modules location instead.
  for (const [loc,p] of Object.entries(npmLock.packages)) {
    if (loc) audited.add(`${p.name || loc.split('node_modules/').at(-1)}@${p.version}`);
  }
  for (const node of tree.inventory.values()) {
    if (node === tree) continue;
    const p = node.package;
    const edges = [];
    for (const edge of node.edgesOut.values()) {
      const detail = {name:edge.name, spec:edge.spec, type:edge.type,
        resolved:edge.to?.location || null, valid:edge.valid};
      edges.push(detail);
      if (!edge.valid) {
        if (edge.optional && !edge.to) omitted.push({from:node.location,...detail});
        else errors.push({from:node.location,...detail,error:edge.error});
      }
    }
    inventory.push({name:p.name,version:p.version,path:node.location,
      in_official_crypto_audited_tree:audited.has(`${p.name}@${p.version}`), dependencies:edges});
  }
  for (const edge of tree.edgesOut.values()) {
    if (!edge.valid) errors.push({from:'.',name:edge.name,error:edge.error});
  }
  const omp = inventory.filter(x => x.name.startsWith('@oh-my-pi/'));
  assert(omp.length === 13 && omp.every(x => x.version === '18.12.6' && x.path === `node_modules/${x.name}`), 'OMP closure mismatch/nested copies');

  const lockBytes = fs.readFileSync(path.join(runtime, 'package-lock.json'));
  const lockMismatch = inventory.filter(x => {
    const entry = npmLock.packages[x.path];
    return !entry || entry.version !== x.version;
  });
  let files = 0, dirs = 0, links = 0, maxLinks = 0;
  const lines = [], aliases = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name), rel = path.relative(nm, abs);
      const st = fs.lstatSync(abs), mode = (st.mode & 0o7777).toString(8).padStart(4,'0');
      if (st.isSymbolicLink()) {
        links++;
        const target = fs.realpathSync(abs);
        if (!target.startsWith(nm + path.sep)) aliases.push({path:rel,target});
        lines.push(`${mode} symlink ${fs.readlinkSync(abs)}  ${rel}`);
      } else if (st.isDirectory()) {
        dirs++; lines.push(`${mode} directory  ${rel}`); walk(abs);
      } else if (st.isFile()) {
        files++; maxLinks=Math.max(maxLinks,st.nlink);
        if (st.nlink !== 1) aliases.push({path:rel,hardlink_count:st.nlink});
        lines.push(`${mode} ${sha(fs.readFileSync(abs))}  ${rel}`);
      } else aliases.push({path:rel,type:'non-regular'});
    }
  }
  walk(nm);
  lines.sort();
  const listing = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(meta,'runtime-manifest-files.txt'), listing);
  const runtimeOnly = inventory.filter(x => !x.in_official_crypto_audited_tree).map(({name,version})=>({name,version}));
  const result = {runtime, package_count:inventory.length, omp_package_count:omp.length,
    lockfile_sha256:sha(lockBytes), lock_mismatches:lockMismatch, dependency_errors:errors,
    omitted_optional_dependencies:omitted, runtime_only_not_in_crypto_audited_tree:runtimeOnly,
    files, directories:dirs, symlinks:links, maximum_regular_file_link_count:maxLinks,
    external_code_or_hardlink_aliases:aliases, tree_manifest_sha256:sha(listing),
    tree_manifest:'runtime-manifest-files.txt', packages:inventory.sort((a,b)=>a.path.localeCompare(b.path))};
  save(path.join(meta,'runtime-inventory.json'),result);
  const urls = [...new Set([...log.matchAll(/https:\/\/[^\s]+/g)].map(x=>x[0]))].sort();
  const cryptoResult = {...status, recovered_without_rerunning:true,
    official_command:'npm audit signatures', verified_registry_signatures:144, verified_attestations:74,
    audit_debug_log:'npm-audit-signatures-debug.log', observed_http_urls:urls,
    trust_cache:'cache/npm/_tuf/tuf-repo-cdn.sigstore.dev',
    trust_endpoint_observation:'TUF trust cache identifies tuf-repo-cdn.sigstore.dev; npm HTTP debug logs do not log TUF HTTP. No claim of packet-level network capture or registry /keys fallback request.',
    omp_subjects:subjects};
  save(path.join(meta,'npm-signatures-closure.json'),cryptoResult);
  fs.copyFileSync(logPath,path.join(meta,'npm-audit-signatures-debug.log'));
  for (const name of ['archive-manifest.json', 'provenance.json', 'pristine-manifest.json',
    'pristine-manifest-files.txt','pristine-manifest-dirs.txt','pristine-manifest-symlinks.txt',
    'runtime-closure.json','runtime-inventory.json','runtime-manifest-files.txt',
    'npm-signatures.json','npm-signatures-closure.json','npm-audit-signatures.log',
    'npm-audit-signatures-debug.log','bun-install.log','package-lock.json']) {
    fs.copyFileSync(path.join(meta,name),path.join(research,`acquisition-${name}`));
  }
  fs.copyFileSync(path.join(sb,'tmp/npm-verify/package-lock.json'),path.join(research,'acquisition-npm-package-lock.json'));
  assert(errors.length === 0, `Unresolved runtime dependencies: ${JSON.stringify(errors)}`);
  assert(lockMismatch.length === 0, 'Installed closure differs from selected npm lock');
  assert(aliases.length === 0, 'External symlink or shared regular-file inode found');
  assert(runtimeOnly.length === 0, 'Runtime includes packages absent from official crypto audit');
  console.log(JSON.stringify({packages:inventory.length,omp:omp.length,files,links,maxLinks,
    dependency_errors:errors.length,lock_mismatches:lockMismatch.length,aliases:aliases.length,
    crypto_subjects:subjects.length,runtime_only:runtimeOnly.length,tree_sha256:sha(listing)},null,2));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
