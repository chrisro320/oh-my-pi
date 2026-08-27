# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

### Compaction callback imports

- Any use of `buildSessionContext` in `session-maintenance.ts` or `session-advisors.ts` MUST have a value import from `"./session-context"`; `import type` alone is insufficient because the function is called at runtime.
- When a patch changes a callback signature or adds a runtime symbol, the regression contract MUST inspect every affected caller and import, then execute the callback path with zero provider calls where practical.

```ts
import { buildSessionContext } from "./session-context";
```
---

## Testing Requirements

- Bun-based scripts MUST NOT be treated as a type-check: `bun` can run code with missing runtime imports until the affected branch executes.
- A regression MUST assert both the runtime import and all changed callsite arities; the production package's `check:types` SHOULD also be run when its compiler dependency is available.
- If the compiler is unavailable in a published/global package, record the exact missing executable and retain the behavioral/static regression instead of claiming type-check coverage.

```ts
assert.match(source, /import\s*\{[^}]*\bbuildSessionContext\b[^}]*\}\s*from "\.\/session-context";/);
```

---

## Code Review Checklist

- [ ] Every newly called runtime symbol has a non-type import.
- [ ] Every changed callback signature has all production callsites migrated.
- [ ] The regression fails for the missing-import/stale-callsite shape and passes after the fix.
- [ ] Validation reports distinguish behavioral coverage from compiler coverage.
