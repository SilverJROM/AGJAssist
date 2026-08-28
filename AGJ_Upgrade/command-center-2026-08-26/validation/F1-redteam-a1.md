# F1 validator red-team a1

Commit under test: `fa77ed72a0d3d195644a0fb92c73ff7686161c8e`
parent: `git show` / `git diff fa77ed72^..fa77ed72` only. Did not judge HEAD.
verdict: standard-fail
focused command: PASS (6/6) — see `validation/F1-vitest-a1.log`
probes: `validation/F1-probe-a1.json` (real jsdom localStorage)

## Criterion authority

The brief says G1/G2/G3 have **NO CRITERION TEXT** in og-requirements.md and to treat Scope as authority.
That lookup is wrong. Real text is at `og-requirements.md:93-99`. Judged F1 against **Scope** (helpers only) plus G3's isolation+reload clause, which is this row. G1 affordance and G2 switcher/send-clears UI are F2 — not an F1 fail, not a PLAN_DEFECT against this commit.

Mechanism named for G3: localStorage key per (viewer, pane). Pair→key must be injective; reload = `setItem` on that key, read back via `getItem` / `readTerminalDraft`.

## Lens 1: pair→key injectivity / alias — **FAIL (G3)**

`_terminalDraftKey = (viewer, pane) => \`agj_terminal_draft:${String(viewer)}:${String(pane)}\``.

Probe specimen `colon_join_is_injective`:
- write `("v","a:b","draft-X")` then `("v:a","b","draft-Y")`
- one key remains: `agj_terminal_draft:v:a:b`
- both reads return `draft-Y`

Tmux targets in this app are `session:window.pane` (`app.js` `activeTarget`). Viewer is an unconstrained string. Colon-free spec panes (`0.0`) cannot expose the alias.

Same-viewer tmux panes `agj:0.0` vs `agj:0.1` do isolate (probe `tmux_target_pane_isolation`) because the delimiter collision needs a `:` in **both** fields. Still a G3 leak for any viewer that contains `:`.

## Lens 2: clear isolation spec does not discriminate — **FAIL (D-082 / G3)**

`"clears a specific viewer/pane draft"` writes the other draft **after** clear. Probe `spec_clear_passes_with_wipe_all`: `localStorage.clear()` stand-in still passes. Impl `removeItem` is actually key-scoped (`clear_key_scoped_impl`). Test cannot fail the wipe-all.

## Lens 3: write isolation + persist second path — **clean**

- Three (viewer,pane) combos with literal drafts `"draft A/B/C"` — would fail if the key ignored viewer or pane.
- Persist test reads `localStorage.getItem("agj_terminal_draft:viewer-persist:1.2")` as a second path (literal key, not `_terminalDraftKey`). Would fail if write used another prefix.
- Missing key → `null` (literal). Overwrite `"first"` → `"second"` (literals).
- Real jsdom roundtrip matches the Map mock for colon-free keys (`jsdom_roundtrip`).

## Lens 4: scope / wakeup / UI — **clean**

Diff is only `terminal-chat-state.js` helpers + the spec. No wakeup wiring. No FriendlyTerminalView / switcher port (F2). `typeof localStorage === "undefined"` and try/catch no-op on quota: fail-safe, not a leak.

## Lens 5: write(null) vs clear — **note, not a fail**

`write(null)` stores `""`; `clear` `removeItem`s. Read of empty string vs missing is `""` vs `null`. Scope exports both functions; F2 must call `clearTerminalDraft` on send, not `write(..., null)`.

Verdict: not standard-clean. Product alias + non-discriminating clear spec.
