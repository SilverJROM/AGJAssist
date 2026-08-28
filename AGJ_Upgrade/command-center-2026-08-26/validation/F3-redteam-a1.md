F3 standard red-team validation, attempt 1

Commit under test: 0228b9940b7f25da993f0a4155ef52b3c1c9f110
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: PASS, 1 test passed.

Lens 1, mechanism coverage:
The implementation calls both `loadSessions()` and `setFriendlyRefreshTick()`, and the probe recorded sessions/output request counts increasing from 1 to 2 after clicking `terminal-refresh`.

Lens 2, lifecycle UI:
FAIL. The refresh control exposes no refresh-specific in-progress or completion state. The DOM/ARIA evidence has an empty `statusText` before and after refresh and no disabled/aria-busy refresh lifecycle signal.

Lens 3, test discrimination:
FAIL. The committed focused test does not track request counts or use distinct second-call fixtures, so it would pass if the refresh click did not reload sessions or output.

Lens 4, reachability:
PARTIAL/FAIL. `terminal-refresh` exists in the normal FriendlyTerminalView transcript state, but the search-open branch replaces it; the probe recorded `whileSearchOpen.refreshCount: 0`.

Verdict: FAIL. Scope has no og-requirement text for I1/I2, so the slice scope is the authority.
