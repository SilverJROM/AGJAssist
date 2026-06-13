# Decision: A4 grok effort changes are launch-time only

## Context
A4 implements the app-side grok adapter before the full binding-driven launcher. R10 requires per-agent default effort and v1 launch-time effort. The grok TUI contract supports `--effort {low,medium,high,xhigh,max}` at process launch.

## Decision
The A4 dispatch helper resolves effort before launch and requires the grok launch command to include `--effort <tier>`. A mid-run effort change is not represented as a live in-TUI mutation in A4.

## Consequence
Changing effort for an active grok task requires relaunching the grok session at a task boundary and resending the app-composed prompt. This keeps R10 honest for v1 and avoids claiming an unverified live-effort control.
