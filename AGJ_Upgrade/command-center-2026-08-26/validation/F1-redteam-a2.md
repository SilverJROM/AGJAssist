# F1 validator red-team a2

Commit under test: `c5aa50963b0c07b4becd0984038632928a9d3513`
parent diff matches the driver brief (encodeURIComponent key + clear-order + colon specimen).
verdict: standard-clean PASS
focused command: PASS (7/7) — see `validation/F1-vitest-a2.log`
probes: `validation/F1-probe-a2.json` (real jsdom localStorage)

## Criterion authority

Brief says G1/G2/G3 have no og-requirements text. Wrong: `og-requirements.md:93-99`.
F1 Scope is helpers only. G1 affordance and G2 switcher/send-clears UI stay F2 — not a fail.
G3 isolation+reload is this row. Mechanism: `localStorage` key
`agj_terminal_draft:${encodeURIComponent(String(viewer))}:${encodeURIComponent(String(pane))}`.

## a1 findings

1. Colon-join alias — **closed**. Probe `a1_colon_no_alias`: `("v","a:b")` → `agj_terminal_draft:v:a%3Ab` = `draft-X`; `("v:a","b")` → `agj_terminal_draft:v%3Aa:b` = `draft-Y`. Spec asserts those **literal** keys (D-082, not `_terminalDraftKey`).
2. Clear spec wrote survivor after clear — **closed**. Spec now writes both first. Probe `a1_clear_spec_fails_wipe_all`: `localStorage.clear()` stand-in no longer passes.

## Lenses

- **Injectivity:** pair set including `:`, `%3A`, empty, tmux `agj:0.0`/`agj:0.1`, space/slash/percent/unicode — 7 distinct keys, each read returns its own literal (`pair_set_injective`, `special_char_isolation`, `tmux_target_isolation`). Encoded fields contain no `:`, so the remaining colon is a unique split.
- **Persist second path:** colon-free `agj_terminal_draft:viewer-persist:1.2` still matches (`encodeURIComponent` is identity on those chars). Would fail a different prefix.
- **Write isolation / overwrite / missing-null:** literals; would fail if viewer or pane were ignored.
- **Scope:** diff is only the key line + spec. No wakeup, no FriendlyTerminalView.
- **write(null) vs clear:** stores `""` vs `removeItem`. Note only; F2 must call `clearTerminalDraft` on send.

Verdict: standard-clean PASS.
