// Task-specific generation only: use the pinned upstream compiler, never edit compiled JSON by hand.
import { compileCompatRules } from "/tmp/omp-upgrade-18126-01a1684f/rebase/compiler/scripts/compat-compiler/index.ts";
const root = Bun.argv[2] ?? "/tmp/omp-upgrade-18126-01a1684f/rebase/work/pi-catalog/src/compat";
const compiled = await compileCompatRules(`${root}/rules`);
const output = "/tmp/omp-upgrade-18126-01a1684f/rebase/compiler/rules.json";
await Bun.write(output, JSON.stringify(compiled));
console.log(JSON.stringify({ output, rules: compiled.cascade.rules.length, files: compiled.files.length }));
