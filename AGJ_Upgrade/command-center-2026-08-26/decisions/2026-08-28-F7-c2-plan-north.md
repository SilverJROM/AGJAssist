# 2026-08-28 F7-c2 — ESCALATE north (fault_class=plan)

EXIT terminal_drain=true 09:52:35Z. F7 CLOSE red, localize `fault_class=plan failing_units=(none)`. skip_ladder.

F1–F6 product is plan-conformant (F5 switcher spec clicks `tabs-collapse` before asserting the strip). The F7 journey does not.

## Defects (from RAISE-F7-c2)

- **G3** asserts `data-testid=refresh-from-session` (nowhere in `src`). og-req G3 is F1 localStorage drafts (`terminal-chat-state.js`, no DOM).
- **H3** asserts `document.documentElement[data-theme]`. F6 delivered `prefers-color-scheme` CSS tokens. Mockup `data-theme` is on the mockup `cc-phone` harness node.
- **I2** asserts composer value survives `page.reload` (no plan row owns active-pane restoration). og-req I2 is refresh in-progress + completion, composer never blocked (F3).
- **G2/J1/J2** vs **H1**: journey never clicks `tabs-collapse`; default `tabsCollapsed=true` (H1 green) hides the strip, so H1 green and G2/J1/J2 green are mutually exclusive under this harness.
- **FENCE_STUB=F1**: F1 is client-only; stub is Fastify preHandler on API routes. A0 invented `api/agent-session/refresh` only inside the stub block. `expected_negative_fail_ids: G3` cannot be met by harness rewrite alone.

Localize asks: rebind G1–J2 to og-requirements **and mint a D0-style harness-correctness row** plus a corrected F7 negative naming a **server-backed** contributor.

## North question (changes "done")

1. **PLAN_SOUND harness-only** — rewrite `e2e/command-center-window-fence.spec.ts` in F7/F0: click `tabs-collapse` before G2/J1/J2; rebind G3/H3/I2 to og-req; change F7 negative to a server-backed contributor. No new queue row.
2. **Mint F0b** (or similar) harness-correctness row + F7 negative rebase. Scope change.
3. **Product scope** — add the missing surfaces (refresh testid, documentElement data-theme, composer-across-reload). Changes F1–F6 done meaning.

Projcore default if you stay silent: (1) harness-only, product F1–F6 frozen, negative on a real API contributor (not F1).

DIRECTION-F7-a9 SKIP keep parked. D0 RETRY a10 so the drain can work the already-approved summaries harness while F7 waits.
