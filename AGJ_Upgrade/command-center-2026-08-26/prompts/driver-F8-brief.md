# [driver] Slice F8 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
PRODUCT REGRESSION FIX (north-ruled, not harness). e2e/terminal-ux-conversation.spec.ts A4/A6/A7 fail on current HEAD — confirmed by direct execution, not a harness or environment artifact. The effort north-star's non-negotiable ("do not regress the existing terminal/chat surface — key row, send-as-command/raw-keys, image attach, ME-nav, search, font, groups, selection prompts — across phone/tablet/desktop") is broken at 390px: A4 (type/font live Settings sync + mobile fit), A6 (single topbar controls still perform their functions at 390), A7 (show-raw reveals stripped chrome). The spec is untouched by this run; F4/F5/F6 rewrote app.js/style.css for agent-window-v2 and dropped this. Restore the terminal topbar controls' functionality at 390px per the LOCKED mockup (mockups/final/agent-window-v2.html, mobile-first/390px reference) — un-hide/re-enable what the collapse work dropped, do NOT revert F4-F6's product intent otherwise. Claude implementer only (sonnet5/opus5) — this is app.js/style.css UI work. STOP and escalate to north (not a coordinator call) if the locked mockup itself is found to intentionally omit a control A4/A6/A7 require — that specific conflict is JROM's to resolve, not a default "fix the code" case.

## Acceptance criteria (ACs)
A4,A6,A7

## Focused tests (the row's acceptance)
`npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`

## Contract
- estimate: 40min · deps: A0,F4,F5,F6 · impl_tier=L3 · val_tier=L3 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
