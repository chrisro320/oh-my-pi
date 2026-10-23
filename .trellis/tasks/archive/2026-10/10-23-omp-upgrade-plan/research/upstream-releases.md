# Official upstream release assessment

Read-only research by `UpstreamReleases`, 2026-10-23. Findings are package/release/tag metadata and changelog claims, not patch compatibility or behavioral proof. No packages were downloaded, installed or executed.

## Candidate identity

- npm `latest`: `18.12.6` (also independently read by the main session).
- GitHub release: `v18.12.6`, published `2026-10-21T21:02:53Z`; tag commit `45c35e40c46166dc726ccc52f5d27f40f2449f99` (tag commit is unsigned). Baseline tag `v18.10.1` resolves to `5d0aaffaf1f987503ce129a642fb6e30339615af`, matching the existing manifest.
- Package: `@oh-my-pi/pi-coding-agent@18.12.6`.
- Tarball: `https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-18.12.6.tgz`.
- npm integrity: `sha512-Wo+FcJ7A3RY/OFuafj4hcdIAXc/W7NMxbanwQh3Cmy8s57+ihLOLgAv+HROxHBkssEMg0MaScwkQ9xwqLPiC/g==`.
- npm SHA-1 shasum: `7762bf3888fa4a841545ea2e13f6e22e74f24792`. SHA-256 is not published in this metadata and has NOT been computed. Future archive acquisition must verify registry integrity and record SHA-256 before pristine extraction.
- npm metadata has no `gitHead`; the GitHub tag is the source-commit reference, not a completed provenance verification. A SLSA attestation endpoint is advertised; its provenance has not been independently validated.
- Bun floor remains `>=1.3.14`; installed Bun `1.3.14` meets that declared floor only. This is not runtime compatibility proof.

## Release cadence and options

Fourteen successor releases occurred from October 12 through October 21: `18.10.2`, `.3`, `.4`, `18.11.0`, `.1`, `.2`, `.3`, `18.12.0`, `.1`, `.2`, `.3`, `.4`, `.5`, `.6`. Several same-day hotfix pairs show active churn in the exact lifecycle/cache code we customize.

Recommended candidate for user approval: pin `18.12.6`, not a floating `latest`. It includes the newest fixes in the same failure classes as our custom patches, but is only about two days old. `18.11.3` has more elapsed time but omits all subsequent revival/effort/compaction fixes; it is not established as safer by testing. Remaining on `18.10.1` avoids immediate migration but retains the current divergence. No target is approved yet.

## Changelog-derived overlap requiring source/consumer assessment

| Boundary | Upstream claims | Migration implication |
| --- | --- | --- |
| OAuth/account authority | `18.12.0` SIGTERM during refresh-token replacement; `18.11.2` read-only account peek; Codex 401/403/404 discovery changes | Inspect 0090 durable journal, lease/CAS, Anthropic-only protection, unlock and account-scoped catalog behavior. Similar claims do not authorize retiring the family. |
| Compaction/Codex continuity | Kept-turn fixes; retry-delay policy; tool-result snapcompact ordering; archive >500k preservation; `/compact` or `/new` during tools; image-stripping text compaction; `18.12.6` no idle compaction for persistent Codex cache | Highest-risk cross-package rebase with the compaction and image families. Preserve fail-closed chain semantics and direct manual compaction without reintroducing forced notes. |
| Prompt/resume prefix | Stable MCP instruction ordering; eval-history resume/fork cache fixes; memory recall duplication fixes | Compare actual serialized provider requests and persistence transitions, not source-text similarity. |
| Model effort/cache policy | `18.12.4` inherited-auto/default effort persistence; `18.12.5` explicit subagent effort; Vertex TTL and persistent-cache catalog axes | Recheck the installed model-default repair and 0069/0074/0092/0094 at real consumers. |
| Subagent lifecycle | `18.12.3` revival after abort and parked todo availability; `18.12.4` waking without prefix loss; `18.12.6` revival fallback chain | 0101 is a likely overlap candidate, NOT proven upstream-owned. Check persisted system prompt and yield-item behavior on warm/cold revival. |
| Task/eval | `18.10.2` task structured output defaults off while eval agent/workpool stay structured; `18.12.2` eval wait time excluded from timeout | Assess tools/schema/prefix contract and runtime consumer compatibility. |
| TUI/native | Status profile/subagent spend changes, approval UI, read line-selector changes, Tern narrow-sheet fixes | Rebase footer/read/UI interfaces; native binary overlay still needs separate source inspection/rebuild/acceptance. |

## Declared API/behavior changes to account for

- `18.10.3`: `isOfficialCodexApiUrl` moves from `pi-ai` to `pi-catalog/wire/codex`; image-count/inline-budget resolvers take an explicit `officialEndpoint` boolean.
- `18.10.4`: Codex Code Mode and `toolNamespacesInfo` stream option removed.
- `18.11.2`: gateway key resolvers take route options rather than `AuthStorage` directly.
- `18.11.3`: `ui.approve()` returns `once | session | deny` instead of boolean.
- `18.12.0`: `PI_CODEX_ZSTD` replaced by `PI_REQUEST_COMPRESSION`; find result/detail contracts change.
- `18.12.1`: eval `display()` removed from Python and JavaScript; formatted-code helpers take a file path rather than a language. Existing custom MIME-display capability must be explicitly mapped, not silently dropped or turned into a no-op.

These are changelog statements until checked against target source. An older `18.10.0` TUI removal mentioned by the research agent predates our baseline and is not a new migration delta.

## Dependency scope

The coding-agent metadata retains eleven direct OMP package names. Including itself and Linux x64 native package yields the same thirteen-package shape as the installed receipt. Native optional platform packages are version-pinned at `18.12.6`. Non-OMP dependency declaration strings were reported unchanged; actual transitive resolution, every package archive integrity, native binary hashes and full runtime closure were not verified.

## Primary sources

- [npm exact package](https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/18.12.6)
- [npm native package](https://registry.npmjs.org/@oh-my-pi/pi-natives/18.12.6)
- [GitHub release](https://github.com/can1357/oh-my-pi/releases/tag/v18.12.6)
- [Tag commit](https://api.github.com/repos/can1357/oh-my-pi/commits/v18.12.6)
- [Release list](https://api.github.com/repos/can1357/oh-my-pi/releases)
- [Coding-agent changelog](https://raw.githubusercontent.com/can1357/oh-my-pi/v18.12.6/packages/coding-agent/CHANGELOG.md)
- [AI changelog](https://raw.githubusercontent.com/can1357/oh-my-pi/v18.12.6/packages/ai/CHANGELOG.md)
- [Catalog changelog](https://raw.githubusercontent.com/can1357/oh-my-pi/v18.12.6/packages/catalog/CHANGELOG.md)
- [TUI changelog](https://raw.githubusercontent.com/can1357/oh-my-pi/v18.12.6/packages/tui/CHANGELOG.md)

## Remaining evidence gaps

Target source-level patch overlap, archive SHA-256, verified tag-to-artifact provenance, full transitive/native closure, per-capability adoption proofs and all executable acceptance results remain unverified. Source/archive research can proceed after target selection without claiming implementation or deployment authorization.
