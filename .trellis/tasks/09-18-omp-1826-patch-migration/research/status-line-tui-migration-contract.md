# Status-line package-boundary contract for OMP 18.2.6

## Verified ownership

Official integrity-verified 18.2.6 source places all three status-line behavior surfaces in `@oh-my-pi/pi-tui`:

- segment rendering: `pi-tui/src/status-line/segments.ts`;
- accepted segment IDs/defaults: `pi-tui/src/status-line/schema.ts`;
- usage TTL, turn-boundary detection, refresh sequencing, render-cache invalidation, and `#onBranchChange`: `pi-tui/src/status-line/component.ts` (`refreshUsageInBackground()` around 1637, `#applyUsageRefreshReports()` around 1682–1705).

The coding-agent package owns the application adapter and provider fetch implementation:

- `pi-coding-agent/src/modes/status-line-host.ts` implements `StatusLineHost` and currently forwards only `(session, signal)`;
- `pi-coding-agent/src/session/agent-session.ts:10585-10606` calls `AuthStorage.fetchUsageReports()` and currently accepts only `signal`;
- `pi-coding-agent/src/config/settings-schema.ts:106-123` imports and re-exports the segment schema from `@oh-my-pi/pi-tui/status-line/schema`.

Therefore the correct 18.2.6 migration boundary is not “0037 remains in agent” and not “0037 is TUI-only.” It is cross-package:

| Logical patch | 18.2.6 production ownership | Plan root |
|---|---|---|
| 0004 token total | `pi-tui/src/status-line/segments.ts` | `TUI` |
| 0033 cache-turn segment | `pi-tui/src/status-line/schema.ts` + `segments.ts` | `TUI` |
| 0037/0041 usage gate | TUI component owns cadence/turn/repaint; coding-agent host/session bridge carries active-provider restriction; 0026 keeps AuthStorage provider filtering in pi-ai | `NM` for the cross-package 0037 candidate; existing 0026 stays `AI` |

A package move is not upstream adoption. The 18.2.6 pristine component still has a five-minute TTL and calls `#onBranchChange?.()` after changed usage; `token_total` still excludes cache reads and `cache_turn` is absent.

## Controller contract

`patches/apply.sh` already declares `TUI="${NM}/pi-tui"`, but 18.2.3-era machinery is incomplete. The 18.2.6 implementation must add all of the following as one boundary change:

1. `--print-plan` maps `$TUI` to the literal root label `TUI`.
2. The 18.2.6 plan uses `:TUI` for 0004/0033 and `:NM` for cross-package 0037; it never labels a `pi-tui/src/...` patch as `AGENT`.
3. Apply/check/revert status mirroring resolves TUI through the existing absolute-root mirror function and copies every touched TUI file.
4. Apply-mode gate exports include:

   ```sh
   export OMP_PATCH_VERIFY_TUI_ROOT="$TUI"
   ```

5. Root precedence for status-line gates is:

   ```text
   OMP_PATCH_VERIFY_TUI_ROOT
     → OMP_PATCH_VERIFY_NM/pi-tui
     → HOME/.bun/install/global/node_modules/@oh-my-pi/pi-tui
   ```

Machine-check form: `OMP_PATCH_VERIFY_TUI_ROOT → OMP_PATCH_VERIFY_NM/pi-tui → HOME default`.

   Agent-side adapter checks use the analogous existing `OMP_PATCH_VERIFY_AGENT_ROOT` precedence. A TUI text read paired with a live/global import is a false gate and must fail review.
6. `verify-patch-family-rollups.sh`:
   - extracts `pi-tui` for the 18.2.6 baseline;
   - accepts `TUI` in `patchroot()`;
   - maps a resolved `TUI` entry to `pi-tui` in the 18.2.6 package-set calculation;
   - maps `NM` to all selected 18.2.6 roots including `pi-tui` when a cross-package patch can touch it;
   - includes `pi-tui` in reverse/pristine file-set and byte comparison;
   - pins the 18.2.6 plan with the literal root labels emitted by the real controller.
7. Dependency-complete sandbox construction includes the official `pi-tui@18.2.6` package and its exact package graph. A correct patch applied to an extracted TUI tree while the runtime imports a nested pristine TUI is a failed sandbox.

Older 18.1.14/18.1.18/18.2.3 plan outputs and family baselines remain unchanged. TUI is added to the 18.2.6 chain oracle; it is not retrofitted into old plan labels.

## 0037 host boundary

The portable TUI component must not import coding-agent policy or `AgentSession`. It detects the active provider/turn boundary and calls the host capability. The host contract carries the optional provider restriction through the coding-agent adapter to `AgentSession.fetchUsageReports()`, which forwards it to the 0026-patched `AuthStorage.fetchUsageReports({ providers })`.

Required flow:

```text
pi-tui StatusLineComponent
  active provider + turn/TTL decision
    → StatusLineHost.fetchUsageReports(session, signal, providers?)
      → coding-agent statusLineHost adapter
        → AgentSession.fetchUsageReports(signal, providers?)
          → pi-ai AuthStorage.fetchUsageReports({ signal, providers })
```

This keeps renderer portability: TUI owns refresh scheduling; coding-agent owns runtime policy bridging; pi-ai owns credential fan-out/filtering.

## Behavior-sensitive status-line gate

Add or adapt one selected-root gate for the complete family. It must use both `OMP_PATCH_VERIFY_TUI_ROOT` and `OMP_PATCH_VERIFY_AGENT_ROOT`, import the component/segments/schema from the selected TUI tree, and exercise the real exported agent host adapter with a fake session rather than merely grepping forwarding text.

Observable assertions:

1. `token_total` includes input, output, cacheRead, cacheWrite, orchestration input/output/cacheRead.
2. `cache_turn` is accepted by schema and renders only the most recent settled non-error/non-aborted assistant usage; streaming usage does not render.
3. Non-Anthropic idle redraws observe 50-second TTL; a new settled turn bypasses it once.
4. Anthropic idle redraws make zero fetch calls after the cold fetch; a settled turn can fetch only at the 60-second boundary.
5. The active provider restriction reaches the fake `AgentSession.fetchUsageReports` through the real coding-agent host adapter.
6. A changed usage result invalidates TUI render memo but does not invoke `#onBranchChange`/request a repaint.
7. Session/provider identity changes reset the appropriate usage context without leaking the previous provider's turn key.

Fault controls must independently reject:

- a `token_total` implementation that drops cache reads;
- removal of `cache_turn` from schema or registry;
- restoration of the five-minute hardcoded TTL;
- idle Anthropic polling;
- a 59,999 ms Anthropic refresh or a blocked 60,000 ms refresh;
- host adapter dropping the provider list;
- usage completion calling `#onBranchChange`;
- a gate whose TUI import resolves outside `OMP_PATCH_VERIFY_TUI_ROOT`.

The gate is registered by resolved plan membership, not version-string shortcuts or symbol-presence skips. Missing TUI package/assets/imports fail closed.
