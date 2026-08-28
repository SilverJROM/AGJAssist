F3 standard red-team validation, attempt 4

Commit under test: fe7126493cdde78282fa4c5133dae5f05787a8e6
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: PASS, 1 test passed.

Scope authority note:
I1/I2 have no criterion text in og-requirements.md, so the F3 scope text is the authority.

Lens 1, lifecycle control reachability:
PASS. Normal and search-open DOM both contain exactly one refresh button plus one `[data-testid="terminal-refresh-status"]`; both branches show `Refreshing` while disabled/`aria-busy="true"` and then `Updated`.

Lens 2, request mechanism:
PASS. The probe request log shows explicit `/output?lines=2000&refresh=1` calls for both normal and search-open refreshes, and session metadata calls advance from bash to zsh-*.

Lens 3, rendered output replacement:
FAIL. With a non-empty initial pane snapshot, explicit refresh requests returned `refreshed output fixture` and `search refresh output fixture`, but the rendered transcript remained `initial output fixture` after both refreshes.

Lens 4, focused test discrimination:
FAIL. The focused test starts with empty output, so it does not prove refresh replaces already-rendered pane output.

Verdict: FAIL.
