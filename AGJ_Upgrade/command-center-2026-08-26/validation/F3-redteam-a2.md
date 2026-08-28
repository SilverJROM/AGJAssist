F3 standard red-team validation, attempt 2

Commit under test: 3b7312b0658b2c38e9dbc8c3ac62144a1c2113d8
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: PASS, 1 test passed.

Scope authority note:
I1/I2 have no criterion text in og-requirements.md, so the F3 scope text is the authority.

Lens 1, request mechanism:
PASS. The focused test now uses distinct second-call fixtures and proves session metadata plus pane output are re-requested on refresh.

Lens 2, search-open reachability:
PASS. The validation probe recorded `searchOpen.refreshCount: 1` and `searchOpen.refreshVisible: true`.

Lens 3, lifecycle ordering:
FAIL. `handleRefresh()` marks completion after scheduling the `refreshTick`, not after the child output reload completes. This can announce completion before pane output is re-pulled, and can mark `Updated` after a failed sessions request.

Lens 4, DOM/ARIA lifecycle surface:
FAIL. The validation probe recorded the refresh button disabled with `aria-busy="true"`, but no `[data-testid="terminal-refresh-status"]` element/text in the normal topbar: `during.status: null`, `during.sawRefreshing: false`.

Lens 5, test discrimination:
PARTIAL/FAIL. The focused test is now discriminating for second-call output/session fixtures, but it does not assert the in-progress state, natural click reachability, search-open refresh behavior, or completion-after-output ordering.

Verdict: FAIL.
