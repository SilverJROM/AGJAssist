FINDING 1 of 4
WHAT FAILED: E2 newest-first. Independent probe sent summaries oldest-first (`First summary` at `2026-08-27T09:00:00Z`, then `Second summary` at `2026-08-27T10:00:00Z`). `src/web/public/app.js` renders `summaries.map` with no `created_at`/`id` sort, so card 0 was First (9:00 AM) and card 1 was Second (10:00 AM). The focused spec at `e2e/command-center-summaries.spec.ts:31-34` already lists newest-first, so `cards.nth(0)` = `Second summary` cannot fail a non-sorting UI.
THE FIX: In `src/web/public/app.js` inside the summaries-dropdown render (the `summaries.map` around the `data-testid="summary-card"` block), sort a copy before mapping: `[...summaries].sort((a, b) => { const tb = Date.parse(b.created_at || '') || 0; const ta = Date.parse(a.created_at || '') || 0; return tb - ta || (Number(b.id) || 0) - (Number(a.id) || 0); })`. In `e2e/command-center-summaries.spec.ts`, put the fixture oldest-first (id 1 / 09:00 `First summary` first, then id 2 / 10:00 `Second summary`) and keep asserting nth(0) contains `Second summary` and nth(1) contains `First summary`.
WHY THE LAST ATTEMPT MISSED IT: The spec computed expected order from an already-DESC fixture, which is the order the unsort UI already emits.

FINDING 2 of 4
WHAT FAILED: E2 "that agent's summaries". The focused spec routes `**/api/summary-agents/*/summaries` and returns the same two rows for every agent. It never records the GET pathname. A UI that fetches `/api/summary-agents/wrong/summaries` or a hardcoded name would still pass. The pane fixture target is the literal `1`.
THE FIX: In the cards test, replace the glob fulfill with a pathname check: parse `new URL(route.request().url()).pathname` and only return the two-row fixture when it equals `/api/summary-agents/1/summaries`; otherwise return `{ summaries: [] }`. After opening the dropdown, `expect(requestedPath).toBe('/api/summary-agents/1/summaries')` (record `requestedPath` from that route). Keep the pane target literal `1` in the tmux fixture.
WHY THE LAST ATTEMPT MISSED IT: The glob mock made every agent look like agent-a.

FINDING 3 of 4
WHAT FAILED: E2 timestamped. Cards do render `new Date(s.created_at).toLocaleString()`, but `e2e/command-center-summaries.spec.ts` never asserts any date/time text. A card with only summary text + `via …` would still pass.
THE FIX: In the cards test, compute the expected stamp in the spec from the fixture literal (not from the component): `const newestStamp = new Date('2026-08-27T10:00:00Z').toLocaleString();` and `await expect(cards.nth(0)).toContainText(newestStamp);` plus the same for `2026-08-27T09:00:00Z` on nth(1).
WHY THE LAST ATTEMPT MISSED IT: Assertions covered summary text and endpoint tags only.

FINDING 4 of 4
WHAT FAILED: E2 scrollable. The dropdown has inline `max-height:400px;overflow:auto`, but the focused spec never asserts those styles. Removing them would still pass.
THE FIX: After the dropdown is visible, `await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toHaveCSS('max-height', '400px');` and `await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toHaveCSS('overflow', 'auto');`.
WHY THE LAST ATTEMPT MISSED IT: Scroll was CSS-only with no discriminating assertion.
