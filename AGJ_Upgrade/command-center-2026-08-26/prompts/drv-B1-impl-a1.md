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

# THE SLICE — B1 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer only: remove Workflows, Overmind Projects, and OVM Console (`OvmConsole` at `/conversations`) screens, header links, and bottom-nav entries; unknown `#/overmind*` hashes redirect home. Extract surviving bottom-nav/landing helpers out of `overmind-helpers.js` before dropping the OVM import. Do not delete FriendlyTerminalView or the file wholesale (G1 deletes leftovers).

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

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
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=B1 attempt=1 role=implementer
  marker=DRV-B1-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(B1): <summary>` or `[B1] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer B1 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[B1] <summary>' \
  && printf '%s\n' '[projcore callback] implementer B1 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer B1 STATUS: BLOCKED — <reason>`. Do not widen scope.
