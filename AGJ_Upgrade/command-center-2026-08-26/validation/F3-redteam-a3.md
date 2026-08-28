F3 standard red-team validation, attempt 3

Commit under test: 27e16a7d49ee2d8b567d516aa02e5142ca86b663
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: PASS, 1 test passed.

Scope authority note:
I1/I2 have no criterion text in og-requirements.md, so the F3 scope text is the authority.

Lens 1, normal lifecycle:
PASS. The independent probe recorded a normal topbar refresh status element, `Refreshing` while disabled/`aria-busy="true"`, then `Updated` only after refreshed transcript text appeared.

Lens 2, session/output re-pull:
PASS. The focused test and probe used literal second-call fixtures. DOM evidence shows `zsh` session metadata and `refreshed output fixture` after refresh.

Lens 3, composer retention:
PASS. DOM evidence recorded composer value `keep-me` before, during, and after refresh.

Lens 4, search-open reachability:
PARTIAL/FAIL. The refresh button remains visible/enabled when search is open, but the search-open DOM has no `[data-testid="terminal-refresh-status"]` element (`searchOpen.statusCount: 0`), so the lifecycle surface is not always reachable with the control.

Lens 5, test discrimination:
PARTIAL/FAIL. The focused test does not assert the search-open refresh status element or run the refresh lifecycle from the search-open branch.

Verdict: FAIL.
