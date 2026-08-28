# D6 validation red-team a2

Commit under test: b687e58a439efca490c6b31a8b0c447c8fabe101

Scope authority: the validator brief claimed E2/E3 had no og-requirements text. They do. Judged against og-requirements:

- E2. Agent window Summaries dropdown listing that agent's summaries, timestamped, newest first, scrollable; empty state reads sensibly.
- E3. A summary records which endpoint produced it; LLM-fail degrade is D3. D6's E3 piece is the visible endpoint tag.

Mechanism chosen for newest-first: client-side `[...summaries].sort` by `Date.parse(created_at) DESC` then `id DESC` before card render. Fixture is deliberately oldest-first. Per-agent key is `activeTarget` (pane target); the focused spec pins GET `/api/summary-agents/1/summaries` to the literal pane target `1`.

Focused test result:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-summaries.spec.ts --project=cc` passed 2/2 (PIPE_EXIT=0).

Independent UI probe:
- `validation/D6-ui-probe-a2.mjs` served shipped `src/web/public` on :3215 with two panes and an oldest-first fixture.
- Newest-first: PASS. card0=`Second summary` 10:00 AM via test-ep; card1=`First summary` 9:00 AM via 140.
- GET paths: `/api/summary-agents/sessA%3A0.0/summaries` then `/api/summary-agents/sessB%3A0.0/summaries`. Isolation: agent-b showed only `B-only summary`.
- Scroll CSS: overflow=auto, max-height=400px.
- Empty: `No summaries yet`.
- Timestamps: browser and Node `toLocaleString()` match (`8/27/2026, 10:00:00 AM` / `9:00:00 AM`).
- XSS: `html0_has_raw_b=false`.
- Evidence: `validation/D6-ui-a2.png`, `validation/D6-ui-empty-a2.png`, `validation/D6-dom-aria-a2.txt`.

Red-team lenses:
- Scope coverage: a1 findings 1–4 are in this commit (sort + oldest-first fixture, pathname pin to `/api/summary-agents/1/summaries`, fixture-derived stamps, overflow/max-height CSS). Empty state still asserts the literal `No summaries yet`.
- Test discrimination: a non-sorting UI fails nth(0)=Second against oldest-first rows; a wrong-agent fetch gets `{summaries:[]}` and fails toHaveCount(2); missing stamps fail toContainText of the spec's Date path; missing scroll fails toHaveCSS.
- Product behavior: dropdown, cards, endpoint tags, timestamps, scroll, empty state, and per-pane fetch all observed.
- Error handling: fetch catch still falls to empty; LLM-fail degrade remains D3.
- Endpoint provenance (E3): non-default `via test-ep` on the newest card. Clean for D6's UI piece.
- Evidence: screenshot + DOM/ARIA exist for the user-visible dropdown.

Verdict: PASS. The D6 scope survives the standard-tier adversarial pass.
