FINDING 1 of 1
WHAT FAILED: The product code and the discrimination are both CORRECT now — do not touch `src/web/public/app.js`, and do
not restructure the mid-send block. What fails is that the gate test does not pass RELIABLY. Three consecutive runs of the
prescribed command `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`:
  run 1: 1 passed (11.3s), exit 0
  run 2: 1 FAILED, exit 1 — `Test timeout of 30000ms exceeded` at e2e/command-center-refresh.spec.ts:185 (`midsend poll fixture`)
  run 3: 1 passed (29.9s), exit 0 — 0.1s under the ceiling
ROOT CAUSE (measured, not inferred — validation/F3-timing-m24.jsonl, 5 instrumented runs): every wait AFTER the view
mounts is stable at ~10.2s (view-mounted -> midsend-poll-rendered = 10135/10126/10138/10131/10138 ms). What varies is the
MOUNT: 1207 / 2470 / 4801 / 13515 / 16893 ms. Two of those runs finished at 24.9s and 28.1s against the 30000ms per-test
timeout in `playwright.config.ts`. A mount near 20s pushes the final assertion past the ceiling. The failure transcript
shows the correct pre-poll state — the clock ran out mid-assertion; this is NOT a product freeze and NOT a bad specimen.
The mount phase fetches `https://telegram.org/js/telegram-web-app.js` (~850ms), `https://esm.sh/preact@10.19.3`,
`https://esm.sh/htm@3.1.1` and a jsdelivr stylesheet (validation/F3-netprobe-m24.jsonl); on a quiet box the whole mount is
~1.2s, so the jitter tracks machine load (this box runs other seats; `uptime` showed load ~2.8 with another project's node
process at 173% CPU during the failing window). The journey's ~10.2s of deliberate waits — the `waitForTimeout(3000)`
settle sleep plus two 1200ms route delays — leaves no headroom for that.
THE FIX: one line. Make it the FIRST statement inside the test in `e2e/command-center-refresh.spec.ts`, immediately after
`test('command-center refresh control is always reachable and re-pulls output and session metadata', async ({ page }) => {`:
    // The journey itself is ~10s of deliberate waits; page mount on this shared box has been
    // measured between 1.2s and 16.9s. The 30000ms config default leaves no headroom.
    test.setTimeout(90000);
`test.setTimeout()` is a per-test override — it does NOT touch `playwright.config.ts` and does not affect any other spec.
VERIFIED BEFORE BEING PRESCRIBED (validation/F3-fixcheck-timeout-m24.spec.ts, log validation/F3-redteam-probe-m24-a4.log):
  - shipped journey + `test.setTimeout(90000)`: 5 runs, 5 passed, exit 0 every time.
  - discrimination is NOT weakened by the longer timeout: the four mutants in validation/F3-mutant-*-m24.spec.ts already
    carry `test.setTimeout(120000)` and still go red — M1 (`kept` -> `[]`) at line 182, M2 (both resets deleted) and M2a
    (only `openAgentAfterYouRef.current = false;` deleted) at line 204. So raising the ceiling removes the flake without
    removing the test's teeth.
DO NOT "fix" this by deleting or shortening `await page.waitForTimeout(3000);  // Allow send to settle` (line 158). That
sleep is what makes the FIRST freeze block the SETTLED-send specimen; without it that block collapses into the mid-send
one and M1's guard at line 182 is the only thing left. If you want the journey shorter, replace that sleep with a
deterministic wait on the agent turn that the settled send produces
(`await expect(page.locator('[data-testid="terminal-turn-agent"]')).toHaveCount(N)`) and then RE-RUN the M1/M2/M2a
mutants to prove all three are still red — do not ship a shortening that has not been re-mutated.
DO NOT chase M2b (deleting only `sendBaselineRef.current = '';` leaves the spec green). That is correct and was settled at
attempt 3: after a refresh either an agent entry was appended (`openNew` false) or the refresh snapshot equals the
pre-send snapshot (both diffs identical), so no user-visible failure can be constructed from it.
WHY THE LAST ATTEMPT MISSED IT: the specimen was verified once, green, on a quiet box; nothing in the attempt-3
prescription asked for a repeat-run stability check, and a single green run cannot show a 1-in-3 wall-clock flake.
