# D6 validation red-team a1

Commit under test: 7576c422c1b16725855df859cd93b06268896a2e

Scope authority: the validator brief claimed E2/E3 had no og-requirements text. They do. Judged against og-requirements:

- E2. Agent window Summaries dropdown listing that agent's summaries, timestamped, newest first, scrollable; empty state reads sensibly.
- E3. A summary records which endpoint produced it; LLM-fail degrade is D3's service claim. D6's E3 piece is the visible endpoint tag.

Mechanism chosen for newest-first: client-side `created_at DESC, id DESC` before card render. D4 also ORDER BYs, but this slice's e2e mocks the API, so the UI must still discriminate newest-first on an oldest-first fixture (D-082).

Focused test result:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-summaries.spec.ts --project=cc` passed 2/2 (PIPE_EXIT=0). That pass is not a clean AC pass.

Independent UI probe:
- `validation/D6-ui-probe-a1.mjs` served shipped `src/web/public` on :3214, two panes `sessA:0.0` / `sessB:0.0`, oldest-first fixture, XSS specimen, empty-state page.
- GET paths: `/api/summary-agents/sessA%3A0.0/summaries` then `/api/summary-agents/sessB%3A0.0/summaries` — per-activeTarget fetch works.
- Isolation: agent-b showed only `B-only summary`.
- Newest-first: FAIL. card0=`First summary` 9:00 AM via 140; card1=`Second summary` 10:00 AM via test-ep.
- Scroll CSS: overflow=auto, max-height=400px (present, untested by spec).
- Empty: `No summaries yet` (present).
- XSS: `html0_has_raw_b=false`; text shows escaped `<b>RAW</b>`.
- Evidence: `validation/D6-ui-a1.png`, `validation/D6-ui-empty-a1.png`, `validation/D6-dom-aria-a1.txt`.

Red-team lenses:
- Scope coverage: toggle, dropdown, cards, endpoint tags (`via 140` / `via test-ep`), empty state, and scroll CSS exist. Newest-first does not.
- Test discrimination (D-082): focused spec fixture is already DESC; glob-mocks every agent path; no timestamp assertion; no overflow/max-height assertion. A non-sorting, any-agent, untimestamped, non-scrolling dropdown can still pass.
- Product behavior: `summaries.map` preserves API order; fetch key is `activeTarget` (pane target), which isolated correctly in the probe.
- Error handling: fetch `.catch(() => setSummaries([]))` falls through to empty state; LLM-fail degrade is out of D6 scope (D3).
- Endpoint provenance (E3): tags resolve `summaryEndpoints.find(e => e.id === s.endpoint_id)` and the probe showed non-default `via test-ep` on the 10:00 row. Clean for the UI piece of E3.
- Evidence: screenshot + DOM/ARIA captured for the user-visible dropdown.

Verdict: FAIL. Product dropdown is present, but newest-first is neither implemented nor discriminated, and the focused spec also misses per-agent path, timestamp, and scroll assertions.
