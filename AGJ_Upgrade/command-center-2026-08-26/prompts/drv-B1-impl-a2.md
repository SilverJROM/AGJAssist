# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] B1 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed B1: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator B1 STATUS: DONE — FAIL no ovm.spec.ts; --project=cc missing; hashes 404 not home

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# B1 a1 validator prescription
commit under test: e94ef39a35c3646927e9955b1ddd08c00fd50eff
req: A1 (og-requirements.md DOES contain A1; the validator brief's "NO CRITERION TEXT FOUND" is wrong. A1 + the B1 SCOPE are the contract.)
A1 text: the mini-app no longer exposes Overmind: Workflows, Overmind Projects, and OVM Console screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
SCOPE extra (plan): unknown `#/overmind*` hashes redirect home; extract surviving bottom-nav/landing helpers out of overmind-helpers.js; do not delete FriendlyTerminalView or the file wholesale.

Independent probe (Desktop Chrome, no Telegram initData → `App()`, which is what `--project=cc` will render): `#/overmind`, `#/overmind-projects`, `#/conversations`, `#/overmind-xyz` stay on those hashes and show `.empty-state` "Page not found". Header literals Workflows / OVM Projects / Chat are gone. `.overmind-page` count is 0. Dashboard cards no longer include Workflows.

FINDING 1 of 3
WHAT FAILED: Slice test output `e2e/command-center-ovm.spec.ts` was never authored. Commit e94ef39 only touches `src/web/public/app.js` and `src/web/public/nav-helpers.js`. Exact command `npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1` cannot collect B1. With `-c playwright.cc.config.ts` Playwright reports `No tests found.` Standing contract: that path is an OUTPUT of the slice. A1 is user-visible, so the spec must fail when the hash does not become home and when the three nav literals reappear.
THE FIX: Create `e2e/command-center-ovm.spec.ts`. Use `test('B1 …')` titles so `--grep B1` hits them. Seed `localStorage` with literal `agj_token` and `agj_user` (same pattern as `e2e/parent-hint-b5.spec.ts`). Specimens the app would not choose: goto `#/overmind`, `#/overmind-projects`, `#/conversations`, `#/overmind-xyz` (DEFAULT landing is `/`). After load, assert the URL string is exactly the home hash — `expect(page.url()).toBe('http://localhost:3210/index.html#/')` (or `new URL(page.url()).hash === '#/'`). Do NOT use `/index\\.html#\\//` (that regex matches `#/overmind` and is how `e2e/command-center-ovm-fence.spec.ts` A1 currently fails to discriminate). Do NOT import `AVAILABLE_BOTTOM_NAV_TABS` / `readLandingTab` from `nav-helpers.js` or `overmind-helpers.js` to compute expected. Also assert literal header texts: `page.locator('nav.nav-links a')` allTextContents() does not include `'Workflows'`, `'OVM Projects'`, or `'Chat'`; `page.locator('.overmind-page')` has count 0; dashboard at `#/` has no card whose label text is `'Workflows'`.
WHY THE LAST ATTEMPT MISSED IT: Implementer shipped only the app.js/nav-helpers extract and never wrote the slice spec.

FINDING 2 of 3
WHAT FAILED: The slice command uses `--project=cc` with the default config. `playwright.config.ts` only registers `chromium` and comments that `cc` lives in `playwright.cc.config.ts`. Exact command failed first with `Error: Project(s) "cc" not found. Available projects: "chromium"` before the missing spec even mattered.
THE FIX: Add a `cc` project to `playwright.config.ts` so the written command collects: `{ name: 'cc', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3210' } }`. Do not nest a second webServer inside that project (TestProject ignores it). Leave the existing `webServer` (`node e2e/static-server.mjs` on :3210) — B1 is UI-only and that server is enough. Do not rewrite the plan command; tiller runs it as written. Confirm green with the exact string `npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1` (wrapped in `timeout --signal=TERM --kill-after=15s 180s …`).
WHY THE LAST ATTEMPT MISSED IT: No spec was added, so the missing `cc` project was never exercised.

FINDING 3 of 3
WHAT FAILED: Scope requires unknown `#/overmind*` hashes redirect home. Desktop `App()` (Playwright `cc` / no `window.Telegram.WebApp.initData`) has no redirect: `useRoute()` keeps `#/overmind` and the else-branch renders `<div class="empty-state">Page not found</div>`. Probe evidence: url stayed `http://127.0.0.1:3229/index.html#/overmind` with that empty-state (screenshot `validation/B1-ui-_overmind-a1.png`, DOM `validation/B1-dom-_overmind-a1.html`). Same for `#/overmind-projects`, `#/conversations`, `#/overmind-xyz`. `TgApp()` only remaps unknown hashes in a mount-only `useEffect(() => { … }, [])` via `KNOWN_EXACT`; a later `hashchange` still 404s. Removing those ids from `KNOWN_EXACT` is not a redirect in `App()`.
THE FIX: In both `App()` and `TgApp()` in `src/web/public/app.js`, after `const route = useRoute()`, add a `useEffect` that depends on `route` (not `[]`): if `route === '/conversations' || route === '/overmind' || route.startsWith('/overmind')`, call `navigate('/')`. Use the literal `'/'` (scope word "home"), not `readLandingTab()`. Keep the existing 404 else-branch for other unknown routes. Do not re-route those hashes to `OvermindWorkflows` / `OvermindProjects` / `OvmConsole`. Leave those function bodies in app.js (G1 deletes leftovers). Do not delete `FriendlyTerminalView`.
WHY THE LAST ATTEMPT MISSED IT: It unhooked the three screens and dropped the ids from `KNOWN_EXACT`, which only affects TgApp's first-load unknown-hash remap, and never added an `App()` / post-mount redirect.

Notes for the next seat (not extra findings):
- A1 allows 404 OR redirect; B1 SCOPE requires redirect. Implement the redirect so the B1 spec's exact-home URL assertion can pass.
- `src/web/public/overmind-helpers.js` still lists `/conversations`, `/overmind`, `/overmind-projects` in `AVAILABLE_BOTTOM_NAV_TABS`; `tests/bottom-nav-helpers.test.ts` still imports that alias and asserts `addBottomNavTab(..., "/overmind")` succeeds. Live `app.js` imports `./nav-helpers.js` (clean). G1 deletes the leftover file; do not spend this slice deleting it, but the B1 spec must import nothing from overmind-helpers for expected values.
- Do not copy fence A1's `toHaveURL(/\/index\.html#\//)` — it matches `#/overmind`.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(B1): <summary>` or `[B1] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer B1 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer only: remove Workflows, Overmind Projects, and OVM Console (`OvmConsole` at `/conversations`) screens, header links, and bottom-nav entries; unknown `#/overmind*` hashes redirect home. Extract surviving bottom-nav/landing helpers out of `overmind-helpers.js` before dropping the OVM import. Do not delete FriendlyTerminalView or the file wholesale (G1 deletes leftovers).

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **A1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1`
