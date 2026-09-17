# Component Guidelines (TUI & Session Selector Overlay)

> Executable contracts, viewport boundaries, and keybinding isolation for terminal components.

---

## 1. Scope / Trigger
- **Trigger**: Introducing modal overlays, dynamic container swapping, or quick-action keybindings inside full-height terminal components (such as `SessionSelectorComponent`).
- **Goal**: Prevent scrollback buffer pollution (issue #3283), eliminate keyboard input collisions with search filters, and ensure non-blocking, leak-free async data presentation.

---

## 2. Signatures

### Component Slot Swapping (Private Pattern in `SessionSelectorComponent`)
```typescript
// Conceptual contract implemented via private members:
// #contentSlot: Container;
// #showPreview(session: SessionInfo): void;
// #closePreview(): void;
```

### Preview Component Construction
```typescript
class SessionPreviewView implements Component {
  constructor(
    session: SessionInfo,
    onClose: () => void,
    onSelect: () => void,
    onExit: () => void,
    getTerminalRows: () => number,
  );
  handleInput(keyData: string): void;
  render(width: number): readonly string[];
  dispose(): void;
}
```

---

## 3. Contracts

### Keybinding Isolation Contract
- When `searchInput.getValue().length === 0`:
  - `Space` / `keyData === " "` MUST trigger `onPreviewRequest(selected)`.
  - `Backspace` / `delete` MUST trigger `onDeleteRequest(selected)`.
- When `searchInput.getValue().length > 0`:
  - `Space` MUST append a space character to the active filter string; it MUST NOT open the preview overlay.
- Inside Preview Overlay:
  - `matchesKey(keyData, "ctrl+c")`: MUST call `onExit()` immediately to quit the process.
  - `matchesKey(keyData, "enter") | "\n"`: MUST call `onSelect()` to resume the session immediately.
  - `matchesKey(keyData, "escape") | matchesKey(keyData, "space")`: MUST call `onClose()` to restore the list.
  - Directional keys (`up`, `down`, `pageUp`, `pageDown`): Forwarded to `ScrollView.handleScrollKey`.

### Viewport Line-Budget Contract
- **No Outer Append**: Dialogs and previews MUST NOT be appended outside or below `#contentSlot`.
- Total rendered lines within `#contentSlot` MUST be bounded by `Math.max(4, terminalRows - chromeHeight)` so that `topBorder + chrome + max(list, preview) + footer` never exceeds `terminalRows`.

### Concurrency & Data Integrity Contract
- Data fetching MUST use read-only helpers (`loadSessionMessagesReadOnly`) that acquire no session locks and instantiate no file writers.
- Every async fetch MUST be protected by `#generation = ++this.#generation` and checked against `#disposed` to discard stale completion callbacks.

---

## 4. Validation & Error Matrix

| Condition | Observable Behavior | Error Handling / Fallback |
| :--- | :--- | :--- |
| Valid JSONL session file | Displays User first prompt + collapsed middle + last assistant turn | None (success) |
| Non-existent or corrupt JSONL | Displays `Failed to load preview: <error>` in red | Overlay remains responsive; Esc/Space returns to list |
| Empty session (no messages) | Displays `(No conversation messages found in session)` | Normal view rendered without crash |
| User presses Space with non-empty search query | Character `" "` typed into search input | Preview NOT opened; fuzzy filter re-runs |
| User presses Ctrl+C inside preview | Triggers `onExit()` and terminates picker | Process exits cleanly without hanging in raw mode |
| User presses Enter inside preview | Disposes preview + list and invokes `onSelect(session)` | Direct resume without returning to list |

---

## 5. Good / Base / Bad Cases

### Good Case
User navigates session list with `Up`/`Down`. At an ambiguous title, user presses `Space`. A preview overlay appears instantly with the real prompt and last assistant reply. User verifies and presses `Enter`. The session resumes immediately.

### Base Case
User opens preview, decides it is the wrong session, presses `Esc` or `Space`. The overlay closes; the list re-renders with the previous `selectedIndex`, query, and scroll offset completely intact.

### Bad Case (Prevented)
User types `"bug "` into search input. If `Space` were intercepted globally, the space after `"bug"` would open the preview instead of filtering by `"bug "`. Guarding `searchInput.getValue().length === 0` prevents this bug.

---

## 6. Tests Required (with Assertion Points)

1. **Initial List Hint Assertion**:
   - `selector.render(width).includes("Space preview") === true`
2. **Space Key Trigger Assertion**:
   - Send `" "` to selector with empty query.
   - `selector.render(width).includes("Enter resume") === true`
   - Formatted role markers `[User]` or `[Assistant]` present in output.
3. **Escape Key Reversion Assertion**:
   - Send `"\x1b"` to open preview.
   - `selector.render(width).includes("Space preview") === true`
   - `selector.render(width).includes("Enter resume") === false`
4. **Input Query Isolation Assertion**:
   - Send `"test "` to list.
   - Output stays in list mode (`"Space preview"` present, `"Enter resume"` absent).
5. **Direct Enter Resume Assertion**:
   - Press `Enter` (`"\n"`) in preview mode.
   - `selectedSession === mockSession` and selector terminates.
6. **Direct Ctrl+C Hard Exit Assertion**:
   - Send `"\x03"` in preview mode.
   - `exited === true` and process terminal closes.

---

## 7. Wrong vs Correct

### Wrong (Stacking below container)
```typescript
// WRONG: Appending overlay below contentSlot
this.addChild(this.#sessionList);
if (this.#previewView) {
  this.addChild(this.#previewView); // Pushes footer below terminal viewport!
}
```

### Correct (Slot swapping)
```typescript
// CORRECT: Swapping inside #contentSlot Container
this.#contentSlot.clear();
this.#contentSlot.addChild(this.#previewView); // Competes only with list height budget
this.#onRequestRender?.();
```

### Wrong (Unchecked inline object cast)
```typescript
// WRONG: fabricates unchecked shape
const text = (m as { content?: unknown }).content;
```

### Correct (Checked type guard)
```typescript
// CORRECT: type narrowed safely
const rawContent = "content" in m ? m.content : undefined;
const text = extractPreviewText(rawContent).trim();
```

## Scenario: Turn-gated quota refresh without forced repaint

### 1. Scope / Trigger

0037/0041 migration into 18.2.3's `StatusLineComponent` usage refresh pipeline.
Preserve quota cadence independently from upstream's five-minute TTL and
fetch-completion redraw behavior.

### 2. Signatures

- `StatusLineComponent.refreshUsageInBackground()`: starts eligible usage work.
- Completed-turn identity: latest assistant timestamp/stopReason.
- Anthropic gate: 60,000 ms; other-provider TTL: 50,000 ms.
- Fetch completion invalidates render cache, not the render-request callback.

### 3. Contracts

- Anthropic fetches once at cold start; later fetches require a NEW completed
  turn and elapsed gate. Elapsed time or repeated idle rendering alone must
  never cause polling.
- Other eligible providers retain the 50s TTL; a new completed turn bypasses it.
  Preserve the existing provider whitelist and in-flight/sequence protection.
- Preserve `#invalidateStatusLineRenderCache()` so a natural redraw shows new
  values. Remove fetch-triggered `#onBranchChange` repaint, not cache invalidation.
- The 180s historical Anthropic value is not this plan's contract; 0041 is
  physically merged into the 18.2.3 0037 candidate, not omitted semantically.

### 4. Validation & Error Matrix

| Condition | Expected observation |
|---|---|
| Anthropic cold start | One fetch |
| Anthropic idle for ten minutes | No additional fetch |
| New Anthropic turn at 59,999 ms | No fetch |
| New Anthropic turn at 60,000 ms | Fetch |
| Other eligible provider at 50,000 ms | TTL refresh allowed |
| Other provider new completed turn before TTL | Fetch |
| Ineligible provider | No fetch |
| Fetch completes | Zero forced repaint callbacks |

### 5. Good / Base / Bad Cases

- Good: mock the clock and provider result, exercise the real component.
- Base: next natural render consumes the invalidated cache.
- Bad: remove render-cache invalidation to conceal repaint, or compare constant
  spelling instead of observing fetch/repaint counts.

### 6. Tests Required

Runtime probes must reject 90s gate, 300s TTL, idle polling, and forced-repaint
mutations. No real provider calls. Source CLI and offline behavior are not
equivalent to visual TUI or provider acceptance; report those limits explicitly.

Machine-check representation before delivery/review:
`grep -nE '0037|omit:0041' patches/apply.sh`.

### 7. Wrong vs Correct

- Wrong: fetch completion calls the branch-change callback to repaint.
- Correct: fetch completion updates state and invalidates the render cache;
  existing natural redraws render the next values.
