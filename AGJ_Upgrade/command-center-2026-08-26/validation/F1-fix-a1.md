# F1 attempt 1 — FAIL prescription

commit judged: fa77ed72a0d3d195644a0fb92c73ff7686161c8e
Focused row command PASSES (6/6) — see `validation/F1-vitest-a1.log`. It fails on G3 isolation: two distinct (viewer, pane) pairs alias onto one localStorage key, and the clear spec cannot catch a wipe-all. **2 findings, fix in this order.**

Read first: the brief says G1/G2/G3 have **NO CRITERION TEXT** in og-requirements.md. That is wrong. Real text is at `og-requirements.md:93-99`. This slice's Scope is still the authority for *what F1 builds* (helpers only). Do **not** port composer/switcher UI (that is F2). G3's isolation+reload clause IS this row.

- **G1.** Composer text kept per-agent on switch + "draft kept" affordance → F2 UI. F1 only supplies the storage helpers.
- **G2.** Send clears draft + switcher indicator → F2 UI. F1's `clearTerminalDraft` is the primitive.
- **G3.** Draft state per-viewer/client (localStorage keyed by pane), survives reload, never leaks one agent's draft into another's.

Mechanism chosen for G3: `localStorage` key per (viewer, pane) pair. That pair-to-key map must be injective.

Probe: `validation/F1-probe-a1.json` (real jsdom `localStorage`, not the spec's Map mock).

---

FINDING 1 of 2
WHAT FAILED: `_terminalDraftKey` in `src/web/public/terminal-chat-state.js` is
`agj_terminal_draft:${String(viewer)}:${String(pane)}`. Colon is both the field delimiter and a legal character in tmux pane targets (`session:0.0`) and in any viewer string that contains `:`. Probe specimen:
- `writeTerminalDraft("v", "a:b", "draft-X")`
- `writeTerminalDraft("v:a", "b", "draft-Y")`
leaves a **single** key `agj_terminal_draft:v:a:b` and both reads return `"draft-Y"`. Distinct pairs leaked. Focused spec never feeds a `:` in either field (`"0.0"`, `"0.1"`, `"1.2"`), so 6/6 stays green.
THE FIX: Make the key injective over the pair by encoding each field with `encodeURIComponent` (turns `:` into `%3A`):
```
const _terminalDraftKey = (viewer, pane) =>
  `agj_terminal_draft:${encodeURIComponent(String(viewer))}:${encodeURIComponent(String(pane))}`;
```
Do not JSON.stringify the pair as the only change and then assert via `_terminalDraftKey` — that would compute the expected key from the mechanism under test (D-082).
Add a spec `it` with those two literal pairs. Assert **literal** keys and values:
- `localStorage.getItem("agj_terminal_draft:v:a%3Ab")` === `"draft-X"`
- `localStorage.getItem("agj_terminal_draft:v%3Aa:b")` === `"draft-Y"`
- `readTerminalDraft("v", "a:b")` === `"draft-X"`
- `readTerminalDraft("v:a", "b")` === `"draft-Y"`
Colon-free keys used by the persist test (`agj_terminal_draft:viewer-persist:1.2`) are unchanged under `encodeURIComponent` — keep that assertion as the same literal.
WHY THE LAST ATTEMPT MISSED IT: isolation cases only used colon-free `"0.0"` / `"0.1"` panes, which cannot collide under `:`-join.

FINDING 2 of 2
WHAT FAILED: `tests/unit/terminal-draft-jsdom.spec.ts` `"clears a specific viewer/pane draft"` writes the survivor **after** `clearTerminalDraft`. Sequence today: write `v1/0.0` → clear `v1/0.0` → write `v1/0.1` → expect `v1/0.1`. Probe `spec_clear_passes_with_wipe_all`: a stand-in that calls `localStorage.clear()` (wipes every draft) still passes this test. The isolation claim for **clear** is untested. Impl `removeItem` on one key is actually scoped (probe `clear_key_scoped_impl`), but the spec cannot fail the wipe-all alias.
THE FIX: In that same `it()`, write **both** drafts first, then clear one:
```
writeTerminalDraft("v1", "0.0", "to be cleared");
writeTerminalDraft("v1", "0.1", "must-remain");
clearTerminalDraft("v1", "0.0");
expect(readTerminalDraft("v1", "0.0")).toBeNull();
expect(readTerminalDraft("v1", "0.1")).toBe("must-remain");
```
Do not write `"must-remain"` after the clear. Leave the Map mock in place if you want; this sequence fails wipe-all on that mock too.
WHY THE LAST ATTEMPT MISSED IT: the comment said "Other drafts remain" but the other draft was created after the clear.
