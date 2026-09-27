# Research review corrections

Authoritative final: preflight-report.md, matrix.json, runtime-gates.json. Initial scout JSONs are retained as raw research, not accepted final verdicts.

- TUI/provider moves predate this upgrade.
- Exporting an existing helper does not duplicate it; stale-response helper existed in 18.2.10.
- Static same-looking context cannot override strict patch rejection; 0069 fails at trailing type-definition context after new AnthropicOutputEffort/tool-change types.
- Cross-root touched paths are now canonical without a leading slash; earlier-failure overlap recomputed, execution roots unchanged.
- Scope of 0034 includes hindsight/backend.ts and reset-boundary ordering. Scope of 0067 is only core compaction.ts.
- Checkpoint warning is a static persistence risk already present in 18.2.10, not proven new regression.
- 0065 generated rules must be regenerated from current KDL, never replace entire new JSON with old output.
- Default fuzz acceptance is not behavior proof; 0014 crash is actual zero-network buildRequest execution.
- CacheCompaction reviewed its 16 entries: no blocker. CachePersistence reviewed its 10 entries and identified metadata/0065 omissions, corrected above. Neither review executed tests or edited files.
