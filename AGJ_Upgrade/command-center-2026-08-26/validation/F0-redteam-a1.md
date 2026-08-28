F0 validator red-team a1

Commit under test: d08ca352dd82017d5784cc0ec7ea8371551bac68

Scope source: HARNESS-SMOKE has no criterion text in og-requirements.md; per brief, the
slice scope is the authority.

Focused command result:
- Ran the row command inside the required 180s timeout wrapper.
- Overall wrapped command exit: 0.
- Playwright produced the intended red fence failure and the post-run JSON check accepted
  the generated assertion failures.

Evidence checked:
- fence-report-v1.json exists.
- AGJ_Upgrade/command-center-2026-08-26/validation/F0-focused-a1.log exists.
- test-results/command-center-window-fenc-f8fe0-center-window-fence-journey-cc/error-context.md exists.

Adversarial lenses:
- Collection lens: check() no longer throws after assertion failures, so the harness does
  not stop after G1. Report evidence shows G1, G2, G3, H1, H2, H3, I1, I2, J1, and J2
  were all collected and all failed with kind "assert".
- Report-finally lens: the report is written in finally after the journey body, and the
  focused command consumed it after Playwright returned.
- Discrimination lens: expected red state is not computed from the mechanism under test.
  The node check independently reads the report and requires at least one assert failure.
- Scope lens: the commit edits only e2e/command-center-window-fence.spec.ts and does not
  implement product UI.
- Mechanism lens: G3 now checks the visible refresh-from-session control via a locator,
  matching the stated "visibility of refresh-from-session" mechanism instead of the old
  session-refresh API status path.

Verdict: standard-clean PASS.
